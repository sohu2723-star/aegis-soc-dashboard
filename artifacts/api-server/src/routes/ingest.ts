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
  blockedIpsTable,
} from "@workspace/db";
import { broadcaster } from "../lib/broadcaster";
import { evaluateEvent } from "../lib/auto-defense";
import { sendTelegramMessage, telegramAvailable } from "../lib/telegram";
import { getSetting } from "../lib/app-settings";
import { isDefenderIp } from "../lib/ip-classifier";
import { eq, and } from "drizzle-orm";
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
  const a = alert ?? {};
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

  await db.insert(sshSessionsTable).values({
    sourceIp: ip ?? "unknown", status:"failed",
    failures: Number(failures) || 5, bannedBy:"fail2ban",
  });

  const existing = await db.select().from(blockedIpsTable)
    .where(and(eq(blockedIpsTable.ip, ip), eq(blockedIpsTable.isActive, true)));
  if (existing.length === 0) {
    await db.insert(blockedIpsTable).values({
      ip, reason:`Fail2ban: jail=${jail ?? "sshd"}, failures=${failures ?? "?"}`,
      blockedBy:"auto", isActive:true,
    });
  }

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
    targetHost: target_ip ?? "bank-web",
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
  const { src_ip, dest_ip, username, status: st, auth_method, session_id, failures, prior_failures } = req.body;
  const failCount    = Number(failures) || 0;
  // prior_failures = how many failed attempts from this IP before this success event
  // 0 = clean login (authorized); ≥3 = brute-force success (breach)
  const priorFails   = prior_failures != null ? Number(prior_failures) : failCount;
  const targetHost   = dest_ip ?? "bank-web";

  await db.insert(sshSessionsTable).values({
    sourceIp: src_ip ?? "unknown", username: username ?? null,
    status: st ?? "failed", authMethod: auth_method ?? null,
    sessionId: session_id ?? null, failures: failCount, bannedBy: null,
  });

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
    });
    if (isBreach) {
      await mkAlert(event.id, "critical",
        `🚨 SSH BREACH: ${src_ip} authenticated as '${username}' after ${priorFails} failures`);
    }

  } else if (st === "failed") {
    // SSH brute force — create event on first attempt and every 5th failure
    // (avoids flooding but keeps dashboard responsive on first hit)
    if (failCount === 1 || failCount % 5 === 0) {
      const severity = failCount >= 5 ? "high" : "medium";
      const event = await insertEvent({
        type:"network_attack", subtype:"SSH Brute Force",
        severity,
        sourceIp: src_ip ?? "unknown", targetHost,
        toolUsed:"ssh",
        description:`SSH brute force from ${src_ip} — ${failCount} failed attempt(s) for user '${username ?? "?"}'`,
        status:"detected", layer:"perimeter",
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
  const { src_ip, dest_ip, url, method, status_code, prior_failures, is_success, targetHost } = req.body;
  if (!src_ip) { res.status(400).json({ error: "src_ip required" }); return; }

  const priorFails = Number(prior_failures) || 0;
  const isSuccess  = Boolean(is_success);
  const host       = targetHost ?? dest_ip ?? "bank-web";

  if (isSuccess) {
    // Auth success — classify as breach if prior failures existed
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
    });
    if (isBreach) {
      await mkAlert(event.id, "critical",
        `🚨 WEB BREACH: ${src_ip} authenticated to ${url} after ${priorFails} failures`);
    }
  } else {
    // Failed login attempt — emit event on 1st and every 5th attempt
    if (priorFails === 1 || priorFails % 5 === 0) {
      const severity = priorFails >= 5 ? "high" : "medium";
      const event = await insertEvent({
        type: "web_attack", subtype: "Web Login Brute Force",
        severity,
        sourceIp: src_ip, targetHost: host,
        toolUsed: "apache",
        description: `Web login brute force from ${src_ip} → ${url} — ${priorFails} failed attempt(s) (HTTP ${status_code})`,
        status: "detected", layer: "application",
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
  const { src_ip, url, method, status_code, attack_type, payload, user_agent, rule_id, blocked } = req.body;
  if (!src_ip || !url) { res.status(400).json({ error:"src_ip and url required" }); return; }

  await db.insert(httpAttacksTable).values({
    sourceIp: src_ip, targetUrl: url.slice(0,1024), method: method ?? "GET",
    statusCode: Number(status_code) || null, attackType: attack_type ?? null,
    payload: payload ? String(payload).slice(0,2000) : null,
    userAgent: user_agent ? String(user_agent).slice(0,512) : null,
    ruleId: rule_id ?? null, blocked: Boolean(blocked),
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
  });
  if (s === "critical" || s === "high")
    await mkAlert(event.id, s, `WEB ATTACK ${s}: ${attack_type} from ${src_ip} → ${url.slice(0,80)}`);
  res.status(201).json({ id:event.id });
});

// ─────────────────────────────────────────────────────────────────────────────
// Mail server (SMTP / Postfix / Dovecot)
// Fields: src_ip, from, to, subject, mail_type, count, blocked
// mail_type: spam | phishing | relay_attempt | brute | malware_attachment
// ─────────────────────────────────────────────────────────────────────────────
router.post("/ingest/mail", auth, async (req, res) => {
  const { src_ip, from, to, subject, mail_type, count, blocked } = req.body;
  if (!src_ip) { res.status(400).json({ error:"src_ip required" }); return; }

  const sevMap: Record<string,"critical"|"high"|"medium"|"low"> = {
    phishing:"critical", malware_attachment:"critical",
    relay_attempt:"high", spam:"medium", brute:"high",
  };
  const s = sevMap[mail_type ?? "spam"] ?? "medium";

  const desc = mail_type === "phishing"
    ? `Phishing email from ${src_ip}: "${subject}" → ${to}`
    : mail_type === "malware_attachment"
    ? `Malware attachment from ${src_ip}: "${subject}" → ${to}`
    : mail_type === "relay_attempt"
    ? `Open relay attempt from ${src_ip}: ${from} → ${to}`
    : mail_type === "spam"
    ? `Spam from ${src_ip}: ${count ?? 1} mails, "${subject}"`
    : `Mail brute force from ${src_ip} on ${to}`;

  const event = await insertEvent({
    type:"mail_attack", subtype: mail_type ?? "spam", severity: s,
    sourceIp: src_ip, targetHost: "mail-server",
    toolUsed:"postfix", description: desc,
    status: blocked ? "blocked":"detected", layer:"perimeter",
  });
  if (s === "critical" || s === "high")
    await mkAlert(event.id, s, `MAIL ${s.toUpperCase()}: ${mail_type} from ${src_ip}`);
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
// ─────────────────────────────────────────────────────────────────────────────
router.post("/ingest/dns", auth, async (req, res) => {
  const { src_ip, attack_type, query, response_ip, target_resolver } = req.body;
  const s = attack_type === "dns_poison" || attack_type === "dns_hijack" ? "critical" : "high";

  const event = await insertEvent({
    type:"network_attack", subtype: attack_type ?? "DNS Attack", severity: s,
    sourceIp: src_ip ?? "unknown", targetHost: target_resolver ?? "dns-server",
    toolUsed:"dnsspoof",
    description:`DNS ${attack_type ?? "attack"} from ${src_ip}: query "${query}" → poisoned to ${response_ip ?? "?"}`,
    status:"detected", layer:"perimeter",
  });
  await mkAlert(event.id, s, `DNS ATTACK: ${attack_type} from ${src_ip} — "${query}"`);
  res.status(201).json({ id:event.id });
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
