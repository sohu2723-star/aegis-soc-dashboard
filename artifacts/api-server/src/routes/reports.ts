import { Router } from "express";
import { db } from "@workspace/db";
import { reportsTable, securityEventsTable, incidentsTable } from "@workspace/db";
import { desc, count, eq, gte } from "drizzle-orm";
import { z } from "zod";
import { askGroq, groqAvailable } from "../lib/groq-client";
import { containsMyanmarText, englishArchivedTitle, ensureCompleteEnglishReport } from "../lib/report-language";

const router = Router();

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

router.get("/reports", async (_req, res) => {
  const reports = await db.select().from(reportsTable).orderBy(desc(reportsTable.generatedAt));
  res.json(reports.map(r => ({
    ...r,
    title: englishArchivedTitle(r.title, r.generatedAt, r.type),
    summary: containsMyanmarText(r.summary)
      ? "This archived report contains legacy non-English AI text. Download the report for an English evidence-based fallback, or generate a new report."
      : r.summary,
    generatedAt: r.generatedAt.toISOString(),
  })));
});

const generateReportSchema = z.object({
  title:  z.string().trim().min(3).max(255)
    .regex(/^[\x20-\x7e]+$/, "Report title must use English/ASCII characters only"),
  type:   z.enum(["daily", "weekly", "incident", "custom"]),
  format: z.enum(["html", "pdf"]),
});

router.post("/reports/generate", async (req, res) => {
  const body = generateReportSchema.parse(req.body);

  // Always compute from the time window (not all-time total) so the card
  // count matches what the HTML download shows.
  const windowHours = body.type === "daily" ? 24 : body.type === "weekly" ? 168 : 24;
  const since = new Date(Date.now() - windowHours * 3_600_000);

  const [windowResult] = await db.select({ count: count() }).from(securityEventsTable)
    .where(gte(securityEventsTable.createdAt, since));
  const eventsCount = Number(windowResult?.count ?? 0);

  // Fallback template summary with ## sections so the HTML renders styled blocks
  const templateSummary =
`## Incident Summary
${body.type.charAt(0).toUpperCase() + body.type.slice(1)} security report covering the last ${windowHours} hours. Total events recorded: ${eventsCount}. No critical threats requiring immediate escalation were detected during this period.

## Key Threats
No high-priority threats requiring immediate escalation. Routine monitoring active across all sensors in the last ${windowHours} hours.

## Defense Actions
All automated defenses remain active: Suricata IDS (pfSense), Fail2ban banning, SSH monitoring, Web attack detection, and iptables Firewall rules on all company VMs.

## Recommendations
1. Review Fail2ban jail logs on each company server for repeat attacker IPs.
2. Verify Suricata IDS rule set is up to date on pfSense.
3. Check SSH authorized_keys on all VMs — remove any unauthorized entries.
4. Monitor DNS query logs on company-dns-server for tunneling or exfiltration attempts.
5. Ensure all LDAP bind operations are logged and forwarded to AEGIS.`;

  let summary = templateSummary;
  let aiGenerated = false;

  // Try AI analysis if Groq is configured
  if (groqAvailable()) {
    try {

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
AEGIS SOC SECURITY BRIEFING DATA
REPORT TYPE: ${body.type.toUpperCase()} — "${body.title}"
TIME WINDOW: last ${windowHours} hours
Total events: ${recentEvents.length}
Severity: ${sevBreakdown || "no data"}
Attack types: ${attackTypes || "no data"}
Top attackers: ${topAttackers || "no data"}

Write a professional English security briefing. Fill every section fully:

## Incident Summary
(What attacks occurred in the last ${windowHours} hours — direct narrative)

## Key Threats
(One line per top attacker IP — attack type, target host, event count — active voice)

## Defense Actions
(What was blocked, what is pending — specific and actionable)

## Recommendations
(At least 5 specific steps with commands where applicable)
`.trim();

      const generatedSummary = await askGroq({
        system: `You are AEGIS-AI, a professional cybersecurity SOC analyst.
Lab: company-web-server 10.10.10.10, company-dns-server 10.10.10.20, company-customer-db 10.20.20.10, company-ldap-server 10.20.20.20, pfSense 10.30.30.1.
RULES:
- Write in clear, professional English — live SOC briefing style
- Active voice: "attacked", "attempted to breach" — never passive
- Section headings: ## format (## Incident Summary, ## Key Threats, ## Defense Actions, ## Recommendations)
- Use English digits only for IPs, ports, counts
- Never cut mid-sentence — complete every section fully`,
        user: aiPrompt,
        maxTokens: 4000,
        temperature: 0.15,
        topP: 0.85,
      });
      summary = ensureCompleteEnglishReport(generatedSummary, templateSummary);
      aiGenerated = summary === generatedSummary.trim();
    } catch (err: any) {
      console.warn("AI report generation failed, using template:", err?.message);
      summary = templateSummary;
    }
  }

  const [row] = await db.insert(reportsTable).values({
    title:   body.title,
    type:    body.type,
    format:  body.format,
    summary,
    eventsCount,
    incidentsCount: 0,
  }).returning();

  const [report] = await db.select().from(reportsTable).where(eq(reportsTable.id, row.id));
  res.status(201).json({ ...report, generatedAt: report.generatedAt.toISOString(), aiGenerated });
});

router.get("/reports/:id/download", async (req, res) => {
  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [report] = await db.select().from(reportsTable).where(eq(reportsTable.id, id));
  if (!report) { res.status(404).json({ error: "Report not found" }); return; }

  // ── Determine report time window ────────────────────────────────────────────
  const windowHoursMap: Record<string, number> = { daily: 24, weekly: 168, incident: 24, custom: 24 };
  const windowHours = windowHoursMap[report.type] ?? 24;
  const windowSince = new Date(new Date(report.generatedAt).getTime() - windowHours * 3_600_000);

  // Full window for severity/type counts
  const windowEvents = await db.select().from(securityEventsTable)
    .where(gte(securityEventsTable.createdAt, windowSince))
    .orderBy(desc(securityEventsTable.createdAt))
    .limit(500);

  // Last 100 for the events table (most recent first)
  const recentEvents = windowEvents.slice(0, 100);

  // ── Severity counts from the full time window ───────────────────────────────
  const sevCounts = { critical: 0, high: 0, medium: 0, low: 0 };
  const typeCounts: Record<string, number> = {};
  for (const e of windowEvents) {
    const s = e.severity as keyof typeof sevCounts;
    if (s in sevCounts) sevCounts[s]++;
    typeCounts[e.type] = (typeCounts[e.type] ?? 0) + 1;
  }
  const totalWindowEvents = windowEvents.length;

  // ── Top attacker IPs ────────────────────────────────────────────────────────
  const ipCounts: Record<string, number> = {};
  for (const e of windowEvents) ipCounts[e.sourceIp] = (ipCounts[e.sourceIp] ?? 0) + 1;
  const topAttackers = Object.entries(ipCounts).sort(([,a],[,b]) => b - a).slice(0, 5);

  const generatedAt = new Date(report.generatedAt);
  const genStr = generatedAt.toLocaleString("en-GB", { dateStyle: "full", timeStyle: "short" });
  const displayTitle = englishArchivedTitle(report.title, generatedAt, report.type);
  const downloadFallback =
`## Incident Summary
This ${report.type} report covers the previous ${windowHours} hours and contains ${totalWindowEvents} security events. The recorded severity distribution is ${sevCounts.critical} critical, ${sevCounts.high} high, ${sevCounts.medium} medium and ${sevCounts.low} low events. Review the event log below for the authoritative evidence and timestamps.

## Key Threats
${topAttackers.length > 0
  ? topAttackers.map(([ip, n]) => `${ip} generated ${n} recorded events during this reporting window.`).join("\n")
  : "No attacker IP activity was recorded during this reporting window."}

## Defense Actions
This legacy report did not preserve a complete English AI defense narrative. Use the Defense Rules command history to verify executed, pending and failed actions; do not infer successful blocking from detection events alone.

## Recommendations
1. Review all critical and high events in the security event table.
2. Validate current pfSense EasyRule and Linux iptables state against the listed attacker IPs.
3. Investigate the top attacker IPs and affected targets.
4. Confirm that pending or failed defense commands have been resolved.
5. Generate a new English AI report for a current evidence-based analysis.`;
  const displaySummary = ensureCompleteEnglishReport(report.summary, downloadFallback);

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>AEGIS SOC Report — ${escapeHtml(displayTitle)}</title>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  :root {
    --bg:        #202630;
    --surface:   #29313d;
    --surface2:  #343d4a;
    --border:    #3b4654;
    --primary:   #4fa3a5;
    --primary-d: #3c7f82;
    --text:      #e2e6ea;
    --muted:     #aab3be;
    --red:       #c56b70;
    --orange:    #c58f5a;
    --yellow:    #c5a45a;
    --green:     #6faf82;
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
    background: linear-gradient(90deg, #2c2326, #332a2d, #2c2326);
    border: 1px solid #6b4a4e;
    border-radius: 6px; text-align: center;
    padding: 6px 20px; font-size: 10px; font-weight: 700;
    letter-spacing: 4px; text-transform: uppercase; color: #d8a8ab;
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
  .stat-card.accent { border-color: var(--primary-d); background: rgba(60,127,130,0.10); }
  .stat-num { font-size: 30px; font-weight: 700; line-height: 1; font-variant-numeric: tabular-nums; }
  .stat-label { font-size: 9px; color: var(--muted); text-transform: uppercase; letter-spacing: 1px; margin-top: 4px; }
  .c-primary  { color: var(--primary); }
  .c-red      { color: var(--red); }
  .c-orange   { color: var(--orange); }
  .c-yellow   { color: var(--yellow); }
  .c-green    { color: var(--green); }
  .c-muted    { color: var(--muted); }

  /* ── Summary box / AI briefing ── */
  .summary-box {
    background: var(--surface); border: 1px solid var(--border); border-radius: 8px;
    padding: 20px 24px; line-height: 1.8; color: var(--text); font-size: 13px;
  }
  .summary-section { margin-bottom: 20px; }
  .summary-section:last-child { margin-bottom: 0; }
  .summary-heading {
    font-size: 9px; font-weight: 700; letter-spacing: 3px; text-transform: uppercase;
    color: var(--primary); border-bottom: 1px solid rgba(79,163,165,0.25);
    padding-bottom: 6px; margin-bottom: 10px;
    display: flex; align-items: center; gap: 8px;
  }
  .summary-heading::before { content: ""; display: block; width: 3px; height: 12px; background: var(--primary); border-radius: 2px; }
  .summary-body { color: var(--text); line-height: 1.85; font-size: 13px; white-space: pre-wrap; }

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
  tbody tr:hover { background: rgba(79, 163, 165, 0.06); }

  .mono { font-family: "Courier New", monospace; }
  .sev-badge {
    display: inline-block; font-size: 9px; font-weight: 700;
    letter-spacing: 1px; text-transform: uppercase;
    padding: 2px 7px; border-radius: 3px;
  }
  .sev-critical { background: rgba(197,107,112,0.18); color: var(--red);    border: 1px solid rgba(197,107,112,0.36); }
  .sev-high     { background: rgba(197,143,90,0.18);  color: var(--orange); border: 1px solid rgba(197,143,90,0.36); }
  .sev-medium   { background: rgba(197,164,90,0.18);  color: var(--yellow); border: 1px solid rgba(197,164,90,0.36); }
  .sev-low      { background: rgba(111,175,130,0.18);  color: var(--green);  border: 1px solid rgba(111,175,130,0.36); }
  .type-tag {
    display: inline-block; background: var(--surface2); border: 1px solid var(--border);
    border-radius: 4px; padding: 1px 7px; font-size: 10px; font-family: "Courier New", monospace; color: var(--muted);
  }
  .status-tag {
    display: inline-block; font-size: 9px; font-weight: 600;
    padding: 2px 7px; border-radius: 3px; text-transform: uppercase; letter-spacing: 1px;
  }
  .status-blocked  { background: rgba(111,175,130,0.12);  color: var(--green);  border: 1px solid rgba(111,175,130,0.30); }
  .status-detected { background: rgba(197,143,90,0.12);  color: var(--orange); border: 1px solid rgba(197,143,90,0.30); }
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
    <h1>${escapeHtml(displayTitle)}</h1>
    <div class="report-subtitle">AEGIS Tactical Security Operations Report</div>
    <span class="report-type-badge">${report.type}</span>
  </div>

  <!-- Stats -->
  <div class="stats-grid">
    <div class="stat-card accent">
      <div class="stat-num c-primary">${totalWindowEvents}</div>
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
      <div class="stat-num c-muted">${windowHours}h</div>
      <div class="stat-label">Window</div>
    </div>
  </div>

  <!-- Attack type breakdown -->
  ${Object.keys(typeCounts).length > 0 ? `
  <div class="section">
    <div class="section-title">Attack Type Breakdown</div>
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:10px">
      ${Object.entries(typeCounts).sort(([,a],[,b])=>b-a).map(([type, n]) => {
        const pct = totalWindowEvents > 0 ? Math.round((n / totalWindowEvents) * 100) : 0;
        const colorMap: Record<string,string> = {
          web_attack:"#c56b70", ssh_brute:"#c58f5a", db_attack:"#c5a45a",
          dns_attack:"#4fa3a5", ldap_attack:"#8f82a6", ddos:"#b95c63",
          port_scan:"#7c83a8", mitm:"#b08a56", network_attack:"#7d8791",
          auth_event:"#6faf82", api_attack:"#5f9da1",
        };
        const col = colorMap[type] ?? "#7d8791";
        return `<div style="background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:12px">
          <div style="font-size:10px;font-family:'Courier New',monospace;color:${col};font-weight:700;margin-bottom:6px">${type}</div>
          <div style="font-size:22px;font-weight:700;color:var(--text);font-variant-numeric:tabular-nums">${n}</div>
          <div style="height:4px;background:var(--border);border-radius:2px;margin-top:8px">
            <div style="height:4px;background:${col};border-radius:2px;width:${pct}%"></div>
          </div>
          <div style="font-size:9px;color:var(--muted);margin-top:4px">${pct}% of window</div>
        </div>`;
      }).join("")}
    </div>
  </div>` : ""}

  <!-- AI Summary — parsed into styled sections by ## headings -->
  <div class="section">
    <div class="section-title">AI Security Briefing</div>
    <div class="summary-box">
      ${(() => {
        const raw = displaySummary;
        // Split on ## headings; if no headings found, show as plain pre-wrap block
        const parts = raw.split(/^##\s*/m);
        if (parts.length <= 1) {
          return `<div class="summary-body">${raw.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")}</div>`;
        }
        // First part before any ## (if any)
        const intro = parts[0].trim();
        const sections = parts.slice(1);
        const introHtml = intro
          ? `<div class="summary-body" style="margin-bottom:16px">${intro.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")}</div>`
          : "";
        const sectionsHtml = sections.map(sec => {
          const nl = sec.indexOf("\n");
          const heading = nl === -1 ? sec.trim() : sec.slice(0, nl).trim();
          const body    = nl === -1 ? "" : sec.slice(nl + 1).trim();
          const escapedHeading = heading.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
          const escapedBody    = body.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
          return `<div class="summary-section">
            <div class="summary-heading">${escapedHeading}</div>
            ${escapedBody ? `<div class="summary-body">${escapedBody}</div>` : ""}
          </div>`;
        }).join("\n");
        return introHtml + sectionsHtml;
      })()}
    </div>
  </div>

  <!-- Top Attackers -->
  <div class="section">
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

  <!-- Events table -->
  <div class="section">
    <div class="section-title">Security Events Log — ${recentEvents.length} Events (${windowHours}h window)</div>
    ${recentEvents.length > 0 ? `
    <div class="table-wrap">
    <table>
      <thead>
        <tr>
          <th>Timestamp</th>
          <th>Severity</th>
          <th>Type</th>
          <th>Subtype / Description</th>
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
          const desc = (e.description ?? "").slice(0, 90);
          const escapedDesc = desc.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
          const escapedSub  = (e.subtype ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
          const escapedType = (e.type ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
          return `
        <tr>
          <td class="mono" style="font-size:11px;color:var(--muted);white-space:nowrap">${ts}</td>
          <td><span class="sev-badge sev-${e.severity}">${e.severity}</span></td>
          <td><span class="type-tag">${escapedType}</span></td>
          <td style="max-width:220px">
            <div style="font-weight:600;font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapedSub}</div>
            ${escapedDesc ? `<div style="font-size:10px;color:var(--muted);margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapedDesc}</div>` : ""}
          </td>
          <td class="mono" style="color:var(--primary);white-space:nowrap">${e.sourceIp}</td>
          <td class="mono" style="color:var(--muted);white-space:nowrap">${e.targetHost}</td>
          <td style="color:var(--muted);font-size:11px;white-space:nowrap">${e.toolUsed ?? "—"}</td>
          <td><span class="status-tag ${statusCls}">${e.status}</span></td>
        </tr>`;
        }).join("")}
      </tbody>
    </table>
    </div>` : `<div class="empty-state">No events recorded in this period.</div>`}
  </div>

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
