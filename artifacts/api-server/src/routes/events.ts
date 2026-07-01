import { Router } from "express";
import { db } from "@workspace/db";
import { securityEventsTable } from "@workspace/db";
import { desc, eq, and } from "drizzle-orm";
import { z } from "zod";

const router = Router();

router.get("/events", async (req, res) => {
  const limit = Number(req.query.limit) || 50;
  const offset = Number(req.query.offset) || 0;
  const severity = req.query.severity as string | undefined;
  const type = req.query.type as string | undefined;

  const conditions = [];
  if (severity) conditions.push(eq(securityEventsTable.severity, severity));
  if (type) conditions.push(eq(securityEventsTable.type, type));

  const events = await db
    .select()
    .from(securityEventsTable)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(securityEventsTable.createdAt))
    .limit(limit)
    .offset(offset);

  res.json(events.map(e => ({
    ...e,
    sourceIp: e.sourceIp,
    targetHost: e.targetHost,
    toolUsed: e.toolUsed,
    createdAt: e.createdAt.toISOString(),
  })));
});

router.get("/events/recent", async (req, res) => {
  const events = await db
    .select()
    .from(securityEventsTable)
    .orderBy(desc(securityEventsTable.createdAt))
    .limit(20);

  res.json(events.map(e => ({
    ...e,
    sourceIp: e.sourceIp,
    targetHost: e.targetHost,
    toolUsed: e.toolUsed,
    createdAt: e.createdAt.toISOString(),
  })));
});

const createEventSchema = z.object({
  type: z.string(),
  subtype: z.string(),
  severity: z.enum(["critical", "high", "medium", "low"]),
  sourceIp: z.string(),
  targetHost: z.string(),
  toolUsed: z.string().optional(),
  description: z.string(),
  layer: z.string(),
});

router.post("/events", async (req, res) => {
  const body = createEventSchema.parse(req.body);
  const [event] = await db.insert(securityEventsTable).values({
    type: body.type,
    subtype: body.subtype,
    severity: body.severity,
    sourceIp: body.sourceIp,
    targetHost: body.targetHost,
    toolUsed: body.toolUsed ?? null,
    description: body.description,
    layer: body.layer,
    status: "detected",
  }).returning();
  res.status(201).json({
    ...event,
    sourceIp: event.sourceIp,
    targetHost: event.targetHost,
    toolUsed: event.toolUsed,
    createdAt: event.createdAt.toISOString(),
  });
});

export default router;
