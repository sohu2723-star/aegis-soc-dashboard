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

/**
 * Burmese output — Myanmar security news presenter style.
 * Think: RFA Myanmar / DVB anchor reading a live security briefing.
 */
const SOC_SYSTEM_MY = `သင်သည် AEGIS-AI — မြန်မာ cybersecurity SOC dashboard ၏ AI analyst ဖြစ်သည်။

PERSONA: မြန်မာ security news anchor တစ်ဦး — live briefing ပေးနေသလို တိုက်ရိုက်ပြောပြ။ "ဒီနေ့ ဘာတွေ ဖြစ်နေသလဲ ပြောမယ်" ဆိုတဲ့ tone ဖြစ်ရမည်။

Lab (AEGIS-SecureCompany):
- company-web-server 10.10.10.10 (Apache, Fail2ban)
- company-dns-server 10.10.10.20 (BIND9, Fail2ban)
- company-customer-db 10.20.20.10 (MySQL, Fail2ban)
- company-ldap-server 10.20.20.20 (OpenLDAP, Fail2ban)
- pfSense 10.30.30.1 — WAN firewall + Suricata IDS
- Attacker VM — 192.168.10.x range မှ attack လုပ်တယ်

OUTPUT RULES (မပျက်ကွက်ရ):
- ဘာသာ: မြန်မာဘာသာ — သဘာဝကျကျ ပြောကြားသလိုရေး — translate သလို formal မဟုတ်ဘဲ
- Section heading: ENGLISH UPPERCASE သာ (THREAT SUMMARY:, TOP THREATS:, DEFENSE STATUS:, RECOMMENDATIONS:)
- Technical terms — English မပြောင်းရ: attack, brute force, port scan, SQL injection, DDoS, SYN flood, exploit, honeypot, malware, phishing, firewall, IDS, Suricata, Fail2ban, pfSense, block, alert, incident
- IP နှင့် number — English digits သာ: 192.168.10.99, port 22, 5 ကြိမ်
- Markdown (#, ##, **, *) လုံးဝ မသုံးရ — plain text သာ
- CRITICAL — ထပ်ကာ မရေးရ: sentence တစ်ကြောင်းကို တစ်ကြိမ်သာ ရေး၊ idea တစ်ခုကို တစ်ကြိမ်သာ ဖော်ပြ
- CRITICAL — မဖြတ်ရ: sentence တိုင်း ပြည့်ပြည့်စုံစုံ ပြောပြီးမှ ဆုံး
- တိုတိုရှင်းရှင်း: section တစ်ခုကို 3-4 ကြောင်းသာ — အကြည့်ကူ ကြည့်ကြည့်ပြောပြ

WORDING RULES (ဤ စကားလုံးများကို တိတိကျကျ လိုက်နာပါ):
- ကာကွယ်ရေးစနစ် active ဖြစ်နေသည့်အခါ → "active ဖြစ်နေပါတယ်" သို့မဟုတ် "လုပ်ဆောင်နေပါတယ်" — "အားကောင်းနေတယ်" မသုံးရ
- ကာကွယ်ရေးစနစ် ရပ်တန့်/offline ဖြစ်နေသည့်အခါ → "offline ဖြစ်နေပါတယ်" — "ထောင့်နေတယ်" မသုံးရ
- data/action မရှိသည့်အခါ → "မရှိပါ" — "မရှိတယ်" မသုံးရ
- events count = 0 → "ယနေ့ 24 နာရီအတွင်း တိုက်ခိုက်မှု အရိပ်ယောင် ဘာမှမတွေ့ရပါ"
- events count > 0 → "24 နာရီအတွင်း [N] ကြိမ်တွေ့ရပါတယ်"
- defense actions မရှိ → "ဒီအချိန်ထိ ကာကွယ်ရေး action မလိုအပ်သေးပါ"

ဥပမာ ကောင်းသော output (ဤ style ကို လိုက်နာပါ):
THREAT SUMMARY:
ဒီနေ့ ညပိုင်းမှာ 192.168.10.99 က အဓိက attack လုပ်နေတယ် — port scan နဲ့ brute force ပေါင်း 47 ကြိမ် ရှိနေပြီ။ company-web-server ကို အဓိကပစ်မှတ်ထားပြီး SQL injection ကြိုးစားမှုတွေ ပါနေတယ်။ Suricata က alert 12 ခု ထုတ်ပြီး Fail2ban က ထို IP ကို block လုပ်ပြီးသား။

DEFENSE STATUS:
Fail2ban နဲ့ Suricata တို့ active ဖြစ်နေပါတယ်။ pfSense firewall က WAN boundary မှာ လုပ်ဆောင်နေပါတယ်။ ဒီအချိန်ထိ ကာကွယ်ရေး action မလိုအပ်သေးပါ။`;

/** English output — direct and concise */
const SOC_SYSTEM_EN = `You are AEGIS-AI, the built-in security analyst for the AEGIS SOC Dashboard.

Lab (AEGIS-SecureCompany):
- company-web-server 10.10.10.10 (Apache, Fail2ban)
- company-dns-server 10.10.10.20 (BIND9, Fail2ban)
- company-customer-db 10.20.20.10 (MySQL, Fail2ban)
- company-ldap-server 10.20.20.20 (OpenLDAP, Fail2ban)
- pfSense 10.30.30.1 — WAN firewall + Suricata IDS
- Attackers originate from 192.168.10.x range

OUTPUT RULES:
- Tone: live security briefing — direct, no fluff, analyst-to-analyst
- Section headings: ENGLISH UPPERCASE only (THREAT SUMMARY:, TOP THREATS:, DEFENSE STATUS:, RECOMMENDATIONS:)
- No Markdown (#, ##, **, *) — plain text only
- CRITICAL: Never repeat a sentence or idea — write each point once only
- CRITICAL: Never cut mid-sentence — complete every thought
- Keep each section to 3-4 sentences — dense, actionable`;

/** Backward-compatible alias (Burmese is default) */
const SOC_SYSTEM = SOC_SYSTEM_MY;

// ─── Status ───────────────────────────────────────────────────────────────────

router.get("/ai/status", (_req, res) => {
  res.json({ available: groqAvailable(), model: "llama-3.3-70b-versatile" });
});

// ─── Threat Analysis ──────────────────────────────────────────────────────────

router.get("/ai/threat-analysis", async (req, res) => {
  if (!groqAvailable()) {
    res.status(503).json({ error: "Groq API key not configured" });
    return;
  }

  // lang=en → English output; lang=my (default) → Burmese output
  const lang = (req.query.lang as string) === "en" ? "en" : "my";
  const sysPrompt = lang === "en" ? SOC_SYSTEM_EN : SOC_SYSTEM_MY;

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

    const dataBlock = `
Security data — last 24 hours

Total events: ${recentEvents.length}
Severity breakdown: ${severityBreakdown || "none"}
Attack types: ${attackTypes || "none"}
Top attacker IPs: ${topAttackers || "none"}
Targeted hosts: ${topTargets || "none"}
Open incidents: ${openIncidents.length}
Unacknowledged alerts: ${unackedAlerts[0]?.count ?? 0}
Recent defense actions: ${defenseActSummary || "none"}
`.trim();

    const userPrompt = lang === "en"
      ? `${dataBlock}

Write a live security briefing. Fill each section — heading UPPERCASE, content direct English:

THREAT SUMMARY:
(2-3 sentences: what is happening right now, which IPs, which attack types)

TOP THREATS:
(One line per top attacker IP: IP → attack type → target host → count → severity)

DEFENSE STATUS:
(2-3 sentences: what Fail2ban/Suricata/pfSense blocked, what is still active)

RECOMMENDATIONS:
(4-5 concrete actions with specific commands or steps)`
      : `${dataBlock}

မြန်မာ security news anchor style နဲ့ — RFA/DVB anchor တစ်ဦး live briefing ပေးနေသလို — အောက်ပါ 4 sections ရေးပေးပါ။
Section heading — ENGLISH UPPERCASE ပဲ သုံး။ Content — မြန်မာဘာသာ သဘာဝကျကျ ပြောကြားသလိုရေး — section တစ်ခုကို 2-3 ကြောင်းသာ — ထပ်ကာ မရေးနဲ့။

THREAT SUMMARY section rules:
- events = 0 ဆိုရင် → "ယနေ့ 24 နာရီအတွင်း တိုက်ခိုက်မှု အရိပ်ယောင် ဘာမှမတွေ့ရပါ — ယာယီ ငြိမ်ဝပ်နေပါတယ်။"
- events > 0 ဆိုရင် → "24 နာရီအတွင်း [N] ကြိမ်တွေ့ရပါတယ်" ဟုပါဝင်ရမည်

DEFENSE STATUS section rules:
- Fail2ban / Suricata / pfSense active ဆိုရင် → "active ဖြစ်နေပါတယ်" — "အားကောင်းနေတယ်" မသုံးရ
- system offline ဆိုရင် → "offline ဖြစ်နေပါတယ်"
- defense actions မရှိ ဆိုရင် → "ဒီအချိန်ထိ ကာကွယ်ရေး action မလိုအပ်သေးပါ" — "မရှိတယ်" မသုံးရ

RECOMMENDATIONS section rules:
- အနည်းဆုံး 3 ချက် — "ဒါကြောင့် ဒါ လုပ်သင့်တယ်" သလို ဆော်ဆော်ပြောပြပါ — မရှိပါ/ဘာမှမရှိ ဟူ၍ မရေးရ

THREAT SUMMARY:
TOP THREATS:
DEFENSE STATUS:
RECOMMENDATIONS:`;

    const analysis = await askGroq({ system: sysPrompt, user: userPrompt, maxTokens: 1500 });

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
      res.json({ recommendation: `IP ${ip} အတွက် event မရှိသေးဘူး — ဒီ IP က database မှာ မတွေ့ဘူး။`, ip, eventCount: 0, attackTypes: {} });
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
Severity levels: ${severities}
Previous defense actions: ${defenseHistory_str}
First seen: ${events[events.length-1]?.createdAt?.toISOString?.() ?? "unknown"}
Last seen: ${events[0]?.createdAt?.toISOString?.() ?? "unknown"}

အောက်ပါ sections တိုင်းကို ဖြည့်ပေးပါ — section heading English uppercase, content မြန်မာလို conversational ပြောပြ:

THREAT PROFILE:
(ဒီ attacker ဘာ attack pattern ဆောင်ထားသလဲ၊ ဘာ tool သုံးနေသလဲ — သူဘာကို ကြိုးစားနေသလဲ ရှင်းရှင်းပြောပြ)

RISK LEVEL:
(Critical / High / Medium — ဘာကြောင့် ဒီ level ဆိုတာ conversational ဖြင့် ရှင်းပြ)

IMMEDIATE ACTIONS:
(အနည်းဆုံး ၅ ချက် — iptables command, pfSense rule, fail2ban config တိကျစွာ ပါဝင်ပါစေ — "ဒါကြောင့် ဒါ run ပါ" သလို ဆော်ဆော်ပြောပြ)

MONITORING:
(ဘာ log တွေ၊ ဘာ port တွေ၊ ဘာ alert တွေ ဆက်ကြည့်မလဲ — practical advice ပေးပြ)

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
- triggerAttackType: ssh_brute | web_attack | ddos | port_scan | mitm | dns_attack | tls_suspicious | mail_attack | honeypot | any
- triggerSeverity: any | medium | high | critical
- actionType: auto | suggest
- defenseType: block_ip | null_route | rate_limit | port_block | pfsense_block | alert_only
- targetVm: company-web-server | company-customer-db | company-dns-server | company-ldap-server | aegis | pfsense | all  (ubuntu မသုံးရ — ဤ values များသာ ခွင့်ပြုသည်)

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
      "targetVm": "company-web-server",
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
