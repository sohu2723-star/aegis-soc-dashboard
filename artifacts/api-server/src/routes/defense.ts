import { Router } from "express";
import { db, blockedIpsTable, defenseActionsTable } from "@workspace/db";
import { eq, desc, and } from "drizzle-orm";
import { z } from "zod";

const router = Router();

router.get("/defense/blocks", async (_req, res) => {
  const blocks = await db.select().from(blockedIpsTable).orderBy(desc(blockedIpsTable.blockedAt));
  res.json(blocks.map(b => ({
    ...b,
    blockedAt:   b.blockedAt.toISOString(),
    unblockedAt: b.unblockedAt ? b.unblockedAt.toISOString() : null,
  })));
});

router.post("/defense/block", async (req, res) => {
  const schema = z.object({
    ip:        z.string().ip(),
    reason:    z.string().min(1),
    blockedBy: z.enum(["manual", "auto"]).optional(),
  });
  const body = schema.safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: "Invalid IP or reason" }); return; }

  const existing = await db.select().from(blockedIpsTable)
    .where(and(eq(blockedIpsTable.ip, body.data.ip), eq(blockedIpsTable.isActive, true)));
  if (existing.length > 0) { res.status(409).json({ error: "IP already blocked" }); return; }

  const [row] = await db.insert(blockedIpsTable).values({
    ip:        body.data.ip,
    reason:    body.data.reason,
    blockedBy: body.data.blockedBy ?? "manual",
    isActive:  true,
  }).returning();

  await db.insert(defenseActionsTable).values({
    type:        body.data.blockedBy === "auto" ? "auto" : "manual",
    action:      "block",
    targetIp:    body.data.ip,
    reason:      body.data.reason,
    performedBy: body.data.blockedBy === "auto" ? "system" : "admin",
    status:      "success",
  });

  const [blocked] = await db.select().from(blockedIpsTable).where(eq(blockedIpsTable.id, row.id));
  res.json({ ...blocked, blockedAt: blocked.blockedAt.toISOString(), unblockedAt: null });
});

router.delete("/defense/block/:ip", async (req, res) => {
  const ip = req.params.ip;
  const existing = await db.select().from(blockedIpsTable)
    .where(and(eq(blockedIpsTable.ip, ip), eq(blockedIpsTable.isActive, true)));
  if (existing.length === 0) { res.status(404).json({ error: "IP not found in block list" }); return; }

  await db.update(blockedIpsTable).set({ isActive: false, unblockedAt: new Date() })
    .where(eq(blockedIpsTable.ip, ip));

  await db.insert(defenseActionsTable).values({
    type:        "manual",
    action:      "unblock",
    targetIp:    ip,
    reason:      "Admin manually unblocked",
    performedBy: "admin",
    status:      "success",
  });

  res.json({ success: true, ip });
});

router.get("/defense/actions", async (_req, res) => {
  const actions = await db.select().from(defenseActionsTable)
    .orderBy(desc(defenseActionsTable.createdAt)).limit(100);
  res.json(actions.map(a => ({ ...a, createdAt: a.createdAt.toISOString() })));
});

router.get("/defense/status", async (_req, res) => {
  const activeBlocks   = await db.select().from(blockedIpsTable).where(eq(blockedIpsTable.isActive, true));
  const recentActions  = await db.select().from(defenseActionsTable)
    .orderBy(desc(defenseActionsTable.createdAt)).limit(5);
  res.json({
    autoDefenseEnabled: true,
    fail2banActive:     true,
    suricataActive:     true,
    totalBlocked:       activeBlocks.length,
    recentActions:      recentActions.map(a => ({ ...a, createdAt: a.createdAt.toISOString() })),
  });
});

export default router;
