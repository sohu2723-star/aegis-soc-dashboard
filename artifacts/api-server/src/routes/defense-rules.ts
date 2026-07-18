/**
 * Defense Rules + Command Queue API
 * All mutation endpoints require X-AEGIS-Admin-Key.
 * Agent polling (/defense/commands/pending) also requires the admin key.
 */
import { Router } from "express";
import { db, defenseRulesTable, defenseCommandsTable } from "@workspace/db";
import { eq, desc, sql } from "drizzle-orm";
import { z } from "zod";
import { requireAdmin } from "../lib/admin-auth";
import { getHotIps } from "../lib/attack-tracker";

const router = Router();

// ─── Rules CRUD (admin only) ──────────────────────────────────────────────────

router.get("/defense/rules", requireAdmin, async (_req, res) => {
  const rules = await db.select().from(defenseRulesTable)
    .orderBy(defenseRulesTable.priority);
  res.json(rules.map(r => ({ ...r, createdAt: r.createdAt.toISOString() })));
});

router.post("/defense/rules", requireAdmin, async (req, res) => {
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
    actionParams:      z.string().optional(),
    targetVm:          z.enum(["bank-web","customer-db","aegis","pfsense","all"]).default("bank-web"),
    priority:          z.number().int().min(1).max(9999).default(100),
  });

  const body = schema.safeParse(req.body);
  if (!body.success) {
    const flat = body.error.flatten();
    const msgs = [
      ...flat.formErrors,
      ...Object.entries(flat.fieldErrors).map(([f, errs]) => `${f}: ${(errs ?? []).join(", ")}`),
    ];
    res.status(400).json({ error: msgs.join(" | ") || "Validation failed" });
    return;
  }

  const [row] = await db.insert(defenseRulesTable).values({
    ...body.data,
    description:  body.data.description ?? null,
    actionParams: body.data.actionParams ?? null,
    isActive: true,
  }).returning();

  const [rule] = await db.select().from(defenseRulesTable).where(eq(defenseRulesTable.id, row.id));
  res.status(201).json({ ...rule, createdAt: rule.createdAt.toISOString() });
});

router.patch("/defense/rules/:id", requireAdmin, async (req, res) => {
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

router.delete("/defense/rules/:id", requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  await db.update(defenseRulesTable).set({ isActive: false }).where(eq(defenseRulesTable.id, id));
  res.json({ success: true, id });
});

// ─── Command queue (agent polling) ────────────────────────────────────────────
// Atomic claim: UPDATE … LIMIT 20 → then SELECT newly-sent rows.
// This avoids the read-then-update race where two pollers fetch the same row.

router.get("/defense/commands/pending", requireAdmin, async (req, res) => {
  const vm = (req.query.vm as string) ?? "ubuntu";

  // Atomic claim via SQL: update status to 'sent' for up to 20 pending rows for this vm
  // PostgreSQL does not support UPDATE...LIMIT — use a subquery instead
  await db.execute(sql`
    UPDATE defense_commands
    SET status = 'sent'
    WHERE id IN (
      SELECT id FROM defense_commands
      WHERE status = 'pending'
        AND (target_vm = ${vm} OR target_vm = 'all')
      LIMIT 20
    )
  `);

  // Fetch the rows we just claimed
  const claimed = await db.select().from(defenseCommandsTable)
    .where(eq(defenseCommandsTable.status, "sent"))
    .orderBy(defenseCommandsTable.createdAt)
    .limit(20);

  const filtered = vm === "all"
    ? claimed
    : claimed.filter(c => c.targetVm === vm || c.targetVm === "all");

  res.json(filtered.map(c => ({
    ...c,
    createdAt:  c.createdAt.toISOString(),
    executedAt: c.executedAt?.toISOString() ?? null,
  })));
});

router.post("/defense/commands/:id/result", requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const { success, error } = req.body;
  await db.update(defenseCommandsTable).set({
    status:     success ? "executed" : "failed",
    errorMsg:   error ? String(error).slice(0, 500) : null,
    executedAt: new Date(),
  }).where(eq(defenseCommandsTable.id, id));
  res.json({ ok: true });
});

router.get("/defense/commands/history", requireAdmin, async (_req, res) => {
  const commands = await db.select().from(defenseCommandsTable)
    .orderBy(desc(defenseCommandsTable.createdAt)).limit(100);
  res.json(commands.map(c => ({
    ...c,
    createdAt:  c.createdAt.toISOString(),
    executedAt: c.executedAt?.toISOString() ?? null,
  })));
});

// ─── Hot IP tracker (read-only, admin only) ───────────────────────────────────
router.get("/defense/hot-ips", requireAdmin, (_req, res) => {
  res.json(getHotIps(3));
});

export default router;
