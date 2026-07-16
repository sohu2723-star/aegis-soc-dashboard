/**
 * AI Analysis Routes — powered by Groq (llama-3.3-70b-versatile).
 *
 *  GET  /ai/status              — check if Groq is configured
 *  GET  /ai/threat-analysis     — current security posture briefing
 *  POST /ai/defend              — defense recommendation for a specific IP
 *  GET  /ai/analyze-event/:id   — explain a single security event
 */
import { Router } from "express";
import { db, securityEventsTable, incidentsTable, alertsTable, defenseActionsTable } from "@workspace/db";
import { desc, eq, gte, count, sql } from "drizzle-orm";
import { askGroq, groqAvailable } from "../lib/groq-client";

const router = Router();

const SOC_SYSTEM = `You are AEGIS-AI, the AI analyst embedded in the AEGIS Tactical SOC Dashboard.
Lab network context:
- Ubuntu Defender: 10.10.10.10 (runs Fail2ban, Suricata, Cowrie honeypot)
- pfSense Firewall: 192.168.122.1 (WAN gateway)
- Bank-Web Server: 10.10.10.30
- Customer DB: 10.20.20.20
- Kali Linux attackers: typically 192.168.122.x range

Write like a professional SOC analyst. Be specific: name IPs, attack types, counts.
Be concise and actionable. No markdown # headers — use plain section labels in CAPS.
All response must be in Burmese (Myanmar language) mixed with English technical terms where needed.`;

// ─── Status ───────────────────────────────────────────────────────────────────

router.get("/ai/status", (_req, res) => {
  res.json({ available: groqAvailable(), model: "llama-3.3-70b-versatile" });
});

// ─── Threat Analysis ──────────────────────────────────────────────────────────

router.get("/ai/threat-analysis", async (_req, res) => {
  if (!groqAvailable()) {
    res.status(503).json({ error: "Groq API key not configured" });
    return;
  }

  try {
    const since24h = new Date(Date.now() - 24 * 3_600_000);

    // Aggregate data for the prompt
    const recentEvents = await db.select().from(securityEventsTable)
      .where(gte(securityEventsTable.createdAt, since24h))
      .orderBy(desc(securityEventsTable.createdAt))
      .limit(200);

    const openIncidents = await db.select().from(incidentsTable)
      .where(eq(incidentsTable.status, "open"));

    const unackedAlerts = await db.select({ count: count() }).from(alertsTable)
      .where(eq(alertsTable.acknowledged, false));

    const recentDefenseActions = await db.select().from(defenseActionsTable)
      .orderBy(desc(defenseActionsTable.createdAt)).limit(20);

    // Compute stats
    const bySeverity: Record<string, number> = {};
    const byType: Record<string, number> = {};
    const bySourceIp: Record<string, number> = {};
    const byTargetHost: Record<string, number> = {};

    for (const e of recentEvents) {
      bySeverity[e.severity]   = (bySeverity[e.severity] ?? 0) + 1;
      byType[e.type]           = (byType[e.type] ?? 0) + 1;
      bySourceIp[e.sourceIp]   = (bySourceIp[e.sourceIp] ?? 0) + 1;
      byTargetHost[e.targetHost] = (byTargetHost[e.targetHost] ?? 0) + 1;
    }

    const topAttackers = Object.entries(bySourceIp)
      .sort(([, a], [, b]) => b - a).slice(0, 5)
      .map(([ip, n]) => `${ip} (${n} events)`).join(", ");

    const topTargets = Object.entries(byTargetHost)
      .sort(([, a], [, b]) => b - a).slice(0, 5)
      .map(([h, n]) => `${h} (${n} events)`).join(", ");

    const attackTypes = Object.entries(byType)
      .sort(([, a], [, b]) => b - a)
      .map(([t, n]) => `${t}: ${n}`).join(", ");

    const severityBreakdown = Object.entries(bySeverity)
      .map(([s, n]) => `${s}: ${n}`).join(", ");

    const defenseActSummary = recentDefenseActions
      .slice(0, 5)
      .map(a => `${a.action} on ${a.targetIp} (${a.status})`).join("; ");

    const userPrompt = `
SECURITY DATA — LAST 24 HOURS

Total events: ${recentEvents.length}
Severity breakdown: ${severityBreakdown || "none"}
Attack types: ${attackTypes || "none"}
Top attackers: ${topAttackers || "none"}
Top targeted hosts: ${topTargets || "none"}
Open incidents: ${openIncidents.length}
Unacknowledged alerts: ${unackedAlerts[0]?.count ?? 0}
Recent defense actions: ${defenseActSummary || "none"}

Write a SOC threat briefing. Be concise — total under 220 words:
1. THREAT SUMMARY (2 sentences only)
2. TOP THREATS (top 3 threats, 1 line each with IP and type)
3. DEFENSE STATUS (2 sentences only)
4. RECOMMENDATIONS (exactly 3 numbered items, 1 sentence each)
`.trim();

    const analysis = await askGroq({ system: SOC_SYSTEM, user: userPrompt, maxTokens: 700 });

    res.json({
      analysis,
      generatedAt: new Date().toISOString(),
      dataPoints: {
        totalEvents: recentEvents.length,
        openIncidents: openIncidents.length,
        unackedAlerts: Number(unackedAlerts[0]?.count ?? 0),
        topAttackers: Object.entries(bySourceIp).sort(([,a],[,b])=>b-a).slice(0,5).map(([ip,n])=>({ip,count:n})),
      },
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Defense Recommendation for a specific IP ─────────────────────────────────

router.post("/ai/defend", async (req, res) => {
  if (!groqAvailable()) {
    res.status(503).json({ error: "Groq API key not configured" });
    return;
  }

  const { ip } = req.body as { ip?: string };
  if (!ip) { res.status(400).json({ error: "ip required" }); return; }

  try {
    const events = await db.select().from(securityEventsTable)
      .where(eq(securityEventsTable.sourceIp, ip))
      .orderBy(desc(securityEventsTable.createdAt))
      .limit(50);

    const defenseHistory = await db.select().from(defenseActionsTable)
      .where(eq(defenseActionsTable.targetIp, ip))
      .orderBy(desc(defenseActionsTable.createdAt))
      .limit(10);

    if (events.length === 0) {
      res.json({ recommendation: `IP ${ip} အတွက် event မရှိသေးဘူး — ဒီ IP က database မှာ မတွေ့ဘူး။`, ip });
      return;
    }

    const byType: Record<string, number> = {};
    const targets = new Set<string>();
    for (const e of events) {
      byType[e.type] = (byType[e.type] ?? 0) + 1;
      targets.add(e.targetHost);
    }

    const attackSummary = Object.entries(byType).map(([t,n]) => `${t}: ${n}x`).join(", ");
    const defenseHistory_str = defenseHistory.map(a => `${a.action} (${a.status})`).join(", ") || "none";
    const severities = [...new Set(events.map(e => e.severity))].join(", ");

    const userPrompt = `
ATTACKER IP: ${ip}
Total events from this IP: ${events.length}
Attack types: ${attackSummary}
Targeted hosts: ${[...targets].join(", ")}
Severity levels seen: ${severities}
Existing defense actions: ${defenseHistory_str}
First seen: ${events[events.length-1]?.createdAt?.toISOString?.() ?? "unknown"}
Last seen: ${events[0]?.createdAt?.toISOString?.() ?? "unknown"}

Write a defense recommendation. Be concise — total response under 200 words:
1. THREAT PROFILE (2 sentences only)
2. RISK LEVEL (Critical/High/Medium — 1 sentence only)
3. RECOMMENDED ACTIONS (exactly 3 numbered steps, each 1 sentence with command if needed)
4. MONITOR (2 bullet points only)
`.trim();

    const recommendation = await askGroq({ system: SOC_SYSTEM, user: userPrompt, maxTokens: 500 });

    res.json({ ip, recommendation, eventCount: events.length, attackTypes: byType, generatedAt: new Date().toISOString() });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Explain a single event ───────────────────────────────────────────────────

router.get("/ai/analyze-event/:id", async (req, res) => {
  if (!groqAvailable()) {
    res.status(503).json({ error: "Groq API key not configured" });
    return;
  }

  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  try {
    const [event] = await db.select().from(securityEventsTable)
      .where(eq(securityEventsTable.id, id));

    if (!event) { res.status(404).json({ error: "Event not found" }); return; }

    // Get other events from same IP for context
    const ipHistory = await db.select({ count: count() }).from(securityEventsTable)
      .where(eq(securityEventsTable.sourceIp, event.sourceIp));

    const userPrompt = `
EVENT DETAILS:
ID: ${event.id}
Type: ${event.type} / ${event.subtype}
Severity: ${event.severity}
Source IP: ${event.sourceIp}
Target: ${event.targetHost}
Tool: ${event.toolUsed ?? "unknown"}
Description: ${event.description ?? "none"}
Status: ${event.status}
Time: ${event.createdAt.toISOString()}
Total events from this IP: ${Number(ipHistory[0]?.count ?? 0)}

ဒီ event ကို ရှင်းပြပေးပါ — ဘာဖြစ်နေသလဲ၊ ဘယ်လောက် ဆိုးသလဲ၊ ဘာ action လုပ်သင့်သလဲ (3 sentences max)
`.trim();

    const explanation = await askGroq({ system: SOC_SYSTEM, user: userPrompt, maxTokens: 300 });
    res.json({ id, explanation, generatedAt: new Date().toISOString() });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
