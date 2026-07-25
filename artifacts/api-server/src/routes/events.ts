import { Router } from "express";
import { db } from "@workspace/db";
import { securityEventsTable } from "@workspace/db";
import { desc, eq, and } from "drizzle-orm";

const router = Router();

router.get("/events", async (req, res) => {
  const limit  = Math.min(Number(req.query.limit) || 50, 500);
  const offset = Number(req.query.offset) || 0;
  const severity = req.query.severity as string | undefined;
  const type     = req.query.type     as string | undefined;

  const conditions = [];
  if (severity) conditions.push(eq(securityEventsTable.severity, severity));
  if (type)     conditions.push(eq(securityEventsTable.type, type));

  const events = await db
    .select().from(securityEventsTable)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(securityEventsTable.createdAt))
    .limit(limit).offset(offset);

  res.json(events.map(e => ({ ...e, createdAt: e.createdAt.toISOString() })));
});

router.get("/events/recent", async (_req, res) => {
  const events = await db
    .select().from(securityEventsTable)
    .orderBy(desc(securityEventsTable.createdAt))
    .limit(20);
  res.json(events.map(e => ({ ...e, createdAt: e.createdAt.toISOString() })));
});


export default router;
