import { Router } from "express";
import { db } from "@workspace/db";
import { incidentsTable } from "@workspace/db";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";

const router = Router();

router.get("/incidents", async (_req, res) => {
  const incidents = await db.select().from(incidentsTable).orderBy(desc(incidentsTable.createdAt));
  res.json(incidents.map(i => ({
    ...i,
    createdAt: i.createdAt.toISOString(),
    updatedAt: i.updatedAt.toISOString(),
  })));
});

router.get("/incidents/:id", async (req, res) => {
  const id = Number(req.params.id);
  const [incident] = await db.select().from(incidentsTable).where(eq(incidentsTable.id, id));
  if (!incident) { res.status(404).json({ error: "Incident not found" }); return; }
  res.json({ ...incident, createdAt: incident.createdAt.toISOString(), updatedAt: incident.updatedAt.toISOString() });
});

const createIncidentSchema = z.object({
  title:       z.string(),
  severity:    z.enum(["critical", "high", "medium", "low"]),
  description: z.string(),
  responder:   z.string().optional(),
});

router.post("/incidents", async (req, res) => {
  const body = createIncidentSchema.parse(req.body);
  const [row] = await db.insert(incidentsTable).values({
    title:       body.title,
    severity:    body.severity,
    description: body.description,
    responder:   body.responder ?? null,
    status:      "open",
    eventCount:  0,
  }).$returningId();

  const [incident] = await db.select().from(incidentsTable).where(eq(incidentsTable.id, row.id));
  res.status(201).json({ ...incident, createdAt: incident.createdAt.toISOString(), updatedAt: incident.updatedAt.toISOString() });
});

const updateIncidentSchema = z.object({
  status:    z.enum(["open", "investigating", "contained", "resolved"]).optional(),
  responder: z.string().optional(),
  notes:     z.string().optional(),
});

router.patch("/incidents/:id", async (req, res) => {
  const id   = Number(req.params.id);
  const body = updateIncidentSchema.parse(req.body);

  await db.update(incidentsTable)
    .set({ ...body, updatedAt: new Date() })
    .where(eq(incidentsTable.id, id));

  const [incident] = await db.select().from(incidentsTable).where(eq(incidentsTable.id, id));
  if (!incident) { res.status(404).json({ error: "Incident not found" }); return; }
  res.json({ ...incident, createdAt: incident.createdAt.toISOString(), updatedAt: incident.updatedAt.toISOString() });
});

export default router;
