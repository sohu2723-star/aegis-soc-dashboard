/**
 * AI Analysis Routes — powered by Groq (openai/gpt-oss-120b).
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
import { containsMyanmarText } from "../lib/report-language";

const router = Router();

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

/** All AI analysis endpoints use English; retained as the shared prompt alias. */
const SOC_SYSTEM = SOC_SYSTEM_EN;

// ─── Status ───────────────────────────────────────────────────────────────────

router.get("/ai/status", (_req, res) => {
  res.json({ available: groqAvailable(), model: "openai/gpt-oss-120b" });
});

// ─── Threat Analysis ──────────────────────────────────────────────────────────

router.get("/ai/threat-analysis", async (req, res) => {
  if (!groqAvailable()) {
    res.status(503).json({ error: "Groq API key not configured" });
    return;
  }

  // Threat briefings are an auditable SOC artifact and are English-only.
  // Ignore legacy lang=my callers so UI, HTML reports and Telegram remain
  // consistent and no mixed-language briefing is cached.
  const sysPrompt = SOC_SYSTEM_EN;

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

    // Fail2ban ban events from security_events (these ARE real blocks even if defense_actions is empty)
    const fail2banBans = await db.select({
      sourceIp: securityEventsTable.sourceIp,
      targetHost: securityEventsTable.targetHost,
      description: securityEventsTable.description,
      createdAt: securityEventsTable.createdAt,
    }).from(securityEventsTable)
      .where(gte(securityEventsTable.createdAt, since24h))
      .orderBy(desc(securityEventsTable.createdAt))
      .limit(50)
      .then(rows => rows.filter(e =>
        // include ban/block events
        (e.description ?? "").toLowerCase().includes("ban") ||
        (e.description ?? "").toLowerCase().includes("block") ||
        (e.targetHost ?? "").toLowerCase().includes("fail2ban")
      ));

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

    const topAttackerEntries = Object.entries(bySourceIp)
      .sort(([, a], [, b]) => b - a).slice(0, 5);
    const topAttackers = topAttackerEntries
      .map(([ip, n]) => `${ip} (${n} events)`).join(", ");

    const perAttackerEvidence = topAttackerEntries.map(([ip, total]) => {
      const rows = recentEvents.filter(e => e.sourceIp === ip);
      const types: Record<string, number> = {};
      const targets: Record<string, number> = {};
      let highest = "low";
      const severityRank: Record<string, number> = { low: 1, medium: 2, high: 3, critical: 4 };
      for (const event of rows) {
        types[event.type] = (types[event.type] ?? 0) + 1;
        targets[event.targetHost] = (targets[event.targetHost] ?? 0) + 1;
        if ((severityRank[event.severity] ?? 0) > (severityRank[highest] ?? 0)) highest = event.severity;
      }
      return `${ip}: ${total} events; severity ${highest}; types ${Object.entries(types).map(([k,v]) => `${k}(${v})`).join(", ")}; targets ${Object.entries(targets).map(([k,v]) => `${k}(${v})`).join(", ")}`;
    }).join("\n") || "none";

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

    // Fail2ban bans are real blocks — surface them separately so AI sees actual blocking activity
    const fail2banSummary = fail2banBans.length > 0
      ? fail2banBans.slice(0, 10)
          .map(b => `Fail2ban banned ${b.sourceIp} on ${b.targetHost}: ${b.description ?? ""}`)
          .join("; ")
      : "none";

    // Per-service breakdown — how many events hit each server
    const byTarget: Record<string, number> = {};
    for (const e of recentEvents) {
      const t = e.targetHost ?? "unknown";
      byTarget[t] = (byTarget[t] ?? 0) + 1;
    }
    const serviceBreakdown = Object.entries(byTarget)
      .sort(([,a],[,b]) => b - a)
      .map(([h,n]) => `${h}: ${n}`)
      .join(", ") || "none";

    // Last 10 events with full detail — gives AI concrete examples to reference
    const recentEventDetails = recentEvents.slice(0, 10).map((e, i) =>
      `${i+1}. [${e.severity.toUpperCase()}] ${e.type}/${e.subtype} | ${e.sourceIp} → ${e.targetHost} | ${e.toolUsed ?? "?"} | ${(e.description ?? "").slice(0, 120)}`
    ).join("\n") || "none";

    const dataBlock = `
AEGIS SOC — LIVE SECURITY DATA (last 24 hours as of ${new Date().toISOString()})

Total events: ${recentEvents.length}
Severity breakdown: ${severityBreakdown || "none — no attacks detected"}
Attack types: ${attackTypes || "none"}
Top attacker IPs: ${topAttackers || "none"}
Per-attacker evidence:
${perAttackerEvidence}
Per-service hit count: ${serviceBreakdown}
Open incidents: ${openIncidents.length}
Unacknowledged alerts: ${unackedAlerts[0]?.count ?? 0}
Fail2ban IP bans: ${fail2banSummary}
Defense actions: ${defenseActSummary || "none"}

MOST RECENT 10 EVENTS (newest first):
${recentEventDetails}
`.trim();

    // ── English mode: single-step, direct ────────────────────────────────────
    const enUserPrompt = `${dataBlock}

Write a live security briefing. Fill each section — heading UPPERCASE, content direct English:

THREAT SUMMARY:
(4-6 sentences: scope, total volume, severity, current attack activity, affected services and operational impact)

TOP THREATS:
(One evidence-rich paragraph per top attacker IP: exact types, targets, event count and highest severity)

DEFENSE STATUS:
(Separate executed, pending and failed evidence. Never say blocked unless the supplied action status proves it.)

RECOMMENDATIONS:
(At least 5 prioritized actions tied to the observed evidence, including validation steps)`;

    const generatedAnalysis = await askGroq({
      system: sysPrompt,
      user: enUserPrompt,
      maxTokens: 3000,
      temperature: 0.15,
      topP: 0.85,
    });
    const requiredHeadings = ["THREAT SUMMARY:", "TOP THREATS:", "DEFENSE STATUS:", "RECOMMENDATIONS:"];
    const analysis = !containsMyanmarText(generatedAnalysis) && requiredHeadings.every(h => generatedAnalysis.includes(h))
      ? generatedAnalysis
      : `THREAT SUMMARY:\nAEGIS recorded ${recentEvents.length} security events during the last 24 hours. Severity distribution: ${severityBreakdown || "none"}. Observed attack types: ${attackTypes || "none"}. Affected services: ${serviceBreakdown}.\n\nTOP THREATS:\n${perAttackerEvidence}\n\nDEFENSE STATUS:\nRecorded defense actions: ${defenseActSummary || "none"}. Recorded Fail2ban evidence: ${fail2banSummary}. Review command history before treating any detected event as successfully blocked.\n\nRECOMMENDATIONS:\n1. Investigate critical and high events first.\n2. Validate pfSense and Linux firewall state for each top attacker.\n3. Resolve pending or failed defense commands.\n4. Confirm all monitored sensors are current.\n5. Document verification results in the incident record.`;

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
      res.json({ recommendation: `No security events for IP ${ip} were found in the AEGIS database.`, ip, eventCount: 0, attackTypes: {} });
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

Write a complete professional English analysis using every section below:

THREAT PROFILE:
(Explain the observed attack pattern, tools, targets and likely objective using only supplied evidence.)

RISK LEVEL:
(Assign Critical, High or Medium and justify the rating with exact evidence.)

IMMEDIATE ACTIONS:
(Provide at least five prioritized actions. Clearly label proposed commands as recommendations rather than executed actions.)

MONITORING:
(Specify logs, ports, alerts and verification evidence to monitor.)

The IP may be internal, external or VPN-originated. Do not invent its location or identity.
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

    // Type-specific context block — gives the AI the right service knowledge
    const typeContext: Record<string, string> = {
      web_attack:     "Service: Apache/ModSecurity on company-web-server (10.10.10.10). Tools: sqlmap, nikto, burpsuite, gobuster. Relevant logs: /var/log/apache2/modsec_audit.log, /var/log/apache2/access.log. Defenses: ModSecurity rules, Fail2ban apache-auth jail, pfSense web block.",
      ssh_brute:      "Service: OpenSSH on the target VM. Tools: hydra, medusa, ncrack, Metasploit ssh_login. Relevant logs: /var/log/auth.log. Defenses: Fail2ban sshd jail (ban after 5 failures), iptables -A INPUT -s <IP> -p tcp --dport 22 -j DROP.",
      db_attack:      "Service: MySQL on company-customer-db (10.20.20.10:3306). Tools: sqlmap --dbms=mysql, hydra -s 3306 mysql, Metasploit mysql_login. Relevant logs: /var/log/mysql/error.log. Defenses: Fail2ban mysqld-auth jail, iptables port 3306 block, MySQL bind-address restriction.",
      dns_attack:     "Service: BIND9 on company-dns-server (10.10.10.20:53). Tools: dnsenum, dig AXFR, dnsrecon, dnsspoof. Relevant logs: /var/log/named/named.log. Defenses: BIND9 allow-transfer ACL, disable recursion for external IPs, Fail2ban named jail.",
      ldap_attack:    "Service: OpenLDAP slapd on company-ldap-server (10.20.20.20:389). Tools: ldapsearch, nmap --script ldap-*, Hydra LDAP module. Relevant logs: /var/log/syslog (slapd). Defenses: Fail2ban slapd jail, disable anonymous bind, restrict allowed IPs in slapd.conf.",
      ldap_brute:     "Service: OpenLDAP slapd on company-ldap-server (10.20.20.20:389). Tools: Hydra LDAP module, ldapbrute. Relevant logs: /var/log/syslog (slapd err=49 invalid credentials). Defenses: Fail2ban slapd jail, account lockout policy, strong bind DN passwords.",
      ddos:           "Service: Network layer — pfSense WAN interface / target VM. Tools: hping3, LOIC, Metasploit auxiliary/dos. Attack vectors: SYN flood, UDP flood, ICMP flood, HTTP flood. Defenses: pfSense traffic shaper, iptables -A INPUT -p tcp --syn -m limit --limit 1/s -j ACCEPT, Suricata threshold rules.",
      port_scan:      "Reconnaissance phase — attacker mapping open ports before attack. Tools: nmap (-sS, -sV, -O, -A), masscan, zmap. Relevant logs: pfSense syslog, Suricata ET SCAN signatures. Defenses: pfSense block scan source IP, iptables recent module, Suricata drop rule for SID 2000537 (ET SCAN).",
      mitm:           "Attack: ARP cache poisoning / MitM on LAN segment. Tools: arpspoof, ettercap, bettercap. Relevant logs: arpwatch, pfSense ARP table. Defenses: Enable Dynamic ARP Inspection (DAI) on switch, static ARP entries for gateway, arpwatch alert.",
      network_attack: "General network/perimeter attack detected by Suricata or pfSense. Check signature details for specific attack vector. Defenses: review pfSense firewall rules, Suricata alert category, block source IP.",
    };

    const typeCtx = typeContext[event.type] ?? typeContext["network_attack"];

    const userPrompt = `Event #${event.id}: ${event.type}/${event.subtype} [${event.severity.toUpperCase()}]
Source: ${event.sourceIp} → Target: ${event.targetHost}
Tool: ${event.toolUsed ?? "unknown"} | ${event.description ?? ""}
${event.signatureText ? `Signature/Rule: ${event.signatureText.slice(0, 200)}` : ""}
Historical events from this IP: ${Number(ipHistory[0]?.count ?? 0)}

Attack context: ${typeCtx}

Write one concise English paragraph containing four complete parts:
(1) Identify the attack, affected service and observed tool.
(2) Explain the severity and operational risk.
(3) Recommend an exact response command with IP, port and service where appropriate; do not claim it was executed.
(4) State which logs and indicators should be checked next.`.trim();

    const explanation = await askGroq({ system: SOC_SYSTEM, user: userPrompt, maxTokens: 900 });
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
        type:        securityEventsTable.type,
        subtype:     securityEventsTable.subtype,
        severity:    securityEventsTable.severity,
        sourceIp:    securityEventsTable.sourceIp,
        targetHost:  securityEventsTable.targetHost,
        toolUsed:    securityEventsTable.toolUsed,
        description: securityEventsTable.description,
      })
        .from(securityEventsTable)
        .where(gte(securityEventsTable.createdAt, since24h))
        .orderBy(desc(securityEventsTable.createdAt))
        .limit(400),
      db.select({
        name:             sql<string>`name`,
        triggerAttackType: sql<string>`trigger_attack_type`,
        defenseType:      sql<string>`defense_type`,
        targetVm:         sql<string>`target_vm`,
        isActive:         sql<boolean>`is_active`,
      }).from(sql`defense_rules`),
    ]);

    // ── Aggregate attack patterns ───────────────────────────────────────────
    const byType:    Record<string, number> = {};
    const bySubtype: Record<string, number> = {};
    const bySeverity:Record<string, number> = {};
    const byTarget:  Record<string, number> = {};
    const byTool:    Record<string, number> = {};
    // Per-IP: { ip → { type → count } }
    const ipAttackMap: Record<string, Record<string, number>> = {};
    // Per-IP target set
    const ipTargetMap: Record<string, Set<string>> = {};

    for (const e of recentEvents) {
      byType[e.type]       = (byType[e.type]       ?? 0) + 1;
      bySubtype[e.subtype] = (bySubtype[e.subtype] ?? 0) + 1;
      bySeverity[e.severity] = (bySeverity[e.severity] ?? 0) + 1;
      byTarget[e.targetHost] = (byTarget[e.targetHost] ?? 0) + 1;
      if (e.toolUsed) byTool[e.toolUsed] = (byTool[e.toolUsed] ?? 0) + 1;

      if (!ipAttackMap[e.sourceIp]) ipAttackMap[e.sourceIp] = {};
      ipAttackMap[e.sourceIp][e.type] = (ipAttackMap[e.sourceIp][e.type] ?? 0) + 1;

      if (!ipTargetMap[e.sourceIp]) ipTargetMap[e.sourceIp] = new Set();
      ipTargetMap[e.sourceIp].add(e.targetHost);
    }

    const topAttackerEntries = Object.entries(ipAttackMap)
      .map(([ip, types]) => ({ ip, total: Object.values(types).reduce((a,b)=>a+b,0), types }))
      .sort((a,b) => b.total - a.total)
      .slice(0, 8);

    const attackerDetail = topAttackerEntries.map(({ ip, total, types }) => {
      const typeStr   = Object.entries(types).sort(([,a],[,b])=>b-a).map(([t,n])=>`${t}(${n})`).join("+");
      const targetStr = [...(ipTargetMap[ip] ?? [])].slice(0, 3).join(", ");
      return `  ${ip}: ${total} events [${typeStr}] → targets: ${targetStr}`;
    }).join("\n") || "  (no attacker IPs)";

    const attackSummary   = Object.entries(byType).sort(([,a],[,b])=>b-a).map(([t,n])=>`${t}:${n}`).join(", ") || "none";
    const subtypeSummary  = Object.entries(bySubtype).sort(([,a],[,b])=>b-a).slice(0,10).map(([t,n])=>`${t}:${n}`).join(", ") || "none";
    const severityBreakdown = Object.entries(bySeverity).map(([s,n])=>`${s}:${n}`).join(", ");
    const topTargets      = Object.entries(byTarget).sort(([,a],[,b])=>b-a).slice(0,5).map(([h,n])=>`${h}(${n})`).join(", ");
    const topTools        = Object.entries(byTool).sort(([,a],[,b])=>b-a).slice(0,5).map(([t,n])=>`${t}(${n})`).join(", ") || "none";

    // Sample recent event descriptions for context
    const sampleDescs = recentEvents
      .filter(e => e.description)
      .slice(0, 15)
      .map((e, i) => `  ${i+1}. [${e.type}/${e.subtype}] ${e.sourceIp}→${e.targetHost}: ${(e.description ?? "").slice(0, 100)}`)
      .join("\n");

    // What attack types already have active rules covering them
    const coveredTypes = new Set(currentRules.filter(r => r.isActive).map(r => r.triggerAttackType));
    const uncoveredTypes = Object.keys(byType).filter(t => !coveredTypes.has(t) && !coveredTypes.has("any"));
    const activeRuleSummary = currentRules.filter(r => r.isActive)
      .map(r => `${r.name} [${r.triggerAttackType} → ${r.defenseType} @ ${r.targetVm}]`).join(", ") || "none";

    const userPrompt = `
AEGIS SOC — LIVE ATTACK DATA (last 24h), generated at ${new Date().toISOString()}
Total events: ${recentEvents.length}

ATTACK TYPE BREAKDOWN:
${attackSummary}

SUBTYPE BREAKDOWN (specific attack methods):
${subtypeSummary}

SEVERITY: ${severityBreakdown}
TOP TARGETED SERVERS: ${topTargets}
TOOLS/METHODS USED: ${topTools}

TOP ATTACKER IPs (with attack breakdown per IP):
${attackerDetail}

SAMPLE RECENT EVENT DESCRIPTIONS:
${sampleDescs || "  (no events)"}

EXISTING ACTIVE RULES (DO NOT duplicate these):
${activeRuleSummary}

GAPS — attack types with NO active rule yet:
${uncoveredTypes.length > 0 ? uncoveredTypes.join(", ") : "all major types covered"}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
TASK: Analyze the actual attack data above and recommend 4-6 defense rules that:
1. Target the REAL attack types/subtypes actually seen in the data above
2. Prioritize uncovered gaps first
3. Are specific to which server is being attacked (use the top targeted servers)
4. Reference actual attacker IPs or tools where relevant in reasoning
5. DO NOT repeat existing active rules

Valid field values:
- triggerAttackType: ssh_brute | web_attack | ddos | port_scan | mitm | dns_attack | db_attack | ldap_brute | ldap_enum | any
- triggerSeverity: any | medium | high | critical
- actionType: auto
- defenseType: block_ip | rate_limit | pfsense_block | alert_only
- targetVm: company-web-server | company-customer-db | company-dns-server | company-ldap-server | pfsense | all

Return ONLY valid JSON, no extra text:

{
  "recommendations": [
    {
      "name": "short rule name",
      "description": "what this rule does (English)",
      "reasoning": "why this rule — reference specific attack data seen above",
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
`.trim();

    const raw = await askGroq({
      system: SOC_SYSTEM,
      user: userPrompt,
      maxTokens: 2500,
      temperature: 0.7,  // higher variety — rules change with each call
    });

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
