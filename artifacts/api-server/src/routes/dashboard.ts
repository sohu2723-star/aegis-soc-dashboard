import { Router } from "express";
import { db } from "@workspace/db";
import { securityEventsTable, incidentsTable, alertsTable, systemStatusTable } from "@workspace/db";
import { count, eq, and, gte, desc, sql } from "drizzle-orm";
import { ensureSystemStatusSeeded } from "./system";

const router = Router();

// ── In-memory cache for /dashboard/summary ────────────────────────────────────
// The summary runs 8 parallel DB queries. With Supabase pooler (port 6543),
// establishing connections after an idle period takes 2-5s per slot, making
// the first request after idle > 8s → false "API slow" banner.
// Cache per targetHost for 3s so rapid polls and SSE-triggered invalidations
// don't all race to open fresh connections at once.
const _summaryCache = new Map<string, { data: unknown; expiresAt: number }>();
const SUMMARY_CACHE_MS = 3000;
// React Query retries and SSE invalidations can request the same summary while
// the first DB read is still running.  Share that read instead of starting
// another eight queries and exhausting the postgres.js pool.
const _summaryRequests = new Map<string, Promise<any>>();

function getCachedSummary(key: string) {
  const entry = _summaryCache.get(key);
  if (entry && entry.expiresAt > Date.now()) return entry.data;
  return null;
}
function setCachedSummary(key: string, data: unknown) {
  _summaryCache.set(key, { data, expiresAt: Date.now() + SUMMARY_CACHE_MS });
  // Prune stale entries (max 20 host keys)
  if (_summaryCache.size > 20) {
    const now = Date.now();
    for (const [k, v] of _summaryCache) if (v.expiresAt <= now) _summaryCache.delete(k);
  }
}

router.get("/dashboard/summary", async (req, res) => {
  // Optional ?targetHost=IP — scope all event stats to a specific host
  const targetHost =
    typeof req.query.targetHost === "string" && req.query.targetHost
      ? req.query.targetHost
      : null;

  // Fast path — return cached result before touching the DB
  const cacheKey = targetHost ?? "__all__";
  const cached = getCachedSummary(cacheKey);
  if (cached) { res.json(cached); return; }

  // Kick off seeding in the background — do NOT await it.
  // Seeding touches system_status with DELETE/INSERT which can hit Supabase
  // statement_timeout while waiting for row locks held by another server instance.
  // The dashboard handles missing system_status rows gracefully (shows 0/0).
  void ensureSystemStatusSeeded();

  // Hard wall-clock timeout so the endpoint returns a 503 quickly when the
  // DB is unreachable (e.g. Supabase paused) instead of hanging indefinitely.
  // The client's 8 s "slow" banner fires before this, but without this guard
  // the request would never resolve and retry would pile up.
  const DB_TIMEOUT_MS = 12_000;
  // Pre-build filters so we don't branch inside Promise.all
  const baseWhere   = targetHost ? eq(securityEventsTable.targetHost, targetHost) : undefined;
  const critWhere   = targetHost
    ? and(eq(securityEventsTable.severity, "critical"), eq(securityEventsTable.targetHost, targetHost))
    : eq(securityEventsTable.severity, "critical");
  const blockedWhere = targetHost
    ? and(eq(securityEventsTable.status, "blocked"), eq(securityEventsTable.targetHost, targetHost))
    : eq(securityEventsTable.status, "blocked");

  const since12h = sql`now() - interval '12 hours'`;

  // ─── Run all 7 queries in parallel, with a hard timeout ─────────────────────
  let queryResult: Awaited<ReturnType<typeof runSummaryQueries>>;
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    let request = _summaryRequests.get(cacheKey);
    if (!request) {
      request = runSummaryQueries();
      _summaryRequests.set(cacheKey, request);
      void request.finally(() => {
        if (_summaryRequests.get(cacheKey) === request) _summaryRequests.delete(cacheKey);
      }).catch(() => undefined);
    }
    const dbTimeout = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(
        () => reject(new Error("dashboard/summary DB queries timed out")),
        DB_TIMEOUT_MS,
      );
    });
    queryResult = await Promise.race([request, dbTimeout]);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(503).json({ error: "db_unavailable", message: msg });
    return;
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
  const [
    [totalEventsRes],
    [criticalRes],
    [openIncidentsRes],
    [activeAlertsRes],
    [blockedRes],
    allStatuses,
    attacksByTypeRows,
    trendRows,
  ] = queryResult;

  function runSummaryQueries() {
    return Promise.all([
      // 1. Total events
      baseWhere
        ? db.select({ count: count() }).from(securityEventsTable).where(baseWhere)
        : db.select({ count: count() }).from(securityEventsTable),

      // 2. Critical events
      db.select({ count: count() }).from(securityEventsTable).where(critWhere),

      // 3. Open incidents
      db.select({ count: count() }).from(incidentsTable).where(eq(incidentsTable.status, "open")),

      // 4. Unacknowledged alerts
      db.select({ count: count() }).from(alertsTable).where(eq(alertsTable.acknowledged, false)),

      // 5. Blocked events
      db.select({ count: count() }).from(securityEventsTable).where(blockedWhere),

      // 6. System status — fetch status + lastCheck + hostIp to apply stale timeout
      db.select({
        component: systemStatusTable.component,
        status:    systemStatusTable.status,
        lastCheck: systemStatusTable.lastCheck,
        hostIp:    systemStatusTable.hostIp,
      }).from(systemStatusTable),

      // 7. Attack type breakdown — GROUP BY at DB level (replaces 500-row fetch)
      baseWhere
        ? db
            .select({ type: securityEventsTable.type, count: count() })
            .from(securityEventsTable)
            .where(baseWhere)
            .groupBy(securityEventsTable.type)
            .orderBy(desc(count()))
            .limit(10)
        : db
            .select({ type: securityEventsTable.type, count: count() })
            .from(securityEventsTable)
            .groupBy(securityEventsTable.type)
            .orderBy(desc(count()))
            .limit(10),

      // 8. Hourly trend (last 12 h) — date_trunc at DB level
      baseWhere
        ? db
            .select({
              hour: sql<string>`to_char(date_trunc('hour', ${securityEventsTable.createdAt}), 'HH24":00"')`,
              count: count(),
            })
            .from(securityEventsTable)
            .where(and(baseWhere, gte(securityEventsTable.createdAt, sql`now() - interval '12 hours'`)))
            .groupBy(sql`date_trunc('hour', ${securityEventsTable.createdAt})`)
            .orderBy(sql`date_trunc('hour', ${securityEventsTable.createdAt})`)
        : db
            .select({
              hour: sql<string>`to_char(date_trunc('hour', ${securityEventsTable.createdAt}), 'HH24":00"')`,
              count: count(),
            })
            .from(securityEventsTable)
            .where(gte(securityEventsTable.createdAt, sql`now() - interval '12 hours'`))
            .groupBy(sql`date_trunc('hour', ${securityEventsTable.createdAt})`)
            .orderBy(sql`date_trunc('hour', ${securityEventsTable.createdAt})`),
    ]);
  }
  // ────────────────────────────────────────────────────────────────────────────

  // Apply same stale check as GET /system/status:
  //   VM sensors  (hostIp set)  → stale after 3 min
  //   Global rows (no hostIp)   → stale after 2 min (self-heartbeat every 30s)
  const STALE_VM_MS     = 3 * 60 * 1000;
  const STALE_GLOBAL_MS = 2 * 60 * 1000;
  const now = Date.now();
  const canonicalStatuses = new Map<string, (typeof allStatuses)[number]>();
  for (const row of allStatuses) {
    const key = `${row.hostIp ?? "GLOBAL"}::${row.component}`;
    const current = canonicalStatuses.get(key);
    if (!current || row.lastCheck > current.lastCheck) {
      canonicalStatuses.set(key, row);
    }
  }
  const resolvedStatuses = [...canonicalStatuses.values()].map(s => {
    const ageMs = s.lastCheck ? now - new Date(s.lastCheck).getTime() : Infinity;
    const staleMs = s.hostIp ? STALE_VM_MS : STALE_GLOBAL_MS;
    const stale = s.status === "online" && ageMs > staleMs;
    return { ...s, status: stale ? "offline" : s.status };
  });
  const systemsOnline = resolvedStatuses.filter(s => s.status === "online").length;
  const systemsTotal  = resolvedStatuses.length;

  // Device-scoped sensor counts — only sensors belonging to targetHost (+ shared global)
  let deviceSystemsOnline = systemsOnline;
  let deviceSystemsTotal  = systemsTotal;
  if (targetHost) {
    const scoped = resolvedStatuses.filter(s => !s.hostIp || s.hostIp === targetHost);
    deviceSystemsOnline = scoped.filter(s => s.status === "online").length;
    deviceSystemsTotal  = scoped.length;
  }

  const attacksByType = attacksByTypeRows.map(r => ({
    type:  r.type,
    count: Number(r.count),
  }));

  const eventsTrend = trendRows.map(r => ({
    hour:  r.hour,
    count: Number(r.count),
  }));

  const payload = {
    totalEvents:    Number(totalEventsRes?.count  ?? 0),
    criticalEvents: Number(criticalRes?.count     ?? 0),
    openIncidents:  Number(openIncidentsRes?.count ?? 0),
    activeAlerts:   Number(activeAlertsRes?.count  ?? 0),
    blockedIPs:     Number(blockedRes?.count       ?? 0),
    systemsOnline,
    systemsTotal,
    deviceSystemsOnline,
    deviceSystemsTotal,
    attacksByType,
    eventsTrend,
    scopedToHost: targetHost,
  };
  setCachedSummary(cacheKey, payload);
  res.json(payload);
});

export default router;
