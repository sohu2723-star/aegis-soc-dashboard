/**
 * AEGIS Ingest API
 * ================
 * Receives real events from VMs (Fail2ban, SSH, ModSec) and pfSense Suricata (syslog)
 * and pfSense (syslog/API). Each event triggers the auto-defense engine.
 *
 * All endpoints require X-AEGIS-Key header.
 */
import { Router } from "express";
import { z } from "zod";
import { db } from "@workspace/db";
import {
  securityEventsTable, alertsTable,
  sshSessionsTable,
  httpAttacksTable,
  dbAttacksTable,
  dnsAttacksTable,
  ldapAttacksTable,
  ftpSessionsTable,
} from "@workspace/db";
import { broadcaster } from "../lib/broadcaster";
import { evaluateEvent } from "../lib/auto-defense";
import { sendTelegramMessage, telegramAvailable } from "../lib/telegram";
import { getSetting } from "../lib/app-settings";
import { isDefenderIp, isLabInternalIp, isAttackerSubnetIp, isSuricataProtocolNoiseSid } from "../lib/ip-classifier";
import { eq } from "drizzle-orm";
import { recordTrafficStats } from "./network";

const router = Router();
const INGEST_KEY = process.env.AEGIS_INGEST_KEY;
if (!INGEST_KEY) {
  throw new Error(
    "AEGIS_INGEST_KEY env var is required. " +
    "Set a strong random secret (e.g. openssl rand -hex 32). " +
    "VMs send this via X-AEGIS-Key header."
  );
}

function auth(req: any, res: any, next: any) {
  const key = req.headers["x-aegis-key"];
  if (!key || key !== INGEST_KEY) {
    res.status(401).json({ error: "Invalid or missing X-AEGIS-Key header" });
    return;
  }
  next();
}

function sev(s: string): "critical" | "high" | "medium" | "low" {
  const v = (s ?? "").toLowerCase();
  if (v === "critical" || v === "1") return "critical";
  if (v === "high"     || v === "2") return "high";
  if (v === "medium"   || v === "3" || v === "warning") return "medium";
  return "low";
}

async function insertEvent(values: typeof securityEventsTable.$inferInsert) {
  const [row] = await db.insert(securityEventsTable).values(values).returning();
  const [event] = await db.select().from(securityEventsTable).where(eq(securityEventsTable.id, row.id));
  const serialized = { ...event, createdAt: event.createdAt.toISOString() };
  broadcaster.broadcast("security_event", serialized);
  broadcaster.broadcast("stats_update", { timestamp: new Date().toISOString() });
  await evaluateEvent({
    id:          event.id,
    type:        event.type,
    subtype:     event.subtype,
    severity:    event.severity,
    sourceIp:    event.sourceIp,
    targetHost:  event.targetHost,
    description: event.description,
    status:      event.status,
  });
  return event;
}

async function mkAlert(eventId: number, severity: "critical"|"high", message: string) {
  const [row] = await db.insert(alertsTable).values({
    message: message.slice(0, 255), severity,
    channel: "telegram",           // all high+ go to telegram channel
    acknowledged: false, eventId,
  }).returning();
  broadcaster.broadcast("alert", { id: row.id, severity });

  // Send Telegram immediately for all high+ alerts — do not wait; fail silently
  if (telegramAvailable()) {
    getSetting("telegramEnabled").then(enabled => {
      if (enabled === "false") return;
      // Myanmar Standard Time (UTC+6:30) timestamp
      const MST_OFFSET_MS = (6 * 60 + 30) * 60 * 1000;
      const mst = new Date(Date.now() + MST_OFFSET_MS);
      const ts  = `${mst.getUTCFullYear()}-${String(mst.getUTCMonth()+1).padStart(2,"0")}-${String(mst.getUTCDate()).padStart(2,"0")} ${String(mst.getUTCHours()).padStart(2,"0")}:${String(mst.getUTCMinutes()).padStart(2,"0")}:${String(mst.getUTCSeconds()).padStart(2,"0")} (MST)`;
      const emoji = severity === "critical" ? "🚨" : "⚠️";
      const label = severity === "critical" ? "CRITICAL ALERT" : "HIGH ALERT";
      const text  =
        `${emoji} <b>AEGIS — ${label}</b>\n` +
        `🕐 ${ts}\n` +
        `${message.slice(0, 280)}`;
      sendTelegramMessage(text).catch(() => {/* silent */});
    }).catch(() => {/* silent */});
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Generic
// ─────────────────────────────────────────────────────────────────────────────
router.post("/ingest/event", auth, async (req, res) => {
  const { source, type, subtype, severity: s, sourceIp, targetHost, toolUsed, description, layer, blocked = false, signature_text } = req.body;
  if (!sourceIp || !description) { res.status(400).json({ error: "sourceIp and description required" }); return; }

  // Defender infrastructure IPs (hub 10.30.30.10, company VMs) must never
  // appear as attackers. The hub SSHes into company VMs to tail logs; those
  // SSH connections can trigger LDAP/MySQL/SSH auth log entries that the
  // forwarder mistakenly forwards as attack events.
  if (isDefenderIp(sourceIp)) {
    res.status(200).json({ ok: true, skipped: "defender_ip" });
    return;
  }

  const event = await insertEvent({
    type: type ?? source ?? "network_attack", subtype: subtype ?? "Unknown",
    severity: sev(s), sourceIp, targetHost: targetHost ?? "internal-network",
    toolUsed: toolUsed ?? source ?? null, description,
    status: blocked ? "blocked" : "detected", layer: layer ?? "perimeter",
    signatureText: signature_text ? String(signature_text).slice(0, 2000) : null,
  });
  const severity = sev(s);
  if (severity === "critical" || severity === "high")
    await mkAlert(event.id, severity, `${severity.toUpperCase()} [${source ?? "sensor"}]: ${description.slice(0, 120)}`);

  res.status(201).json({ ...event, createdAt: event.createdAt.toISOString() });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suricata alert (EVE JSON) — from pfSense Suricata via aegis_forwarder hub
// ─────────────────────────────────────────────────────────────────────────────
router.post("/ingest/suricata", auth, async (req, res) => {
  const { alert, src_ip, dest_ip, proto, event_type } = req.body;

  // ── Topology-aware source filter ──────────────────────────────────────────
  // pfSense Suricata monitors ALL traffic on em1.10 (DMZ) and em2.20 (Internal).
  // That includes: hub SSH monitoring (10.30.30.10), VM-to-VM traffic (10.x→10.x),
  // pfSense gateway probes, and GNS3 NAT cloud return traffic (192.168.122.x,
  // 91.189.x.x internet updates → Suricata TCP-reassembly noise).
  //
  // Valid attack source: 192.168.10.x (Kali attacker subnet, routed via R1).
  // Everything else is either lab-internal or outbound response traffic — skip silently.
  if (isLabInternalIp(src_ip)) {
    res.status(200).json({ ok: true, skipped: "lab_internal_ip" });
    return;
  }

  const a = alert ?? {};

  // ── Suricata internal protocol-noise filter ───────────────────────────────
  // Suricata SID ranges 2200000–2230999 are internal stream-tracking, decoder,
  // and app-layer events — NOT real attack signatures.
  // "SURICATA STREAM ESTABLISHED packet out of window" (SID 2210020) is the
  // most common example: it fires on TCP out-of-order packets on established
  // connections, including responses to outbound apt-get / DNS requests.
  const signatureIdRaw = typeof a.signature_id === "number" ? a.signature_id : null;
  if (isSuricataProtocolNoiseSid(signatureIdRaw)) {
    res.status(200).json({ ok: true, skipped: "suricata_protocol_noise_sid" });
    return;
  }

  // ── Attacker-subnet-only filter ───────────────────────────────────────────
  // In this lab, ALL attacks originate from Kali (192.168.10.0/24) via Router.
  // If src_ip is a public internet IP (not lab-internal, not 192.168.10.x),
  // it is outbound RESPONSE traffic — company VMs doing apt-get, DNS, NTP, etc.
  // These responses trigger Suricata on return but are NOT attacks.
  // Drop them silently; only Kali subnet traffic is real hostile traffic.
  if (!isAttackerSubnetIp(src_ip)) {
    res.status(200).json({ ok: true, skipped: "not_attacker_subnet" });
    return;
  }
  const s = sev(String(a.severity ?? 3));

  // Pull every useful field out of the EVE JSON alert object
  const signatureId:   number | null = typeof a.signature_id === "number" ? a.signature_id : null;
  const alertRev:      number | null = typeof a.rev           === "number" ? a.rev           : null;
  const alertAction:   string | null = a.action   ? String(a.action).slice(0, 32)   : null;
  const alertCategory: string | null = a.category ? String(a.category).slice(0, 128) : null;

  // Full rule text: Suricata EVE JSON can include `alert.rule` when rule logging is enabled,
  // or the forwarder can pass it as a top-level `signature_text` field.
  const signatureText: string | null =
    (a.rule ? String(a.rule).slice(0, 2000) : null) ??
    (req.body.signature_text ? String(req.body.signature_text).slice(0, 2000) : null);

  const event = await insertEvent({
    type: "network_attack",
    subtype: a.signature ?? "Suricata Alert",
    severity: s,
    sourceIp: src_ip ?? "unknown",
    targetHost: dest_ip ?? "internal-network",
    toolUsed: "suricata",
    description: `Suricata ${event_type ?? "alert"}: ${a.signature ?? "Unknown"} | ${a.category ?? ""} | ${proto ?? "TCP"}`,
    status: "detected",
    layer: "perimeter",
    signatureId,
    alertRev,
    alertAction,
    alertCategory,
    signatureText,
  });
  if (s === "critical" || s === "high") await mkAlert(event.id, s, `SURICATA: ${a.signature} (SID:${signatureId ?? "?"}) — ${src_ip} → ${dest_ip}`);
  res.status(201).json({ id: event.id });
});

// ─────────────────────────────────────────────────────────────────────────────
// Fail2ban → auto-block IP in DB
// ─────────────────────────────────────────────────────────────────────────────
router.post("/ingest/fail2ban", auth, async (req, res) => {
  // target_ip: IP of the machine running Fail2ban (the defender being attacked)
  // filter_regex: optional Fail2ban filter failregex pattern
  // maxretry / findtime / bantime: optional jail config for rule display
  const { ip, jail, failures, target_ip, filter_regex, maxretry, findtime, bantime } = req.body;

  // Hub (10.30.30.10) repeatedly SSHes into company VMs to tail logs.
  // If SSH key auth fails or the connection is slow, fail2ban can mistakenly
  // ban the hub itself. Skip any event or block for defender-subnet IPs.
  if (isDefenderIp(ip)) {
    res.status(200).json({ ok: true, skipped: "defender_ip" });
    return;
  }

  // sshSessionsTable: NOT inserted here — /ingest/ssh already records every
  // individual SSH failure. Fail2ban fires AFTER N failures (ban event only),
  // so inserting a session here would create a duplicate record with no username.
  //
  // blockedIpsTable: NOT inserted here — auto-defense evaluates the event via
  // evaluateEvent() inside insertEvent() and writes to blocked_ips when a
  // matching rule fires. Manual insert here would bypass auto-defense and write
  // the wrong reason text.

  // Build a human-readable rule text for the dashboard.
  // If forwarder sends filter_regex, prefer that; otherwise summarise jail config.
  const signatureText: string = filter_regex
    ? `failregex = ${filter_regex}`
    : [
        `jail = ${jail ?? "sshd"}`,
        maxretry  != null ? `maxretry = ${maxretry}`         : null,
        findtime  != null ? `findtime = ${findtime}s`        : null,
        bantime   != null ? `bantime  = ${bantime}s`         : null,
        `action   = iptables-multiport`,
      ].filter(Boolean).join("\n");

  const event = await insertEvent({
    type:"network_attack", subtype:"Brute Force", severity:"high",
    sourceIp: ip ?? "unknown",
    targetHost: target_ip ?? "company-web-server",
    toolUsed:"fail2ban", description:`Fail2ban banned ${ip} from [${jail ?? "sshd"}] after ${failures ?? "?"} failures. Auto-block applied.`,
    status:"blocked", layer:"perimeter",
    signatureText,
  });
  await mkAlert(event.id, "high", `FAIL2BAN: ${ip} auto-banned — jail: ${jail ?? "sshd"}`);
  res.status(201).json({ id: event.id });
});

// ─────────────────────────────────────────────────────────────────────────────
// SSH auth.log
// ─────────────────────────────────────────────────────────────────────────────
router.post("/ingest/ssh", auth, async (req, res) => {
  // dest_ip: IP of the SSH server being attacked (the Ubuntu VM's IP, e.g. 10.10.10.10)
  const { src_ip, dest_ip, username, status: st, auth_method, session_id, failures, prior_failures, signature_text } = req.body;

  // Hub (aegis-company-admin, 10.30.30.10) SSHes into all company VMs every 15s
  // to tail their logs. Those legitimate connections appear in auth.log and get
  // forwarded back as "SSH Brute Force" events — which is wrong.
  // Drop silently; defender connections are NOT attack events.
  if (isDefenderIp(src_ip)) {
    res.status(200).json({ ok: true, skipped: "defender_hub_connection" });
    return;
  }

  const failCount    = Number(failures) || 0;
  // prior_failures = how many failed attempts from this IP before this success event
  // 0 = clean login (authorized); ≥3 = brute-force success (breach)
  const priorFails   = prior_failures != null ? Number(prior_failures) : failCount;
  const targetHost   = dest_ip ?? "company-web-server";

  const { log_source, matched_rule } = req.body;
  await db.insert(sshSessionsTable).values({
    sourceIp: src_ip ?? "unknown", username: username ?? null,
    status: st ?? "failed", authMethod: auth_method ?? null,
    sessionId: session_id ?? null, failures: failCount, bannedBy: null,
    logSource:   log_source   ? String(log_source).slice(0, 128)   : "/var/log/auth.log",
    matchedRule: matched_rule ? String(matched_rule).slice(0, 256) : (failCount >= 5 ? `fail2ban[sshd]: ban after ${failCount} failures` : "auth.log: Invalid password"),
  });

  const sigText = signature_text ? String(signature_text).slice(0, 2000) : null;

  if (st === "success") {
    const isBreach = priorFails >= 3;
    const event = await insertEvent({
      type:      isBreach ? "network_attack" : "auth_event",
      subtype:   isBreach ? "Brute Force Success" : "Authorized Login",
      severity:  isBreach ? "critical" : "low",
      sourceIp:  src_ip ?? "unknown", targetHost,
      toolUsed:  "ssh",
      description: isBreach
        ? `SSH BREACH: ${src_ip} logged in as '${username}' after ${priorFails} failed attempt(s) — attacker is IN!`
        : `Authorized SSH login from ${src_ip} as '${username}' (no prior brute-force attempts)`,
      status: isBreach ? "breach" : "allowed",
      layer: "perimeter",
      signatureText: sigText,
    });
    if (isBreach) {
      await mkAlert(event.id, "critical",
        `🚨 SSH BREACH: ${src_ip} authenticated as '${username}' after ${priorFails} failures`);
    }

  } else if (st === "failed") {
    if (failCount === 1 || failCount % 5 === 0) {
      const severity = failCount >= 5 ? "high" : "medium";
      const event = await insertEvent({
        type:"network_attack", subtype:"SSH Brute Force",
        severity,
        sourceIp: src_ip ?? "unknown", targetHost,
        toolUsed:"ssh",
        description:`SSH brute force from ${src_ip} — ${failCount} failed attempt(s) for user '${username ?? "?"}'`,
        status:"detected", layer:"perimeter",
        signatureText: sigText,
      });
      if (severity === "high") {
        await mkAlert(event.id, "high", `SSH BRUTE FORCE: ${src_ip} — ${failCount} failures targeting '${username ?? "?"}'`);
      }
    }
  }

  res.status(201).json({ ok:true });
});

// ─────────────────────────────────────────────────────────────────────────────
// HTTP Access Log — login breach detection
// Forwarder watches Apache access.log for login endpoints (401/403 failures
// then 200/302 success). Distinguishes authorized login vs brute-force breach.
// Fields: src_ip, dest_ip, url, method, status_code, prior_failures, is_success, targetHost?
// ─────────────────────────────────────────────────────────────────────────────
router.post("/ingest/http_access", auth, async (req, res) => {
  const { src_ip, dest_ip, url, method, status_code, prior_failures, is_success, targetHost, signature_text } = req.body;
  if (!src_ip) { res.status(400).json({ error: "src_ip required" }); return; }

  // Hub (10.30.30.10) and internal VMs must not appear as HTTP attackers.
  if (isLabInternalIp(src_ip)) {
    res.status(200).json({ ok: true, skipped: "lab_internal_ip" });
    return;
  }

  const priorFails = Number(prior_failures) || 0;
  const isSuccess  = Boolean(is_success);
  const host       = targetHost ?? dest_ip ?? "company-web-server";
  const sigText    = signature_text ? String(signature_text).slice(0, 2000) : null;

  if (isSuccess) {
    const isBreach = priorFails >= 3;
    const event = await insertEvent({
      type:      isBreach ? "web_attack"  : "auth_event",
      subtype:   isBreach ? "Web Login Breach" : "Web Authorized Login",
      severity:  isBreach ? "critical" : "low",
      sourceIp:  src_ip, targetHost: host,
      toolUsed:  "apache",
      description: isBreach
        ? `WEB BREACH: ${src_ip} authenticated to ${url} after ${priorFails} failed attempt(s) — attacker logged in!`
        : `Web login success from ${src_ip} to ${url} (no prior failed attempts — authorized)`,
      status: isBreach ? "breach" : "allowed",
      layer:  "application",
      signatureText: sigText,
    });
    if (isBreach) {
      await mkAlert(event.id, "critical",
        `🚨 WEB BREACH: ${src_ip} authenticated to ${url} after ${priorFails} failures`);
    }
  } else {
    if (priorFails === 1 || priorFails % 5 === 0) {
      const severity = priorFails >= 5 ? "high" : "medium";
      const event = await insertEvent({
        type: "web_attack", subtype: "Web Login Brute Force",
        severity,
        sourceIp: src_ip, targetHost: host,
        toolUsed: "apache",
        description: `Web login brute force from ${src_ip} → ${url} — ${priorFails} failed attempt(s) (HTTP ${status_code})`,
        status: "detected", layer: "application",
        signatureText: sigText,
      });
      if (severity === "high") {
        await mkAlert(event.id, "high",
          `WEB BRUTE FORCE: ${src_ip} — ${priorFails} failed login attempts on ${url}`);
      }
    }
  }

  res.status(201).json({ ok: true });
});

// ─────────────────────────────────────────────────────────────────────────────
// HTTP / ModSecurity / Nginx / Web attacks
// ─────────────────────────────────────────────────────────────────────────────
router.post("/ingest/http", auth, async (req, res) => {
  const { src_ip, url, method, status_code, attack_type, payload, user_agent, rule_id, blocked, signature_text } = req.body;
  if (!src_ip || !url) { res.status(400).json({ error:"src_ip and url required" }); return; }

  // Internal lab IPs must never appear as web attackers.
  if (isLabInternalIp(src_ip)) {
    res.status(200).json({ ok: true, skipped: "lab_internal_ip" });
    return;
  }

  const http_log_source = req.body.log_source;
  await db.insert(httpAttacksTable).values({
    sourceIp: src_ip, targetUrl: url.slice(0,1024), method: method ?? "GET",
    statusCode: Number(status_code) || null, attackType: attack_type ?? null,
    payload: payload ? String(payload).slice(0,2000) : null,
    userAgent: user_agent ? String(user_agent).slice(0,512) : null,
    ruleId: rule_id ?? null, blocked: Boolean(blocked),
    logSource: http_log_source ? String(http_log_source).slice(0,128) : "/var/log/apache2/modsec_audit.log",
  });

  const sevMap: Record<string,"critical"|"high"|"medium"|"low"> = {
    SQLi:"critical", XSS:"high", LFI:"critical", RFI:"critical",
    "Command Injection":"critical", SSRF:"high", XXE:"high",
    CSRF:"medium", DirTraversal:"high", Brute:"high",
  };
  const s = sevMap[attack_type ?? ""] ?? "medium";

  const event = await insertEvent({
    type:"web_attack", subtype: attack_type ?? "HTTP Attack", severity: s,
    sourceIp: src_ip, targetHost: url.slice(0,128),
    toolUsed:"modsecurity",
    description:`HTTP ${attack_type ?? "attack"}: ${method} ${url.slice(0,100)} | Rule:${rule_id ?? "N/A"} | ${blocked ? "BLOCKED":"DETECTED"}`,
    status: blocked ? "blocked":"detected", layer:"perimeter",
    signatureText: signature_text ? String(signature_text).slice(0, 2000) : null,
  });
  if (s === "critical" || s === "high")
    await mkAlert(event.id, s, `WEB ATTACK ${s}: ${attack_type} from ${src_ip} → ${url.slice(0,80)}`);
  res.status(201).json({ id:event.id });
});

// ─────────────────────────────────────────────────────────────────────────────
// DDoS (detailed)
// Fields: src_ip, attack_vector, pps, mbps, target_ip, target_port, protocol
// attack_vector: udp_flood | syn_flood | icmp_flood | http_flood | slowloris | amplification
// ─────────────────────────────────────────────────────────────────────────────
router.post("/ingest/ddos", auth, async (req, res) => {
  const { src_ip, attack_vector, pps, mbps, target_ip, target_port, protocol, blocked } = req.body;

  const s = (pps ?? 0) > 10000 || (mbps ?? 0) > 1000 ? "critical" : "high";
  const desc = `DDoS ${attack_vector ?? "flood"} from ${src_ip}: ${pps ?? "?"} pps / ${mbps ?? "?"}Mbps → ${target_ip ?? "target"}${target_port ? `:${target_port}` : ""}`;

  const event = await insertEvent({
    type:"network_attack", subtype: attack_vector ? `DDoS ${attack_vector}` : "DDoS Flood",
    severity: s, sourceIp: src_ip ?? "unknown",
    targetHost: target_ip ?? "internal-network",
    toolUsed:"hping3", description: desc,
    status: blocked ? "blocked":"detected", layer:"perimeter",
  });
  await mkAlert(event.id, s, `DDOS ${attack_vector ?? "flood"}: ${src_ip} → ${target_ip} | ${pps ?? "?"}pps`);
  res.status(201).json({ id:event.id });
});

// ─────────────────────────────────────────────────────────────────────────────
// DNS attack
// Fields: src_ip, attack_type, query, response_ip, target_resolver
// attack_type: dns_poison | dns_amplification | dns_tunneling | dns_hijack
//              dns_zone_transfer | dns_query_refused  (from BIND9 watcher)
// ─────────────────────────────────────────────────────────────────────────────
router.post("/ingest/dns", auth, async (req, res) => {
  const { src_ip, attack_type, query, response_ip, target_resolver, target_ip, log_source, matched_rule } = req.body;

  const isPoison  = attack_type === "dns_poison" || attack_type === "dns_hijack";
  const isZone    = attack_type === "dns_zone_transfer";
  const isRefused = attack_type === "dns_query_refused";
  const s = isPoison ? "critical" : isZone ? "high" : "medium";
  const targetHost = target_resolver ?? target_ip ?? "company-dns-server";

  // Write to dedicated dns_attacks table (for Connection Logs → DNS tab)
  await db.insert(dnsAttacksTable).values({
    sourceIp:    src_ip ?? "unknown",
    targetIp:    target_ip ?? "10.10.10.20",
    attackType:  attack_type ?? null,
    query:       query ? String(query).slice(0, 255) : null,
    severity:    s,
    logSource:   log_source   ? String(log_source).slice(0, 128)   : "/var/log/named/named.log",
    matchedRule: matched_rule ? String(matched_rule).slice(0, 256)
                              : isZone    ? "BIND9: AXFR/IXFR zone transfer attempt"
                              : isRefused ? "BIND9: ≥5 refused queries in 60s (DNS recon)"
                              : `BIND9: ${attack_type ?? "DNS attack"} from ${src_ip}`,
  });

  const desc = isPoison
    ? `DNS ${attack_type} from ${src_ip}: query "${query}" → poisoned to ${response_ip ?? "?"}`
    : isZone
    ? `DNS zone transfer attempt (AXFR/IXFR) from ${src_ip} → ${targetHost}`
    : isRefused
    ? `DNS recon: ${query} — refused queries from ${src_ip} (rate-limit triggered)`
    : `DNS ${attack_type ?? "attack"} from ${src_ip}: query "${query}"`;

  const event = await insertEvent({
    type:"network_attack", subtype: attack_type ?? "DNS Attack", severity: s,
    sourceIp: src_ip ?? "unknown", targetHost,
    toolUsed: isPoison ? "dnsspoof" : "bind9",
    description: desc,
    status:"detected", layer:"perimeter",
    signatureText: matched_rule ? String(matched_rule).slice(0, 2000) : null,
  });
  if (s === "critical" || s === "high")
    await mkAlert(event.id, s as "critical"|"high", `DNS ATTACK: ${attack_type} from ${src_ip} — "${query}"`);
  res.status(201).json({ id:event.id });
});

// ─────────────────────────────────────────────────────────────────────────────
// MySQL DB Attacks — company-customer-db (10.20.20.10:3306)
// Source: /var/log/mysql/error.log via _watch_remote_mysql()
// Fields: src_ip, target_ip, attack_type, username, query, severity, blocked, log_source, matched_rule
// attack_type: Auth Brute | SQLi | Enum | Data Dump | Privilege Esc
// ─────────────────────────────────────────────────────────────────────────────
router.post("/ingest/mysql", auth, async (req, res) => {
  const { src_ip, target_ip, attack_type, username, query, severity: sev_in, blocked, log_source, matched_rule, signature_text } = req.body;
  if (!src_ip) { res.status(400).json({ error: "src_ip required" }); return; }
  if (isDefenderIp(src_ip) || isLabInternalIp(src_ip)) {
    res.status(200).json({ ok: true, skipped: "internal_ip" }); return;
  }

  const s = sev(sev_in ?? "high");
  await db.insert(dbAttacksTable).values({
    sourceIp:    src_ip,
    targetIp:    target_ip ?? "10.20.20.10",
    port:        3306,
    attackType:  attack_type ?? "Auth Brute",
    username:    username ? String(username).slice(0, 64) : null,
    query:       query    ? String(query).slice(0, 2000)  : null,
    severity:    s,
    blocked:     Boolean(blocked),
    logSource:   log_source   ? String(log_source).slice(0, 128)   : "/var/log/mysql/error.log",
    matchedRule: matched_rule ? String(matched_rule).slice(0, 256)
                              : `MySQL: Access denied for user '${username ?? "?"}'@'${src_ip}'`,
  });

  const event = await insertEvent({
    type:"network_attack", subtype: attack_type ?? "DB Auth Brute Force", severity: s,
    sourceIp: src_ip, targetHost: target_ip ?? "company-customer-db",
    toolUsed:"mysql",
    description:`MySQL ${attack_type ?? "auth failure"}: user='${username ?? "?"}' from ${src_ip} → ${target_ip ?? "10.20.20.10"}:3306`,
    status: blocked ? "blocked" : "detected", layer:"data",
    signatureText: signature_text ? String(signature_text).slice(0, 2000) : null,
  });
  if (s === "critical" || s === "high")
    await mkAlert(event.id, s as "critical"|"high", `DB ATTACK: MySQL ${attack_type ?? "auth failure"} from ${src_ip}`);
  res.status(201).json({ id:event.id });
});

// ─────────────────────────────────────────────────────────────────────────────
// LDAP Attacks — company-ldap-server (10.20.20.20:389)
// Source: /var/log/syslog (slapd) via _watch_remote_slapd()
// Fields: src_ip, target_ip, dn, error_code, attack_type, severity, log_source, matched_rule
// attack_type: Auth Brute | Enum | Injection
// ─────────────────────────────────────────────────────────────────────────────
router.post("/ingest/ldap", auth, async (req, res) => {
  const { src_ip, target_ip, dn, error_code, attack_type, severity: sev_in, log_source, matched_rule, signature_text } = req.body;
  if (!src_ip) { res.status(400).json({ error: "src_ip required" }); return; }
  if (isDefenderIp(src_ip) || isLabInternalIp(src_ip)) {
    res.status(200).json({ ok: true, skipped: "internal_ip" }); return;
  }

  const s = sev(sev_in ?? "high");
  const errNum = error_code != null ? Number(error_code) : null;
  await db.insert(ldapAttacksTable).values({
    sourceIp:    src_ip,
    targetIp:    target_ip ?? "10.20.20.20",
    dn:          dn         ? String(dn).slice(0, 255)         : null,
    errorCode:   errNum,
    attackType:  attack_type ?? "Auth Brute",
    severity:    s,
    logSource:   log_source   ? String(log_source).slice(0, 128)   : "/var/log/syslog (slapd)",
    matchedRule: matched_rule ? String(matched_rule).slice(0, 256)
                              : errNum === 49 ? "slapd: err=49 Invalid credentials"
                              : errNum === 32 ? "slapd: err=32 No such object (DN enum)"
                              : "slapd: LDAP auth failure",
  });

  const event = await insertEvent({
    type:"network_attack", subtype: attack_type ?? "LDAP Auth Brute Force", severity: s,
    sourceIp: src_ip, targetHost: target_ip ?? "company-ldap-server",
    toolUsed:"slapd",
    description:`LDAP ${attack_type ?? "auth failure"} from ${src_ip}: dn="${dn ?? "?"}" err=${errNum ?? "?"}`,
    status:"detected", layer:"data",
    signatureText: signature_text ? String(signature_text).slice(0, 2000) : null,
  });
  if (s === "critical" || s === "high")
    await mkAlert(event.id, s as "critical"|"high", `LDAP ATTACK: ${attack_type ?? "auth brute"} from ${src_ip}`);
  res.status(201).json({ id:event.id });
});

// ─────────────────────────────────────────────────────────────────────────────
// FTP Sessions — company-web-server (10.10.10.10:21)
// Source: /var/log/vsftpd.log via _watch_remote_ftp()
// Fields: src_ip, username, status, command, filename, filesize, failures, banned_by, log_source, matched_rule
// status: failed | success | upload | download
// ─────────────────────────────────────────────────────────────────────────────
router.post("/ingest/ftp", auth, async (req, res) => {
  const { src_ip, username, status: st, command, filename, filesize, failures, banned_by, log_source, matched_rule, signature_text } = req.body;
  if (!src_ip) { res.status(400).json({ error: "src_ip required" }); return; }
  if (isDefenderIp(src_ip) || isLabInternalIp(src_ip)) {
    res.status(200).json({ ok: true, skipped: "internal_ip" }); return;
  }

  const failCount = Number(failures) || 0;
  await db.insert(ftpSessionsTable).values({
    sourceIp:    src_ip,
    username:    username  ? String(username).slice(0, 64)   : null,
    status:      st ?? "failed",
    command:     command   ? String(command).slice(0, 32)    : null,
    filename:    filename  ? String(filename).slice(0, 512)  : null,
    filesize:    filesize  ? Number(filesize) : null,
    failures:    failCount,
    bannedBy:    banned_by ? String(banned_by).slice(0, 32)  : null,
    logSource:   log_source   ? String(log_source).slice(0, 128)   : "/var/log/vsftpd.log",
    matchedRule: matched_rule ? String(matched_rule).slice(0, 256)
                              : failCount >= 3 ? `fail2ban[vsftpd]: ban after ${failCount} failures`
                              : st === "failed" ? "vsftpd: FAIL LOGIN"
                              : st === "upload" ? "vsftpd: OK UPLOAD (file exfiltration risk)"
                              : "vsftpd: FTP event",
  });

  // Generate security event for attacks (failed login / file upload from attacker)
  if (st === "failed" && (failCount === 1 || failCount % 5 === 0)) {
    const s = failCount >= 5 ? "high" : "medium";
    const event = await insertEvent({
      type:"network_attack", subtype:"FTP Brute Force", severity: s,
      sourceIp: src_ip, targetHost:"company-web-server",
      toolUsed:"vsftpd",
      description:`FTP brute force from ${src_ip}: ${failCount} failed login attempt(s) for user '${username ?? "?"}'`,
      status:"detected", layer:"application",
      signatureText: signature_text ? String(signature_text).slice(0, 2000) : null,
    });
    if (s === "high")
      await mkAlert(event.id, "high", `FTP BRUTE FORCE: ${src_ip} — ${failCount} failures for '${username ?? "?"}'`);
  } else if (st === "upload") {
    // File upload from attacker IP is suspicious (data exfiltration / webshell plant)
    const event = await insertEvent({
      type:"web_attack", subtype:"FTP File Upload", severity:"high",
      sourceIp: src_ip, targetHost:"company-web-server",
      toolUsed:"vsftpd",
      description:`FTP file upload from ${src_ip}: user='${username ?? "?"}' uploaded '${filename ?? "?"}' (${filesize ?? "?"}B)`,
      status:"detected", layer:"application",
    });
    await mkAlert(event.id, "high", `FTP UPLOAD: ${src_ip} uploaded '${filename ?? "unknown"}' — possible webshell/exfil`);
  }

  res.status(201).json({ ok:true });
});

// ─────────────────────────────────────────────────────────────────────────────
// MITM / ARP Spoofing
// Fields: src_ip, victim_ip, gateway_ip, attack_type, interface
// ─────────────────────────────────────────────────────────────────────────────
router.post("/ingest/mitm", auth, async (req, res) => {
  const { src_ip, victim_ip, gateway_ip, attack_type, iface } = req.body;

  const event = await insertEvent({
    type:"network_attack", subtype: attack_type ?? "ARP Spoofing", severity:"high",
    sourceIp: src_ip ?? "unknown", targetHost: victim_ip ?? "lan-segment",
    toolUsed:"arpspoof",
    description:`MITM ${attack_type ?? "ARP spoof"} on ${iface ?? "eth0"}: ${src_ip} posing as gateway ${gateway_ip ?? "?"} to victim ${victim_ip ?? "?"}`,
    status:"detected", layer:"perimeter",
  });
  await mkAlert(event.id, "high", `MITM DETECTED: ${src_ip} → ${victim_ip} via ${attack_type}`);
  res.status(201).json({ id:event.id });
});

// ─────────────────────────────────────────────────────────────────────────────
// pfSense syslog
// Fields: facility, severity_pf, message, src_ip, dest_ip, src_port, dest_port, proto, rule_number, action
// ─────────────────────────────────────────────────────────────────────────────
router.post("/ingest/pfsense", auth, async (req, res) => {
  const { message, src_ip, dest_ip, src_port, dest_port, proto, rule_number, action } = req.body;

  const isBlock = action === "block" || action === "reject";
  const s = isBlock && (dest_port === "22" || dest_port === "3389") ? "high" : "medium";

  const event = await insertEvent({
    type:"network_attack", subtype:`pfSense ${action ?? "log"}`, severity: s,
    sourceIp: src_ip ?? "unknown", targetHost: dest_ip ?? "internal-network",
    toolUsed:"pfsense",
    description:`pfSense: ${action ?? "log"} | ${proto ?? "TCP"} | ${src_ip}:${src_port ?? "?"} → ${dest_ip}:${dest_port ?? "?"} | Rule:${rule_number ?? "N/A"} | ${message ?? ""}`,
    status: isBlock ? "blocked":"detected", layer:"perimeter",
  });
  res.status(201).json({ id:event.id });
});

// ─────────────────────────────────────────────────────────────────────────────
// Cowrie honeypot
// ─────────────────────────────────────────────────────────────────────────────
router.post("/ingest/cowrie", auth, async (req, res) => {
  const { eventid, src_ip, input, session, username, password } = req.body;
  const isLogin = eventid === "cowrie.login.failed" || eventid === "cowrie.login.success";
  const isCmd   = eventid === "cowrie.command.input";
  const s       = eventid === "cowrie.login.success" ? "critical" : "high";

  const desc = isLogin
    ? `Honeypot: ${eventid === "cowrie.login.success" ? "SUCCESSFUL" : "Failed"} login from ${src_ip}. Creds: ${username}/${password}. Session: ${session}`
    : isCmd
    ? `Honeypot: Command by ${src_ip} in session ${session}: "${input}"`
    : `Honeypot event [${eventid}] from ${src_ip}`;

  // dest_ip: IP of the honeypot host (e.g. 10.10.10.10 or dedicated honeypot IP)
  const dest_ip = req.body.dest_ip;
  const event = await insertEvent({
    type:"network_attack", subtype:"Honeypot Trap", severity: s as any,
    sourceIp: src_ip ?? "unknown", targetHost: dest_ip ?? "cowrie-honeypot",
    toolUsed:"cowrie", description: desc, status:"detected", layer:"perimeter",
  });
  await mkAlert(event.id, s as any, `COWRIE: ${desc.slice(0,100)}`);
  res.status(201).json({ id:event.id });
});

// ─────────────────────────────────────────────────────────────────────────────
// Packet traffic stats (from tcpdump on aegis-forwarder)
// ─────────────────────────────────────────────────────────────────────────────
router.post("/ingest/traffic", auth, (req, res) => {
  const schema = z.object({
    packets:   z.number().int().nonnegative().optional(),
    inbound:   z.number().int().nonnegative(),
    outbound:  z.number().int().nonnegative(),
    blocked:   z.number().int().nonnegative().optional(),
    timestamp: z.string().optional(),
  });
  const body = schema.safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: "Invalid input" }); return; }

  recordTrafficStats({
    inbound:   body.data.inbound,
    outbound:  body.data.outbound,
    blocked:   body.data.blocked  ?? 0,
    packets:   body.data.packets  ?? (body.data.inbound + body.data.outbound),
    timestamp: body.data.timestamp,
  });
  res.status(200).json({ ok: true });
});

export default router;
