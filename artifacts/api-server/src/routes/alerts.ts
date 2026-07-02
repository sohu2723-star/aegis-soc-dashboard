import { Router } from "express";
import { db } from "@workspace/db";
import { alertsTable, securityEventsTable } from "@workspace/db";
import { desc, eq } from "drizzle-orm";

const router = Router();

router.get("/alerts", async (req, res) => {
  const acknowledged = req.query.acknowledged;

  // Enrich alerts with linked security event data (sourceIp, targetHost, type, subtype, toolUsed)
  const rows = await db
    .select({
      id:            alertsTable.id,
      message:       alertsTable.message,
      severity:      alertsTable.severity,
      channel:       alertsTable.channel,
      acknowledged:  alertsTable.acknowledged,
      eventId:       alertsTable.eventId,
      createdAt:     alertsTable.createdAt,
      sourceIp:      securityEventsTable.sourceIp,
      targetHost:    securityEventsTable.targetHost,
      attackType:    securityEventsTable.type,
      attackSubtype: securityEventsTable.subtype,
      toolUsed:      securityEventsTable.toolUsed,
      attackSeverity:securityEventsTable.severity,
    })
    .from(alertsTable)
    .leftJoin(securityEventsTable, eq(alertsTable.eventId, securityEventsTable.id))
    .orderBy(desc(alertsTable.createdAt));

  const filtered = acknowledged !== undefined
    ? rows.filter(a => a.acknowledged === (acknowledged === "true"))
    : rows;

  res.json(filtered.map(a => ({ ...a, createdAt: a.createdAt.toISOString() })));
});

router.patch("/alerts/:id/acknowledge", async (req, res) => {
  const id = Number(req.params.id);
  await db.update(alertsTable).set({ acknowledged: true }).where(eq(alertsTable.id, id));
  const [alert] = await db.select().from(alertsTable).where(eq(alertsTable.id, id));
  if (!alert) { res.status(404).json({ error: "Alert not found" }); return; }
  res.json({ ...alert, createdAt: alert.createdAt.toISOString() });
});

export default router;
