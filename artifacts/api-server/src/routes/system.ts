import { Router } from "express";
import { db } from "@workspace/db";
import { systemStatusTable, networkHostsTable } from "@workspace/db";
import { asc, eq, inArray, isNotNull } from "drizzle-orm";
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

// Per-host sensors seeded as initial "unknown" state.
// The aegis_forwarder (hub mode) will update these to online/offline via POST /system/status.
const PER_HOST_SENSORS = [
  {
    component: "Suricata IDS",
    layer: "sensor",
    status: "unknown",
    description: "Network intrusion detection — alerts on port scans, DDoS, web attacks, SSH brute force",
    hostIp: "10.10.10.10",
  },
  {
    component: "Fail2ban",
    layer: "sensor",
    status: "unknown",
    description: "Brute-force IP banning — SSH, FTP, Apache auth failures",
    hostIp: "10.10.10.10",
  },
  {
    component: "Suricata IDS",
    layer: "sensor",
    status: "unknown",
    description: "Network intrusion detection — alerts on port scans, DDoS, SQL injection attempts",
    hostIp: "10.20.20.20",
  },
  {
    component: "Fail2ban",
    layer: "sensor",
    status: "unknown",
    description: "Brute-force IP banning — SSH and PostgreSQL auth failures",
    hostIp: "10.20.20.20",
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

async function purgeStaleRows() {
  const [all, hosts] = await Promise.all([
    db.select().from(systemStatusTable),
    db.select().from(networkHostsTable),
  ]);
  const activeIps = new Set(hosts.map(h => h.ip).filter(Boolean));

  const toDelete = all.filter(s =>
    // Delete obsolete component names regardless of host
    OBSOLETE_COMPONENTS.includes(s.component) ||
    // Delete orphaned sensor rows (hostIp set but no matching host in network_hosts)
    (s.hostIp != null && !activeIps.has(s.hostIp))
  );

  if (toDelete.length > 0) {
    await db.delete(systemStatusTable).where(
      inArray(systemStatusTable.id, toDelete.map(s => s.id)),
    );
  }
}

async function seedSystemStatus() {
  await purgeStaleRows();

  const remaining = await db.select().from(systemStatusTable);

  // Seed global components if missing
  for (const c of GLOBAL_COMPONENTS) {
    const exists = remaining.some(s => s.component === c.component && !s.hostIp);
    if (!exists) {
      await db.insert(systemStatusTable).values(c);
    }
  }

  // Seed per-host sensors as "unknown" so they appear before the forwarder registers them.
  // Once the forwarder posts real status, these rows get updated to online/offline.
  for (const s of PER_HOST_SENSORS) {
    const exists = remaining.some(r => r.component === s.component && r.hostIp === s.hostIp);
    if (!exists) {
      await db.insert(systemStatusTable).values(s);
    }
  }
}

router.get("/system/status", async (_req, res) => {
  await seedSystemStatus();

  // Only return global rows (no hostIp) + rows whose hostIp is a registered host
  const [allRows, hosts] = await Promise.all([
    db.select().from(systemStatusTable).orderBy(asc(systemStatusTable.layer)),
    db.select().from(networkHostsTable),
  ]);
  const activeIps = new Set(hosts.map(h => h.ip).filter(Boolean));

  const statuses = allRows.filter(
    s => !s.hostIp || activeIps.has(s.hostIp),
  );

  // If a VM forwarder goes silent (crash/reboot/shutdown), its sensor rows stay
  // "online" in the DB forever.  Treat any VM-reported row whose lastCheck is
  // older than 3 minutes as offline so the dashboard reflects reality.
  const STALE_MS = 3 * 60 * 1000; // 3 minutes
  const now = Date.now();
  res.json(statuses.map(s => {
    const stale =
      !!s.hostIp &&
      s.status === "online" &&
      now - s.lastCheck.getTime() > STALE_MS;
    return {
      ...s,
      status:    stale ? "offline" : s.status,
      lastCheck: s.lastCheck.toISOString(),
    };
  }));
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
