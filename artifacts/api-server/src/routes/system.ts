import { Router } from "express";
import { db } from "@workspace/db";
import { systemStatusTable, networkHostsTable } from "@workspace/db";
import { asc, eq, inArray, isNotNull } from "drizzle-orm";
import { broadcaster } from "../lib/broadcaster";

const router = Router();
const PFSENSE_IP = "10.30.30.1";

// Global infrastructure components — always present, no specific host
const GLOBAL_COMPONENTS = [
  {
    component: "pfSense Firewall",
    layer: "perimeter",
    status: "unknown",
    description: "Edge firewall & router — enforces pf rules, blocks attacker IPs at network boundary. Host: 10.30.30.1",
  },
  {
    component: "pfSense Suricata IDS",
    layer: "sensor",
    status: "unknown",
    description: "Network-level IDS on pfSense WAN — detects port scans, DDoS, SQLi, XSS, SSH brute across all zones",
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
  // ── company-web-server (10.10.10.10): Apache/Fail2ban ───────────────────────
  {
    component: "Fail2ban",
    layer: "sensor",
    status: "unknown",
    description: "Brute-force IP banning — SSH, Apache auth failures → auto-ban",
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
    component: "Apache Monitor",
    layer: "sensor",
    status: "unknown",
    description: "Apache access.log watcher — login brute force, 401/403 patterns, web breach detection",
    hostIp: "10.10.10.10",
  },
  // ── aegis-company-admin (10.30.30.10): Hub script VM ───────────────────────
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

  // ── company-customer-db (10.20.20.10): MySQL/Fail2ban ───────────────────────
  {
    component: "Fail2ban",
    layer: "sensor",
    status: "unknown",
    description: "Brute-force IP banning — SSH and service auth failures",
    hostIp: "10.20.20.10",
  },
  {
    component: "SSH Monitor",
    layer: "sensor",
    status: "unknown",
    description: "SSH auth.log watcher — detects brute force and unauthorized access to DB host",
    hostIp: "10.20.20.10",
  },
  {
    component: "MySQL Monitor",
    layer: "sensor",
    status: "unknown",
    description: "MySQL log watcher — auth failures, suspicious queries, connection anomalies",
    hostIp: "10.20.20.10",
  },
  // ── company-dns-server (10.10.10.20): BIND9/Fail2ban ───────────────────────
  {
    component: "DNS Monitor",
    layer: "sensor",
    status: "unknown",
    description: "BIND9 query log watcher — DNS amplification, zone transfer attempts, suspicious queries",
    hostIp: "10.10.10.20",
  },
  {
    component: "Fail2ban",
    layer: "sensor",
    status: "unknown",
    description: "Brute-force IP banning — SSH auth failures on company-dns-server",
    hostIp: "10.10.10.20",
  },
  {
    component: "SSH Monitor",
    layer: "sensor",
    status: "unknown",
    description: "SSH auth.log watcher — unauthorized access attempts on company-dns-server",
    hostIp: "10.10.10.20",
  },
  // ── company-ldap-server (10.20.20.20): OpenLDAP/Fail2ban ───────────────────
  {
    component: "LDAP Monitor",
    layer: "sensor",
    status: "unknown",
    description: "OpenLDAP (slapd) log watcher — auth failures, bind attempts, directory enumeration",
    hostIp: "10.20.20.20",
  },
  {
    component: "Fail2ban",
    layer: "sensor",
    status: "unknown",
    description: "Brute-force IP banning — SSH and LDAP auth failures on company-ldap-server",
    hostIp: "10.20.20.20",
  },
  {
    component: "SSH Monitor",
    layer: "sensor",
    status: "unknown",
    description: "SSH auth.log watcher — unauthorized access attempts on company-ldap-server",
    hostIp: "10.20.20.20",
  },
];

// Components that are obsolete globally (no hostIp) — old naming before per-host refactor.
// Only deletes rows WHERE hostIp IS NULL to avoid killing valid per-host sensor entries.
const GLOBAL_OBSOLETE_COMPONENTS = [
  "Snort IDS",
  "Cowrie Honeypot",  // removed from topology — Suricata + Fail2ban only
  "ModSecurity WAF",
  "AEGIS Dashboard",
  "Kali Linux (Red)",
  "Suricata IDS/IPS",   // renamed to "Suricata IDS" (per-host)
  "Fail2ban",           // old global entry — per-host entries are kept
];

// Components that are ALWAYS wrong regardless of hostIp (old broken forwarder versions).
// These never belonged to any host and are safe to delete unconditionally.
const ALWAYS_DELETE_COMPONENTS = [
  "Morgan HTTP Logger",        // old forwarder wrongly registered
  "PostgreSQL Monitor",        // old entry — replaced by MySQL Monitor for customer-db
  "Suricata IDS/IPS",         // old name
  "Suricata IDS",              // VM-level Suricata removed; pfSense Suricata is in GLOBAL_COMPONENTS
  "HTTP Service (Apache2)",   // renamed → Apache Monitor
  "ATM API Monitor",           // atm-server replaced by ldap-server at 10.20.20.20
  "FTP Monitor",               // FTP removed
];

// Old IPs that no longer exist in the topology — rows with these hostIps must be purged
// so stale DB entries (from old forwarder versions) don't appear on the dashboard.
// NOTE: 10.20.20.20 was the old customer-db IP (now 10.20.20.10) and briefly planned for
// atm-server, but v4 topology assigns it to ldap-server — DO NOT add it here.
const OBSOLETE_HOST_IPS: string[] = [];

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

  // All component names that appear in PER_HOST_SENSORS.
  // Used to detect wrong-host rows (e.g. MySQL Monitor registered under LDAP server IP).
  const seededComponents = new Set(PER_HOST_SENSORS.map(s => s.component));

  // FIX 1: Deduplicate — keep only the highest-id row per (hostIp, component) pair.
  // Duplicate rows appear when the forwarder re-registers after a restart, or when
  // pfSense Firewall / Fail2ban sensor is registered multiple times.
  const maxIdPerPair = new Map<string, number>();
  for (const s of all) {
    const pair = `${s.hostIp}::${s.component}`;
    const cur = maxIdPerPair.get(pair);
    if (cur === undefined || s.id > cur) maxIdPerPair.set(pair, s.id);
  }
  const dupIds = new Set(
    all
      .filter(s => maxIdPerPair.get(`${s.hostIp}::${s.component}`) !== s.id)
      .map(s => s.id)
  );

  const toDelete = all.filter(s => {
    const pair = `${s.hostIp}::${s.component}`;
    // FIX 1: Remove duplicate rows — keep only the highest-id row per (hostIp, component)
    if (dupIds.has(s.id)) return true;
    // Never delete our own seeded entries
    if (seededPairs.has(pair)) return false;
    // Always delete broken old sensor names
    if (ALWAYS_DELETE_COMPONENTS.includes(s.component)) return true;
    // Delete rows that belong to obsolete host IPs (topology changes)
    if (s.hostIp && OBSOLETE_HOST_IPS.includes(s.hostIp)) return true;
    // Delete old global (no-hostIp) obsolete entries
    if (!s.hostIp && GLOBAL_OBSOLETE_COMPONENTS.includes(s.component)) return true;
    // FIX 2: Delete wrong-host sensor rows — component is a known per-host sensor name
    // but assigned to a host it doesn't belong to (e.g. MySQL Monitor on LDAP server IP).
    // This happens when old forwarder versions registered sensors on wrong hosts.
    if (s.hostIp && seededComponents.has(s.component) && !seededPairs.has(pair)) return true;
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

async function seedSystemStatusUnlocked() {
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

// GET /system/status and POST /system/status can arrive at the same time:
// the dashboard polls every 5 seconds while the forwarder reports heartbeats.
// Serialize seed/update mutations so two callers cannot both observe a missing
// component and insert duplicate rows.
let statusMutationQueue: Promise<void> = Promise.resolve();

async function withStatusMutation<T>(operation: () => Promise<T>): Promise<T> {
  const previous = statusMutationQueue;
  let release!: () => void;
  statusMutationQueue = new Promise<void>(resolve => { release = resolve; });
  await previous;
  try {
    return await operation();
  } finally {
    release();
  }
}

export async function ensureSystemStatusSeeded(): Promise<void> {
  await withStatusMutation(() => seedSystemStatusUnlocked());
}

router.get("/system/status", async (_req, res) => {
  await ensureSystemStatusSeeded();

  // Only return global rows (no hostIp) + rows whose hostIp is a registered host
  const [allRows, hosts] = await Promise.all([
    db.select().from(systemStatusTable).orderBy(asc(systemStatusTable.layer)),
    db.select().from(networkHostsTable),
  ]);
  const activeIps = new Set(hosts.map(h => h.ip).filter(Boolean));

  const filteredRows = allRows.filter(
    s => !s.hostIp || activeIps.has(s.hostIp),
  );
  // Defensive read-time canonicalization keeps the visible count stable even
  // if legacy duplicates exist before the serialized cleanup completes.
  const canonical = new Map<string, (typeof filteredRows)[number]>();
  for (const row of filteredRows) {
    const key = `${row.hostIp ?? "GLOBAL"}::${row.component}`;
    const current = canonical.get(key);
    if (!current || row.id > current.id) canonical.set(key, row);
  }
  const statuses = [...canonical.values()];

  // If a VM forwarder goes silent (crash/reboot/shutdown), its sensor rows stay
  // "online" in the DB forever.  Treat any VM-reported row whose lastCheck is
  // older than 3 minutes as offline so the dashboard reflects reality.
  // Global rows (no hostIp) get a longer 2-minute grace period — they are
  // updated by startSelfHeartbeat() every 30s, so stale means server is down.
  const STALE_VM_MS     = 3 * 60 * 1000;  // 3 min  — VM sensors
  const STALE_GLOBAL_MS = 2 * 60 * 1000;  // 2 min  — global rows (AEGIS API Server etc.)
  const now = Date.now();
  res.json(statuses.map(s => {
    const ageMs = now - s.lastCheck.getTime();
    const stale = s.status === "online" && (
      s.hostIp
        ? ageMs > STALE_VM_MS
        : ageMs > STALE_GLOBAL_MS
    );
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

  await withStatusMutation(async () => {
    // A forwarder heartbeat can arrive before the first dashboard GET after a
    // restart. Seed the canonical set inside the same mutation lock so that
    // this request cannot create a transient 19th component.
    await seedSystemStatusUnlocked();
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
});

export default router;

// ─── Self-heartbeat ───────────────────────────────────────────────────────────
// Updates the "AEGIS API Server" global row every 30 s so the stale-timeout
// check above marks it offline if the server is actually down.
let _heartbeatTimer: ReturnType<typeof setInterval> | null = null;

async function _updateSelfStatus() {
  try {
    await db
      .update(systemStatusTable)
      .set({ status: "online", lastCheck: new Date() })
      .where(
        eq(systemStatusTable.component, "AEGIS API Server"),
      );
  } catch {
    // DB not ready yet — next tick will retry
  }
}

export function startSelfHeartbeat(): void {
  if (_heartbeatTimer) return; // already running
  // Run immediately then every 30 s
  void _updateSelfStatus();
  _heartbeatTimer = setInterval(async () => {
    await _updateSelfStatus();
    await _broadcastStaleChanges();
  }, 30_000);
}

// ─── Stale-sensor SSE broadcaster ────────────────────────────────────────────
// Runs every 30 s alongside the heartbeat. If a sensor's lastCheck crossed
// the stale threshold since the last check, broadcast service_status_change
// so the frontend sees it go OFFLINE instantly — no waiting for next poll.
const STALE_VM_MS     = 3 * 60 * 1000;
const STALE_GLOBAL_MS = 2 * 60 * 1000;
const _lastKnownStatus = new Map<number, string>();

async function _broadcastStaleChanges() {
  try {
    const rows = await db.select().from(systemStatusTable);
    const now  = Date.now();
    for (const s of rows) {
      const ageMs  = now - s.lastCheck.getTime();
      const limit  = s.hostIp ? STALE_VM_MS : STALE_GLOBAL_MS;
      const actual = s.status === "online" && ageMs > limit ? "offline" : s.status;
      const prev   = _lastKnownStatus.get(s.id);
      if (prev !== undefined && prev !== actual) {
        broadcaster.broadcast("service_status_change", {
          component: s.component,
          status:    actual,
          prevStatus: prev,
          layer:     s.layer,
          hostIp:    s.hostIp ?? null,
          lastCheck: s.lastCheck.toISOString(),
        });
      }
      _lastKnownStatus.set(s.id, actual);
    }
  } catch {
    // DB not ready — skip
  }
}
