/**
 * UI Rules API — exposes defense rules, firewall rules, command history,
 * and hot IPs for the browser dashboard without requiring X-AEGIS-Admin-Key.
 * All write operations still require X-AEGIS-Admin-Key if set, OR allow
 * access when no admin key is configured (dev / local lab).
 */
import { Router } from "express";
import { db, defenseRulesTable, defenseCommandsTable, firewallRulesTable, defenseActionsTable, securityEventsTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import { z } from "zod";
import { getHotIps } from "../lib/attack-tracker";
import { verifyToken } from "../lib/jwt-auth";

const router = Router();

const ADMIN_KEY = process.env.AEGIS_ADMIN_KEY ?? "";

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
    triggerAttackType: z.string().default("any"),
    triggerSeverity:   z.enum(["any","critical","high","medium","low"]).default("any"),
    triggerThreshold:  z.number().int().min(1).max(10000).default(1),
    triggerWindowSecs: z.number().int().min(1).max(86400).default(60),
    actionType:        z.enum(["auto","suggest"]).default("auto"),
    defenseType:       z.enum([
      "block_ip","null_route","rate_limit","port_block",
      "dns_block","waf_rule","pfsense_block","pfsense_port_block","alert_only",
    ]),
    actionParams: z.string().optional(),
    targetVm:     z.enum(["bank-web","customer-db","aegis","pfsense","all"]).default("bank-web"),
    priority:     z.number().int().min(1).max(9999).default(100),
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
    actionType:        z.enum(["auto","suggest"]).optional(),
    defenseType:       z.string().optional(),
    actionParams:      z.string().optional(),
    targetVm:          z.enum(["bank-web","customer-db","aegis","pfsense","all"]).optional(),
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
  await db.update(defenseRulesTable).set({ isActive: false }).where(eq(defenseRulesTable.id, id));
  res.json({ success: true, id });
});

// ─── Command history + hot IPs ─────────────────────────────────────────────────

// Enhanced history — LEFT JOIN defense_rules (rule name) + security_events (attack info)
// so the dashboard can show the full Attack → Rule → Command chain.
router.get("/ui/defense/commands/history", async (_req, res) => {
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
    .limit(100);

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
    .orderBy(desc(firewallRulesTable.appliedAt));
  res.json(rules.map(r => ({ ...r, appliedAt: r.appliedAt.toISOString() })));
});

router.post("/ui/firewall/rules", maybeAdmin, async (req, res) => {
  const schema = z.object({
    chain:      z.enum(["INPUT","OUTPUT","FORWARD"]).default("INPUT"),
    action:     z.enum(["DROP","ACCEPT","REJECT","LOG"]),
    protocol:   z.enum(["tcp","udp","icmp","all"]).optional(),
    sourceIp:   z.string().optional(),
    destIp:     z.string().optional(),
    sourcePort: z.string().optional(),
    destPort:   z.string().optional(),
    iface:      z.string().optional(),
    createdBy:  z.string().default("admin"),
  });

  const body = schema.safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: body.error.flatten() }); return; }

  const d = body.data;
  const parts = ["iptables", "-A", d.chain];
  if (d.protocol)   parts.push("-p", d.protocol);
  if (d.sourceIp)   parts.push("-s", d.sourceIp);
  if (d.destIp)     parts.push("-d", d.destIp);
  if (d.sourcePort) parts.push("--sport", d.sourcePort);
  if (d.destPort)   parts.push("--dport", d.destPort);
  if (d.iface)      parts.push("-i", d.iface);
  parts.push("-j", d.action);
  const ruleText = parts.join(" ");

  const [rule] = await db.insert(firewallRulesTable).values({
    chain: d.chain, action: d.action,
    protocol: d.protocol ?? null, sourceIp: d.sourceIp ?? null,
    destIp: d.destIp ?? null, sourcePort: d.sourcePort ?? null,
    destPort: d.destPort ?? null, iface: d.iface ?? null,
    ruleText, isActive: true, createdBy: d.createdBy,
  }).returning();

  await db.insert(defenseActionsTable).values({
    type: "manual", action: "firewall_rule_add",
    targetIp: d.sourceIp ?? "any",
    reason: `Firewall rule added: ${ruleText}`,
    performedBy: d.createdBy, status: "success",
  });

  res.status(201).json({ id: rule.id, ruleText, ...d });
});

router.delete("/ui/firewall/rules/:id", maybeAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const existing = await db.select().from(firewallRulesTable).where(eq(firewallRulesTable.id, id));
  if (existing.length === 0) { res.status(404).json({ error: "Rule not found" }); return; }

  await db.update(firewallRulesTable).set({ isActive: false }).where(eq(firewallRulesTable.id, id));

  await db.insert(defenseActionsTable).values({
    type: "manual", action: "firewall_rule_remove",
    targetIp: existing[0].sourceIp ?? "any",
    reason: `Firewall rule removed: ${existing[0].ruleText}`,
    performedBy: "admin", status: "success",
  });

  res.json({ success: true, id });
});

router.get("/ui/firewall/rules/export", async (_req, res) => {
  const rules = await db.select().from(firewallRulesTable)
    .where(eq(firewallRulesTable.isActive, true))
    .orderBy(firewallRulesTable.appliedAt);

  const lines = [
    "#!/bin/bash",
    "# AEGIS Firewall Rules Export",
    `# Generated: ${new Date().toISOString()}`,
    "iptables -F   # Flush existing rules",
    "",
    ...rules.map(r => r.ruleText),
    "",
    "echo 'AEGIS firewall rules applied.'",
  ];

  res.setHeader("Content-Type", "text/plain");
  res.setHeader("Content-Disposition", "attachment; filename=aegis-firewall.sh");
  res.send(lines.join("\n"));
});

export default router;
