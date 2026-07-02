import { Router } from "express";
import { db } from "@workspace/db";
import { reportsTable, securityEventsTable, incidentsTable } from "@workspace/db";
import { desc, count, eq } from "drizzle-orm";
import { z } from "zod";

const router = Router();

router.get("/reports", async (_req, res) => {
  const reports = await db.select().from(reportsTable).orderBy(desc(reportsTable.generatedAt));
  res.json(reports.map(r => ({ ...r, generatedAt: r.generatedAt.toISOString() })));
});

const generateReportSchema = z.object({
  title:  z.string(),
  type:   z.enum(["daily", "weekly", "incident", "custom"]),
  format: z.enum(["html", "pdf"]),
});

router.post("/reports/generate", async (req, res) => {
  const body = generateReportSchema.parse(req.body);

  const [eventsResult]    = await db.select({ count: count() }).from(securityEventsTable);
  const [incidentsResult] = await db.select({ count: count() }).from(incidentsTable);
  const eventsCount    = Number(eventsResult?.count    ?? 0);
  const incidentsCount = Number(incidentsResult?.count ?? 0);

  const summary = `${body.type.charAt(0).toUpperCase() + body.type.slice(1)} security report. ` +
    `Total events: ${eventsCount}. Total incidents: ${incidentsCount}. ` +
    `Covers Suricata IDS, Fail2ban, SSH/FTP monitoring, Web attack detection, and Firewall rules.`;

  const [row] = await db.insert(reportsTable).values({
    title:          body.title,
    type:           body.type,
    format:         body.format,
    summary,
    eventsCount,
    incidentsCount,
  }).returning();

  const [report] = await db.select().from(reportsTable).where(eq(reportsTable.id, row.id));
  res.status(201).json({ ...report, generatedAt: report.generatedAt.toISOString() });
});

export default router;
