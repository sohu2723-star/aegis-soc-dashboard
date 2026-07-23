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
  if (sub.includes("honeypot"))                             return "honeypot";
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
      // SSH into pfSense via forwarder and run easyrule (no REST API package needed)
      return {
        commandType: "ssh_pfsense",
        commandText: `easyrule block WAN ${safeIp}`,
        undoCommand: `easyrule pass WAN ${safeIp}`,
      };

    case "pfsense_port_block": {
      const port  = sanitizePort(params.port || "80");
      const proto = sanitizeProtocol(params.protocol);
      return {
        commandType: "ssh_pfsense",
        // pfSense easyrule doesn't support per-port; use pfctl table rule via SSH
        commandText: `pfctl -t blocklist -T add ${safeIp} && echo "block in quick on em0 proto ${proto} from ${safeIp} to any port = ${port}" | pfctl -f -`,
        undoCommand: `pfctl -t blocklist -T del ${safeIp}`,
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
    // A manually-created rule may target either the normalised attack
    // category (for example "ssh_brute") or the original event type
    // (for example "network_attack"). Support both forms so the trigger
    // values exposed by the dashboard actually work with real ingest events.
    const typeMatch =
      rule.triggerAttackType === "any" ||
      rule.triggerAttackType === actualTriggerType ||
      rule.triggerAttackType === event.type;

    const sevOrder: Record<string, number> = { low: 1, medium: 2, high: 3, critical: 4 };
    const sevMatch =
      rule.triggerSeverity === "any" ||
      (sevOrder[event.severity] ?? 0) >= (sevOrder[rule.triggerSeverity] ?? 0);

    if (!typeMatch || !sevMatch) continue;

    // Key counter by actual trigger type (not rule's "any") to avoid cross-event mixing
    const counterKey = actualTriggerType === "any" ? event.type : actualTriggerType;
    const count = recordAttack(event.sourceIp, counterKey, rule.triggerWindowSecs);
    if (count < rule.triggerThreshold) continue;

    // Rule fires — allow multiple rules to fire per event so that
    // local iptables rules (low priority number) AND pfSense WAN rules
    // (high priority number) can both execute for the same attack.
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
    // No break — continue evaluating remaining rules so pfSense boundary
    // blocks (priority 32/45/50) also fire alongside local iptables rules.
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
    type:       "auto",
    ruleId:     rule.id,
    ruleName:   rule.name,
    action:     rule.defenseType,
    targetIp:   event.sourceIp,   // attacker IP (for block list)
    sourceIp:   event.sourceIp,   // same — explicit alias used by threat map
    targetHost: event.targetHost, // victim host — threat map uses this to match in-flight packets
    commandId:  cmdRow.id,
    status:     "queued",
    timestamp:  new Date().toISOString(),
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

// Defense rules are intentionally managed only through the dashboard CRUD API.
// There is no startup seeding: deleted rules must stay deleted across restarts.
