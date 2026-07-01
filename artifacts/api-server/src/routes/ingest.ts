import { Router } from "express";
import { db } from "@workspace/db";
import {
  securityEventsTable,
  alertsTable,
  sshSessionsTable,
  ftpSessionsTable,
  encryptedTrafficTable,
  httpAttacksTable,
  blockedIpsTable,
} from "@workspace/db";
import { broadcaster } from "../lib/broadcaster";
import { eq, and } from "drizzle-orm";

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

async function createAlert(eventId: number, severity: "critical" | "high", message: string) {
  const [alert] = await db.insert(alertsTable).values({
    message: message.slice(0, 255),
    severity,
    channel: severity === "critical" ? "telegram" : "dashboard",
    acknowledged: false,
    eventId,
  }).$returningId();
  return alert;
}

function broadcastAll(eventRow: any) {
  broadcaster.broadcast("security_event", eventRow);
  broadcaster.broadcast("stats_update", { timestamp: new Date().toISOString() });
}

// ─── Generic event ────────────────────────────────────────────────────────────
router.post("/ingest/event", authMiddleware, async (req, res) => {
  const { source, type, subtype, severity, sourceIp, targetHost, toolUsed, description, layer, blocked = false } = req.body;

  if (!sourceIp || !description) {
    res.status(400).json({ error: "sourceIp and description are required" });
    return;
  }

  const [row] = await db.insert(securityEventsTable).values({
    type:        type ?? source ?? "network_attack",
    subtype:     subtype ?? "Unknown",
    severity:    mapSeverity(severity),
    sourceIp,
    targetHost:  targetHost ?? "internal-network",
    toolUsed:    toolUsed ?? source ?? null,
    description,
    status:      blocked ? "blocked" : "detected",
    layer:       layer ?? "perimeter",
  }).$returningId();

  const eventId = row.id;
  const sev = mapSeverity(severity);
  const serialized = { id: eventId, type, subtype, severity: sev, sourceIp, targetHost, toolUsed, description, status: blocked ? "blocked" : "detected", layer };

  broadcastAll(serialized);

  if (sev === "critical" || sev === "high") {
    const alertId = await createAlert(eventId, sev, `${sev.toUpperCase()} [${source ?? "sensor"}]: ${description.slice(0, 120)}`);
    broadcaster.broadcast("alert", { id: alertId.id, severity: sev });
  }

  res.status(201).json(serialized);
});

// ─── Snort ────────────────────────────────────────────────────────────────────
router.post("/ingest/snort", authMiddleware, async (req, res) => {
  const { priority, msg, src, dst, proto } = req.body;
  const sevMap: Record<string, "critical"|"high"|"medium"|"low"> = { "1": "critical", "2": "high", "3": "medium", "4": "low" };
  const sev = sevMap[String(priority)] ?? "medium";

  const [row] = await db.insert(securityEventsTable).values({
    type: "network_attack", subtype: msg ?? "Snort Alert", severity: sev,
    sourceIp: src ?? "unknown", targetHost: dst ?? "internal-network",
    toolUsed: "snort",
    description: `Snort IDS: ${msg} | Protocol: ${proto ?? "TCP"} | ${src} → ${dst}`,
    status: "detected", layer: "perimeter",
  }).$returningId();

  broadcastAll({ id: row.id, type: "network_attack", severity: sev, sourceIp: src, targetHost: dst });

  if (sev === "critical" || sev === "high") {
    const a = await createAlert(row.id, sev, `SNORT ${sev.toUpperCase()}: ${msg} — ${src} → ${dst}`);
    broadcaster.broadcast("alert", { id: a.id, severity: sev });
  }
  res.status(201).json({ id: row.id });
});

// ─── Suricata EVE JSON ────────────────────────────────────────────────────────
router.post("/ingest/suricata", authMiddleware, async (req, res) => {
  const { alert, src_ip, dest_ip, proto, event_type } = req.body;
  const a = alert ?? {};
  const sev = mapSeverity(String(a.severity ?? 3));

  const [row] = await db.insert(securityEventsTable).values({
    type: "network_attack", subtype: a.signature ?? "Suricata Alert", severity: sev,
    sourceIp: src_ip ?? "unknown", targetHost: dest_ip ?? "internal-network",
    toolUsed: "suricata",
    description: `Suricata ${event_type ?? "alert"}: ${a.signature ?? "Unknown"} | Category: ${a.category ?? "N/A"} | ${proto ?? "TCP"}`,
    status: "detected", layer: "perimeter",
  }).$returningId();

  broadcastAll({ id: row.id, type: "network_attack", severity: sev, sourceIp: src_ip, targetHost: dest_ip });

  if (sev === "critical" || sev === "high") {
    const al = await createAlert(row.id, sev, `SURICATA: ${a.signature} — ${src_ip} → ${dest_ip}`);
    broadcaster.broadcast("alert", { id: al.id, severity: sev });
  }
  res.status(201).json({ id: row.id });
});

// ─── Suricata TLS (encrypted traffic) ────────────────────────────────────────
router.post("/ingest/suricata/tls", authMiddleware, async (req, res) => {
  const { src_ip, dest_ip, dest_port, tls } = req.body;
  const t = tls ?? {};

  const isSuspicious =
    t.version === "SSLv3" ||
    t.version === "TLSv1" ||
    (t.notafter && new Date(t.notafter) < new Date()) ||
    !t.issuerdn;

  await db.insert(encryptedTrafficTable).values({
    sourceIp:     src_ip ?? "unknown",
    destIp:       dest_ip ?? "unknown",
    destPort:     dest_port ?? null,
    tlsVersion:   t.version ?? null,
    cipherSuite:  t.cipher_suite ?? null,
    sni:          t.sni ?? null,
    certIssuer:   t.issuerdn ?? null,
    certSubject:  t.subject ?? null,
    certExpiry:   t.notafter ?? null,
    isSuspicious,
    reason: isSuspicious
      ? (t.version === "SSLv3" || t.version === "TLSv1" ? "Weak TLS version" :
         !t.issuerdn ? "Self-signed cert" : "Expired cert")
      : null,
  });

  if (isSuspicious) {
    const [row] = await db.insert(securityEventsTable).values({
      type: "web_attack", subtype: "Suspicious TLS", severity: "high",
      sourceIp: src_ip ?? "unknown", targetHost: dest_ip ?? "unknown",
      toolUsed: "suricata",
      description: `Suspicious TLS: ${t.version ?? "unknown"} | SNI: ${t.sni ?? "-"} | Issuer: ${t.issuerdn ?? "self-signed"}`,
      status: "detected", layer: "perimeter",
    }).$returningId();

    broadcastAll({ id: row.id, type: "web_attack", severity: "high", sourceIp: src_ip });
  }

  res.status(201).json({ isSuspicious });
});

// ─── Fail2ban ─────────────────────────────────────────────────────────────────
router.post("/ingest/fail2ban", authMiddleware, async (req, res) => {
  const { ip, jail, failures } = req.body;

  // Record SSH session
  await db.insert(sshSessionsTable).values({
    sourceIp:  ip ?? "unknown",
    username:  null,
    status:    "failed",
    failures:  Number(failures) || 5,
    bannedBy:  "fail2ban",
  });

  // Auto-add to blocked IPs
  const existing = await db.select().from(blockedIpsTable)
    .where(and(eq(blockedIpsTable.ip, ip), eq(blockedIpsTable.isActive, true)));

  if (existing.length === 0) {
    await db.insert(blockedIpsTable).values({
      ip,
      reason:    `Fail2ban auto-ban: jail=${jail ?? "sshd"}, failures=${failures ?? "?"}`,
      blockedBy: "auto",
      isActive:  true,
    });
  }

  const [row] = await db.insert(securityEventsTable).values({
    type: "network_attack", subtype: "Brute Force", severity: "high",
    sourceIp: ip ?? "unknown", targetHost: "ubuntu-server",
    toolUsed: "fail2ban",
    description: `Fail2ban: IP ${ip} banned from [${jail ?? "sshd"}] after ${failures ?? "?"} failed attempts. Auto-block applied.`,
    status: "blocked", layer: "perimeter",
  }).$returningId();

  broadcastAll({ id: row.id, type: "network_attack", severity: "high", sourceIp: ip });

  const al = await createAlert(row.id, "high", `FAIL2BAN: IP ${ip} auto-banned — jail: ${jail ?? "sshd"}`);
  broadcaster.broadcast("alert", { id: al.id, severity: "high" });

  res.status(201).json({ id: row.id });
});

// ─── SSH auth.log ─────────────────────────────────────────────────────────────
router.post("/ingest/ssh", authMiddleware, async (req, res) => {
  const { src_ip, username, status, auth_method, session_id, failures } = req.body;

  await db.insert(sshSessionsTable).values({
    sourceIp:   src_ip ?? "unknown",
    username:   username ?? null,
    status:     status ?? "failed",
    authMethod: auth_method ?? null,
    sessionId:  session_id ?? null,
    failures:   Number(failures) || 0,
    bannedBy:   null,
  });

  if (status === "success") {
    const [row] = await db.insert(securityEventsTable).values({
      type: "network_attack", subtype: "Unauthorized SSH Access", severity: "critical",
      sourceIp: src_ip ?? "unknown", targetHost: "ubuntu-server",
      toolUsed: "ssh",
      description: `SSH login SUCCESS from ${src_ip} as user '${username}'. Possible compromise!`,
      status: "detected", layer: "perimeter",
    }).$returningId();

    broadcastAll({ id: row.id, type: "network_attack", severity: "critical", sourceIp: src_ip });
    const al = await createAlert(row.id, "critical", `SSH BREACH: ${src_ip} logged in as '${username}'`);
    broadcaster.broadcast("alert", { id: al.id, severity: "critical" });
  }

  res.status(201).json({ ok: true });
});

// ─── FTP ─────────────────────────────────────────────────────────────────────
router.post("/ingest/ftp", authMiddleware, async (req, res) => {
  const { src_ip, username, command, file_path, file_size, status } = req.body;

  await db.insert(ftpSessionsTable).values({
    sourceIp:  src_ip ?? "unknown",
    username:  username ?? null,
    command:   command ?? null,
    filePath:  file_path ?? null,
    fileSize:  Number(file_size) || null,
    status:    status ?? "success",
  });

  // Flag suspicious file exfiltration (RETR = download from server)
  if (command === "RETR" && file_path) {
    const suspiciousExts = [".conf", ".key", ".pem", ".shadow", ".passwd", ".env", ".sql"];
    const isSuspicious = suspiciousExts.some(ext => file_path.toLowerCase().endsWith(ext));

    if (isSuspicious) {
      const [row] = await db.insert(securityEventsTable).values({
        type: "network_attack", subtype: "File Exfiltration", severity: "critical",
        sourceIp: src_ip ?? "unknown", targetHost: "ftp-server",
        toolUsed: "ftp",
        description: `Suspicious file download via FTP: '${file_path}' by user '${username}' from ${src_ip}`,
        status: "detected", layer: "perimeter",
      }).$returningId();

      broadcastAll({ id: row.id, type: "network_attack", severity: "critical", sourceIp: src_ip });
      const al = await createAlert(row.id, "critical", `FTP EXFIL: ${src_ip} downloaded '${file_path}'`);
      broadcaster.broadcast("alert", { id: al.id, severity: "critical" });
    }
  }

  res.status(201).json({ ok: true });
});

// ─── HTTP / ModSecurity / Nginx ───────────────────────────────────────────────
router.post("/ingest/http", authMiddleware, async (req, res) => {
  const { src_ip, url, method, status_code, attack_type, payload, user_agent, rule_id, blocked } = req.body;

  if (!src_ip || !url) {
    res.status(400).json({ error: "src_ip and url are required" });
    return;
  }

  await db.insert(httpAttacksTable).values({
    sourceIp:   src_ip,
    targetUrl:  url.slice(0, 1024),
    method:     method ?? "GET",
    statusCode: Number(status_code) || null,
    attackType: attack_type ?? null,
    payload:    payload ? String(payload).slice(0, 2000) : null,
    userAgent:  user_agent ? String(user_agent).slice(0, 512) : null,
    ruleId:     rule_id ?? null,
    blocked:    Boolean(blocked),
  });

  const sevMap: Record<string, "critical"|"high"|"medium"|"low"> = {
    SQLi: "critical", XSS: "high", LFI: "critical", RFI: "critical",
    CSRF: "medium", DirTraversal: "high", Brute: "high",
  };
  const sev = sevMap[attack_type ?? ""] ?? "medium";

  const [row] = await db.insert(securityEventsTable).values({
    type: "web_attack", subtype: attack_type ?? "HTTP Attack", severity: sev,
    sourceIp: src_ip, targetHost: url.slice(0, 128),
    toolUsed: "modsecurity",
    description: `HTTP ${attack_type ?? "attack"} from ${src_ip}: ${method} ${url.slice(0, 100)} | Rule: ${rule_id ?? "N/A"} | ${blocked ? "BLOCKED" : "DETECTED"}`,
    status: blocked ? "blocked" : "detected", layer: "perimeter",
  }).$returningId();

  broadcastAll({ id: row.id, type: "web_attack", severity: sev, sourceIp: src_ip });

  if (sev === "critical" || sev === "high") {
    const al = await createAlert(row.id, sev, `WEB ATTACK ${sev.toUpperCase()}: ${attack_type} from ${src_ip} on ${url.slice(0, 80)}`);
    broadcaster.broadcast("alert", { id: al.id, severity: sev });
  }

  res.status(201).json({ id: row.id });
});

// ─── Cowrie honeypot ──────────────────────────────────────────────────────────
router.post("/ingest/cowrie", authMiddleware, async (req, res) => {
  const { eventid, src_ip, input, session, username, password } = req.body;

  const isLogin = eventid === "cowrie.login.failed" || eventid === "cowrie.login.success";
  const isCmd   = eventid === "cowrie.command.input";
  const sev     = eventid === "cowrie.login.success" ? "critical" : "high";

  const desc = isLogin
    ? `Honeypot: ${eventid === "cowrie.login.success" ? "SUCCESSFUL" : "Failed"} login from ${src_ip}. Credentials: ${username}/${password}. Session: ${session}`
    : isCmd
    ? `Honeypot: Command by attacker ${src_ip} in session ${session}: "${input}"`
    : `Honeypot event [${eventid}] from ${src_ip}`;

  const [row] = await db.insert(securityEventsTable).values({
    type: "network_attack", subtype: "Honeypot Trap", severity: sev as any,
    sourceIp: src_ip ?? "unknown", targetHost: "cowrie-honeypot",
    toolUsed: "cowrie",
    description: desc, status: "detected", layer: "perimeter",
  }).$returningId();

  broadcastAll({ id: row.id, type: "network_attack", severity: sev, sourceIp: src_ip });
  const al = await createAlert(row.id, sev as any, `COWRIE: ${desc.slice(0, 100)}`);
  broadcaster.broadcast("alert", { id: al.id, severity: sev });

  res.status(201).json({ id: row.id });
});

export default router;
