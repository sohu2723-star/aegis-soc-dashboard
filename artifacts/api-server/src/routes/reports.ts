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

မြန်မာဘာသာဖြင့် SOC report ပြည့်ပြည့်စုံစုံ ရေးပါ — section တိုင်း ပြည့်ပြည့်စုံစုံ ဖြည့်ပြပါ:

ခြိမ်းခြောက်မှု အကျဉ်းချုပ် (Threat Summary):
(ဘယ် IP တွေ ဘာ attack တွေ မည်မျှ ကြိမ် လုပ်ခဲ့သလဲ — အပြည့်အစုံ)

အပြင်းထန်ဆုံး ခြိမ်းခြောက်မှုများ (Top Threats):
(top attacker IP တစ်ခုချင်းစီ — attack type, severity, target, ကြိမ်ရေ)

Defense အခြေအနေ (Defense Status):
(ဘာ block လုပ်ပြီးပြီ၊ pending ကျန်နေသေးတာ)

ထောက်ပံ့ချက်များ (Recommendations):
(အနည်းဆုံး ၅ ချက် — တစ်ချက်ချင်းစီ တိကျသော command ပါဝင်)
`.trim();

      summary = await askGroq({
        system: `သင်သည် AEGIS-AI SOC analyst ဖြစ်သည်။ Professional security report ကို မြန်မာဘာသာ (Burmese) ဖြင့် ရေးပါ — technical terms နှင့် IP address သာ English သုံးပါ။ Markdown # headers မသုံးပါနှင့်။
Lab: bank-web 10.10.10.10 (DMZ), customer-db 10.20.20.20 (Internal), AEGIS VM 10.30.30.10 (MGMT), pfSense 10.30.30.1 (Firewall).
STRICT RULES: (1) IP address နှင့် number အားလုံး English digits သာ — မြန်မာဂဏန်း လုံးဝ မသုံးရ။ (2) Response ကို sentence အလယ်မှာ မဖြတ်ရ — sections အားလုံး ပြည့်ပြည့်စုံစုံ ပြောပြီးမှ ဆုံးရမည်။ (3) Attacker သည် မည်သည့် IP မဆို ဖြစ်နိုင်သည် — IP range ကို မယူဆပါနှင့်။`,
        user: aiPrompt,
        maxTokens: 2500,
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

  // ── Severity counts across recent events ───────────────────────────────────
  const sevCounts = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const e of recentEvents) {
    const s = e.severity as keyof typeof sevCounts;
    if (s in sevCounts) sevCounts[s]++;
  }

  // ── Top attacker IPs ────────────────────────────────────────────────────────
  const ipCounts: Record<string, number> = {};
  for (const e of recentEvents) ipCounts[e.sourceIp] = (ipCounts[e.sourceIp] ?? 0) + 1;
  const topAttackers = Object.entries(ipCounts).sort(([,a],[,b]) => b - a).slice(0, 5);

  const generatedAt = new Date(report.generatedAt);
  const genStr = generatedAt.toLocaleString("en-GB", { dateStyle: "full", timeStyle: "short" });

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>AEGIS SOC Report — ${report.title}</title>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  :root {
    --bg:        #05080f;
    --surface:   #0d1117;
    --surface2:  #161b22;
    --border:    #21262d;
    --primary:   #22d3ee;
    --primary-d: #0891b2;
    --text:      #e6edf3;
    --muted:     #7d8590;
    --red:       #f87171;
    --orange:    #fb923c;
    --yellow:    #fbbf24;
    --green:     #4ade80;
  }

  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    background: var(--bg);
    color: var(--text);
    font-size: 13px;
    line-height: 1.6;
    min-height: 100vh;
  }

  /* ── Page layout ── */
  .page { max-width: 1100px; margin: 0 auto; padding: 40px 32px 64px; }

  /* ── Cover / header ── */
  .cover {
    display: flex; align-items: flex-start; justify-content: space-between;
    border-bottom: 1px solid var(--border);
    padding-bottom: 28px; margin-bottom: 32px;
  }
  .cover-logo {
    display: flex; align-items: center; gap: 12px;
  }
  .logo-icon {
    width: 42px; height: 42px; border-radius: 10px;
    background: linear-gradient(135deg, var(--primary-d), var(--primary));
    display: flex; align-items: center; justify-content: center;
    font-size: 22px; flex-shrink: 0;
  }
  .logo-text { line-height: 1.2; }
  .logo-title { font-size: 22px; font-weight: 700; letter-spacing: 4px; color: var(--primary); text-transform: uppercase; }
  .logo-sub { font-size: 10px; color: var(--muted); letter-spacing: 2px; text-transform: uppercase; margin-top: 1px; }
  .cover-meta { text-align: right; font-size: 11px; color: var(--muted); line-height: 1.8; }
  .cover-meta strong { color: var(--text); }
  .classify-banner {
    background: linear-gradient(90deg, #1c0a0a, #1f1010, #1c0a0a);
    border: 1px solid #5f2020;
    border-radius: 6px; text-align: center;
    padding: 6px 20px; font-size: 10px; font-weight: 700;
    letter-spacing: 4px; text-transform: uppercase; color: #fca5a5;
    margin-bottom: 28px;
  }

  /* ── Report title block ── */
  .report-title-block { margin-bottom: 32px; }
  .report-title-block h1 {
    font-size: 26px; font-weight: 700; color: var(--text);
    letter-spacing: -0.3px; margin-bottom: 4px;
  }
  .report-subtitle { font-size: 12px; color: var(--muted); }
  .report-type-badge {
    display: inline-block; margin-top: 8px;
    background: var(--primary-d); color: #fff;
    font-size: 10px; font-weight: 700; letter-spacing: 2px;
    text-transform: uppercase; border-radius: 4px; padding: 3px 10px;
  }

  /* ── Section ── */
  .section { margin-bottom: 36px; }
  .section-title {
    font-size: 10px; font-weight: 700; letter-spacing: 3px; text-transform: uppercase;
    color: var(--muted); border-bottom: 1px solid var(--border);
    padding-bottom: 8px; margin-bottom: 16px;
    display: flex; align-items: center; gap: 8px;
  }
  .section-title::before { content: ""; display: block; width: 3px; height: 14px; background: var(--primary); border-radius: 2px; }

  /* ── Stats grid ── */
  .stats-grid { display: grid; grid-template-columns: repeat(6, 1fr); gap: 12px; margin-bottom: 32px; }
  .stat-card {
    background: var(--surface); border: 1px solid var(--border); border-radius: 8px;
    padding: 16px 12px; text-align: center;
  }
  .stat-card.accent { border-color: var(--primary-d); background: rgba(8,145,178,0.07); }
  .stat-num { font-size: 30px; font-weight: 700; line-height: 1; font-variant-numeric: tabular-nums; }
  .stat-label { font-size: 9px; color: var(--muted); text-transform: uppercase; letter-spacing: 1px; margin-top: 4px; }
  .c-primary  { color: var(--primary); }
  .c-red      { color: var(--red); }
  .c-orange   { color: var(--orange); }
  .c-yellow   { color: var(--yellow); }
  .c-green    { color: var(--green); }
  .c-muted    { color: var(--muted); }

  /* ── Summary box ── */
  .summary-box {
    background: var(--surface); border: 1px solid var(--border); border-radius: 8px;
    padding: 20px 24px; line-height: 1.8; color: var(--text); font-size: 13px;
    white-space: pre-wrap;
  }

  /* ── Two-column grid ── */
  .two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }

  /* ── Attacker list ── */
  .attacker-list { list-style: none; }
  .attacker-list li {
    display: flex; align-items: center; justify-content: space-between;
    padding: 7px 0; border-bottom: 1px solid var(--border); font-size: 12px;
  }
  .attacker-list li:last-child { border-bottom: none; }
  .attacker-ip { font-family: "Courier New", monospace; color: var(--primary); }
  .attacker-bar-wrap { flex: 1; margin: 0 12px; height: 4px; background: var(--border); border-radius: 2px; }
  .attacker-bar { height: 4px; background: linear-gradient(90deg, var(--primary-d), var(--primary)); border-radius: 2px; }
  .attacker-count { font-size: 11px; color: var(--muted); white-space: nowrap; font-variant-numeric: tabular-nums; }

  /* ── Tables ── */
  .table-wrap { overflow-x: auto; border-radius: 8px; border: 1px solid var(--border); }
  table { width: 100%; border-collapse: collapse; font-size: 12px; }
  thead { background: var(--surface2); }
  th {
    text-align: left; padding: 9px 12px;
    color: var(--muted); font-size: 9px; font-weight: 700;
    text-transform: uppercase; letter-spacing: 1.5px;
    border-bottom: 1px solid var(--border); white-space: nowrap;
  }
  td { padding: 8px 12px; border-bottom: 1px solid var(--border); vertical-align: middle; }
  tr:last-child td { border-bottom: none; }
  tbody tr:hover { background: rgba(34, 211, 238, 0.03); }

  .mono { font-family: "Courier New", monospace; }
  .sev-badge {
    display: inline-block; font-size: 9px; font-weight: 700;
    letter-spacing: 1px; text-transform: uppercase;
    padding: 2px 7px; border-radius: 3px;
  }
  .sev-critical { background: rgba(248,113,113,0.15); color: var(--red);    border: 1px solid rgba(248,113,113,0.3); }
  .sev-high     { background: rgba(251,146,60,0.15);  color: var(--orange); border: 1px solid rgba(251,146,60,0.3); }
  .sev-medium   { background: rgba(251,191,36,0.15);  color: var(--yellow); border: 1px solid rgba(251,191,36,0.3); }
  .sev-low      { background: rgba(74,222,128,0.15);  color: var(--green);  border: 1px solid rgba(74,222,128,0.3); }
  .type-tag {
    display: inline-block; background: var(--surface2); border: 1px solid var(--border);
    border-radius: 4px; padding: 1px 7px; font-size: 10px; font-family: "Courier New", monospace; color: var(--muted);
  }
  .status-tag {
    display: inline-block; font-size: 9px; font-weight: 600;
    padding: 2px 7px; border-radius: 3px; text-transform: uppercase; letter-spacing: 1px;
  }
  .status-blocked  { background: rgba(74,222,128,0.1);  color: var(--green);  border: 1px solid rgba(74,222,128,0.25); }
  .status-detected { background: rgba(251,146,60,0.1);  color: var(--orange); border: 1px solid rgba(251,146,60,0.25); }
  .status-other    { background: var(--surface2); color: var(--muted); border: 1px solid var(--border); }
  .inc-id   { font-family: "Courier New", monospace; color: var(--muted); font-size: 11px; }
  .inc-open { color: var(--orange); } .inc-closed { color: var(--green); }
  .empty-state { padding: 32px; text-align: center; color: var(--muted); font-size: 12px; }

  /* ── Footer ── */
  .footer {
    margin-top: 48px; border-top: 1px solid var(--border); padding-top: 20px;
    display: flex; align-items: center; justify-content: space-between;
    font-size: 10px; color: var(--muted);
  }
  .footer-left { display: flex; align-items: center; gap: 8px; }
  .footer-dot { width: 5px; height: 5px; border-radius: 50%; background: var(--primary); display: inline-block; }

  @media print {
    body { background: #fff; color: #1a1a1a; }
    :root { --bg: #fff; --surface: #f8f8f8; --surface2: #f0f0f0; --border: #ddd;
      --text: #111; --muted: #666; }
    .classify-banner { border-color: #f44; color: #c00; background: #fff0f0; }
    .attacker-bar { background: var(--primary-d); }
    th { background: #f0f0f0; }
    .logo-title { color: var(--primary-d); }
  }
</style>
</head>
<body>
<div class="page">

  <!-- Cover -->
  <div class="cover">
    <div class="cover-logo">
      <div class="logo-icon">⚡</div>
      <div class="logo-text">
        <div class="logo-title">AEGIS</div>
        <div class="logo-sub">Security Operations Center</div>
      </div>
    </div>
    <div class="cover-meta">
      <div><strong>Report ID</strong> &nbsp;#${report.id}</div>
      <div><strong>Generated</strong> &nbsp;${genStr}</div>
      <div><strong>Period</strong> &nbsp;${report.type.charAt(0).toUpperCase() + report.type.slice(1)}</div>
      <div><strong>Format</strong> &nbsp;${report.format.toUpperCase()}</div>
    </div>
  </div>

  <!-- Classify banner -->
  <div class="classify-banner">⬛ Confidential — Internal SOC Use Only ⬛</div>

  <!-- Report title -->
  <div class="report-title-block">
    <h1>${report.title}</h1>
    <div class="report-subtitle">AEGIS Tactical Security Operations Report</div>
    <span class="report-type-badge">${report.type}</span>
  </div>

  <!-- Stats -->
  <div class="stats-grid">
    <div class="stat-card accent">
      <div class="stat-num c-primary">${report.eventsCount}</div>
      <div class="stat-label">Total Events</div>
    </div>
    <div class="stat-card">
      <div class="stat-num c-red">${sevCounts.critical}</div>
      <div class="stat-label">Critical</div>
    </div>
    <div class="stat-card">
      <div class="stat-num c-orange">${sevCounts.high}</div>
      <div class="stat-label">High</div>
    </div>
    <div class="stat-card">
      <div class="stat-num c-yellow">${sevCounts.medium}</div>
      <div class="stat-label">Medium</div>
    </div>
    <div class="stat-card">
      <div class="stat-num c-green">${sevCounts.low}</div>
      <div class="stat-label">Low</div>
    </div>
    <div class="stat-card">
      <div class="stat-num c-muted">${report.incidentsCount}</div>
      <div class="stat-label">Incidents</div>
    </div>
  </div>

  <!-- AI Summary -->
  <div class="section">
    <div class="section-title">Executive Summary</div>
    <div class="summary-box">${report.summary}</div>
  </div>

  <!-- Two-col: top attackers + incident breakdown -->
  <div class="two-col section">
    <!-- Top Attackers -->
    <div>
      <div class="section-title">Top Attacker IPs</div>
      ${topAttackers.length > 0 ? `
      <ul class="attacker-list">
        ${topAttackers.map(([ip, count], idx) => {
          const pct = topAttackers[0][1] > 0 ? Math.round((count / topAttackers[0][1]) * 100) : 0;
          const rank = ["🥇","🥈","🥉","4️⃣","5️⃣"][idx] ?? "";
          return `
        <li>
          <span class="attacker-ip">${rank} ${ip}</span>
          <span class="attacker-bar-wrap"><span class="attacker-bar" style="width:${pct}%"></span></span>
          <span class="attacker-count">${count} events</span>
        </li>`;
        }).join("")}
      </ul>` : `<p class="empty-state">No attack data</p>`}
    </div>

    <!-- Recent Incidents -->
    <div>
      <div class="section-title">Incidents (${recentIncidents.length})</div>
      ${recentIncidents.length > 0 ? `
      <ul class="attacker-list">
        ${recentIncidents.slice(0,5).map(i => `
        <li>
          <span style="display:flex;flex-direction:column;gap:2px;min-width:0">
            <span style="font-size:12px;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${i.title}</span>
            <span class="inc-id">INC-${String(i.id).padStart(4,"0")} · ${new Date(i.createdAt).toISOString().slice(0,10)}</span>
          </span>
          <span class="sev-badge sev-${i.severity}">${i.severity}</span>
        </li>`).join("")}
      </ul>` : `<p class="empty-state">No incidents</p>`}
    </div>
  </div>

  <!-- Events table -->
  <div class="section">
    <div class="section-title">Security Events Log — Last ${recentEvents.length} Events</div>
    ${recentEvents.length > 0 ? `
    <div class="table-wrap">
    <table>
      <thead>
        <tr>
          <th>Timestamp</th>
          <th>Severity</th>
          <th>Type</th>
          <th>Subtype</th>
          <th>Source IP</th>
          <th>Target</th>
          <th>Tool</th>
          <th>Status</th>
        </tr>
      </thead>
      <tbody>
        ${recentEvents.map(e => {
          const ts = new Date(e.createdAt).toISOString().slice(0,19).replace("T"," ");
          const statusCls = e.status === "blocked" ? "status-blocked" : e.status === "detected" ? "status-detected" : "status-other";
          return `
        <tr>
          <td class="mono" style="font-size:11px;color:var(--muted)">${ts}</td>
          <td><span class="sev-badge sev-${e.severity}">${e.severity}</span></td>
          <td><span class="type-tag">${e.type}</span></td>
          <td style="max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${e.subtype}</td>
          <td class="mono" style="color:var(--primary)">${e.sourceIp}</td>
          <td class="mono" style="color:var(--muted)">${e.targetHost}</td>
          <td style="color:var(--muted);font-size:11px">${e.toolUsed ?? "—"}</td>
          <td><span class="status-tag ${statusCls}">${e.status}</span></td>
        </tr>`;
        }).join("")}
      </tbody>
    </table>
    </div>` : `<div class="empty-state">No events recorded in this period.</div>`}
  </div>

  <!-- Incidents table -->
  ${recentIncidents.length > 0 ? `
  <div class="section">
    <div class="section-title">Incident Register</div>
    <div class="table-wrap">
    <table>
      <thead>
        <tr>
          <th>ID</th>
          <th>Title</th>
          <th>Severity</th>
          <th>Status</th>
          <th>Responder</th>
          <th style="text-align:right">Events</th>
          <th>Created</th>
          <th>Updated</th>
        </tr>
      </thead>
      <tbody>
        ${recentIncidents.map(i => {
          const statusCls = i.status === "closed" ? "inc-closed" : "inc-open";
          return `
        <tr>
          <td class="inc-id">INC-${String(i.id).padStart(4,"0")}</td>
          <td style="font-weight:600;max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${i.title}</td>
          <td><span class="sev-badge sev-${i.severity}">${i.severity}</span></td>
          <td class="${statusCls}" style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:1px">${i.status}</td>
          <td style="color:var(--muted)">${i.responder ?? "—"}</td>
          <td style="text-align:right;font-variant-numeric:tabular-nums;color:var(--muted)">${i.eventCount}</td>
          <td style="color:var(--muted);font-size:11px">${new Date(i.createdAt).toISOString().slice(0,16).replace("T"," ")}</td>
          <td style="color:var(--muted);font-size:11px">${new Date(i.updatedAt).toISOString().slice(0,16).replace("T"," ")}</td>
        </tr>`;
        }).join("")}
      </tbody>
    </table>
    </div>
  </div>` : ""}

  <!-- Footer -->
  <div class="footer">
    <div class="footer-left">
      <span class="footer-dot"></span>
      AEGIS Tactical SOC &nbsp;·&nbsp; Report #${report.id} &nbsp;·&nbsp; ${report.type.toUpperCase()}
    </div>
    <div>Generated ${new Date().toUTCString()} &nbsp;·&nbsp; CONFIDENTIAL</div>
  </div>

</div>
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
