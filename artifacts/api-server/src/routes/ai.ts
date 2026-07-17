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

const SOC_SYSTEM = `သင်သည် AEGIS-AI — AEGIS SOC Dashboard ၏ built-in security analyst ဖြစ်သည်။

Lab topology:
- bank-web (10.10.10.10): Suricata, Fail2ban, Apache2, vsftpd
- customer-db (10.20.20.20): Suricata, Fail2ban, PostgreSQL
- AEGIS VM (10.30.30.10): hub forwarder
- pfSense (10.30.30.1): WAN firewall
- Attacker: မည်သည့် IP မဆို — 192.168.122.x မဟုတ်ဘဲ မည်သည့် IP မဆို threat ဖြစ်နိုင်သည်

Response rules (STRICT — မပျက်ကွက်ရ):
1. မြန်မာဘာသာ ဖြင့်ရေး — IP, port, command, tool names သာ English
2. CRITICAL: IP address နှင့် number အားလုံး — English digits သာ သုံးရမည် (192.168.1.1, 22, 443) — မြန်မာဂဏန်း (၁၂၃) လုံးဝ မသုံးရ
3. Markdown headers (#, ##) မသုံးပါ — plain text paragraph သာ
4. ချက်ချင်း actionable ဖြစ်ပါစေ — concrete command/step ပါဝင်ပါစေ
5. CRITICAL: response ကို sentence အလယ်မှာ မဖြတ်ရ — စကားစုတိုင်း၊ section တိုင်း ပြည့်ပြည့်စုံစုံ ပြောပြီးမှ ဆုံးရမည်
6. ပေးထားသော sections အားလုံး ဖြည့်ပြပါ — section တစ်ခုမျှ ကျော်မသွားရ`;

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
လုံခြုံရေး ဒေတာ — နောက်ဆုံး ၂၄ နာရီ

စုစုပေါင်း event: ${recentEvents.length}
Severity ခွဲခြမ်း: ${severityBreakdown || "none"}
Attack အမျိုးအစား: ${attackTypes || "none"}
Top attacker IPs: ${topAttackers || "none"}
တိုက်ခိုက်ခံ host များ: ${topTargets || "none"}
ဖွင့်ထားသော incident: ${openIncidents.length}
Acknowledge မလုပ်ရသေးသော alert: ${unackedAlerts[0]?.count ?? 0}
ကျုံ့ defense actions: ${defenseActSummary || "none"}

မြန်မာဘာသာဖြင့် SOC threat briefing ပြည့်ပြည့်စုံစုံ ရေးပါ။ Section တစ်ခုချင်းစီကို အပြည့်ဖော်ပြပါ:

ခြိမ်းခြောက်မှု အကျဉ်းချုပ်:
(ဘာတွေ ဖြစ်နေသလဲ၊ ဘယ် IP တွေ ဘာ attack တွေ လုပ်နေသလဲ — ရှင်းလင်းပြည့်စုံစွာ)

အပြင်းထန်ဆုံး ခြိမ်းခြောက်မှုများ:
(top attacker IP တစ်ခုချင်းစီ — attack type, severity, target host, ဘယ်လောက် ကြိမ် ဖြစ်သလဲ)

Defense အခြေအနေ:
(ဘာ block လုပ်ပြီးပြီ၊ Fail2ban/Suricata/pfSense status၊ ဘာ pending ကျန်နေသေးသလဲ)

ထောက်ပံ့ချက် (Recommendations):
(အနည်းဆုံး ၅ ချက် — တစ်ချက်ချင်းစီ တိကျသော command သို့မဟုတ် action ပါဝင်ပါစေ)
`.trim();

    const analysis = await askGroq({ system: SOC_SYSTEM, user: userPrompt, maxTokens: 4000 });

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
ဒီ IP မှ စုစုပေါင်း event: ${events.length}
Attack အမျိုးအစား: ${attackSummary}
တိုက်ခိုက်ခံ host များ: ${[...targets].join(", ")}
Severity levels: ${severities}
ယခင် defense actions: ${defenseHistory_str}
ပထမဆုံး တွေ့ချိန်: ${events[events.length-1]?.createdAt?.toISOString?.() ?? "unknown"}
နောက်ဆုံး တွေ့ချိန်: ${events[0]?.createdAt?.toISOString?.() ?? "unknown"}

မြန်မာဘာသာဖြင့် ဒီ IP အတွက် defense recommendation ပြည့်ပြည့်စုံစုံ ရေးပါ:

ခြိမ်းခြောက်မှု ကိုယ်ပိုင်ပုံရိပ် (Threat Profile):
(ဒီ attacker ဘာ attack pattern ဆောင်ထားသလဲ၊ ဘာ tool သုံးနေသလဲ ဖော်ပြပါ)

အန္တရာယ် အဆင့် (Risk Level):
(Critical / High / Medium — ဘာကြောင့် ဒီ level ဆိုတာ ရှင်းပြပါ)

ချက်ချင်း လုပ်ဆောင်ရမည့် အဆင့်များ (Immediate Actions):
(အနည်းဆုံး ၅ ချက် — iptables command, pfSense rule, fail2ban config တိကျစွာ ပါဝင်ပါစေ)

ဆက်လက် စောင့်ကြည့်ရမည့် အချက်များ (Monitor):
(ဘာ log တွေ၊ ဘာ port တွေ၊ ဘာ alert တွေ ဆက်ကြည့်မလဲ)

ဒီ IP က မည်သည့် IP မဆို ဖြစ်နိုင်သည် (internal network, external, VPN) — assumption မမှားပါနှင့်
`.trim();

    const recommendation = await askGroq({ system: SOC_SYSTEM, user: userPrompt, maxTokens: 3000 });

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

    const userPrompt = `Event #${event.id}: ${event.type}/${event.subtype} [${event.severity.toUpperCase()}]
Source: ${event.sourceIp} → Target: ${event.targetHost}
Tool: ${event.toolUsed ?? "unknown"} | ${event.description ?? ""}
ဒီ IP မှ event ${Number(ipHistory[0]?.count ?? 0)} ခု ရှိပြီ

မြန်မာဘာသာဖြင့် 3-4 ကြောင်းသာ ဖြင့် ရေးပါ:
(1) ဘာဖြစ်နေသလဲ (2) ဘာကြောင့် ဒီ severity (3) ချက်ချင်း လုပ်ရမည့် command 1 ခု — တိုတိုနဲ့ ထိထိမိမိ`.trim();

    const explanation = await askGroq({ system: SOC_SYSTEM, user: userPrompt, maxTokens: 800 });
    res.json({ id, explanation, generatedAt: new Date().toISOString() });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── AI Rule Recommendations ──────────────────────────────────────────────────
// POST /ai/recommend-rules
// Analyses recent attack patterns and returns structured defense rule
// suggestions that can be applied directly to the defense_rules table.

router.post("/ai/recommend-rules", async (_req, res) => {
  if (!groqAvailable()) {
    res.status(503).json({ error: "Groq API key not configured" });
    return;
  }

  try {
    const since24h = new Date(Date.now() - 24 * 3_600_000);

    const [recentEvents, currentRules] = await Promise.all([
      db.select({
        type: securityEventsTable.type,
        subtype: securityEventsTable.subtype,
        severity: securityEventsTable.severity,
        sourceIp: securityEventsTable.sourceIp,
        targetHost: securityEventsTable.targetHost,
        toolUsed: securityEventsTable.toolUsed,
      })
        .from(securityEventsTable)
        .where(gte(securityEventsTable.createdAt, since24h))
        .orderBy(desc(securityEventsTable.createdAt))
        .limit(300),
      db.select({
        name: sql<string>`name`,
        triggerAttackType: sql<string>`trigger_attack_type`,
        isActive: sql<boolean>`is_active`,
        actionType: sql<string>`action_type`,
        defenseType: sql<string>`defense_type`,
      }).from(sql`defense_rules`),
    ]);

    // Aggregate attack patterns
    const byType: Record<string, number> = {};
    const bySeverity: Record<string, number> = {};
    const byTarget: Record<string, number> = {};
    for (const e of recentEvents) {
      byType[e.type] = (byType[e.type] ?? 0) + 1;
      bySeverity[e.severity] = (bySeverity[e.severity] ?? 0) + 1;
      byTarget[e.targetHost] = (byTarget[e.targetHost] ?? 0) + 1;
    }

    const activeRuleNames = currentRules.filter(r => r.isActive).map(r => r.name).join(", ") || "none";
    const attackSummary = Object.entries(byType).sort(([,a],[,b])=>b-a).map(([t,n])=>`${t}: ${n}`).join(", ") || "none";
    const severityBreakdown = Object.entries(bySeverity).map(([s,n])=>`${s}: ${n}`).join(", ");
    const topTargets = Object.entries(byTarget).sort(([,a],[,b])=>b-a).slice(0,3).map(([h,n])=>`${h}(${n})`).join(", ");

    const userPrompt = `
လက်ရှိ attack pattern (နောက်ဆုံး 24 နာရီ):
Attack types: ${attackSummary}
Severity: ${severityBreakdown}
Top targets: ${topTargets}
Total events: ${recentEvents.length}

လက်ရှိ active rules: ${activeRuleNames}

Valid values:
- triggerAttackType: ssh_brute | ftp_brute | web_attack | ddos | port_scan | mitm | dns_attack | tls_suspicious | mail_attack | honeypot | any
- triggerSeverity: any | medium | high | critical
- actionType: auto | suggest
- defenseType: block_ip | null_route | rate_limit | port_block | pfsense_block | alert_only
- targetVm: ubuntu | pfsense

Attack data ကို ကြည့်ပြီး defense rules 3-5 ခု recommend ပေးပါ။
တစ်ခုချင်းစီကို ဒီ JSON format အတိုင်း ဖော်ပြပါ:

{
  "recommendations": [
    {
      "name": "rule name",
      "description": "Burmese description of what this rule does",
      "reasoning": "Burmese explanation of WHY this rule is needed based on attack data",
      "triggerAttackType": "...",
      "triggerSeverity": "...",
      "triggerThreshold": 3,
      "triggerWindowSecs": 60,
      "actionType": "auto",
      "defenseType": "block_ip",
      "targetVm": "ubuntu",
      "priority": 20
    }
  ]
}

JSON ONLY ပြန်ပါ — ရှင်းလင်းချက် plain text မထည့်ပါနှင့်
`.trim();

    const raw = await askGroq({ system: SOC_SYSTEM, user: userPrompt, maxTokens: 2000 });

    // Extract JSON — handle plain JSON, ```json blocks, or ```  blocks
    let jsonStr: string | null = null;
    const codeBlock = raw.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
    if (codeBlock) {
      jsonStr = codeBlock[1];
    } else {
      const direct = raw.match(/\{[\s\S]*\}/);
      if (direct) jsonStr = direct[0];
    }

    if (!jsonStr) {
      res.status(500).json({ error: "AI returned non-JSON response. Raw: " + raw.slice(0, 200) });
      return;
    }

    const parsed = JSON.parse(jsonStr);
    res.json({
      recommendations: parsed.recommendations ?? [],
      generatedAt: new Date().toISOString(),
      basedOn: { totalEvents: recentEvents.length, attackTypes: byType },
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
