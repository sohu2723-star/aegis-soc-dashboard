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
  blockedIpsTable,
} from "@workspace/db";
import { broadcaster } from "../lib/broadcaster";
import { evaluateEvent } from "../lib/auto-defense";
import { sendTelegramMessage, telegramAvailable } from "../lib/telegram";
import { getSetting } from "../lib/app-settings";
import { isDefenderIp, isLabInternalIp, isSuricataProtocolNoiseSid, resolveTargetHost } from "../lib/ip-classifier";
import { and, eq, isNull } from "drizzle-orm";
import { recordTrafficStats } from "./network";
import { logger } from "../lib/logger";
import {
  resolveSeverity,
  type SecuritySeverity,
} from "../lib/security-severity";

const router = Router();
const INGEST_KEY = process.env.AEGIS_INGEST_KEY;
if (!INGEST_KEY) {
  throw new Error(
    "AEGIS_INGEST_KEY env var is required. " +
    "Set a strong random secret (e.g. openssl rand -hex 32). " +
    "VMs send this via X-AEGIS-Key header."
  );
}

// ── Rate limiter — prevent high-volume floods from crashing the server ────────
// Tracks last-insert time per (sourceIp, eventType) key.
// Port scans, DDoS floods, and other high-rate events are throttled so the DB
// and SSE broadcaster do not get overwhelmed.
const _rateLimitMap = new Map<string, number>();

/**
 * Returns true if this event should be dropped to protect against flooding.
 * Rules:
 *   - port_scan: 1 event per (src, target) per 20 s
 *   - ddos:      1 event per src per 15 s
 *   - suricata with same SID+src: 1 per 10 s
 *   - network_attack (generic): 1 per (src, target) per 8 s
 */
function shouldRateLimit(type: string, sourceIp: string, targetHost: string, sid?: number | null): boolean {
  let key: string;
  let windowMs: number;
  if (type === "port_scan") {
    key = `portscan:${sourceIp}:${targetHost}`;
    windowMs = 20_000;
  } else if (type === "ddos") {
    key = `ddos:${sourceIp}`;
    windowMs = 15_000;
  } else if (type === "network_attack" && sid) {
    key = `suricata:${sid}:${sourceIp}`;
    windowMs = 10_000;
  } else if (type === "network_attack") {
    key = `netattack:${sourceIp}:${targetHost}`;
    windowMs = 8_000;
  } else {
    return false;
  }
  const now = Date.now();
  const last = _rateLimitMap.get(key) ?? 0;
  if (now - last < windowMs) return true;
  _rateLimitMap.set(key, now);
  // Prune map when it grows large (memory safety)
  if (_rateLimitMap.size > 10_000) {
    const cutoff = now - 60_000;
    for (const [k, v] of _rateLimitMap) if (v < cutoff) _rateLimitMap.delete(k);
  }
  return false;
}

// ── DDoS ↔ port-scan correlation ─────────────────────────────────────────────
// A SYN/ICMP flood also trips the low-rate recon signatures (they only require
// N SYN packets per window), so one DDoS produced a parallel stream of
// "port scan" alerts. While a source is actively flooding, its recon alerts are
// treated as part of that flood instead of a separate attack.
const DDOS_CORRELATION_MS = 60_000;
const _recentDdosBySrc = new Map<string, number>();

function noteDdosSource(sourceIp: string) {
  _recentDdosBySrc.set(sourceIp, Date.now());
  if (_recentDdosBySrc.size > 1_000) {
    const cutoff = Date.now() - DDOS_CORRELATION_MS;
    for (const [k, v] of _recentDdosBySrc) if (v < cutoff) _recentDdosBySrc.delete(k);
  }
}

function isFloodingSource(sourceIp: string): boolean {
  const last = _recentDdosBySrc.get(sourceIp);
  return last !== undefined && Date.now() - last < DDOS_CORRELATION_MS;
}

// ── stats_update debounce — avoid hammering the dashboard on every event ─────
// During a port scan burst, insertEvent() fires 20+ times/s and each call
// broadcasts stats_update, which makes every connected dashboard refetch
// /api/dashboard/summary every few ms. Debounce to at most once per 2 s.
let _statsDebounceTimer: ReturnType<typeof setTimeout> | null = null;

function debouncedStatsUpdate() {
  if (_statsDebounceTimer) return;
  _statsDebounceTimer = setTimeout(() => {
    broadcaster.broadcast("stats_update", { timestamp: new Date().toISOString() });
    _statsDebounceTimer = null;
  }, 1000);
}

// ── Aegis API brute-force detection ──────────────────────────────────────────
// Track consecutive invalid X-AEGIS-Key attempts per source IP.
// After AUTH_ALERT_THRESHOLD failures in AUTH_WINDOW_MS, fire an API attack alert.
const _apiAuthFailures = new Map<string, { count: number; firstSeen: number }>();
const AUTH_ALERT_THRESHOLD = 5;
const AUTH_WINDOW_MS       = 5 * 60 * 1000; // 5 min

function auth(req: any, res: any, next: any) {
  const key = req.headers["x-aegis-key"];
  if (!key || key !== INGEST_KEY) {
    const ip =
      (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim() ??
      req.socket?.remoteAddress ??
      "unknown";
    const now = Date.now();
    const rec = _apiAuthFailures.get(ip) ?? { count: 0, firstSeen: now };
    if (now - rec.firstSeen > AUTH_WINDOW_MS) { rec.count = 0; rec.firstSeen = now; }
    rec.count++;
    _apiAuthFailures.set(ip, rec);

    // Only fire the brute-force alert for genuine external IPs.
    // 127.0.0.1 / loopback comes from Render health-checks, local curl tests,
    // and same-host services — NOT an attacker. Defender subnets are also skipped.
    if (rec.count === AUTH_ALERT_THRESHOLD && !isDefenderIp(ip) && !isLabInternalIp(ip)) {
      // Fire async — do not block the 401 response
      setImmediate(() => {
        insertEvent({
          type: "api_attack", subtype: "API Key Brute Force", severity: "high",
          sourceIp: ip, targetHost: "aegis-api-server",
          toolUsed: "http",
          description: `AEGIS API brute force: ${ip} — ${rec.count} invalid X-AEGIS-Key attempts in ${Math.round(AUTH_WINDOW_MS / 60000)} min window`,
          status: "detected", layer: "perimeter",
        }).catch(() => {});
      });
    }

    res.status(401).json({ error: "Invalid or missing X-AEGIS-Key header" });
    return;
  }
  next();
}

function sev(
  s: unknown,
  context: Parameters<typeof resolveSeverity>[1] = {},
): SecuritySeverity {
  return resolveSeverity(s, context);
}

function classifyWebSignature(signature: string, category: string): string | null {
  const text = `${signature} ${category}`.toLowerCase();
  if (text.includes("sql") || text.includes("sqli")) return "SQLi";
  if (text.includes("cross site") || text.includes("xss")) return "XSS";
  if (text.includes("directory traversal") || text.includes("path traversal")) return "Traversal";
  if (text.includes("local file") || text.includes(" lfi")) return "LFI";
  if (text.includes("remote file") || text.includes(" rfi")) return "RFI";
  if (text.includes("csrf")) return "CSRF";
  if (text.includes("http") || text.includes("web application")) return "HTTP";
  return null;
}

/**
 * Classify a Suricata signature + category into a specific AEGIS event type.
 * Returns a granular type so the dashboard can label attacks correctly instead
 * of lumping everything under "network_attack".
 */
function classifyAttackTypeFromSuricata(signature: string, category: string): string {
  const t = `${signature} ${category}`.toLowerCase();
  // Database — must be checked BEFORE web_attack because "mysql" contains "sql"
  // and would otherwise be misclassified as web_attack by the sql/sqli check below.
  if (t.includes("mysql") || t.includes("mssql") || t.includes("postgres") ||
      t.includes("oracle") || t.includes("database") || t.includes("sql server")) return "db_attack";
  // Web / application layer (sql/sqli check is safe here — db keywords already handled above)
  if (t.includes("sql") || t.includes("sqli") || t.includes("xss") || t.includes("lfi") ||
      t.includes("rfi") || t.includes("csrf") || t.includes("traversal") ||
      t.includes("web application") || t.includes("http") || t.includes("php") ||
      t.includes("wordpress") || t.includes("cgi") || t.includes("shellcode")) return "web_attack";
  // SSH brute-force / credential stuffing
  if (t.includes("ssh") || t.includes("brute force") || t.includes("bruteforce") ||
      t.includes("credential")) return "ssh_brute";
  // DNS
  if (t.includes("dns") || t.includes("domain") || t.includes("resolver")) return "dns_attack";
  // LDAP
  if (t.includes("ldap") || t.includes("slapd") || t.includes("directory")) return "ldap_attack";
  // Named scanner tools are recon even when the signature mentions SYN packets
  // (e.g. "ET SCAN Nmap -sS SYN Scan"), so they are matched before the flood check.
  if (t.includes("nmap") || t.includes("masscan") || t.includes("zmap") ||
      t.includes("port sweep") || t.includes("port scan") || t.includes("portscan")) return "port_scan";
  // DDoS / flood — the attempted-dos classtype is authoritative, so a volumetric
  // rule is never demoted to recon by the generic "scan" keyword below.
  if (t.includes("attempted-dos") || t.includes("denial of service") ||
      t.includes("flood") || t.includes("ddos") || t.includes(" dos ") ||
      t.includes(" dos:") || t.includes("udp storm")) return "ddos";
  // Generic reconnaissance
  if (t.includes("probing") || t.includes("recon") ||
      (t.includes("scan") && !t.includes("sql"))) return "port_scan";
  // MITM / ARP
  if (t.includes("arp") || t.includes("mitm") || t.includes("spoofing") ||
      t.includes("man-in-the-middle")) return "mitm";
  // Default — genuine unclassified network/perimeter alert
  return "network_attack";
}

/**
 * Map a Fail2ban jail name to a specific AEGIS event type.
 */
function classifyFail2banType(jail: string): string {
  const j = jail.toLowerCase();
  if (j.includes("ssh") || j.includes("sshd")) return "ssh_brute";
  if (j.includes("mysql") || j.includes("mariadb")) return "db_attack";
  if (j.includes("ldap") || j.includes("slapd")) return "ldap_attack";
  if (j.includes("apache") || j.includes("nginx") || j.includes("http") || j.includes("web")) return "web_attack";
  return "network_attack";
}

async function insertEvent(values: typeof securityEventsTable.$inferInsert) {
  const [row] = await db.insert(securityEventsTable).values(values).returning();
  const [event] = await db.select().from(securityEventsTable).where(eq(securityEventsTable.id, row.id));
  const serialized = { ...event, createdAt: event.createdAt.toISOString() };
  broadcaster.broadcast("security_event", serialized);
  // Debounced — avoids flooding the dashboard during port scan / DDoS bursts.
  debouncedStatsUpdate();
  // Fire-and-forget: auto-defense runs in the background so ingest endpoints
  // return immediately without blocking on DB writes for rules/commands/blocks.
  // 5 simultaneous attacks previously exhausted the Supabase pooler and made
  // /api/dashboard/summary queue up → 8 s timeout → "warming up" banner.
  setImmediate(() => {
    evaluateEvent({
      id:          event.id,
      type:        event.type,
      subtype:     event.subtype,
      severity:    event.severity,
      sourceIp:    event.sourceIp,
      targetHost:  event.targetHost,
      description: event.description,
      status:      event.status,
    }).catch(err => logger.warn({ err: err?.message ?? String(err) }, "evaluateEvent background task failed"));
  });
  // Every real attack severity is visible in Active Alerts. The endpoint-
  // specific calls below add a more descriptive message; mkAlert is
  // idempotent per event so they cannot create duplicate rows.
  if (event.severity === "critical" || event.severity === "high" || event.severity === "medium") {
    await mkAlert(
      event.id,
      event.severity,
      `${event.severity.toUpperCase()} [${event.subtype}]: ${event.description.slice(0, 180)}`,
    );
  }
  return event;
}

const telegramNotifiedEvents = new Set<number>();

async function notifyTelegramForAlert(
  eventId: number,
  severity: "critical" | "high" | "medium",
  message: string,
): Promise<boolean> {
  if ((severity !== "critical" && severity !== "high") || !telegramAvailable()) return false;
  if (telegramNotifiedEvents.has(eventId)) return true;

  try {
    const enabled = await getSetting("telegramEnabled");
    if (enabled === "false") return false;

    // Myanmar Standard Time (UTC+6:30) timestamp
    const MST_OFFSET_MS = (6 * 60 + 30) * 60 * 1000;
    const mst = new Date(Date.now() + MST_OFFSET_MS);
    const ts = `${mst.getUTCFullYear()}-${String(mst.getUTCMonth() + 1).padStart(2, "0")}-${String(mst.getUTCDate()).padStart(2, "0")} ${String(mst.getUTCHours()).padStart(2, "0")}:${String(mst.getUTCMinutes()).padStart(2, "0")}:${String(mst.getUTCSeconds()).padStart(2, "0")} (MST)`;
    const emoji = severity === "critical" ? "🚨" : "⚠️";
    const label = severity === "critical" ? "CRITICAL ALERT" : "HIGH ALERT";
    await sendTelegramMessage(
      `${emoji} <b>AEGIS — ${label}</b>\n🕐 ${ts}\n${message.slice(0, 280)}`,
    );
    telegramNotifiedEvents.add(eventId);
    return true;
  } catch (error: any) {
    logger.warn({ err: error?.message ?? String(error), eventId }, "Telegram alert send failed");
    return false;
  }
}

async function mkAlert(eventId: number, severity: "critical"|"high"|"medium", message: string) {
  const [existing] = await db.select({ id: alertsTable.id }).from(alertsTable)
    .where(eq(alertsTable.eventId, eventId));
  if (existing) {
    // Auto-defense can create the alert before this common ingest path runs.
    // Still send the high/critical Telegram notification exactly once.
    const alreadyNotified = telegramNotifiedEvents.has(eventId);
    const telegramSent = await notifyTelegramForAlert(eventId, severity, message);
    // The endpoint-specific handler may call mkAlert after insertEvent has
    // already created and broadcast the same row. Avoid a duplicate SSE
    // packet/toast, while still broadcasting a first successful send for an
    // alert row created by auto-defense.
    if (!alreadyNotified && telegramSent) {
      broadcaster.broadcast("alert", { id: existing.id, eventId, severity, telegramSent });
    }
    return existing;
  }

  const [row] = await db.insert(alertsTable).values({
    message: message.slice(0, 255), severity,
    channel: severity === "medium" ? "dashboard" : "telegram",
    acknowledged: false, eventId,
  }).returning();

  const telegramSent = await notifyTelegramForAlert(eventId, severity, message);

  // Broadcast after the send attempt so the Threat Map's TELEGRAM packet and
  // badge reflect an actual successful Telegram delivery, not just a DB row.
  broadcaster.broadcast("alert", { id: row.id, eventId, severity, telegramSent });
  return row;
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

  const eventType = type ?? source ?? "network_attack";
  const eventSubtype = subtype ?? "Unknown Attack";
  const severity = sev(s, {
    type: eventType,
    subtype: eventSubtype,
    description,
    status: blocked ? "blocked" : "detected",
    untrustedSource: !isDefenderIp(sourceIp) && !isLabInternalIp(sourceIp),
  });
  const event = await insertEvent({
    type: eventType, subtype: eventSubtype,
    severity, sourceIp, targetHost: targetHost ?? "internal-network",
    toolUsed: toolUsed ?? source ?? null, description,
    status: blocked ? "blocked" : "detected", layer: layer ?? "perimeter",
    signatureText: signature_text ? String(signature_text).slice(0, 2000) : null,
  });
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
  // Known lab-internal/NAT sources are noise; attacker source addressing is dynamic.
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

  // Attacker addressing is intentionally dynamic. Accept any non-defender
  // source that produced a real Suricata signature; do not hard-code Kali.
  // Internal/NAT noise and protocol-only SIDs were already rejected above.
  const subtype = a.signature ? String(a.signature) : "Unknown Attack";
  const s = sev(a.severity ?? 3, { subtype });

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

  // Suricata is the hub-mode HTTP IDS. Persist its web signatures in the
  // Connections HTTP view as well as the canonical security event stream.
  const webAttackType = classifyWebSignature(subtype, alertCategory ?? "");
  if (webAttackType) {
    try {
      await db.insert(httpAttacksTable).values({
        sourceIp: src_ip,
        targetUrl: dest_ip ? `http://${dest_ip}` : "http://unknown-target",
        method: "UNKNOWN",
        statusCode: null,
        attackType: webAttackType,
        payload: signatureText ?? subtype,
        userAgent: null,
        ruleId: signatureId == null ? null : String(signatureId),
        blocked: alertAction === "blocked",
        logSource: "pfSense Suricata EVE JSON",
      });
    } catch (error) {
      // This is a secondary/indexing write. A missing optional connection-log
      // migration must not discard the canonical security event or prevent
      // auto-defense. Keep the error server-side without exposing event data.
      logger.warn(
        { err: error instanceof Error ? error.message : String(error) },
        "Could not index Suricata web alert in http_attacks; continuing ingest",
      );
    }
  }

  const suricataType = classifyAttackTypeFromSuricata(subtype, alertCategory ?? "");
  const suricataTarget = resolveTargetHost(dest_ip, "internal-network");

  if (suricataType === "ddos") noteDdosSource(src_ip ?? "unknown");
  if (suricataType === "port_scan" && isFloodingSource(src_ip ?? "unknown")) {
    res.status(200).json({ ok: true, skipped: "ddos_correlated" });
    return;
  }

  // Rate-limit high-volume Suricata events (port scans, repeated SID floods)
  if (shouldRateLimit(suricataType, src_ip ?? "unknown", suricataTarget, signatureId)) {
    res.status(200).json({ ok: true, skipped: "rate_limited" });
    return;
  }

  const event = await insertEvent({
    type: suricataType,
    subtype,
    severity: s,
    sourceIp: src_ip ?? "unknown",
    targetHost: suricataTarget,
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
  if (s === "critical" || s === "high") await mkAlert(event.id, s, `SURICATA: ${a.signature} (SID:${signatureId ?? "?"}) — ${src_ip} → ${suricataTarget}`);
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
  if (!ip) { res.status(400).json({ error: "ip required" }); return; }

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
  const jailName = String(jail ?? "sshd").slice(0, 20);
  const jailLower = jailName.toLowerCase();
  const subtype = jailLower.includes("ssh") ? "SSH Brute Force"
    : jailLower.includes("mysql") ? "MySQL Auth Brute Force"
    : jailLower.includes("ldap") || jailLower.includes("slapd") ? "LDAP Auth Brute Force"
    : jailLower.includes("apache") || jailLower.includes("nginx") ? "Web Brute Force"
    : "Brute Force";

  // Fail2ban has already enforced this ban on the target server. Reflect the
  // observed state independently of whether a second auto-defense rule matches.
  const resolvedFail2banTarget = resolveTargetHost(target_ip, "company-web-server");
  const existingBlock = await db.select({ id: blockedIpsTable.id }).from(blockedIpsTable)
    .where(and(eq(blockedIpsTable.ip, ip), eq(blockedIpsTable.isActive, true)));
  if (existingBlock.length === 0) {
    await db.insert(blockedIpsTable).values({
      ip, reason: `Fail2ban jail ${jailName}`, blockedBy: `fail2ban:${jailName}`,
      targetHost: resolvedFail2banTarget, isActive: true,
    });
  }

  // Back-fill bannedBy on existing ssh_sessions rows for this IP so the
  // Connection Logs page shows who banned it instead of "—".
  await db.update(sshSessionsTable)
    .set({ bannedBy: `fail2ban:${jailName}` })
    .where(and(eq(sshSessionsTable.sourceIp, ip), isNull(sshSessionsTable.bannedBy)));

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
    type: classifyFail2banType(jailName), subtype, severity:"high",
    sourceIp: ip ?? "unknown",
    targetHost: resolvedFail2banTarget,
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
  // Hub forwarder may send "targetHost" instead of "dest_ip" — accept both.
  const { src_ip, dest_ip, username, status: st, auth_method, session_id, failures, prior_failures, signature_text, targetHost: targetHostParam } = req.body;

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
  // Hub forwarder sends "targetHost" (the VM's IP) rather than "dest_ip".
  // Fall back in order: dest_ip → targetHost param → "company-web-server".
  const targetHost   = resolveTargetHost(dest_ip ?? targetHostParam, "company-web-server");

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
    const severity = sev(isBreach ? "critical" : "critical", {
      authentication: "success",
      trustedSource: false,
      subtype: isBreach ? "Brute Force Success" : "Unauthorized Access",
    });
    const event = await insertEvent({
      type:      isBreach ? "network_attack" : "auth_event",
      subtype:   isBreach ? "Brute Force Success" : "Unauthorized Access",
      severity,
      sourceIp:  src_ip ?? "unknown", targetHost,
      toolUsed:  "ssh",
      description: isBreach
        ? `SSH BREACH: ${src_ip} logged in as '${username}' after ${priorFails} failed attempt(s) — attacker is IN!`
        : `UNAUTHORIZED SSH ACCESS: ${src_ip} logged in as '${username}' on the monitored host`,
      status: "breach",
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
        type:"ssh_brute", subtype:"SSH Brute Force",
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
  const host       = resolveTargetHost(targetHost ?? dest_ip, "company-web-server");
  const sigText    = signature_text ? String(signature_text).slice(0, 2000) : null;

  if (isSuccess) {
    const isBreach = priorFails >= 3;
    const severity = sev("critical", {
      authentication: "success",
      trustedSource: false,
      subtype: isBreach ? "Web Login Breach" : "Unauthorized Access",
    });
    const event = await insertEvent({
      type:      isBreach ? "web_attack"  : "auth_event",
      subtype:   isBreach ? "Web Login Breach" : "Unauthorized Access",
      severity,
      sourceIp:  src_ip, targetHost: host,
      toolUsed:  "apache",
      description: isBreach
        ? `WEB BREACH: ${src_ip} authenticated to ${url} after ${priorFails} failed attempt(s) — attacker logged in!`
        : `UNAUTHORIZED WEB ACCESS: ${src_ip} authenticated to ${url} on the monitored host`,
      status: "breach",
      layer:  "application",
      signatureText: sigText,
    });
    await mkAlert(event.id, "critical",
      `🚨 WEB BREACH: ${src_ip} authenticated to ${url}${priorFails ? ` after ${priorFails} failures` : ""}`);
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

  const sevMap: Record<string, SecuritySeverity> = {
    SQLi:"critical", XSS:"high", LFI:"critical", RFI:"critical",
    "Command Injection":"critical", SSRF:"high", XXE:"high",
    CSRF:"medium", DirTraversal:"high", Brute:"high",
  };
  const subtype = attack_type ?? "Unknown Attack";
  const s = sev(sevMap[attack_type ?? ""] ?? "critical", {
    type: "web_attack",
    subtype,
  });

  const event = await insertEvent({
    type:"web_attack", subtype, severity: s,
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
  const ddosTarget = resolveTargetHost(target_ip, "internal-network");
  const desc = `DDoS ${attack_vector ?? "flood"} from ${src_ip}: ${pps ?? "?"} pps / ${mbps ?? "?"}Mbps → ${ddosTarget}${target_port ? `:${target_port}` : ""}`;

  // Rate-limit DDoS flood events — forwarder can send them every few seconds
  if (shouldRateLimit("ddos", src_ip ?? "unknown", ddosTarget)) {
    res.status(200).json({ ok: true, skipped: "rate_limited" });
    return;
  }

  const event = await insertEvent({
    type:"ddos", subtype: attack_vector ? `DDoS ${attack_vector}` : "DDoS Flood",
    severity: s, sourceIp: src_ip ?? "unknown",
    targetHost: ddosTarget,
    toolUsed:"hping3", description: desc,
    status: blocked ? "blocked":"detected", layer:"perimeter",
  });
  await mkAlert(event.id, s, `DDOS ${attack_vector ?? "flood"}: ${src_ip} → ${ddosTarget} | ${pps ?? "?"}pps`);
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
  const targetHost = resolveTargetHost(target_resolver ?? target_ip, "company-dns-server");

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
    type:"dns_attack", subtype: attack_type ?? "DNS Attack", severity: s,
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
    type:"db_attack", subtype: `MySQL ${attack_type ?? "DB Auth Brute Force"}`, severity: s,
    sourceIp: src_ip, targetHost: resolveTargetHost(target_ip, "company-customer-db"),
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
    type:"ldap_attack", subtype: `LDAP ${attack_type ?? "Auth Brute Force"}`, severity: s,
    sourceIp: src_ip, targetHost: resolveTargetHost(target_ip, "company-ldap-server"),
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
// MITM / ARP Spoofing
// Fields: src_ip, victim_ip, gateway_ip, attack_type, interface
// ─────────────────────────────────────────────────────────────────────────────
router.post("/ingest/mitm", auth, async (req, res) => {
  const { src_ip, victim_ip, gateway_ip, attack_type, iface } = req.body;

  const event = await insertEvent({
    type:"mitm", subtype: attack_type ?? "ARP Spoofing", severity:"high",
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
  const subtype = action ? `pfSense ${action}` : "Unknown Attack";
  // Classify pfSense events by destination port when available
  const pfType = (() => {
    if (!dest_port) return "network_attack";
    const p = String(dest_port);
    if (p === "22" || p === "2222") return "ssh_brute";
    if (p === "80" || p === "443" || p === "8080" || p === "8443") return "web_attack";
    if (p === "53") return "dns_attack";
    if (p === "3306" || p === "5432" || p === "1433") return "db_attack";
    if (p === "389" || p === "636") return "ldap_attack";
    return "network_attack";
  })();

  const s = sev(
    !action
      ? "critical"
      : isBlock && (dest_port === "22" || dest_port === "3389")
        ? "high"
        : "medium",
    { type: pfType, subtype },
  );

  const event = await insertEvent({
    type: pfType, subtype, severity: s,
    sourceIp: src_ip ?? "unknown", targetHost: dest_ip ?? "internal-network",
    toolUsed:"pfsense",
    description:`pfSense: ${action ?? "log"} | ${proto ?? "TCP"} | ${src_ip}:${src_port ?? "?"} → ${dest_ip}:${dest_port ?? "?"} | Rule:${rule_number ?? "N/A"} | ${message ?? ""}`,
    status: isBlock ? "blocked":"detected", layer:"perimeter",
  });
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
