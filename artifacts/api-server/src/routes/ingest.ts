import { Router } from "express";
import { db } from "@workspace/db";
import { securityEventsTable, alertsTable } from "@workspace/db";
import { broadcaster } from "../lib/broadcaster";

const router = Router();

const INGEST_KEY = process.env.AEGIS_INGEST_KEY ?? "aegis-demo-key-change-me";

function authMiddleware(req: any, res: any, next: any) {
  const key = req.headers["x-aegis-key"];
  if (!key || key !== INGEST_KEY) {
    res.status(401).json({ error: "Invalid or missing X-AEGIS-Key header" });
    return;
  }
  next();
}

function mapSeverity(input: string): "critical" | "high" | "medium" | "low" {
  const s = (input ?? "").toLowerCase();
  if (s === "critical" || s === "1") return "critical";
  if (s === "high" || s === "2") return "high";
  if (s === "medium" || s === "3" || s === "warning") return "medium";
  return "low";
}

function mapStatus(blocked: boolean): "detected" | "blocked" {
  return blocked ? "blocked" : "detected";
}

// Generic ingest — works from any source
router.post("/ingest/event", authMiddleware, async (req, res) => {
  const {
    source,         // "snort" | "suricata" | "fail2ban" | "cowrie" | "custom"
    type,
    subtype,
    severity,
    sourceIp,
    targetHost,
    toolUsed,
    description,
    layer,
    blocked = false,
  } = req.body;

  if (!sourceIp || !description) {
    res.status(400).json({ error: "sourceIp and description are required" });
    return;
  }

  const [event] = await db.insert(securityEventsTable).values({
    type: type ?? source ?? "network_attack",
    subtype: subtype ?? "Unknown",
    severity: mapSeverity(severity),
    sourceIp,
    targetHost: targetHost ?? "internal-network",
    toolUsed: toolUsed ?? source ?? null,
    description,
    status: mapStatus(blocked),
    layer: layer ?? "perimeter",
  }).returning();

  const serialized = { ...event, createdAt: event.createdAt.toISOString() };
  broadcaster.broadcast("security_event", serialized);

  // Auto-create alert for high/critical
  if (event.severity === "critical" || event.severity === "high") {
    const [alert] = await db.insert(alertsTable).values({
      message: `${event.severity.toUpperCase()} [${source ?? "sensor"}]: ${description.slice(0, 120)}`,
      severity: event.severity,
      channel: event.severity === "critical" ? "telegram" : "dashboard",
      acknowledged: false,
      eventId: event.id,
    }).returning();

    broadcaster.broadcast("alert", { ...alert, createdAt: alert.createdAt.toISOString() });
  }

  broadcaster.broadcast("stats_update", { timestamp: new Date().toISOString() });
  res.status(201).json(serialized);
});

// Snort unified2 / alert_fast format (parsed on Ubuntu, sent here)
router.post("/ingest/snort", authMiddleware, async (req, res) => {
  const { priority, msg, src, dst, proto } = req.body;
  const severityMap: Record<string, "critical"|"high"|"medium"|"low"> = {
    "1": "critical", "2": "high", "3": "medium", "4": "low",
  };
  const sev = severityMap[String(priority)] ?? "medium";

  const [event] = await db.insert(securityEventsTable).values({
    type: "network_attack",
    subtype: msg ?? "Snort Alert",
    severity: sev,
    sourceIp: src ?? "unknown",
    targetHost: dst ?? "internal-network",
    toolUsed: "snort",
    description: `Snort IDS alert: ${msg}. Protocol: ${proto ?? "TCP"}. Source: ${src} → Destination: ${dst}`,
    status: "detected",
    layer: "perimeter",
  }).returning();

  const serialized = { ...event, createdAt: event.createdAt.toISOString() };
  broadcaster.broadcast("security_event", serialized);
  if (sev === "critical" || sev === "high") {
    const [alert] = await db.insert(alertsTable).values({
      message: `SNORT ${sev.toUpperCase()}: ${msg} — ${src} → ${dst}`,
      severity: sev,
      channel: "dashboard",
      acknowledged: false,
      eventId: event.id,
    }).returning();
    broadcaster.broadcast("alert", { ...alert, createdAt: alert.createdAt.toISOString() });
  }
  broadcaster.broadcast("stats_update", { timestamp: new Date().toISOString() });
  res.status(201).json(serialized);
});

// Suricata EVE JSON format
router.post("/ingest/suricata", authMiddleware, async (req, res) => {
  const { alert, src_ip, dest_ip, proto, event_type } = req.body;
  const a = alert ?? {};
  const sev = mapSeverity(String(a.severity ?? 3));

  const [event] = await db.insert(securityEventsTable).values({
    type: "network_attack",
    subtype: a.signature ?? "Suricata Alert",
    severity: sev,
    sourceIp: src_ip ?? "unknown",
    targetHost: dest_ip ?? "internal-network",
    toolUsed: "suricata",
    description: `Suricata ${event_type ?? "alert"}: ${a.signature ?? "Unknown signature"}. Category: ${a.category ?? "N/A"}. Protocol: ${proto ?? "TCP"}`,
    status: "detected",
    layer: "perimeter",
  }).returning();

  const serialized = { ...event, createdAt: event.createdAt.toISOString() };
  broadcaster.broadcast("security_event", serialized);
  if (sev === "critical" || sev === "high") {
    const [alert2] = await db.insert(alertsTable).values({
      message: `SURICATA: ${a.signature} — ${src_ip} → ${dest_ip}`,
      severity: sev,
      channel: "dashboard",
      acknowledged: false,
      eventId: event.id,
    }).returning();
    broadcaster.broadcast("alert", { ...alert2, createdAt: alert2.createdAt.toISOString() });
  }
  broadcaster.broadcast("stats_update", { timestamp: new Date().toISOString() });
  res.status(201).json(serialized);
});

// Fail2ban ban action
router.post("/ingest/fail2ban", authMiddleware, async (req, res) => {
  const { ip, jail, failures } = req.body;

  const [event] = await db.insert(securityEventsTable).values({
    type: "network_attack",
    subtype: "Brute Force",
    severity: "high",
    sourceIp: ip ?? "unknown",
    targetHost: "ubuntu-server",
    toolUsed: "fail2ban",
    description: `Fail2ban: IP ${ip} banned from jail [${jail ?? "sshd"}] after ${failures ?? "?"} failed attempts. Auto-block applied.`,
    status: "blocked",
    layer: "perimeter",
  }).returning();

  const serialized = { ...event, createdAt: event.createdAt.toISOString() };
  broadcaster.broadcast("security_event", serialized);
  const [alert] = await db.insert(alertsTable).values({
    message: `FAIL2BAN: IP ${ip} auto-banned — jail: ${jail ?? "sshd"}, failures: ${failures ?? "?"}`,
    severity: "high",
    channel: "dashboard",
    acknowledged: false,
    eventId: event.id,
  }).returning();
  broadcaster.broadcast("alert", { ...alert, createdAt: alert.createdAt.toISOString() });
  broadcaster.broadcast("stats_update", { timestamp: new Date().toISOString() });
  res.status(201).json(serialized);
});

// Cowrie honeypot
router.post("/ingest/cowrie", authMiddleware, async (req, res) => {
  const { eventid, src_ip, input, session, username, password } = req.body;

  const isLogin = eventid === "cowrie.login.failed" || eventid === "cowrie.login.success";
  const isCmd = eventid === "cowrie.command.input";
  const sev = eventid === "cowrie.login.success" ? "critical" : "high";

  const desc = isLogin
    ? `Honeypot: ${eventid === "cowrie.login.success" ? "SUCCESSFUL" : "Failed"} login attempt from ${src_ip}. Credentials: ${username}/${password}. Session: ${session}`
    : isCmd
    ? `Honeypot: Command executed by attacker ${src_ip} in session ${session}: "${input}"`
    : `Honeypot event [${eventid}] from ${src_ip}`;

  const [event] = await db.insert(securityEventsTable).values({
    type: "network_attack",
    subtype: "Honeypot Trap",
    severity: sev as any,
    sourceIp: src_ip ?? "unknown",
    targetHost: "cowrie-honeypot",
    toolUsed: "cowrie",
    description: desc,
    status: "detected",
    layer: "perimeter",
  }).returning();

  const serialized = { ...event, createdAt: event.createdAt.toISOString() };
  broadcaster.broadcast("security_event", serialized);
  const [alert] = await db.insert(alertsTable).values({
    message: `COWRIE HONEYPOT: ${desc.slice(0, 100)}`,
    severity: sev as any,
    channel: "dashboard",
    acknowledged: false,
    eventId: event.id,
  }).returning();
  broadcaster.broadcast("alert", { ...alert, createdAt: alert.createdAt.toISOString() });
  broadcaster.broadcast("stats_update", { timestamp: new Date().toISOString() });
  res.status(201).json(serialized);
});

export default router;
