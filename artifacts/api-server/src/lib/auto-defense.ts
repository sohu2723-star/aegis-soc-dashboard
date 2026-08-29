/**
 * AEGIS Auto-Defense Engine
 * =========================
 * Evaluates every ingest event against active defense rules.
 * When a rule fires it queues a command for the Ubuntu/pfSense agent to execute.
 *
 * All values inserted into shell commands are sanitised through
 * defense-sanitize.ts before use — no raw user input reaches shell strings.
 */

import { db } from "@workspace/db";
import { eq, isNull } from "drizzle-orm";
import {
  defenseRulesTable,
  defenseCommandsTable,
  blockedIpsTable,
  defenseActionsTable,
  sshSessionsTable,
  type DefenseRule,
} from "@workspace/db";
import { and } from "drizzle-orm";
import { broadcaster } from "./broadcaster";
import { recordAttack } from "./attack-tracker";
import {
  sanitizeIp,
  sanitizeRate,
  parseActionParams,
} from "./defense-sanitize";
import { isDefenderIp } from "./ip-classifier";
import { isAutoDefenseEnabled } from "./app-settings";

// ─── Attack-type normaliser ───────────────────────────────────────────────────
export function toTriggerType(eventType: string, eventSubtype: string): string {
  const sub = (eventSubtype ?? "").toLowerCase();
  const typ = (eventType ?? "").toLowerCase();

  // The ingest pipeline has already classified canonical event types. Treat
  // that value as authoritative so a DDoS event whose signature also contains
  // words such as "SYN scan" can never trigger a port_scan defense rule.
  if (typ === "ddos")                                      return "ddos";
  if (typ === "port_scan")                                 return "port_scan";
  if (typ === "web_attack")                                return "web_attack";
  if (typ === "ssh_brute")                                 return "ssh_brute";
  if (typ === "dns_attack")                                return "dns_attack";
  if (typ === "db_attack")                                 return "db_attack";
  if (typ === "ldap_attack")                               return sub.includes("enum") ? "ldap_enum" : "ldap_brute";
  if (typ === "mitm")                                      return "mitm";
  if (typ === "auth_event")                                return "auth_event";

  // Service-specific checks must precede the generic network/SSH fallback.
  if (sub.includes("ldap"))                                 return sub.includes("enum") ? "ldap_enum" : "ldap_brute";
  if (sub.includes("mysql") || sub.includes("database") || sub.includes("db ")) return "db_attack";
  // SSH brute force — both failed attempts AND successful breach (Brute Force Success).
  // Breach events use type "auth_event" + subtype "Brute Force Success"; they
  // must still map to "ssh_brute" so rules with triggerAttackType="ssh_brute" fire.
  if (sub.includes("brute") && (sub.includes("ssh") || typ === "ssh_brute"))  return "ssh_brute";
  if (sub.includes("brute force") || sub.includes("brute-force"))             return "ssh_brute";
  if (sub.includes("port scan") || sub.includes("nmap"))   return "port_scan";
  if (sub.includes("ddos") || sub.includes("flood"))       return "ddos";
  if (sub.includes("sqli") || sub.includes("sql") || sub.includes("xss") ||
      sub.includes("lfi") || sub.includes("rfi") || sub.includes("traversal") ||
      sub.includes("csrf") || sub.includes("injection") || sub.includes("ssrf") ||
      sub.includes("xxe") || typ === "web_attack")          return "web_attack";
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
        // Kill any active sessions from the attacker immediately after inserting the DROP rule.
        // Using -I (insert) ensures this rule takes precedence over any existing ACCEPT rules.
        // ss -K terminates established TCP connections so the block takes effect on live sessions too.
        commandText: `(iptables -C INPUT -s ${safeIp} -j DROP 2>/dev/null || iptables -I INPUT -s ${safeIp} -j DROP) && (ss -K dst ${safeIp} 2>/dev/null; ss -K src ${safeIp} 2>/dev/null; true)`,
        // Remove every legacy duplicate, not only the first matching rule.
        undoCommand: `while iptables -C INPUT -s ${safeIp} -j DROP 2>/dev/null; do iptables -D INPUT -s ${safeIp} -j DROP || exit 1; done; ! iptables -C INPUT -s ${safeIp} -j DROP 2>/dev/null`,
      };

    case "rate_limit": {
      const rate = sanitizeRate(params.rate ?? "10/min");
      return {
        commandType: "iptables",
        commandText:
          `iptables -I INPUT -s ${safeIp} -m limit --limit ${rate} --limit-burst 20 -j ACCEPT && ` +
          `iptables -A INPUT -s ${safeIp} -j DROP`,
        undoCommand:
          `iptables -D INPUT -s ${safeIp} -m limit --limit ${rate} --limit-burst 20 -j ACCEPT; ` +
          `iptables -D INPUT -s ${safeIp} -j DROP`,
      };
    }

    case "pfsense_block":
      // SSH into pfSense via forwarder and run easyrule (no REST API package needed)
      return {
        commandType: "ssh_pfsense",
        // easyrule can print a semantic failure while still exiting zero. Use
        // its supported showblock command and accept pfSense's CIDR rendering.
        commandText: `easyrule block wan ${safeIp} && easyrule showblock wan | grep -Fqx -e ${safeIp} -e ${safeIp}/32 -e ${safeIp}/128`,
        undoCommand: `easyrule unblock wan ${safeIp} && ! easyrule showblock wan | grep -Fqx -e ${safeIp} -e ${safeIp}/32 -e ${safeIp}/128`,
      };

    case "alert_only":
      return {
        commandType: "custom",
        commandText: `logger -t aegis "Rule ${rule.name} triggered for ${safeIp}"`,
        undoCommand: null,
      };

    default:
      throw new Error(`Unsupported defense type: ${rule.defenseType}`);
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
      await executeAutoDefense(rule, event);
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

  // Deduplication: if this defense type produces a hard block and the IP is
  // already actively blocked, skip queuing another command.  Without this,
  // every ingest event re-queues the same iptables/pfSense command for an IP
  // that is already blocked, causing an unbounded pile-up of "pending" rows.
  const isHardBlock = ["block_ip", "pfsense_block"].includes(rule.defenseType);
  if (isHardBlock) {
    const alreadyBlocked = await db.select({ id: blockedIpsTable.id })
      .from(blockedIpsTable)
      .where(and(eq(blockedIpsTable.ip, event.sourceIp), eq(blockedIpsTable.isActive, true)));
    if (alreadyBlocked.length > 0) {
      console.log(`[AutoDefense] Skipped — ${event.sourceIp} already actively blocked`);
      return;
    }
  }

  const targets = commandType === "ssh_pfsense" ? ["pfsense"] : rule.targetVm === "all"
    ? ["aegis", "company-web-server", "company-dns-server", "company-customer-db", "company-ldap-server"]
    : [rule.targetVm];
  const cmdRows = await db.insert(defenseCommandsTable).values(targets.map(targetVm => ({
    ruleId: rule.id, eventId: event.id, targetVm, commandType, commandText,
    undoCommand: undoCommand ?? null, targetIp: event.sourceIp, status: "pending",
  }))).returning();

  // Record in blocked_ips for IP-blocking defense types
  if (["block_ip", "pfsense_block"].includes(rule.defenseType)) {
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

    // Back-fill bannedBy on ssh_sessions rows so Connection Logs shows
    // "aegis-auto-defense" instead of "—" for this IP.
    await db.update(sshSessionsTable)
      .set({ bannedBy: "aegis-auto-defense" })
      .where(and(eq(sshSessionsTable.sourceIp, event.sourceIp), isNull(sshSessionsTable.bannedBy)));
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

  for (const cmdRow of cmdRows) {
    broadcaster.broadcast("defense_action", {
      type: "auto", ruleId: rule.id, ruleName: rule.name, action: rule.defenseType,
      targetIp: event.sourceIp, sourceIp: event.sourceIp, targetHost: event.targetHost,
      targetVm: cmdRow.targetVm, commandId: cmdRow.id, status: "queued",
      timestamp: new Date().toISOString(),
    });
  }

  broadcaster.broadcast("stats_update", { timestamp: new Date().toISOString() });
}

// Defense rules are intentionally managed only through the dashboard CRUD API.
// There is no startup seeding: deleted rules must stay deleted across restarts.
