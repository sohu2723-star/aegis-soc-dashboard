import { Router } from "express";
import { db, networkHostsTable } from "@workspace/db";
import { securityEventsTable } from "@workspace/db";
import { eq, desc, or } from "drizzle-orm";
import { z } from "zod";

const router = Router();

router.get("/network/hosts", async (_req, res) => {
  const hosts = await db.select().from(networkHostsTable).orderBy(desc(networkHostsTable.lastSeen));
  res.json(hosts.map(h => ({ ...h, lastSeen: h.lastSeen.toISOString(), createdAt: h.createdAt.toISOString() })));
});

router.post("/network/hosts", async (req, res) => {
  const schema = z.object({
    ip:          z.string(),
    hostname:    z.string(),
    role:        z.enum(["kali", "ubuntu", "honeypot", "router", "unknown"]).optional(),
    os:          z.string().optional(),
    mac:         z.string().optional(),
    openPorts:   z.string().optional(),
    status:      z.enum(["online", "offline"]).optional(),
    isMonitored: z.boolean().optional(),
  });
  const body = schema.safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: "Invalid input" }); return; }

  const existing = await db.select().from(networkHostsTable).where(eq(networkHostsTable.ip, body.data.ip));

  if (existing.length > 0) {
    await db.update(networkHostsTable)
      .set({ ...body.data, lastSeen: new Date() })
      .where(eq(networkHostsTable.ip, body.data.ip));
    const [updated] = await db.select().from(networkHostsTable).where(eq(networkHostsTable.ip, body.data.ip));
    res.json({ ...updated, lastSeen: updated.lastSeen.toISOString(), createdAt: updated.createdAt.toISOString() });
    return;
  }

  const [row] = await db.insert(networkHostsTable).values({
    ip:          body.data.ip,
    hostname:    body.data.hostname,
    role:        body.data.role        ?? "unknown",
    os:          body.data.os          ?? null,
    mac:         body.data.mac         ?? null,
    openPorts:   body.data.openPorts   ?? null,
    status:      body.data.status      ?? "online",
    isMonitored: body.data.isMonitored ?? false,
  }).returning();

  const [created] = await db.select().from(networkHostsTable).where(eq(networkHostsTable.id, row.id));
  res.json({ ...created, lastSeen: created.lastSeen.toISOString(), createdAt: created.createdAt.toISOString() });
});

router.delete("/network/hosts/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  await db.delete(networkHostsTable).where(eq(networkHostsTable.id, id));
  res.json({ success: true });
});

router.patch("/network/hosts/:id/offline", async (req, res) => {
  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  await db.update(networkHostsTable).set({ status: "offline" }).where(eq(networkHostsTable.id, id));
  const [updated] = await db.select().from(networkHostsTable).where(eq(networkHostsTable.id, id));
  if (!updated) { res.status(404).json({ error: "Not found" }); return; }
  res.json({ ...updated, lastSeen: updated.lastSeen.toISOString(), createdAt: updated.createdAt.toISOString() });
});

router.get("/network/hosts/:ip/events", async (req, res) => {
  const ip = req.params.ip;
  const limit = Math.min(Number(req.query.limit) || 100, 500);

  const events = await db
    .select().from(securityEventsTable)
    .where(or(
      eq(securityEventsTable.sourceIp, ip),
      eq(securityEventsTable.targetHost, ip),
    ))
    .orderBy(desc(securityEventsTable.createdAt))
    .limit(limit);

  const typeCounts: Record<string, number> = {};
  const bySeverity = { critical: 0, high: 0, medium: 0, low: 0 };

  for (const e of events) {
    typeCounts[e.type] = (typeCounts[e.type] ?? 0) + 1;
    const sev = e.severity as keyof typeof bySeverity;
    if (sev in bySeverity) bySeverity[sev]++;
  }

  const byType = Object.entries(typeCounts)
    .map(([type, count]) => ({ type, count }))
    .sort((a, b) => b.count - a.count);

  res.json({
    ip,
    totalEvents: events.length,
    byType,
    bySeverity,
    recentEvents: events.slice(0, 20).map(e => ({ ...e, createdAt: e.createdAt.toISOString() })),
  });
});

router.get("/network/traffic", async (_req, res) => {
  const now = new Date();
  const points = Array.from({ length: 24 }, (_, i) => {
    const t    = new Date(now.getTime() - (23 - i) * 3600 * 1000);
    const hour = t.getHours();
    const base = hour >= 8 && hour <= 22 ? 120 : 30;
    return {
      time:     t.toISOString(),
      inbound:  Math.floor(base + Math.random() * 80),
      outbound: Math.floor(base * 0.6 + Math.random() * 60),
      blocked:  Math.floor(Math.random() * 20),
    };
  });
  res.json(points);
});

export default router;
