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
        commandType: "pfsense_rule",
        // Human-readable — no automated agent runs on the real pfSense box,
        // so this is read by a person and applied by hand in the pfSense GUI.
        commandText:
          `pfSense GUI steps:\n` +
          `1. Firewall > Aliases > Add — Name: AEGIS_BLOCK, Type: Host(s), Address: ${safeIp}\n` +
          `2. Firewall > Rules > [WAN or the interface facing this attacker] > Add\n` +
          `   Action: Block   Protocol: any   Source: AEGIS_BLOCK   Destination: any\n` +
          `   Description: ${rule.name}\n` +
          `3. Apply Changes\n` +
          `CLI equivalent (pfSense shell / pfctl):\n` +
          `   pfctl -t aegis_blocklist -T add ${safeIp}`,
        undoCommand: `pfctl -t aegis_blocklist -T delete ${safeIp}`,
      };

    case "pfsense_port_block": {
      const port  = sanitizePort(params.port || "80");
      const proto = sanitizeProtocol(params.protocol);
      return {
        commandType: "pfsense_rule",
        commandText:
          `pfSense GUI steps:\n` +
          `1. Firewall > Rules > [interface facing this attacker] > Add\n` +
          `   Action: Block   Protocol: ${proto.toUpperCase()}   Source: ${safeIp}\n` +
          `   Destination port range: ${port} - ${port}\n` +
          `   Description: ${rule.name}\n` +
          `2. Apply Changes`,
        undoCommand: `Remove the "${rule.name}" rule from Firewall > Rules`,
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

// ─── Suggest manual defense ───────────────────────────────────────────────────
async function suggestManualDefense(rule: DefenseRule, event: IngestEvent) {
  const { commandText } = buildCommand(rule, event.sourceIp, event.id);

  const [incRow] = await db.insert(incidentsTable).values({
    title:       `[ACTION NEEDED] ${rule.name} — ${event.sourceIp}`,
    severity:    event.severity as any,
    status:      "open",
    description: `Rule "${rule.name}" triggered for ${event.sourceIp}. Manual action required.`,
    responder:   "admin",
    notes:       `Suggested command (on ${rule.targetVm}):\n${commandText}`,
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

// ─── Seed default rules ───────────────────────────────────────────────────────
export async function seedDefaultRules() {
  const existing = await db.select().from(defenseRulesTable);
  const existingNames = new Set(existing.map(r => r.name));

  const defaults: Array<typeof defenseRulesTable.$inferInsert> = [
    {
      name: "SSH Brute Force → Auto Block",
      description: "Block any IP with ≥5 SSH failures in 60s",
      triggerAttackType: "ssh_brute", triggerSeverity: "any",
      triggerThreshold: 5, triggerWindowSecs: 60,
      actionType: "auto", defenseType: "block_ip",
      targetVm: "ubuntu", priority: 10, isActive: true,
    },
    {
      name: "Honeypot Touch → Instant Block",
      description: "Any honeypot contact = immediate IP ban",
      triggerAttackType: "honeypot", triggerSeverity: "any",
      triggerThreshold: 1, triggerWindowSecs: 1,
      actionType: "auto", defenseType: "block_ip",
      targetVm: "ubuntu", priority: 5, isActive: true,
    },
    {
      name: "DDoS → Null Route",
      description: "Null-route IP sending ≥50 events in 30s",
      triggerAttackType: "ddos", triggerSeverity: "any",
      triggerThreshold: 50, triggerWindowSecs: 30,
      actionType: "auto", defenseType: "null_route",
      targetVm: "ubuntu", priority: 8, isActive: true,
    },
    {
      name: "Web Attack (High) → Auto Block",
      description: "Block IP on first high/critical SQLi, XSS, LFI, RFI",
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
    {
      name: "FTP Brute Force → Block",
      description: "Block IP with ≥10 FTP failures in 60s",
      triggerAttackType: "ftp_brute", triggerSeverity: "any",
      triggerThreshold: 10, triggerWindowSecs: 60,
      actionType: "auto", defenseType: "block_ip",
      targetVm: "ubuntu", priority: 25, isActive: true,
    },
    {
      name: "Mail Spam → Auto Block",
      description: "Block IP sending ≥100 mails in 60s",
      triggerAttackType: "mail_attack", triggerSeverity: "any",
      triggerThreshold: 100, triggerWindowSecs: 60,
      actionType: "auto", defenseType: "block_ip",
      targetVm: "ubuntu", priority: 30, isActive: true,
    },
    {
      name: "Critical Attack → pfSense Block (Suggested)",
      description: "Any critical severity attack → suggest blocking at pfSense (manual — no auto-agent on the real router)",
      triggerAttackType: "any", triggerSeverity: "critical",
      triggerThreshold: 1, triggerWindowSecs: 60,
      actionType: "suggest", defenseType: "pfsense_block",
      targetVm: "pfsense", priority: 50, isActive: true,
    },
    {
      name: "Web Attack (SQLi/XSS/etc) → pfSense Block (Suggested)",
      description: "High/critical web attack on a bank VM → suggest a pfSense block rule",
      triggerAttackType: "web_attack", triggerSeverity: "high",
      triggerThreshold: 1, triggerWindowSecs: 60,
      actionType: "suggest", defenseType: "pfsense_block",
      targetVm: "pfsense", priority: 45, isActive: true,
    },
    {
      name: "MITM / ARP Spoof → Suggest Rule",
      description: "ARP spoofing needs manual VLAN isolation — creates incident",
      triggerAttackType: "mitm", triggerSeverity: "any",
      triggerThreshold: 1, triggerWindowSecs: 60,
      actionType: "suggest", defenseType: "alert_only",
      targetVm: "pfsense", priority: 40, isActive: true,
    },
  ];

  for (const rule of defaults) {
    if (existingNames.has(rule.name)) continue; // already seeded — don't duplicate
    await db.insert(defenseRulesTable).values(rule);
  }
}
