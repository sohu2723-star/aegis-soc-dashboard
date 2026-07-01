import { Router } from "express";
import { db } from "@workspace/db";
import { alertsTable } from "@workspace/db";
import { desc, eq } from "drizzle-orm";

const router = Router();

router.get("/alerts", async (req, res) => {
  const acknowledged = req.query.acknowledged;
  const alerts = await db.select().from(alertsTable).orderBy(desc(alertsTable.createdAt));
  const filtered = acknowledged !== undefined
    ? alerts.filter(a => a.acknowledged === (acknowledged === "true"))
    : alerts;
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
