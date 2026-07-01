import { Router } from "express";
import { db, networkHostsTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import { z } from "zod";

const router = Router();

router.get("/network/hosts", async (req, res) => {
  const hosts = await db
    .select()
    .from(networkHostsTable)
    .orderBy(desc(networkHostsTable.lastSeen));
  res.json(hosts.map(h => ({ ...h, lastSeen: h.lastSeen.toISOString(), createdAt: h.createdAt.toISOString() })));
});

router.post("/network/hosts", async (req, res) => {
  const schema = z.object({
    ip: z.string(),
    hostname: z.string(),
    role: z.enum(["kali", "ubuntu", "honeypot", "router", "unknown"]).optional(),
    os: z.string().optional(),
    mac: z.string().optional(),
    openPorts: z.string().optional(),
    status: z.enum(["online", "offline"]).optional(),
    isMonitored: z.boolean().optional(),
  });
  const body = schema.safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: "Invalid input" }); return; }

  const existing = await db.select().from(networkHostsTable).where(eq(networkHostsTable.ip, body.data.ip));
  if (existing.length > 0) {
    const [updated] = await db.update(networkHostsTable)
      .set({ ...body.data, lastSeen: new Date() })
      .where(eq(networkHostsTable.ip, body.data.ip))
      .returning();
    res.json({ ...updated, lastSeen: updated.lastSeen.toISOString(), createdAt: updated.createdAt.toISOString() });
    return;
  }

  const [created] = await db.insert(networkHostsTable).values({
    ...body.data,
    ip: body.data.ip,
    hostname: body.data.hostname,
    role: body.data.role ?? "unknown",
    status: body.data.status ?? "online",
    isMonitored: body.data.isMonitored ?? false,
  }).returning();
  res.json({ ...created, lastSeen: created.lastSeen.toISOString(), createdAt: created.createdAt.toISOString() });
});

router.get("/network/traffic", async (_req, res) => {
  const now = new Date();
  const points = Array.from({ length: 24 }, (_, i) => {
    const t = new Date(now.getTime() - (23 - i) * 3600 * 1000);
    const hour = t.getHours();
    const base = hour >= 8 && hour <= 22 ? 120 : 30;
    return {
      time: t.toISOString(),
      inbound: Math.floor(base + Math.random() * 80),
      outbound: Math.floor(base * 0.6 + Math.random() * 60),
      blocked: Math.floor(Math.random() * 20),
    };
  });
  res.json(points);
});

export default router;
