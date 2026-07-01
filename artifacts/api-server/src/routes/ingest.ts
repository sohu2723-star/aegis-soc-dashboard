/**
 * AEGIS Ingest API
 * ================
 * Receives real events from Ubuntu VM (Suricata, Fail2ban, SSH, FTP, ModSec, Cowrie)
 * and pfSense (syslog/API). Each event triggers the auto-defense engine.
 *
 * All endpoints require X-AEGIS-Key header.
 */
import { Router } from "express";
import { db } from "@workspace/db";
import {
  securityEventsTable, alertsTable,
  sshSessionsTable, ftpSessionsTable,
  encryptedTrafficTable, httpAttacksTable,
  blockedIpsTable,
} from "@workspace/db";
import { broadcaster } from "../lib/broadcaster";
import { evaluateEvent } from "../lib/auto-defense";
import { eq, and } from "drizzle-orm";

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
  const [row] = await db.insert(securityEventsTable).values(values).$returningId();
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
    channel: severity === "critical" ? "telegram" : "dashboard",
    acknowledged: false, eventId,
  }).$returningId();
  broadcaster.broadcast("alert", { id: row.id, severity });
}

// ─────────────────────────────────────────────────────────────────────────────
// Generic
// ─────────────────────────────────────────────────────────────────────────────
router.post("/ingest/event", auth, async (req, res) => {
  const { source, type, subtype, severity: s, sourceIp, targetHost, toolUsed, description, layer, blocked = false } = req.body;
  if (!sourceIp || !description) { res.status(400).json({ error: "sourceIp and description required" }); return; }

  const event = await insertEvent({
    type: type ?? source ?? "network_attack", subtype: subtype ?? "Unknown",
    severity: sev(s), sourceIp, targetHost: targetHost ?? "internal-network",
    toolUsed: toolUsed ?? source ?? null, description,
    status: blocked ? "blocked" : "detected", layer: layer ?? "perimeter",
  });
  const severity = sev(s);
  if (severity === "critical" || severity === "high")
    await mkAlert(event.id, severity, `${severity.toUpperCase()} [${source ?? "sensor"}]: ${description.slice(0, 120)}`);

  res.status(201).json({ ...event, createdAt: event.createdAt.toISOString() });
});

// ─────────────────────────────────────────────────────────────────────────────
// Snort
// ─────────────────────────────────────────────────────────────────────────────
router.post("/ingest/snort", auth, async (req, res) => {
  const { priority, msg, src, dst, proto } = req.body;
  const sevMap: Record<string,"critical"|"high"|"medium"|"low"> = {"1":"critical","2":"high","3":"medium","4":"low"};
  const s = sevMap[String(priority)] ?? "medium";

  const event = await insertEvent({
    type:"network_attack", subtype: msg ?? "Snort Alert", severity: s,
    sourceIp: src ?? "unknown", targetHost: dst ?? "internal-network",
    toolUsed:"snort", description:`Snort IDS: ${msg} | ${proto ?? "TCP"} | ${src} → ${dst}`,
    status:"detected", layer:"perimeter",
  });
  if (s === "critical" || s === "high") await mkAlert(event.id, s, `SNORT: ${msg} — ${src} → ${dst}`);
  res.status(201).json({ id: event.id });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suricata alert (EVE JSON)
// ─────────────────────────────────────────────────────────────────────────────
router.post("/ingest/suricata", auth, async (req, res) => {
  const { alert, src_ip, dest_ip, proto, event_type } = req.body;
  const a = alert ?? {};
  const s = sev(String(a.severity ?? 3));

  const event = await insertEvent({
    type:"network_attack", subtype: a.signature ?? "Suricata Alert", severity: s,
    sourceIp: src_ip ?? "unknown", targetHost: dest_ip ?? "internal-network",
    toolUsed:"suricata", description:`Suricata ${event_type ?? "alert"}: ${a.signature ?? "Unknown"} | ${a.category ?? ""} | ${proto ?? "TCP"}`,
    status:"detected", layer:"perimeter",
  });
  if (s === "critical" || s === "high") await mkAlert(event.id, s, `SURICATA: ${a.signature} — ${src_ip} → ${dest_ip}`);
  res.status(201).json({ id: event.id });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suricata TLS (encrypted traffic)
// ─────────────────────────────────────────────────────────────────────────────
router.post("/ingest/suricata/tls", auth, async (req, res) => {
  const { src_ip, dest_ip, dest_port, tls } = req.body;
  const t = tls ?? {};
  const isSuspicious = t.version === "SSLv3" || t.version === "TLSv1" ||
    (t.notafter && new Date(t.notafter) < new Date()) || !t.issuerdn;

  await db.insert(encryptedTrafficTable).values({
    sourceIp: src_ip ?? "unknown", destIp: dest_ip ?? "unknown",
    destPort: dest_port ?? null, tlsVersion: t.version ?? null,
    cipherSuite: t.cipher_suite ?? null, sni: t.sni ?? null,
    certIssuer: t.issuerdn ?? null, certSubject: t.subject ?? null,
    certExpiry: t.notafter ?? null, isSuspicious,
    reason: isSuspicious ? (t.version === "SSLv3" || t.version === "TLSv1" ? "Weak TLS" : !t.issuerdn ? "Self-signed" : "Expired cert") : null,
  });

  if (isSuspicious) {
    const event = await insertEvent({
      type:"web_attack", subtype:"Suspicious TLS", severity:"high",
      sourceIp: src_ip ?? "unknown", targetHost: dest_ip ?? "unknown",
      toolUsed:"suricata",
      description:`Suspicious TLS: ${t.version ?? "unknown"} | SNI: ${t.sni ?? "-"} | Issuer: ${t.issuerdn ?? "self-signed"}`,
      status:"detected", layer:"perimeter",
    });
    await mkAlert(event.id, "high", `TLS SUSPICIOUS: ${t.version} from ${src_ip} — ${t.sni ?? dest_ip}`);
  }
  res.status(201).json({ isSuspicious });
});

// ─────────────────────────────────────────────────────────────────────────────
// Fail2ban → auto-block IP in DB
// ─────────────────────────────────────────────────────────────────────────────
router.post("/ingest/fail2ban", auth, async (req, res) => {
  const { ip, jail, failures } = req.body;

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

  const event = await insertEvent({
    type:"network_attack", subtype:"Brute Force", severity:"high",
    sourceIp: ip ?? "unknown", targetHost:"ubuntu-server",
    toolUsed:"fail2ban", description:`Fail2ban banned ${ip} from [${jail ?? "sshd"}] after ${failures ?? "?"} failures. Auto-block applied.`,
    status:"blocked", layer:"perimeter",
  });
  await mkAlert(event.id, "high", `FAIL2BAN: ${ip} auto-banned — jail: ${jail ?? "sshd"}`);
  res.status(201).json({ id: event.id });
});

// ─────────────────────────────────────────────────────────────────────────────
// SSH auth.log
// ─────────────────────────────────────────────────────────────────────────────
router.post("/ingest/ssh", auth, async (req, res) => {
  const { src_ip, username, status: st, auth_method, session_id, failures } = req.body;

  await db.insert(sshSessionsTable).values({
    sourceIp: src_ip ?? "unknown", username: username ?? null,
    status: st ?? "failed", authMethod: auth_method ?? null,
    sessionId: session_id ?? null, failures: Number(failures) || 0, bannedBy: null,
  });

  if (st === "success") {
    const event = await insertEvent({
      type:"network_attack", subtype:"Unauthorized SSH Access", severity:"critical",
      sourceIp: src_ip ?? "unknown", targetHost:"ubuntu-server",
      toolUsed:"ssh", description:`SSH login SUCCESS from ${src_ip} as '${username}'. Possible compromise!`,
      status:"detected", layer:"perimeter",
    });
    await mkAlert(event.id, "critical", `SSH BREACH: ${src_ip} logged in as '${username}'`);
  }
  res.status(201).json({ ok:true });
});

// ─────────────────────────────────────────────────────────────────────────────
// FTP
// ─────────────────────────────────────────────────────────────────────────────
router.post("/ingest/ftp", auth, async (req, res) => {
  const { src_ip, username, command, file_path, file_size, status: st } = req.body;

  await db.insert(ftpSessionsTable).values({
    sourceIp: src_ip ?? "unknown", username: username ?? null,
    command: command ?? null, filePath: file_path ?? null,
    fileSize: Number(file_size) || null, status: st ?? "success",
  });

  const suspiciousExts = [".conf",".key",".pem",".shadow",".passwd",".env",".sql",".id_rsa",".htpasswd"];
  if (command === "RETR" && file_path && suspiciousExts.some(e => file_path.toLowerCase().endsWith(e))) {
    const event = await insertEvent({
      type:"network_attack", subtype:"File Exfiltration", severity:"critical",
      sourceIp: src_ip ?? "unknown", targetHost:"ftp-server",
      toolUsed:"ftp", description:`FTP exfil: '${file_path}' by '${username}' from ${src_ip}`,
      status:"detected", layer:"perimeter",
    });
    await mkAlert(event.id, "critical", `FTP EXFIL: ${src_ip} downloaded '${file_path}'`);
  }
  res.status(201).json({ ok:true });
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

  const event = await insertEvent({
    type:"network_attack", subtype:"Honeypot Trap", severity: s as any,
    sourceIp: src_ip ?? "unknown", targetHost:"cowrie-honeypot",
    toolUsed:"cowrie", description: desc, status:"detected", layer:"perimeter",
  });
  await mkAlert(event.id, s as any, `COWRIE: ${desc.slice(0,100)}`);
  res.status(201).json({ id:event.id });
});

export default router;
