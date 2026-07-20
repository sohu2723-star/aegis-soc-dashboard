import { Router } from "express";
import { db, sshSessionsTable, httpAttacksTable } from "@workspace/db";
import { desc } from "drizzle-orm";

const router = Router();

// ─── SSH ─────────────────────────────────────────────────────────────────────

router.get("/connections/ssh", async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  const sessions = await db.select().from(sshSessionsTable)
    .orderBy(desc(sshSessionsTable.createdAt)).limit(limit);
  res.json(sessions.map(s => ({
    ...s,
    createdAt: s.createdAt.toISOString(),
    endedAt:   s.endedAt?.toISOString() ?? null,
  })));
});

// ─── HTTP Attacks ─────────────────────────────────────────────────────────────

router.get("/connections/http-attacks", async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  const rows = await db.select().from(httpAttacksTable)
    .orderBy(desc(httpAttacksTable.createdAt)).limit(limit);
  res.json(rows.map(r => ({ ...r, createdAt: r.createdAt.toISOString() })));
});

export default router;
