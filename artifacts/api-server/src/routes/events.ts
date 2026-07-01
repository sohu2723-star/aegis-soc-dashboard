import { Router } from "express";
import { db } from "@workspace/db";
import { securityEventsTable } from "@workspace/db";
import { desc, eq, and } from "drizzle-orm";
import { z } from "zod";

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

const createEventSchema = z.object({
  type:       z.string(),
  subtype:    z.string(),
  severity:   z.enum(["critical", "high", "medium", "low"]),
  sourceIp:   z.string(),
  targetHost: z.string(),
  toolUsed:   z.string().optional(),
  description: z.string(),
  layer:      z.string(),
});

router.post("/events", async (req, res) => {
  const body = createEventSchema.parse(req.body);
  const [row] = await db.insert(securityEventsTable).values({
    ...body,
    toolUsed: body.toolUsed ?? null,
    status:   "detected",
  }).$returningId();

  const [event] = await db.select().from(securityEventsTable).where(eq(securityEventsTable.id, row.id));
  res.status(201).json({ ...event, createdAt: event.createdAt.toISOString() });
});

export default router;
