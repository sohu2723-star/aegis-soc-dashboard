import { Router } from "express";
import { db, networkHostsTable } from "@workspace/db";
import { securityEventsTable, defenseCommandsTable, systemStatusTable } from "@workspace/db";
import { eq, desc, or, lt, and, gte, asc } from "drizzle-orm";
import { z } from "zod";
import { broadcaster } from "../lib/broadcaster";
import { sanitizeIp } from "../lib/defense-sanitize";

const router = Router();

// ─── In-memory traffic stats ring buffer (last 24 hourly buckets) ─────────────
interface TrafficBucket { time: string; inbound: number; outbound: number; blocked: number; packets: number }
const _trafficRing: Map<string, TrafficBucket> = new Map();

export function recordTrafficStats(stats: { inbound: number; outbound: number; blocked: number; packets: number; timestamp?: string }) {
  const t = stats.timestamp ? new Date(stats.timestamp) : new Date();
  t.setMinutes(0, 0, 0);
  const key = t.toISOString();
  const existing = _trafficRing.get(key);
  if (existing) {
    existing.inbound  += stats.inbound;
    existing.outbound += stats.outbound;
    existing.blocked  += stats.blocked;
    existing.packets  += stats.packets;
  } else {
    _trafficRing.set(key, { time: key, ...stats, packets: stats.packets });
    // Prune entries older than 25 hours
    const cutoff = Date.now() - 25 * 3_600_000;
    for (const [k] of _trafficRing) {
      if (new Date(k).getTime() < cutoff) _trafficRing.delete(k);
    }
  }
}

// ─── Auto-timeout: mark hosts offline if heartbeat stopped ────────────────────
const OFFLINE_TIMEOUT_MS = 45_000; // 45s — forwarder heartbeats every 15s, so 3 missed = offline

async function markStaleHostsOffline() {
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
}

// Run on interval (background) — also runs inline on each GET so Render
// cold-start / sleep gaps don't leave hosts stuck as "online" forever.
setInterval(markStaleHostsOffline, 30_000);

// ─── GET all hosts ─────────────────────────────────────────────────────────────
router.get("/network/hosts", async (_req, res) => {
  // Inline stale check: if the background interval missed ticks (Render sleep),
  // this ensures hosts go offline the moment the dashboard next polls.
  await markStaleHostsOffline();
  const hosts = await db.select().from(networkHostsTable).orderBy(desc(networkHostsTable.lastSeen));
  res.json(hosts.map(h => ({ ...h, lastSeen: h.lastSeen.toISOString(), createdAt: h.createdAt.toISOString() })));
});

// ─── Register / heartbeat ──────────────────────────────────────────────────────
router.post("/network/hosts", async (req, res) => {
  const schema = z.object({
    ip:          z.string(),
    hostname:    z.string(),
    role:        z.enum(["kali", "ubuntu", "honeypot", "router", "unknown", "web-server", "mail-server", "workstation", "database", "forwarder"]).optional(),
    os:          z.string().nullish(),
    mac:         z.string().nullish(),
    openPorts:   z.string().nullish(),
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

// ─── Remove host (+ cascade-delete its sensor rows) ───────────────────────────
router.delete("/network/hosts/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  // Grab the host's IP before deleting so we can clean up sensors
  const [host] = await db.select().from(networkHostsTable).where(eq(networkHostsTable.id, id));
  if (host?.ip) {
    // Remove all system_status sensor rows tied to this host
    await db.delete(systemStatusTable).where(eq(systemStatusTable.hostIp, host.ip));
  }

  await db.delete(networkHostsTable).where(eq(networkHostsTable.id, id));

  broadcaster.broadcast("host_status_change", {
    id, ip: host?.ip ?? null, hostname: host?.hostname ?? null,
    status: "deleted", reason: "manual_delete",
  });

  res.json({ success: true });
});

// ─── Mark host OFFLINE + queue iptables block ──────────────────────────────────
router.patch("/network/hosts/:id/offline", async (req, res) => {
  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  await db.update(networkHostsTable).set({ status: "offline" }).where(eq(networkHostsTable.id, id));
  const [updated] = await db.select().from(networkHostsTable).where(eq(networkHostsTable.id, id));
  if (!updated) { res.status(404).json({ error: "Not found" }); return; }

  // Queue iptables block on all company VMs so attacks actually can't get through
  try {
    const safeIp = sanitizeIp(updated.ip);
    const blockCmd = `iptables -I INPUT -s ${safeIp} -j DROP && iptables -I OUTPUT -d ${safeIp} -j DROP && iptables -I FORWARD -s ${safeIp} -j DROP`;
    const undoCmd  = `iptables -D INPUT -s ${safeIp} -j DROP; iptables -D OUTPUT -d ${safeIp} -j DROP; iptables -D FORWARD -s ${safeIp} -j DROP`;
    await db.insert(defenseCommandsTable).values({
      targetVm:    "all",
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

  // Queue iptables unblock on all company VMs
  try {
    const safeIp = sanitizeIp(updated.ip);
    const unblockCmd = `iptables -D INPUT -s ${safeIp} -j DROP; iptables -D OUTPUT -d ${safeIp} -j DROP; iptables -D FORWARD -s ${safeIp} -j DROP`;
    await db.insert(defenseCommandsTable).values({
      targetVm:    "all",
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

  // Also match by hostname so VM labels (company-web-server, company-dns-server, company-customer-db, company-ldap-server) resolve to their IP
  const [hostRow] = await db.select().from(networkHostsTable).where(eq(networkHostsTable.ip, ip));
  const hostname = hostRow?.hostname ?? null;

  const conditions = [
    eq(securityEventsTable.sourceIp, ip),
    eq(securityEventsTable.targetHost, ip),
    ...(hostname ? [eq(securityEventsTable.targetHost, hostname)] : []),
  ];

  const events = await db
    .select().from(securityEventsTable)
    .where(or(...conditions))
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
    recentEvents: events.slice(0, 200).map(e => ({ ...e, createdAt: e.createdAt.toISOString() })),
  });
});

router.get("/network/traffic", async (_req, res) => {
  const now = new Date();

  // Build 24-hour skeleton
  const buckets: Record<string, TrafficBucket> = {};
  for (let i = 0; i < 24; i++) {
    const t = new Date(now.getTime() - (23 - i) * 3_600_000);
    t.setMinutes(0, 0, 0);
    const key = t.toISOString();
    // Prefer real tcpdump stats from ring; fall back to zero
    buckets[key] = _trafficRing.get(key) ?? { time: key, inbound: 0, outbound: 0, blocked: 0, packets: 0 };
  }

  // If ring is entirely empty (hub not yet running), fall back to security_events counts
  const hasRealData = [...Object.values(buckets)].some(b => b.packets > 0);
  if (!hasRealData) {
    try {
      const since  = new Date(now.getTime() - 24 * 60 * 60 * 1000);
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
        }
      }
    } catch { /* DB not ready */ }
  }

  res.json(Object.values(buckets));
});

export default router;
