/**
 * UI Rules API — exposes defense rules, firewall rules, command history,
 * and hot IPs for the browser dashboard without requiring X-AEGIS-Admin-Key.
 * All write operations still require X-AEGIS-Admin-Key if set, OR allow
 * access when no admin key is configured (dev / local lab).
 */
import { Router } from "express";
import { db, defenseRulesTable, defenseCommandsTable, firewallRulesTable, defenseActionsTable, securityEventsTable } from "@workspace/db";
import { eq, desc, and } from "drizzle-orm";
import { z } from "zod";
import { getHotIps } from "../lib/attack-tracker";
import { verifyToken } from "../lib/jwt-auth";
import {
  sanitizeChain,
  sanitizeFwAction,
  sanitizeFirewallPort,
  sanitizeInterface,
  sanitizeOptionalIp,
  sanitizeProtocol,
} from "../lib/defense-sanitize";

const router = Router();

const ADMIN_KEY = process.env.AEGIS_ADMIN_KEY ?? "";
const FIREWALL_TARGETS = [
  "company-web-server",
  "company-dns-server",
  "company-customer-db",
  "company-ldap-server",
] as const;

/**
 * Allow write if ANY of these is true:
 *  1. No admin key configured (dev/lab mode)
 *  2. X-AEGIS-Admin-Key header matches the secret
 *  3. Valid JWT Bearer session (user logged in via Google or admin-key login)
 */
function maybeAdmin(req: any, res: any, next: any) {
  if (!ADMIN_KEY) return next();
  const key = req.headers["x-aegis-admin-key"];
  if (key === ADMIN_KEY) return next();
  // Accept a valid JWT session as admin proof
  const auth = req.headers["authorization"] ?? "";
  if (auth.startsWith("Bearer ")) {
    const payload = verifyToken(auth.slice(7));
    if (payload?.role === "admin") return next();
  }
  res.status(403).json({ error: "X-AEGIS-Admin-Key required for write operations" });
}

// ─── Service Control ───────────────────────────────────────────────────────────
// Queue a systemctl start/stop/restart command for a specific service on a VM.
// The defense agent on that VM polls /api/defense/commands/pending and executes it.
router.post("/ui/system/service-control", maybeAdmin, async (req, res) => {
  const schema = z.object({
    service:  z.enum(["fail2ban", "apache2", "bind9", "slapd", "mysql"]),
    action:   z.enum(["start", "stop", "restart"]),
    targetVm: z.enum(["company-web-server", "company-dns-server", "company-customer-db", "company-ldap-server"]),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid body" }); return; }

  const { service, action, targetVm } = parsed.data;
  const serviceTargets: Record<string, string[]> = {
    fail2ban: ["company-web-server", "company-dns-server", "company-customer-db", "company-ldap-server"],
    apache2: ["company-web-server"],
    bind9: ["company-dns-server"], mysql: ["company-customer-db"], slapd: ["company-ldap-server"],
  };
  if (!serviceTargets[service]?.includes(targetVm)) {
    res.status(400).json({ error: `${service} is not valid for ${targetVm}` });
    return;
  }
  const commandText = `systemctl ${action} ${service}`;
  const undoCommand = action === "stop" ? `systemctl start ${service}`
    : action === "start" ? `systemctl stop ${service}`
    : undefined;

  const [cmd] = await db.insert(defenseCommandsTable).values({
    targetVm,
    commandType: "service_control",
    commandText,
    undoCommand: undoCommand ?? null,
    status: "pending",
  }).returning();

  res.json({ queued: true, command: cmd });
});

// ─── Defense Rules ─────────────────────────────────────────────────────────────

router.get("/ui/defense/rules", async (_req, res) => {
  const rules = await db.select().from(defenseRulesTable)
    .orderBy(defenseRulesTable.priority);
  res.json(rules.map(r => ({ ...r, createdAt: r.createdAt.toISOString() })));
});

router.post("/ui/defense/rules", maybeAdmin, async (req, res) => {
  const schema = z.object({
    name:              z.string().min(1).max(128),
    description:       z.string().max(512).optional(),
    triggerAttackType: z.enum([
      "ssh_brute","auth_event","network_attack","web_attack","ddos",
      "port_scan","dns_attack","db_attack","ldap_brute","ldap_enum","any",
    ]).default("any"),
    triggerSeverity:   z.enum(["any","critical","high","medium","low"]).default("any"),
    triggerThreshold:  z.number().int().min(1).max(10000).default(1),
    triggerWindowSecs: z.number().int().min(1).max(86400).default(60),
    actionType:        z.literal("auto").default("auto"),
    defenseType:       z.enum([
      "block_ip","rate_limit","pfsense_block","alert_only",
    ]),
    actionParams: z.string().optional(),
    targetVm:     z.enum(["company-web-server","company-customer-db","company-dns-server","company-ldap-server","aegis","pfsense","all"]).default("company-web-server"),
    priority:     z.number().int().min(1).max(9999).default(100),
  }).superRefine((data, ctx) => {
    if (data.defenseType === "pfsense_block" && data.targetVm !== "pfsense") {
      ctx.addIssue({ code: "custom", path: ["targetVm"], message: "pfSense WAN Block must target pfsense" });
    }
    if (data.defenseType !== "pfsense_block" && data.targetVm === "pfsense") {
      ctx.addIssue({ code: "custom", path: ["targetVm"], message: "Linux defenses cannot target pfSense" });
    }
  });

  const body = schema.safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: body.error.flatten() }); return; }

  const [row] = await db.insert(defenseRulesTable).values({
    ...body.data,
    description:  body.data.description ?? null,
    actionParams: body.data.actionParams ?? null,
    isActive: true,
  }).returning();

  const [rule] = await db.select().from(defenseRulesTable).where(eq(defenseRulesTable.id, row.id));
  res.status(201).json({ ...rule, createdAt: rule.createdAt.toISOString() });
});

router.patch("/ui/defense/rules/:id", maybeAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const schema = z.object({
    isActive:          z.boolean().optional(),
    priority:          z.number().int().min(1).max(9999).optional(),
    triggerThreshold:  z.number().int().min(1).optional(),
    triggerWindowSecs: z.number().int().min(1).optional(),
    actionType:        z.literal("auto").optional(),
    defenseType:       z.enum(["block_ip","rate_limit","pfsense_block","alert_only"]).optional(),
    actionParams:      z.string().optional(),
    targetVm:          z.enum(["company-web-server","company-customer-db","company-dns-server","company-ldap-server","aegis","pfsense","all"]).optional(),
  });

  const body = schema.safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: body.error.flatten() }); return; }

  await db.update(defenseRulesTable).set(body.data).where(eq(defenseRulesTable.id, id));
  const [rule] = await db.select().from(defenseRulesTable).where(eq(defenseRulesTable.id, id));
  if (!rule) { res.status(404).json({ error: "Rule not found" }); return; }
  res.json({ ...rule, createdAt: rule.createdAt.toISOString() });
});

router.delete("/ui/defense/rules/:id", maybeAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [existing] = await db.select({ id: defenseRulesTable.id })
    .from(defenseRulesTable)
    .where(eq(defenseRulesTable.id, id));
  if (!existing) { res.status(404).json({ error: "Rule not found" }); return; }

  // A deleted rule must not leave a queued command that a VM agent can still
  // dispatch after the rule has disappeared from the dashboard.
  await db.delete(defenseCommandsTable).where(and(
    eq(defenseCommandsTable.ruleId, id),
    eq(defenseCommandsTable.status, "pending"),
  ));
  await db.delete(defenseRulesTable).where(eq(defenseRulesTable.id, id));
  res.json({ success: true, id });
});

// ─── Command history + hot IPs ─────────────────────────────────────────────────

// Enhanced history — LEFT JOIN defense_rules (rule name) + security_events (attack info)
// so the dashboard can show the full Attack → Rule → Command chain.
router.get("/ui/defense/commands/history", async (req, res) => {
  const limit  = Math.min(Number(req.query.limit)  || 50, 200);
  const offset = Number(req.query.offset) || 0;

  const commands = await db
    .select({
      id:          defenseCommandsTable.id,
      ruleId:      defenseCommandsTable.ruleId,
      eventId:     defenseCommandsTable.eventId,
      targetVm:    defenseCommandsTable.targetVm,
      commandType: defenseCommandsTable.commandType,
      commandText: defenseCommandsTable.commandText,
      undoCommand: defenseCommandsTable.undoCommand,
      targetIp:    defenseCommandsTable.targetIp,
      status:      defenseCommandsTable.status,
      errorMsg:    defenseCommandsTable.errorMsg,
      createdAt:   defenseCommandsTable.createdAt,
      executedAt:  defenseCommandsTable.executedAt,
      // Joined: rule metadata
      ruleName:    defenseRulesTable.name,
      // Joined: triggering event metadata
      eventSourceIp:    securityEventsTable.sourceIp,
      eventSubtype:     securityEventsTable.subtype,
      eventType:        securityEventsTable.type,
      eventDescription: securityEventsTable.description,
    })
    .from(defenseCommandsTable)
    .leftJoin(defenseRulesTable,    eq(defenseCommandsTable.ruleId,  defenseRulesTable.id))
    .leftJoin(securityEventsTable,  eq(defenseCommandsTable.eventId, securityEventsTable.id))
    .orderBy(desc(defenseCommandsTable.createdAt))
    .limit(limit)
    .offset(offset);

  res.json(commands.map(c => ({
    ...c,
    createdAt:  c.createdAt.toISOString(),
    executedAt: c.executedAt?.toISOString() ?? null,
  })));
});

// Event → Commands: return all defense commands triggered by a specific security event.
// Used by the Events detail panel to show "what happened after this alert".
router.get("/ui/events/:id/commands", async (req, res) => {
  const eventId = Number(req.params.id);
  if (!Number.isFinite(eventId)) { res.status(400).json({ error: "Invalid event id" }); return; }

  const commands = await db
    .select({
      id:          defenseCommandsTable.id,
      ruleId:      defenseCommandsTable.ruleId,
      targetVm:    defenseCommandsTable.targetVm,
      commandType: defenseCommandsTable.commandType,
      commandText: defenseCommandsTable.commandText,
      undoCommand: defenseCommandsTable.undoCommand,
      targetIp:    defenseCommandsTable.targetIp,
      status:      defenseCommandsTable.status,
      errorMsg:    defenseCommandsTable.errorMsg,
      createdAt:   defenseCommandsTable.createdAt,
      executedAt:  defenseCommandsTable.executedAt,
      ruleName:    defenseRulesTable.name,
    })
    .from(defenseCommandsTable)
    .leftJoin(defenseRulesTable, eq(defenseCommandsTable.ruleId, defenseRulesTable.id))
    .where(eq(defenseCommandsTable.eventId, eventId))
    .orderBy(desc(defenseCommandsTable.createdAt));

  res.json(commands.map(c => ({
    ...c,
    createdAt:  c.createdAt.toISOString(),
    executedAt: c.executedAt?.toISOString() ?? null,
  })));
});

router.get("/ui/defense/hot-ips", (_req, res) => {
  res.json(getHotIps(10));
});

// ─── Firewall Rules ────────────────────────────────────────────────────────────

router.get("/ui/firewall/rules", async (_req, res) => {
  const rules = await db.select().from(firewallRulesTable)
    .where(eq(firewallRulesTable.isActive, true))
    .orderBy(desc(firewallRulesTable.appliedAt));
  res.json(rules.map(r => ({ ...r, appliedAt: r.appliedAt.toISOString() })));
});

router.post("/ui/firewall/rules", maybeAdmin, async (req, res) => {
  const schema = z.object({
    chain:      z.enum(["INPUT","OUTPUT"]).default("INPUT"),
    action:     z.enum(["DROP","ACCEPT"]),
    protocol:   z.enum(["tcp","udp","all"]).optional(),
    sourceIp:   z.string().optional(),
    destIp:     z.string().optional(),
    sourcePort: z.string().optional(),
    destPort:   z.string().optional(),
    iface:      z.string().optional(),
    createdBy:  z.string().default("admin"),
    targetVm:   z.enum([...FIREWALL_TARGETS, "all"]).default("company-web-server"),
  });

  const body = schema.safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: body.error.flatten() }); return; }

  const d = body.data;
  let chain: string;
  let action: string;
  let protocol: string | null;
  let sourceIp: string | null;
  let destIp: string | null;
  let sourcePort: string | null;
  let destPort: string | null;
  let iface: string | null;
  try {
    chain = sanitizeChain(d.chain);
    action = sanitizeFwAction(d.action);
    protocol = d.protocol ? sanitizeProtocol(d.protocol) : null;
    sourceIp = sanitizeOptionalIp(d.sourceIp);
    destIp = sanitizeOptionalIp(d.destIp);
    sourcePort = sanitizeFirewallPort(d.sourcePort);
    destPort = sanitizeFirewallPort(d.destPort);
    iface = sanitizeInterface(d.iface);
    if ((sourcePort || destPort) && protocol !== "tcp" && protocol !== "udp") {
      throw new Error("Source and destination ports require protocol tcp or udp");
    }
    if (!sourceIp && !destIp && !sourcePort && !destPort) {
      throw new Error("At least one IP address or port is required; refusing an unrestricted firewall rule");
    }
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Invalid firewall rule" });
    return;
  }

  // Use -I (insert at position 1 = top) so the rule takes priority over
  // any existing ACCEPT rules already in the chain.  -A (append) places
  // the rule at the bottom, so Ubuntu's default ACCEPT rules fire first
  // and DROP/REJECT rules are never reached.
  const ruleSpec = [chain];
  if (protocol)   ruleSpec.push("-p", protocol);
  if (sourceIp)   ruleSpec.push("-s", sourceIp);
  if (destIp)     ruleSpec.push("-d", destIp);
  if (sourcePort) ruleSpec.push("--sport", sourcePort);
  if (destPort)   ruleSpec.push("--dport", destPort);
  if (iface)      ruleSpec.push(chain === "OUTPUT" ? "-o" : "-i", iface);
  ruleSpec.push("-j", action);
  const ruleText = ["iptables", "-I", chain, "1", ...ruleSpec.slice(1)].join(" ");

  const duplicate = await db.select({ id: firewallRulesTable.id }).from(firewallRulesTable)
    .where(and(
      eq(firewallRulesTable.ruleText, ruleText),
      eq(firewallRulesTable.targetVm, d.targetVm),
      eq(firewallRulesTable.isActive, true),
    ));
  if (duplicate.length > 0) {
    res.status(409).json({ error: "An identical active firewall rule already exists for this target" });
    return;
  }

  const [rule] = await db.insert(firewallRulesTable).values({
    chain, action, protocol, sourceIp, destIp, sourcePort, destPort, iface,
    targetVm: d.targetVm,
    ruleText, isActive: true, createdBy: d.createdBy,
  }).returning();

  await db.insert(defenseActionsTable).values({
    type: "manual", action: "firewall_rule_add",
    targetIp: sourceIp ?? "any",
    targetHost: d.targetVm,
    reason: `Firewall rule queued on ${d.targetVm === "all" ? FIREWALL_TARGETS.length + " company servers" : d.targetVm}: ${ruleText}`,
    performedBy: d.createdBy, status: "queued",
  });

  // Create one row per selected target. A single targetVm="all" row can only
  // be claimed once, so the explicit all selection is expanded here.
  // Undo: -I 1 → -D (delete by rule specification, strip position arg "1")
  const checkText = ["iptables", "-C", ...ruleSpec].join(" ");
  const commandText = `${checkText} 2>/dev/null || ${ruleText}`;
  const undoText = ["iptables", "-D", ...ruleSpec].join(" ") + " 2>/dev/null || true";
  const targets = d.targetVm === "all" ? [...FIREWALL_TARGETS] : [d.targetVm];
  const commands = await db.insert(defenseCommandsTable).values(targets.map(targetVm => ({
    targetVm,
    commandType: "iptables",
    commandText,
    undoCommand: undoText,
    targetIp: sourceIp,
    status: "pending",
  }))).returning({ id: defenseCommandsTable.id, targetVm: defenseCommandsTable.targetVm });

  res.status(201).json({ id: rule.id, ruleText, targets: commands });
});

router.delete("/ui/firewall/rules/:id", maybeAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const existing = await db.select().from(firewallRulesTable).where(eq(firewallRulesTable.id, id));
  if (existing.length === 0) { res.status(404).json({ error: "Rule not found" }); return; }

  const rule = existing[0];
  // Always queue the inverse after any pending add. Deleting pending commands
  // by command text is unsafe because two independently-managed rules can have
  // identical iptables text but different targets.
  // Handle both old rules (-A) and new rules (-I 1); strip the position
  // argument "1" from -I so iptables -D matches by rule specification.
  const deleteCmd = rule.ruleText
    .replace(" -A ", " -D ")
    .replace(" -I ", " -D ")
    .replace(/^(iptables -D \S+) 1 /, "$1 ") + " 2>/dev/null || true";
  const targets = rule.targetVm === "all" ? [...FIREWALL_TARGETS] : [rule.targetVm];
  const commands = await db.insert(defenseCommandsTable).values(targets.map(targetVm => ({
    targetVm,
    commandType: "iptables",
    commandText: deleteCmd,
    undoCommand: rule.ruleText,
    targetIp: rule.sourceIp ?? null,
    status: "pending",
  }))).returning({ id: defenseCommandsTable.id, targetVm: defenseCommandsTable.targetVm });
  await db.delete(firewallRulesTable).where(eq(firewallRulesTable.id, id));

  await db.insert(defenseActionsTable).values({
    type: "manual", action: "firewall_rule_remove",
    targetIp: rule.sourceIp ?? "any",
    targetHost: rule.targetVm,
    reason: `Firewall rule removal queued on ${rule.targetVm === "all" ? FIREWALL_TARGETS.length + " company servers" : rule.targetVm}: ${rule.ruleText}`,
    performedBy: "admin", status: "queued",
  });

  res.json({ queued: true, id, targets: commands });
});

export default router;
