import { Router } from "express";
import { db } from "@workspace/db";
import { systemStatusTable } from "@workspace/db";
import { asc, eq, inArray } from "drizzle-orm";
import { broadcaster } from "../lib/broadcaster";

const router = Router();

// Global infrastructure components — always present, no specific host
const GLOBAL_COMPONENTS = [
  {
    component: "pfSense Firewall",
    layer: "perimeter",
    status: "unknown",
    description: "Edge firewall & router — enforces pf rules, blocks attacker IPs at network boundary",
  },
  {
    component: "AEGIS API Server",
    layer: "brain",
    status: "online",
    description: "Central ingest & command server — receives sensor events, runs auto-defense engine, serves dashboard",
  },
];

// Components that are obsolete and should be removed from the DB on startup
const OBSOLETE_COMPONENTS = [
  "Snort IDS",
  "Cowrie Honeypot",
  "ModSecurity WAF",
  "AEGIS Dashboard",
  "Kali Linux (Red)",
  "Suricata IDS/IPS",   // now registered per-host by the VM forwarder
  "Fail2ban",           // now registered per-host by the VM forwarder
];

async function seedSystemStatus() {
  // 1. Remove obsolete global components (no hostIp) from DB
  const all = await db.select().from(systemStatusTable);
  const toDelete = all.filter(
    s => !s.hostIp && OBSOLETE_COMPONENTS.includes(s.component),
  );
  if (toDelete.length > 0) {
    await db.delete(systemStatusTable).where(
      inArray(systemStatusTable.id, toDelete.map(s => s.id)),
    );
  }

  // 2. Seed global components if missing
  const remaining = await db.select().from(systemStatusTable);
  for (const c of GLOBAL_COMPONENTS) {
    const exists = remaining.some(s => s.component === c.component && !s.hostIp);
    if (!exists) {
      await db.insert(systemStatusTable).values(c);
    }
  }
}

router.get("/system/status", async (_req, res) => {
  await seedSystemStatus();

  const statuses = await db
    .select()
    .from(systemStatusTable)
    .orderBy(asc(systemStatusTable.layer));

  res.json(statuses.map(s => ({
    ...s,
    lastCheck: s.lastCheck.toISOString(),
  })));
});

router.post("/system/status", async (req, res) => {
  const { component, layer, status, description, metrics, hostIp } = req.body as {
    component: string; layer: string; status: string;
    description?: string; metrics?: string; hostIp?: string;
  };
  if (!component || !layer || !status) {
    res.status(400).json({ error: "component, layer, status required" });
    return;
  }

  const existing = await db.select().from(systemStatusTable);
  // Match on (component, hostIp) so multiple VMs reporting the same service
  // (e.g. Fail2ban on two Ubuntu hosts) don't overwrite each other. Rows
  // without a hostIp (legacy/global components) still match by component name.
  const match = existing.find(s => s.component === component && (hostIp ? s.hostIp === hostIp : !s.hostIp));

  let result;
  if (match) {
    const prevStatus = match.status;
    const [updated] = await db
      .update(systemStatusTable)
      .set({ status, metrics: metrics ?? null, hostIp: hostIp ?? match.hostIp, lastCheck: new Date() })
      .where(eq(systemStatusTable.id, match.id))
      .returning();
    result = { ...updated, lastCheck: updated.lastCheck.toISOString() };

    // Broadcast only when status actually changed
    if (prevStatus !== status) {
      broadcaster.broadcast("service_status_change", {
        component,
        status,
        prevStatus,
        layer,
        hostIp: hostIp ?? null,
        lastCheck: result.lastCheck,
      });
    }
  } else {
    const [row] = await db.insert(systemStatusTable).values({
      component, layer, status,
      description: description ?? component,
      metrics: metrics ?? null,
      hostIp: hostIp ?? null,
    }).returning();
    result = { ...row, lastCheck: row.lastCheck.toISOString() };

    broadcaster.broadcast("service_status_change", {
      component,
      status,
      prevStatus: "unknown",
      layer,
      hostIp: hostIp ?? null,
      lastCheck: result.lastCheck,
    });
  }

  res.json(result);
});

export default router;
