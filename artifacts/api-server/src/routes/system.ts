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
// Match component names exactly with what the forwarder POSTs to /system/status.
const PER_HOST_SENSORS = [
  // ── bank-web (10.10.10.10): Apache/vsftpd/Suricata/Fail2ban ─────────────────
  {
    component: "Suricata IDS",
    layer: "sensor",
    status: "unknown",
    description: "Network intrusion detection — port scans, DDoS, SQLi, XSS, SSH brute force",
    hostIp: "10.10.10.10",
  },
  {
    component: "Fail2ban",
    layer: "sensor",
    status: "unknown",
    description: "Brute-force IP banning — SSH, FTP, Apache auth failures → auto-ban",
    hostIp: "10.10.10.10",
  },
  {
    component: "SSH Monitor",
    layer: "sensor",
    status: "unknown",
    description: "SSH auth.log watcher — detects brute force, failed logins, unauthorized access",
    hostIp: "10.10.10.10",
  },
  {
    component: "FTP Monitor",
    layer: "sensor",
    status: "unknown",
    description: "vsftpd log watcher — FTP sessions, file transfers, brute force attempts",
    hostIp: "10.10.10.10",
  },
  {
    component: "Apache Monitor",
    layer: "sensor",
    status: "unknown",
    description: "Apache/ModSecurity log watcher — SQLi, XSS, LFI, RFI, directory traversal",
    hostIp: "10.10.10.10",
  },

  // ── aegis-forwarder (10.30.30.10): Hub script VM ────────────────────────────
  // MGMT zone ဖြစ်ပေမယ့် SSH ဖွင့်ထားတာကြောင့် Kali မှ attack လာနိုင်
  {
    component: "Hub Forwarder",
    layer: "sensor",
    status: "unknown",
    description: "aegis_forwarder.py hub process — collects logs from all VMs, posts to API",
    hostIp: "10.30.30.10",
  },
  {
    component: "SSH Monitor",
    layer: "sensor",
    status: "unknown",
    description: "SSH auth.log watcher — MGMT zone မှာ SSH attack လာနိုင်၊ detect + block",
    hostIp: "10.30.30.10",
  },
  {
    component: "Fail2ban",
    layer: "sensor",
    status: "unknown",
    description: "Brute-force IP banning — AEGIS VM ၏ SSH ကာကွယ်",
    hostIp: "10.30.30.10",
  },

  // ── customer-db (10.20.20.20): PostgreSQL/Suricata/Fail2ban ─────────────────
  {
    component: "Suricata IDS",
    layer: "sensor",
    status: "unknown",
    description: "Network intrusion detection — port scans, DDoS, SQL injection attempts",
    hostIp: "10.20.20.20",
  },
  {
    component: "Fail2ban",
    layer: "sensor",
    status: "unknown",
    description: "Brute-force IP banning — SSH and service auth failures",
    hostIp: "10.20.20.20",
  },
  {
    component: "SSH Monitor",
    layer: "sensor",
    status: "unknown",
    description: "SSH auth.log watcher — detects brute force and unauthorized access to DB host",
    hostIp: "10.20.20.20",
  },
  {
    component: "PostgreSQL Monitor",
    layer: "sensor",
    status: "unknown",
    description: "PostgreSQL log watcher — auth failures, suspicious queries, connection anomalies",
    hostIp: "10.20.20.20",
  },
];

// Components that are obsolete globally (no hostIp) — old naming before per-host refactor.
// Only deletes rows WHERE hostIp IS NULL to avoid killing valid per-host sensor entries.
const GLOBAL_OBSOLETE_COMPONENTS = [
  "Snort IDS",
  "Cowrie Honeypot",
  "ModSecurity WAF",
  "AEGIS Dashboard",
  "Kali Linux (Red)",
  "Suricata IDS/IPS",   // renamed to "Suricata IDS" (per-host)
  "Fail2ban",           // old global entry — per-host entries are kept
];

// Components that are ALWAYS wrong regardless of hostIp (old broken forwarder versions).
// These never belonged to any host and are safe to delete unconditionally.
const ALWAYS_DELETE_COMPONENTS = [
  "Morgan HTTP Logger",        // old forwarder wrongly registered under aegis-forwarder
  "PostgreSQL Monitor",        // old forwarder wrongly registered under 10.30.30.10; now seeded correctly for customer-db only
  "Suricata IDS/IPS",         // renamed → "Suricata IDS" (per-host)
  "HTTP Service (Apache2)",   // renamed → "Apache Monitor"
  "FTP Service (vsftpd)",     // renamed → "FTP Monitor"
];

async function purgeStaleRows() {
  const [all, hosts] = await Promise.all([
    db.select().from(systemStatusTable),
    db.select().from(networkHostsTable),
  ]);
  const activeIps = new Set(hosts.map(h => h.ip).filter(Boolean));

  // Known correct (hostIp, component) pairs — never delete these even if host is not yet registered
  const seededPairs = new Set(
    PER_HOST_SENSORS.map(s => `${s.hostIp}::${s.component}`)
  );

  const toDelete = all.filter(s => {
    const pair = `${s.hostIp}::${s.component}`;
    // Never delete our own seeded entries
    if (seededPairs.has(pair)) return false;
    // Always delete broken old sensor names
    if (ALWAYS_DELETE_COMPONENTS.includes(s.component)) return true;
    // Delete old global (no-hostIp) obsolete entries
    if (!s.hostIp && GLOBAL_OBSOLETE_COMPONENTS.includes(s.component)) return true;
    // Delete orphaned per-host rows whose host is no longer registered
    if (s.hostIp != null && !activeIps.has(s.hostIp)) return true;
    return false;
  });

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
