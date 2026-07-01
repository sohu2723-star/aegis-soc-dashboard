import { Router } from "express";
import { db, sshSessionsTable, ftpSessionsTable, encryptedTrafficTable, httpAttacksTable } from "@workspace/db";
import { desc, eq } from "drizzle-orm";

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

// ─── FTP ─────────────────────────────────────────────────────────────────────

router.get("/connections/ftp", async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  const sessions = await db.select().from(ftpSessionsTable)
    .orderBy(desc(ftpSessionsTable.createdAt)).limit(limit);
  res.json(sessions.map(s => ({ ...s, createdAt: s.createdAt.toISOString() })));
});

// ─── Encrypted traffic ────────────────────────────────────────────────────────

router.get("/connections/tls", async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  const rows = await db.select().from(encryptedTrafficTable)
    .orderBy(desc(encryptedTrafficTable.createdAt)).limit(limit);
  res.json(rows.map(r => ({ ...r, createdAt: r.createdAt.toISOString() })));
});

// Suspicious TLS only
router.get("/connections/tls/suspicious", async (_req, res) => {
  const rows = await db.select().from(encryptedTrafficTable)
    .where(eq(encryptedTrafficTable.isSuspicious, true))
    .orderBy(desc(encryptedTrafficTable.createdAt)).limit(100);
  res.json(rows.map(r => ({ ...r, createdAt: r.createdAt.toISOString() })));
});

// ─── HTTP Attacks ─────────────────────────────────────────────────────────────

router.get("/connections/http-attacks", async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  const rows = await db.select().from(httpAttacksTable)
    .orderBy(desc(httpAttacksTable.createdAt)).limit(limit);
  res.json(rows.map(r => ({ ...r, createdAt: r.createdAt.toISOString() })));
});

export default router;
