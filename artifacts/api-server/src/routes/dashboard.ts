import { Router } from "express";
import { db } from "@workspace/db";
import { securityEventsTable, incidentsTable, alertsTable, systemStatusTable } from "@workspace/db";
import { count, eq, and, gte, desc } from "drizzle-orm";

const router = Router();

router.get("/dashboard/summary", async (req, res) => {
  const [totalEventsRes] = await db.select({ count: count() }).from(securityEventsTable);
  const [criticalRes] = await db.select({ count: count() }).from(securityEventsTable).where(eq(securityEventsTable.severity, "critical"));
  const [openIncidentsRes] = await db.select({ count: count() }).from(incidentsTable).where(eq(incidentsTable.status, "open"));
  const [activeAlertsRes] = await db.select({ count: count() }).from(alertsTable).where(eq(alertsTable.acknowledged, false));
  const [blockedRes] = await db.select({ count: count() }).from(securityEventsTable).where(eq(securityEventsTable.status, "blocked"));

  const allStatuses = await db.select().from(systemStatusTable);
  const systemsOnline = allStatuses.filter(s => s.status === "online").length;
  const systemsTotal = allStatuses.length;

  const allEvents = await db.select().from(securityEventsTable).orderBy(desc(securityEventsTable.createdAt)).limit(200);

  const typeCounts: Record<string, { count: number; severity: string }> = {};
  for (const e of allEvents) {
    if (!typeCounts[e.type]) {
      typeCounts[e.type] = { count: 0, severity: e.severity };
    }
    typeCounts[e.type].count++;
    if (e.severity === "critical") typeCounts[e.type].severity = "critical";
    else if (e.severity === "high" && typeCounts[e.type].severity !== "critical") typeCounts[e.type].severity = "high";
  }

  const attacksByType = Object.entries(typeCounts).map(([type, val]) => ({
    type,
    count: val.count,
    severity: val.severity,
  }));

  const hourCounts: Record<string, number> = {};
  for (const e of allEvents) {
    const hour = new Date(e.createdAt).toISOString().slice(0, 13) + ":00";
    hourCounts[hour] = (hourCounts[hour] || 0) + 1;
  }
  const eventsTrend = Object.entries(hourCounts)
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-12)
    .map(([hour, c]) => ({ hour, count: c }));

  res.json({
    totalEvents: Number(totalEventsRes?.count ?? 0),
    criticalEvents: Number(criticalRes?.count ?? 0),
    openIncidents: Number(openIncidentsRes?.count ?? 0),
    activeAlerts: Number(activeAlertsRes?.count ?? 0),
    blockedIPs: Number(blockedRes?.count ?? 0),
    systemsOnline,
    systemsTotal,
    attacksByType,
    eventsTrend,
  });
});

export default router;
