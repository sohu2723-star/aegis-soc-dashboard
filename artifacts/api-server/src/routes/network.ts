import { Router } from "express";
import { db, networkHostsTable } from "@workspace/db";
import { securityEventsTable, defenseCommandsTable } from "@workspace/db";
import { eq, desc, or, lt, and, gte, asc } from "drizzle-orm";
import { z } from "zod";
import { broadcaster } from "../lib/broadcaster";
import { sanitizeIp } from "../lib/defense-sanitize";

const router = Router();

// ─── Auto-timeout: mark hosts offline if heartbeat stopped > 90s ago ──────────
const OFFLINE_TIMEOUT_MS = 45_000; // 45s — forwarder heartbeats every 15s, so 3 missed = offline

setInterval(async () => {

  const cutoff = new Date(Date.now() - OFFLINE_TIMEOUT_MS);
  try {
    const stale = await db
      .select()
      .from(networkHostsTable)
      .where(and(
        eq(networkHostsTable.status, "online"),
        lt(networkHostsTable.lastSeen, cutoff),
      ));

    for (const host of stale) {
      await db.update(networkHostsTable)
        .set({ status: "offline" })
        .where(eq(networkHostsTable.id, host.id));

      broadcaster.broadcast("host_status_change", {
        id:       host.id,
        ip:       host.ip,
        hostname: host.hostname,
        status:   "offline",
        reason:   "heartbeat_timeout",
      });
    }
  } catch {
    // DB may not be ready on first tick
  }
}, 30_000);

// ─── GET all hosts ─────────────────────────────────────────────────────────────
router.get("/network/hosts", async (_req, res) => {
  const hosts = await db.select().from(networkHostsTable).orderBy(desc(networkHostsTable.lastSeen));
  res.json(hosts.map(h => ({ ...h, lastSeen: h.lastSeen.toISOString(), createdAt: h.createdAt.toISOString() })));
});

// ─── Register / heartbeat ──────────────────────────────────────────────────────
router.post("/network/hosts", async (req, res) => {
  const schema = z.object({
    ip:          z.string(),
    hostname:    z.string(),
    role:        z.enum(["kali", "ubuntu", "honeypot", "router", "unknown", "web-server", "mail-server", "workstation", "database", "forwarder"]).optional(),
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
    const prev = existing[0];
    await db.update(networkHostsTable)
      .set({ ...body.data, lastSeen: new Date() })
      .where(eq(networkHostsTable.ip, body.data.ip));
    const [updated] = await db.select().from(networkHostsTable).where(eq(networkHostsTable.ip, body.data.ip));

    // Broadcast status change when host comes back online
    if (prev.status === "offline" && updated.status === "online") {
      broadcaster.broadcast("host_status_change", {
        id:       updated.id,
        ip:       updated.ip,
        hostname: updated.hostname,
        status:   "online",
        reason:   "heartbeat",
      });
    }

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

  broadcaster.broadcast("host_status_change", {
    id:       created.id,
    ip:       created.ip,
    hostname: created.hostname,
    status:   created.status,
    reason:   "registered",
  });

  res.json({ ...created, lastSeen: created.lastSeen.toISOString(), createdAt: created.createdAt.toISOString() });
});

// ─── Remove host ───────────────────────────────────────────────────────────────
router.delete("/network/hosts/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  await db.delete(networkHostsTable).where(eq(networkHostsTable.id, id));
  res.json({ success: true });
});

// ─── Mark host OFFLINE + queue iptables block ──────────────────────────────────
router.patch("/network/hosts/:id/offline", async (req, res) => {
  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  await db.update(networkHostsTable).set({ status: "offline" }).where(eq(networkHostsTable.id, id));
  const [updated] = await db.select().from(networkHostsTable).where(eq(networkHostsTable.id, id));
  if (!updated) { res.status(404).json({ error: "Not found" }); return; }

  // Queue iptables block on the Ubuntu VM so attacks actually can't get through
  try {
    const safeIp = sanitizeIp(updated.ip);
    const blockCmd = `iptables -I INPUT -s ${safeIp} -j DROP && iptables -I OUTPUT -d ${safeIp} -j DROP && iptables -I FORWARD -s ${safeIp} -j DROP`;
    const undoCmd  = `iptables -D INPUT -s ${safeIp} -j DROP; iptables -D OUTPUT -d ${safeIp} -j DROP; iptables -D FORWARD -s ${safeIp} -j DROP`;
    await db.insert(defenseCommandsTable).values({
      targetVm:    "ubuntu",
      commandType: "network_isolate",
      commandText: blockCmd,
      undoCommand:  undoCmd,
      targetIp:    updated.ip,
      status:      "pending",
    });
  } catch { /* skip if IP format invalid */ }

  broadcaster.broadcast("host_status_change", {
    id:       updated.id,
    ip:       updated.ip,
    hostname: updated.hostname,
    status:   "offline",
    reason:   "manual",
  });

  res.json({ ...updated, lastSeen: updated.lastSeen.toISOString(), createdAt: updated.createdAt.toISOString() });
});

// ─── Mark host ONLINE + queue iptables unblock ─────────────────────────────────
router.patch("/network/hosts/:id/online", async (req, res) => {
  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  await db.update(networkHostsTable).set({ status: "online", lastSeen: new Date() }).where(eq(networkHostsTable.id, id));
  const [updated] = await db.select().from(networkHostsTable).where(eq(networkHostsTable.id, id));
  if (!updated) { res.status(404).json({ error: "Not found" }); return; }

  // Queue iptables unblock on the Ubuntu VM
  try {
    const safeIp = sanitizeIp(updated.ip);
    const unblockCmd = `iptables -D INPUT -s ${safeIp} -j DROP; iptables -D OUTPUT -d ${safeIp} -j DROP; iptables -D FORWARD -s ${safeIp} -j DROP`;
    await db.insert(defenseCommandsTable).values({
      targetVm:    "ubuntu",
      commandType: "network_restore",
      commandText: unblockCmd,
      undoCommand:  `iptables -I INPUT -s ${safeIp} -j DROP && iptables -I OUTPUT -d ${safeIp} -j DROP && iptables -I FORWARD -s ${safeIp} -j DROP`,
      targetIp:    updated.ip,
      status:      "pending",
    });
  } catch { /* skip if IP format invalid */ }

  broadcaster.broadcast("host_status_change", {
    id:       updated.id,
    ip:       updated.ip,
    hostname: updated.hostname,
    status:   "online",
    reason:   "manual",
  });

  res.json({ ...updated, lastSeen: updated.lastSeen.toISOString(), createdAt: updated.createdAt.toISOString() });
});

// ─── Host events ───────────────────────────────────────────────────────────────
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
  const now   = new Date();
  const since = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  // Build hour-bucket map for last 24 h
  const buckets: Record<string, { time: string; inbound: number; outbound: number; blocked: number }> = {};
  for (let i = 0; i < 24; i++) {
    const t = new Date(now.getTime() - (23 - i) * 3_600_000);
    t.setMinutes(0, 0, 0);
    const key = t.toISOString();
    buckets[key] = { time: key, inbound: 0, outbound: 0, blocked: 0 };
  }

  try {
    const events = await db
      .select()
      .from(securityEventsTable)
      .where(gte(securityEventsTable.createdAt, since))
      .orderBy(asc(securityEventsTable.createdAt));

    for (const e of events) {
      const t = new Date(e.createdAt);
      t.setMinutes(0, 0, 0);
      const key = t.toISOString();
      if (buckets[key]) {
        buckets[key].inbound++;
        if (e.status === "blocked") buckets[key].blocked++;
        // Estimate outbound as ~30% of inbound (internal to external)
        buckets[key].outbound = Math.floor(buckets[key].inbound * 0.3);
      }
    }
  } catch {
    // Return empty buckets if DB not ready
  }

  res.json(Object.values(buckets));
});

export default router;
