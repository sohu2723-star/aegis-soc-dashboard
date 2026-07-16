/**
 * AEGIS Auto-Defense Engine
 * =========================
 * Evaluates every ingest event against active defense rules.
 * When a rule fires:
 *   - "auto"    → queues a command for the Ubuntu/pfSense agent to execute
 *   - "suggest" → creates an incident with the recommended rule
 *
 * All values inserted into shell commands are sanitised through
 * defense-sanitize.ts before use — no raw user input reaches shell strings.
 */

import { db } from "@workspace/db";
import { eq } from "drizzle-orm";
import {
  defenseRulesTable,
  defenseCommandsTable,
  blockedIpsTable,
  defenseActionsTable,
  alertsTable,
  incidentsTable,
  type DefenseRule,
} from "@workspace/db";
import { and } from "drizzle-orm";
import { broadcaster } from "./broadcaster";
import { recordAttack } from "./attack-tracker";
import {
  sanitizeIp,
  sanitizePort,
  sanitizeProtocol,
  sanitizeRate,
  parseActionParams,
} from "./defense-sanitize";
import { isDefenderIp } from "./ip-classifier";
import { isAutoDefenseEnabled } from "./app-settings";

// ─── Attack-type normaliser ───────────────────────────────────────────────────
function toTriggerType(eventType: string, eventSubtype: string): string {
  const sub = (eventSubtype ?? "").toLowerCase();
  const typ = (eventType ?? "").toLowerCase();

  if (sub.includes("brute") && (sub.includes("ssh") || typ === "network_attack")) return "ssh_brute";
  if (sub.includes("port scan") || sub.includes("nmap"))   return "port_scan";
  if (sub.includes("ddos") || sub.includes("flood"))       return "ddos";
  if (sub.includes("sqli") || sub.includes("sql") || sub.includes("xss") ||
      sub.includes("lfi") || sub.includes("rfi") || sub.includes("traversal") ||
      sub.includes("csrf") || sub.includes("injection") || sub.includes("ssrf") ||
      sub.includes("xxe") || typ === "web_attack")          return "web_attack";
  if (sub.includes("phishing") || sub.includes("fake"))    return "phishing";
  if (sub.includes("smtp") || sub.includes("mail") || sub.includes("spam") ||
      typ === "mail_attack")                                return "mail_attack";
  if (sub.includes("ftp"))                                  return "ftp_brute";
  if (sub.includes("honeypot") || sub.includes("cowrie"))  return "honeypot";
  if (sub.includes("tls") || sub.includes("ssl"))          return "tls_suspicious";
  if (sub.includes("dns"))                                  return "dns_attack";
  if (sub.includes("arp") || sub.includes("mitm"))         return "mitm";
  return "any";
}

// ─── Command builder (sanitised) ─────────────────────────────────────────────
function buildCommand(rule: DefenseRule, sourceIp: string, _eventId: number) {
  // Always sanitise the IP — throws on invalid input, aborting rule execution
  const safeIp = sanitizeIp(sourceIp);
  const params  = parseActionParams(rule.actionParams);  // throws on unsafe values

  switch (rule.defenseType) {

    case "block_ip":
      return {
        commandType: "iptables",
        commandText: `iptables -I INPUT -s ${safeIp} -j DROP`,
        undoCommand: `iptables -D INPUT -s ${safeIp} -j DROP`,
      };

    case "null_route":
      return {
        commandType: "null_route",
        commandText: `ip route add blackhole ${safeIp}/32`,
        undoCommand: `ip route del blackhole ${safeIp}/32`,
      };

    case "rate_limit": {
      const rate = sanitizeRate(params.rate ?? "10/min");
      return {
        commandType: "iptables",
        commandText:
          `iptables -I INPUT -s ${safeIp} -m limit --limit ${rate} --limit-burst 20 -j ACCEPT && ` +
          `iptables -A INPUT -s ${safeIp} -j DROP`,
        undoCommand: `iptables -D INPUT -s ${safeIp} -j DROP`,
      };
    }

    case "port_block": {
      const port  = sanitizePort(params.port || "22");
      const proto = sanitizeProtocol(params.protocol);
      return {
        commandType: "iptables",
        commandText: `iptables -I INPUT -p ${proto} -s ${safeIp} --dport ${port} -j DROP`,
        undoCommand: `iptables -D INPUT -p ${proto} -s ${safeIp} --dport ${port} -j DROP`,
      };
    }

    case "dns_block": {
      const domain = params.domain ?? safeIp;
      return {
        commandType: "custom",
        // Use printf to avoid shell injection via domain (already validated as hostname)
        commandText: `printf '0.0.0.0 %s\\n' ${domain} >> /etc/hosts`,
        undoCommand: `sed -i '/0.0.0.0 ${domain}/d' /etc/hosts`,
      };
    }

    case "pfsense_block":
      return {
        commandType: "pfsense_api",
        // Structured JSON — defense_agent.py running on pfSense (or with network
        // access to it) parses this and calls the pfSense REST API to add the
        // firewall rule. Only executed for actionType="auto" rules.
        commandText: JSON.stringify({
          action: "block_ip",
          ip:     safeIp,
          reason: rule.name,
          ttl:    params.durationSecs,
        }),
        undoCommand: JSON.stringify({ action: "unblock_ip", ip: safeIp }),
      };

    case "pfsense_port_block": {
      const port  = sanitizePort(params.port || "80");
      const proto = sanitizeProtocol(params.protocol);
      return {
        commandType: "pfsense_api",
        commandText: JSON.stringify({
          action:   "block_port",
          ip:       safeIp,
          port,
          protocol: proto,
          reason:   rule.name,
        }),
        undoCommand: JSON.stringify({ action: "unblock_port", ip: safeIp, port }),
      };
    }

    case "waf_rule":
      return {
        commandType: "custom",
        // modsec_ban.sh must be a hardened wrapper on the VM — no shell expansion
        commandText: `modsec_ban.sh ${safeIp}`,
        undoCommand: `modsec_unban.sh ${safeIp}`,
      };

    default: // alert_only
      return {
        commandType: "custom",
        commandText: `logger -t aegis "Rule ${rule.name} triggered for ${safeIp}"`,
        undoCommand: null,
      };
  }
}

// ─── Main evaluator ───────────────────────────────────────────────────────────
export interface IngestEvent {
  id:          number;
  type:        string;
  subtype:     string;
  severity:    string;
  sourceIp:    string;
  targetHost:  string;
  description: string;
  status:      string;
}

export async function evaluateEvent(event: IngestEvent): Promise<void> {
  if (!event.sourceIp || event.sourceIp === "unknown") return;

  // Global kill switch — toggled from the dashboard, persisted in app_settings.
  if (!(await isAutoDefenseEnabled())) {
    console.log(`[AutoDefense] Skipped — auto-defense is disabled globally`);
    return;
  }

  // Skip auto-defense for private/defender IPs — never self-block
  if (isDefenderIp(event.sourceIp)) {
    console.log(`[AutoDefense] Skipped — defender IP ${event.sourceIp} is whitelisted (RFC1918)`);
    return;
  }

  const actualTriggerType = toTriggerType(event.type, event.subtype);

  const rules = await db.select().from(defenseRulesTable)
    .where(eq(defenseRulesTable.isActive, true));

  for (const rule of rules.sort((a, b) => a.priority - b.priority)) {
    const typeMatch =
      rule.triggerAttackType === "any" ||
      rule.triggerAttackType === actualTriggerType;

    const sevOrder: Record<string, number> = { low: 1, medium: 2, high: 3, critical: 4 };
    const sevMatch =
      rule.triggerSeverity === "any" ||
      (sevOrder[event.severity] ?? 0) >= (sevOrder[rule.triggerSeverity] ?? 0);

    if (!typeMatch || !sevMatch) continue;

    // Key counter by actual trigger type (not rule's "any") to avoid cross-event mixing
    const counterKey = actualTriggerType === "any" ? event.type : actualTriggerType;
    const count = recordAttack(event.sourceIp, counterKey, rule.triggerWindowSecs);
    if (count < rule.triggerThreshold) continue;

    // Rule fires
    try {
      if (rule.actionType === "auto") {
        await executeAutoDefense(rule, event);
      } else {
        await suggestManualDefense(rule, event);
      }
    } catch (err: any) {
      // If sanitisation throws, log and skip — don't crash ingest
      console.error(`[AutoDefense] Rule "${rule.name}" skipped — sanitisation error: ${err?.message}`);
    }

    break; // highest-priority rule only
  }
}

// ─── Auto defense ─────────────────────────────────────────────────────────────
async function executeAutoDefense(rule: DefenseRule, event: IngestEvent) {
  const { commandType, commandText, undoCommand } = buildCommand(rule, event.sourceIp, event.id);

  const [cmdRow] = await db.insert(defenseCommandsTable).values({
    ruleId:      rule.id,
    eventId:     event.id,
    targetVm:    rule.targetVm,
    commandType,
    commandText,
    undoCommand:  undoCommand ?? null,
    targetIp:    event.sourceIp,
    status:      "pending",
  }).returning();

  // Record in blocked_ips for IP-blocking defense types
  if (["block_ip", "null_route", "pfsense_block"].includes(rule.defenseType)) {
    const exists = await db.select().from(blockedIpsTable)
      .where(and(eq(blockedIpsTable.ip, event.sourceIp), eq(blockedIpsTable.isActive, true)));
    if (exists.length === 0) {
      await db.insert(blockedIpsTable).values({
        ip:         event.sourceIp,
        reason:     `Auto-defense: ${rule.name}`,
        blockedBy:  "auto",
        targetHost: event.targetHost ?? null,
        isActive:   true,
      });
    }
  }

  await db.insert(defenseActionsTable).values({
    type:           "auto",
    action:         rule.defenseType,
    targetIp:       event.sourceIp,
    targetHost:     event.targetHost ?? null,
    reason:         `Rule: ${rule.name} — ${event.subtype} from ${event.sourceIp}`,
    performedBy:    "aegis-auto-defense",
    status:         "queued",
    relatedEventId: String(event.id),
  });

  broadcaster.broadcast("defense_action", {
    type:      "auto",
    ruleId:    rule.id,
    ruleName:  rule.name,
    action:    rule.defenseType,
    targetIp:  event.sourceIp,
    commandId: cmdRow.id,
    status:    "queued",
    timestamp: new Date().toISOString(),
  });

  broadcaster.broadcast("stats_update", { timestamp: new Date().toISOString() });
}

// ─── Render a pfSense JSON action as human-readable GUI steps ─────────────────
// Used when suggesting (not auto-executing) a pfSense defense — a person reads
// this and applies it by hand in the pfSense web GUI, since no automated
// executor may be running against the real router.
function humanizePfSenseAction(commandText: string): string {
  try {
    const p = JSON.parse(commandText);
    if (p.action === "block_ip") {
      return (
        `pfSense GUI steps:\n` +
        `1. Firewall > Aliases > Add — Name: AEGIS_BLOCK, Type: Host(s), Address: ${p.ip}\n` +
        `2. Firewall > Rules > [interface facing this attacker] > Add\n` +
        `   Action: Block   Protocol: any   Source: AEGIS_BLOCK   Destination: any\n` +
        `   Description: ${p.reason ?? "AEGIS suggested block"}\n` +
        `3. Apply Changes\n` +
        `CLI equivalent (pfSense shell): pfctl -t aegis_blocklist -T add ${p.ip}`
      );
    }
    if (p.action === "block_port") {
      return (
        `pfSense GUI steps:\n` +
        `1. Firewall > Rules > [interface facing this attacker] > Add\n` +
        `   Action: Block   Protocol: ${String(p.protocol ?? "tcp").toUpperCase()}   Source: ${p.ip}\n` +
        `   Destination port range: ${p.port} - ${p.port}\n` +
        `   Description: ${p.reason ?? "AEGIS suggested block"}\n` +
        `2. Apply Changes`
      );
    }
  } catch { /* not JSON — fall through to raw text below */ }
  return commandText;
}

// ─── Suggest manual defense ───────────────────────────────────────────────────
async function suggestManualDefense(rule: DefenseRule, event: IngestEvent) {
  const { commandText } = buildCommand(rule, event.sourceIp, event.id);
  const readableCommand = rule.targetVm === "pfsense" ? humanizePfSenseAction(commandText) : commandText;

  const [incRow] = await db.insert(incidentsTable).values({
    title:       `[ACTION NEEDED] ${rule.name} — ${event.sourceIp}`,
    severity:    event.severity as any,
    status:      "open",
    description: `Rule "${rule.name}" triggered for ${event.sourceIp}. Manual action required.`,
    responder:   "admin",
    notes:       `Attack: ${event.subtype} (${event.type}) from ${event.sourceIp} → ${event.targetHost}\n\nSuggested defense (apply on ${rule.targetVm}):\n${readableCommand}`,
    eventCount:  1,
  }).returning();

  const [alertRow] = await db.insert(alertsTable).values({
    message:      `MANUAL ACTION: ${rule.name} — ${event.sourceIp}`.slice(0, 255),
    severity:     event.severity as any,
    channel:      "dashboard",
    acknowledged: false,
    eventId:      event.id,
  }).returning();

  broadcaster.broadcast("alert", { id: alertRow.id, severity: event.severity, manualAction: true });
  broadcaster.broadcast("incident", { id: incRow.id, title: `[ACTION NEEDED] ${rule.name}` });
}

// Rules that belonged to removed services (bank-mail, teller-pc, cowrie, snort)
// — deleted from DB on startup so they don't appear in the Defense Rules page.
const OBSOLETE_RULE_NAMES = [
  "Honeypot Touch → Instant Block",   // Cowrie honeypot removed
  "FTP Brute Force → Block",          // no FTP server on bank-web/customer-db
  "Mail Spam → Auto Block",           // bank-mail removed from lab
];

// ─── Seed default rules ───────────────────────────────────────────────────────
export async function seedDefaultRules() {
  const existing = await db.select().from(defenseRulesTable);

  // Remove obsolete rules that no longer apply to this lab topology
  const toDelete = existing.filter(r => OBSOLETE_RULE_NAMES.includes(r.name));
  if (toDelete.length > 0) {
    const { inArray } = await import("drizzle-orm");
    await db.delete(defenseRulesTable).where(
      inArray(defenseRulesTable.id, toDelete.map(r => r.id)),
    );
  }

  const existingNames = new Set(existing.map(r => r.name));

  const defaults: Array<typeof defenseRulesTable.$inferInsert> = [
    // ── bank-web + customer-db: iptables / null-route (executed by forwarder) ──
    {
      name: "SSH Brute Force → Auto Block",
      description: "Block any IP with ≥5 SSH failures in 60s on bank-web or customer-db",
      triggerAttackType: "ssh_brute", triggerSeverity: "any",
      triggerThreshold: 5, triggerWindowSecs: 60,
      actionType: "auto", defenseType: "block_ip",
      targetVm: "ubuntu", priority: 10, isActive: true,
    },
    {
      name: "DDoS → Null Route",
      description: "Null-route any IP flooding ≥50 events in 30s",
      triggerAttackType: "ddos", triggerSeverity: "any",
      triggerThreshold: 50, triggerWindowSecs: 30,
      actionType: "auto", defenseType: "null_route",
      targetVm: "ubuntu", priority: 8, isActive: true,
    },
    {
      name: "Web Attack (High) → Auto Block",
      description: "Block IP on first high/critical SQLi, XSS, LFI, RFI against bank-web",
      triggerAttackType: "web_attack", triggerSeverity: "high",
      triggerThreshold: 1, triggerWindowSecs: 60,
      actionType: "auto", defenseType: "block_ip",
      targetVm: "ubuntu", priority: 15, isActive: true,
    },
    {
      name: "Port Scan → Auto Block",
      description: "Block any IP detected doing a port scan",
      triggerAttackType: "port_scan", triggerSeverity: "any",
      triggerThreshold: 1, triggerWindowSecs: 60,
      actionType: "auto", defenseType: "block_ip",
      targetVm: "ubuntu", priority: 20, isActive: true,
    },

    // ── pfSense WAN: suggested blocks (auto if defense_agent runs on pfSense) ──
    {
      name: "Critical Attack → pfSense Block",
      description: "Critical attack → block at pfSense WAN. Auto-applied if defense_agent.py runs on pfSense with PFSENSE_API_KEY set; otherwise creates a manual incident.",
      triggerAttackType: "any", triggerSeverity: "critical",
      triggerThreshold: 1, triggerWindowSecs: 60,
      actionType: "suggest", defenseType: "pfsense_block",
      targetVm: "pfsense", priority: 50, isActive: true,
    },
    {
      name: "Web Attack → pfSense Block",
      description: "High/critical web attack → also block at pfSense WAN boundary. Auto-applied if defense_agent.py runs on pfSense.",
      triggerAttackType: "web_attack", triggerSeverity: "high",
      triggerThreshold: 1, triggerWindowSecs: 60,
      actionType: "suggest", defenseType: "pfsense_block",
      targetVm: "pfsense", priority: 45, isActive: true,
    },
    {
      name: "MITM / ARP Spoof → Incident",
      description: "ARP spoofing detected — creates incident with VLAN isolation steps. Manual action required on pfSense.",
      triggerAttackType: "mitm", triggerSeverity: "any",
      triggerThreshold: 1, triggerWindowSecs: 60,
      actionType: "suggest", defenseType: "alert_only",
      targetVm: "pfsense", priority: 40, isActive: true,
    },
  ];

  for (const rule of defaults) {
    if (existingNames.has(rule.name)) continue;
    await db.insert(defenseRulesTable).values(rule);
  }
}
