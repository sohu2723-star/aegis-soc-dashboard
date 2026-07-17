import { Router } from "express";
import { db } from "@workspace/db";
import { reportsTable, securityEventsTable, incidentsTable } from "@workspace/db";
import { desc, count, eq, gte } from "drizzle-orm";
import { z } from "zod";
import { askGroq, groqAvailable } from "../lib/groq-client";

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

  // Fallback template summary (used if Groq is unavailable or fails)
  const templateSummary = `${body.type.charAt(0).toUpperCase() + body.type.slice(1)} security report. ` +
    `Total events: ${eventsCount}. Total incidents: ${incidentsCount}. ` +
    `Covers Suricata IDS, Fail2ban, SSH/FTP monitoring, Web attack detection, and Firewall rules.`;

  let summary = templateSummary;
  let aiGenerated = false;

  // Try AI analysis if Groq is configured
  if (groqAvailable()) {
    try {
      const windowHours = body.type === "daily" ? 24 : body.type === "weekly" ? 168 : 24;
      const since = new Date(Date.now() - windowHours * 3_600_000);

      const recentEvents = await db.select().from(securityEventsTable)
        .where(gte(securityEventsTable.createdAt, since))
        .orderBy(desc(securityEventsTable.createdAt)).limit(200);

      const byType: Record<string, number> = {};
      const bySourceIp: Record<string, number> = {};
      const bySeverity: Record<string, number> = {};
      for (const e of recentEvents) {
        byType[e.type]         = (byType[e.type] ?? 0) + 1;
        bySourceIp[e.sourceIp] = (bySourceIp[e.sourceIp] ?? 0) + 1;
        bySeverity[e.severity] = (bySeverity[e.severity] ?? 0) + 1;
      }

      const topAttackers = Object.entries(bySourceIp).sort(([,a],[,b])=>b-a).slice(0,5)
        .map(([ip,n]) => `${ip} (${n} events)`).join(", ");
      const attackTypes = Object.entries(byType).sort(([,a],[,b])=>b-a)
        .map(([t,n]) => `${t}: ${n}`).join(", ");
      const sevBreakdown = Object.entries(bySeverity).map(([s,n])=>`${s}:${n}`).join(", ");

      const aiPrompt = `
REPORT TYPE: ${body.type.toUpperCase()} — "${body.title}"
TIME WINDOW: last ${windowHours} hours
Total events: ${recentEvents.length} | Incidents: ${incidentsCount}
Severity: ${sevBreakdown || "no data"}
Attack types: ${attackTypes || "no data"}
Top attackers: ${topAttackers || "no data"}

Write a ${body.type} SOC report summary with these sections:
THREAT SUMMARY | TOP THREATS | DEFENSE STATUS | RECOMMENDATIONS
Max 500 words. Burmese language mixed with English technical terms.
`.trim();

      summary = await askGroq({
        system: `သင်သည် AEGIS-AI SOC analyst ဖြစ်သည်။ Professional security report ကို မြန်မာဘာသာ (Burmese) ဖြင့် ရေးပါ — technical terms သာ English သုံးပါ။ Markdown # headers မသုံးပါနှင့်။
Lab: bank-web 10.10.10.10 (DMZ), customer-db 10.20.20.20 (Internal), AEGIS VM 10.30.30.10 (MGMT), pfSense 10.30.30.1 (Firewall).
အရေးကြီး: Attacker သည် မည်သည့် IP မဆို ဖြစ်နိုင်သည် — IP range ကို မယူဆပါနှင့်။ Report ပြည့်ပြည့်စုံစုံ ဖြစ်ပါစေ — sentence ကြားမှာ မဖြတ်ပါနှင့်။`,
        user: aiPrompt,
        maxTokens: 800,
      });
      aiGenerated = true;
    } catch (err: any) {
      console.warn("AI report generation failed, using template:", err?.message);
      summary = templateSummary;
    }
  }

  const [row] = await db.insert(reportsTable).values({
    title:          body.title,
    type:           body.type,
    format:         body.format,
    summary,
    eventsCount,
    incidentsCount,
  }).returning();

  const [report] = await db.select().from(reportsTable).where(eq(reportsTable.id, row.id));
  res.status(201).json({ ...report, generatedAt: report.generatedAt.toISOString(), aiGenerated });
});

router.get("/reports/:id/download", async (req, res) => {
  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [report] = await db.select().from(reportsTable).where(eq(reportsTable.id, id));
  if (!report) { res.status(404).json({ error: "Report not found" }); return; }

  const recentEvents = await db.select().from(securityEventsTable)
    .orderBy(desc(securityEventsTable.createdAt)).limit(50);
  const recentIncidents = await db.select().from(incidentsTable)
    .orderBy(desc(incidentsTable.createdAt)).limit(20);

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>${report.title}</title>
<style>
  body { font-family: monospace; background: #0a0f1a; color: #e5e7eb; margin: 0; padding: 32px; }
  h1 { color: #22d3ee; text-transform: uppercase; letter-spacing: 4px; border-bottom: 1px solid #1f2937; padding-bottom: 12px; }
  h2 { color: #94a3b8; text-transform: uppercase; letter-spacing: 2px; font-size: 14px; margin-top: 32px; }
  .meta { color: #6b7280; font-size: 12px; margin-bottom: 24px; }
  .summary { background: #111827; border: 1px solid #1f2937; border-radius: 6px; padding: 16px; margin: 16px 0; line-height: 1.6; }
  .stats { display: flex; gap: 24px; margin: 16px 0; }
  .stat { background: #111827; border: 1px solid #1f2937; border-radius: 6px; padding: 16px 24px; text-align: center; }
  .stat-num { font-size: 36px; font-weight: bold; color: #22d3ee; }
  .stat-label { font-size: 11px; color: #6b7280; text-transform: uppercase; letter-spacing: 1px; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; margin-top: 8px; }
  th { text-align: left; padding: 8px 12px; color: #6b7280; border-bottom: 1px solid #1f2937; font-size: 10px; text-transform: uppercase; letter-spacing: 1px; }
  td { padding: 8px 12px; border-bottom: 1px solid #1f2937; }
  .critical { color: #f87171; } .high { color: #fb923c; } .medium { color: #fbbf24; } .low { color: #4ade80; }
  .tag { display: inline-block; background: #1f2937; border: 1px solid #374151; border-radius: 4px; padding: 2px 8px; font-size: 10px; }
  footer { margin-top: 48px; color: #374151; font-size: 11px; border-top: 1px solid #1f2937; padding-top: 16px; }
</style>
</head>
<body>
<h1>⚡ AEGIS SOC — ${report.title}</h1>
<div class="meta">
  Generated: ${new Date(report.generatedAt).toISOString()} &nbsp;|&nbsp;
  Type: ${report.type.toUpperCase()} &nbsp;|&nbsp;
  Format: ${report.format.toUpperCase()} &nbsp;|&nbsp;
  Report ID: #${report.id}
</div>

<div class="summary">${report.summary}</div>

<div class="stats">
  <div class="stat">
    <div class="stat-num">${report.eventsCount}</div>
    <div class="stat-label">Security Events</div>
  </div>
  <div class="stat">
    <div class="stat-num">${report.incidentsCount}</div>
    <div class="stat-label">Incidents</div>
  </div>
</div>

${recentEvents.length > 0 ? `
<h2>Recent Security Events (last 50)</h2>
<table>
  <tr><th>Time</th><th>Type</th><th>Subtype</th><th>Severity</th><th>Source IP</th><th>Target</th><th>Status</th></tr>
  ${recentEvents.map(e => `
  <tr>
    <td>${new Date(e.createdAt).toISOString().slice(0, 19).replace("T", " ")}</td>
    <td class="tag">${e.type}</td>
    <td>${e.subtype}</td>
    <td class="${e.severity}">${e.severity.toUpperCase()}</td>
    <td style="color:#22d3ee;font-family:monospace">${e.sourceIp}</td>
    <td style="font-family:monospace">${e.targetHost}</td>
    <td>${e.status}</td>
  </tr>`).join("")}
</table>` : "<h2>Recent Security Events</h2><p style='color:#6b7280'>No events recorded in this period.</p>"}

${recentIncidents.length > 0 ? `
<h2>Incidents (last 20)</h2>
<table>
  <tr><th>ID</th><th>Title</th><th>Severity</th><th>Status</th><th>Responder</th><th>Events</th><th>Created</th></tr>
  ${recentIncidents.map(i => `
  <tr>
    <td style="font-family:monospace;color:#6b7280">INC-${String(i.id).padStart(4,"0")}</td>
    <td>${i.title}</td>
    <td class="${i.severity}">${i.severity.toUpperCase()}</td>
    <td>${i.status}</td>
    <td>${i.responder ?? "—"}</td>
    <td>${i.eventCount}</td>
    <td>${new Date(i.createdAt).toISOString().slice(0, 16).replace("T", " ")}</td>
  </tr>`).join("")}
</table>` : "<h2>Incidents</h2><p style='color:#6b7280'>No incidents recorded in this period.</p>"}

<footer>AEGIS Tactical SOC — Confidential Security Report — Generated ${new Date().toUTCString()}</footer>
</body>
</html>`;

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="aegis-report-${report.id}-${report.type}.html"`);
  res.send(html);
});

router.delete("/reports/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  await db.delete(reportsTable).where(eq(reportsTable.id, id));
  res.json({ success: true });
});

export default router;
