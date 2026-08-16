/**
 * Auto-report scheduler — generates SOC reports on a configurable interval.
 *
 * RELIABILITY: Uses a 30-second polling loop + DB-persisted "lastAutoReportAt"
 * timestamp instead of setTimeout. This means the scheduler survives Render
 * free-tier sleep/restart cycles — on wake it checks immediately whether the
 * interval has elapsed and fires if so.
 *
 * Interval unit: SECONDS (not minutes).
 * Default: 86400 s (24 h). Minimum: 15 s.
 * Max: 604800 s (7 days).
 *
 * All timestamps shown to users are Myanmar Standard Time (UTC+6:30).
 */

import { db, reportsTable, securityEventsTable, incidentsTable, defenseActionsTable, defenseCommandsTable } from "@workspace/db";
import { desc, count, gte } from "drizzle-orm";
import { getSetting, setSetting } from "./app-settings";
import { askGroq, groqAvailable } from "./groq-client";
import { sendTelegramMessage, telegramAvailable, sanitizeForTelegramHtml } from "./telegram";
import { logger } from "./logger";
import { ensureCompleteEnglishReport } from "./report-language";

export const DEFAULT_INTERVAL_SECONDS = 86400;   // 24 h
export const MIN_INTERVAL_SECONDS     = 15;       // 15 s
export const MAX_INTERVAL_SECONDS     = 604800;   // 7 days

const POLL_TICK_MS = 30_000; // check every 30 s

// ── Myanmar Standard Time helper (UTC+6:30) ───────────────────────────────────
const MST_OFFSET_MS = (6 * 60 + 30) * 60 * 1000;

function toMST(date: Date): Date {
  return new Date(date.getTime() + MST_OFFSET_MS);
}

function fmtMST(date: Date, includeSeconds = false): string {
  const mst = toMST(date);
  const y  = mst.getUTCFullYear();
  const mo = String(mst.getUTCMonth() + 1).padStart(2, "0");
  const d  = String(mst.getUTCDate()).padStart(2, "0");
  const h  = String(mst.getUTCHours()).padStart(2, "0");
  const mi = String(mst.getUTCMinutes()).padStart(2, "0");
  const s  = String(mst.getUTCSeconds()).padStart(2, "0");
  return includeSeconds
    ? `${y}-${mo}-${d} ${h}:${mi}:${s} (MST)`
    : `${y}-${mo}-${d} ${h}:${mi} (MST)`;
}

function intervalLabel(secs: number): string {
  if (secs < 60)    return `${secs} seconds`;
  if (secs < 3600)  return `${Math.round(secs / 60)} minutes`;
  if (secs < 86400) return `${Math.round(secs / 3600)} hours`;
  if (secs === 86400) return "24 hours";
  return `${Math.round(secs / 86400)} days`;
}

function reportType(secs: number): string {
  if (secs <= 3600)  return "hourly";
  if (secs < 86400)  return "periodic";
  return "daily";
}

/** Return the current Myanmar-time boundary for fixed daily schedules. */
function mstBoundary(now: Date, intervalSeconds: number): number | null {
  if (intervalSeconds !== 86400 && intervalSeconds !== 43200) return null;
  const mst = toMST(now);
  const hour = intervalSeconds === 86400
    ? 0
    : mst.getUTCHours() >= 12 ? 12 : 0;
  return Date.UTC(
    mst.getUTCFullYear(),
    mst.getUTCMonth(),
    mst.getUTCDate(),
    hour,
  ) - MST_OFFSET_MS;
}

// ── Interval storage (seconds) ────────────────────────────────────────────────

export async function getIntervalSeconds(): Promise<number> {
  // Try new seconds key first
  const sv = await getSetting("reportIntervalSeconds");
  if (sv) {
    const n = Number(sv);
    if (!isNaN(n) && n >= MIN_INTERVAL_SECONDS) return n;
  }
  // Legacy fallback: old key stored minutes → convert to seconds
  const mv = await getSetting("reportIntervalMinutes");
  if (mv) {
    const n = Number(mv) * 60;
    if (!isNaN(n) && n >= MIN_INTERVAL_SECONDS) return n;
  }
  return DEFAULT_INTERVAL_SECONDS;
}

/** Kept for backward compat with settings.ts import */
export async function getReportInterval(): Promise<number> {
  return getIntervalSeconds();
}

export async function setIntervalSeconds(seconds: number): Promise<void> {
  const clamped = Math.max(MIN_INTERVAL_SECONDS, Math.min(MAX_INTERVAL_SECONDS, Math.round(seconds)));
  await setSetting("reportIntervalSeconds", String(clamped));
  // Clear legacy minutes key to avoid confusion
  await setSetting("reportIntervalMinutes", "");
  // For the fixed 12/24-hour presets, schedule the next exact Myanmar-time
  // boundary (12:00/00:00) instead of drifting from the time the setting was
  // clicked. The persisted marker is just before that boundary so the next
  // poll fires once when it arrives.
  const now = new Date();
  const currentBoundary = mstBoundary(now, clamped);
  const nextBoundary = currentBoundary === null
    ? now.getTime() + clamped * 1_000
    : currentBoundary <= now.getTime()
      ? currentBoundary + clamped * 1_000
      : currentBoundary;
  await setSetting("lastAutoReportAt", new Date(nextBoundary - 1).toISOString());
  logger.info({ intervalSeconds: clamped }, "Report interval updated");
}

/** Backward-compat alias used by settings.ts */
export async function setReportInterval(seconds: number): Promise<void> {
  return setIntervalSeconds(seconds);
}

// ── Core report generation ────────────────────────────────────────────────────

async function runAutoReport(intervalSeconds: number): Promise<void> {
  logger.info({ intervalSeconds }, "Auto-report: generating scheduled report");

  try {
    const now = new Date();
    // For fixed daily/12h intervals, anchor "since" to the exact previous
    // MST boundary (prev midnight or prev noon) rather than rolling
    // "now - interval".  This ensures the query window matches the label
    // exactly even if the poll fires a few seconds late.
    const currentBoundary = mstBoundary(now, intervalSeconds);
    const since = currentBoundary !== null
      ? new Date(currentBoundary - intervalSeconds * 1_000)
      : new Date(now.getTime() - intervalSeconds * 1_000);

    const [windowEventsResult]   = await db.select({ count: count() }).from(securityEventsTable)
      .where(gte(securityEventsTable.createdAt, since));
    const [windowIncidentResult] = await db.select({ count: count() }).from(incidentsTable)
      .where(gte(incidentsTable.createdAt, since));
    const eventsCount    = Number(windowEventsResult?.count    ?? 0);
    const incidentsCount = Number(windowIncidentResult?.count  ?? 0);

    const periodLabel = intervalLabel(intervalSeconds);
    const sinceLabel  = fmtMST(since);
    const nowLabel    = fmtMST(now);

    // Fallback template — uses ## sections so HTML download renders styled blocks
    const templateSummary =
`## Incident Summary
This scheduled AEGIS SOC report covers the last ${periodLabel}, from ${sinceLabel} to ${nowLabel}. The platform recorded ${eventsCount} security events and ${incidentsCount} incidents. The security event log remains the authoritative source for event severity, source IP, target and detection details.

## Key Threats
No AI-validated threat narrative is available for this report. If the event count is greater than zero, review the event table and top-attacker breakdown before determining impact; if it is zero, no attack events were recorded in this window.

## Defense Actions
No AI-validated defense narrative is available. Verify executed, pending and failed commands in Defense Rules Command History and confirm pfSense EasyRule or Linux iptables state before claiming that an attacker was blocked.

## Recommendations
1. Review all critical and high events recorded during this window.
2. Validate the current pfSense EasyRule block list and Linux iptables rules.
3. Investigate top source IPs and their affected target services.
4. Resolve every pending or failed defense command and document the result.
5. Confirm Suricata, Fail2ban, SSH, Web, DNS, database and LDAP sensors are reporting current data.`;

    let summary     = templateSummary;
    let aiGenerated = false;

    if (groqAvailable()) {
      try {
        const recentEvents = await db.select().from(securityEventsTable)
          .where(gte(securityEventsTable.createdAt, since))
          .orderBy(desc(securityEventsTable.createdAt))
          .limit(200);

        const byType:     Record<string, number> = {};
        const bySourceIp: Record<string, number> = {};
        const bySeverity: Record<string, number> = {};
        // Per-IP attack type breakdown for accurate Key Threats analysis
        const ipAttackTypes: Record<string, Record<string, number>> = {};
        const ipTargets:     Record<string, Set<string>> = {};

        for (const e of recentEvents) {
          byType[e.type]         = (byType[e.type]         ?? 0) + 1;
          bySourceIp[e.sourceIp] = (bySourceIp[e.sourceIp] ?? 0) + 1;
          bySeverity[e.severity] = (bySeverity[e.severity] ?? 0) + 1;

          if (!ipAttackTypes[e.sourceIp]) ipAttackTypes[e.sourceIp] = {};
          ipAttackTypes[e.sourceIp][e.type] = (ipAttackTypes[e.sourceIp][e.type] ?? 0) + 1;

          if (!ipTargets[e.sourceIp]) ipTargets[e.sourceIp] = new Set();
          ipTargets[e.sourceIp].add(e.targetHost);
        }

        const topAttackerEntries = Object.entries(bySourceIp).sort(([,a],[,b])=>b-a).slice(0,5);
        const topAttackers = topAttackerEntries.map(([ip,n])=>`${ip} (${n})`).join(", ");
        const attackTypes  = Object.entries(byType).sort(([,a],[,b])=>b-a).map(([t,n])=>`${t}: ${n}`).join(", ");
        const sevBreakdown = Object.entries(bySeverity).map(([s,n])=>`${s}:${n}`).join(", ");

        // Detailed per-IP breakdown for AI
        const ipDetails = topAttackerEntries.map(([ip, total]) => {
          const types   = Object.entries(ipAttackTypes[ip] ?? {}).sort(([,a],[,b])=>b-a).map(([t,n])=>`${t}(${n})`).join(", ");
          const targets = [...(ipTargets[ip] ?? [])].slice(0, 3).join(", ");
          return `  - ${ip}: ${total} events | attack types: ${types} | targets: ${targets}`;
        }).join("\n");

        const recentDefenseActions = await db.select().from(defenseActionsTable)
          .where(gte(defenseActionsTable.createdAt, since))
          .orderBy(desc(defenseActionsTable.createdAt)).limit(50);
        const recentDefenseCommands = await db.select().from(defenseCommandsTable)
          .where(gte(defenseCommandsTable.createdAt, since))
          .orderBy(desc(defenseCommandsTable.createdAt)).limit(50);
        const defenseEvidence = recentDefenseActions.length
          ? recentDefenseActions.map(a => `${a.action} ${a.targetIp} on ${a.targetHost ?? "unspecified target"}: ${a.status}`).join("; ")
          : "No defense actions were recorded in this reporting window.";
        const commandEvidence = recentDefenseCommands.length
          ? recentDefenseCommands.map(c => `${c.commandType} for ${c.targetIp ?? "unknown IP"} on ${c.targetVm}: ${c.status}`).join("; ")
          : "No defense commands were queued in this reporting window.";

        const generatedSummary = await askGroq({
          system: `You are AEGIS-AI, a senior Security Operations Center analyst writing a formal daily security report.

LANGUAGE: English only. Never output Burmese/Myanmar script.
VOICE: Precise, evidence-based, professional, and active.
ACCURACY: Use only supplied evidence. Clearly distinguish observed actions from recommendations. Never claim an IP was blocked unless defense evidence says it was executed.
SECTION TITLES: Use exactly these English titles: ## Incident Summary / ## Key Threats / ## Defense Actions / ## Recommendations
COMPLETENESS: Write all four sections. Incident Summary must explain scope, volume, severity and operational impact. Key Threats must cover each supplied top attacker with type and targets. Defense Actions must distinguish executed, pending and failed commands. Recommendations must contain at least five prioritized actions tied to observed evidence.
Never cut off mid-sentence.`,
          user: `AEGIS SOC SECURITY BRIEFING DATA — Last ${periodLabel} (${sinceLabel} ~ ${nowLabel})

Events: ${recentEvents.length} | Incidents: ${incidentsCount}
Severity: ${sevBreakdown || "none"}
Attack types: ${attackTypes || "none"}
Top attacker IPs: ${topAttackers || "none"}

Per-IP attack breakdown (for Key Threats section):
${ipDetails || "  No attackers detected"}

Recorded defense actions:
${defenseEvidence}

Defense command status:
${commandEvidence}

Write a complete security briefing using ONLY this data. Fill all 4 sections accurately:

## Incident Summary
(Explain the reporting scope, event totals, severity distribution, principal attack activity and likely operational impact.)

## Key Threats
(Each top attacker IP — what attack type they used, which targets they hit — active voice, specific details from the per-IP breakdown above)

## Defense Actions
(State only evidenced executed, pending and failed actions. If none exist, say so explicitly.)

## Recommendations
(At least 5 prioritized, specific and actionable items based on the observed attack types and defense status.)`,
          maxTokens: 5000,
          temperature: 0.15,
          topP: 0.85,
        });
        summary = ensureCompleteEnglishReport(generatedSummary, templateSummary);
        aiGenerated = summary === generatedSummary.trim();
      } catch (err: any) {
        logger.warn({ err: err.message, stack: err.stack?.slice(0, 300) }, "Auto-report AI failed, using template summary");
      }
    }

    const scheduledType = reportType(intervalSeconds);
    const typeLabel = scheduledType.charAt(0).toUpperCase() + scheduledType.slice(1);
    const title = `AEGIS ${typeLabel} Security Report — ${nowLabel} (Last ${periodLabel})`;

    await db.insert(reportsTable).values({
      title,
      type:   scheduledType,
      format: "html",
      summary,
      eventsCount,
      incidentsCount,
    });

    logger.info({ aiGenerated, eventsCount, incidentsCount, intervalSeconds }, "Auto-report saved");

    // ── Telegram notification ─────────────────────────────────────────────────
    if (telegramAvailable()) {
      const telegramEnabled = await getSetting("telegramEnabled");
      if (telegramEnabled !== "false") {
        // Sanitize: escape HTML special chars, convert ## → <b>, strip unsafe tags
        const safeSummary = sanitizeForTelegramHtml(summary);

        const MAX_CHARS = 600;
        let trimmedSummary = safeSummary;
        if (safeSummary.length > MAX_CHARS) {
          const chunk     = safeSummary.slice(0, MAX_CHARS);
          const lastBreak = Math.max(chunk.lastIndexOf("."), chunk.lastIndexOf("\n"));
          trimmedSummary  = lastBreak > 50
            ? safeSummary.slice(0, lastBreak + 1) + "\n\n📖 <i>View the complete report in the AEGIS dashboard.</i>"
            : chunk + "…";
        }

        const msg =
          `🛡 <b>AEGIS Auto-Report</b>\n` +
          `📅 <b>${nowLabel}</b>\n` +
          `⏱ <b>Period:</b> Last ${periodLabel} (${sinceLabel} ~ ${nowLabel})\n` +
          `📊 <b>Events:</b> ${eventsCount} | <b>Incidents:</b> ${incidentsCount}\n` +
          `🤖 ${aiGenerated ? "AI-generated" : "Template"}\n\n` +
          trimmedSummary;

        await sendTelegramMessage(msg).catch(e => logger.warn({ err: e.message }, "Telegram send failed"));
      }
    }
  } catch (err: any) {
    logger.error({ err: err.message }, "Auto-report generation failed");
  }
}

// ── Polling scheduler ─────────────────────────────────────────────────────────
// Uses setInterval + DB-persisted lastAutoReportAt so it survives server
// restarts (Render free-tier sleep kills setTimeout timers).

let _pollTimer: ReturnType<typeof setInterval> | null = null;

async function poll(): Promise<void> {
  try {
    const intervalSecs = await getIntervalSeconds();
    const lastRunStr   = await getSetting("lastAutoReportAt");
    const lastRun      = lastRunStr ? new Date(lastRunStr).getTime() : 0;
    const now          = Date.now();

    const boundary = mstBoundary(new Date(now), intervalSecs);
    const due = boundary !== null
      ? now >= boundary && lastRun < boundary
      : now - lastRun >= intervalSecs * 1_000;

    if (due) {
      // Persist before running to prevent double-fire if runAutoReport is slow
      await setSetting("lastAutoReportAt", new Date().toISOString());
      await runAutoReport(intervalSecs);
    }
  } catch (err: any) {
    logger.error({ err: err.message }, "Scheduler poll error");
  }
}

export async function startScheduler(): Promise<void> {
  if (_pollTimer !== null) return; // already running

  // Seed lastAutoReportAt only on true first boot (no value in DB).
  // Do NOT overwrite an existing value — if the server restarts after
  // midnight but before the scheduled report fires, overwriting with
  // "now" would set lastRun > boundary and the midnight report would
  // be permanently skipped until the next day's midnight.
  const existing = await getSetting("lastAutoReportAt");
  if (!existing) {
    // First cold boot: set to now so we don't fire immediately on startup.
    await setSetting("lastAutoReportAt", new Date().toISOString());
  }

  logger.info({ pollTickMs: POLL_TICK_MS }, "Auto-report polling scheduler started");
  // Run once immediately to catch up after a restart
  await poll();
  _pollTimer = setInterval(() => { poll(); }, POLL_TICK_MS);
}

export function stopScheduler(): void {
  if (_pollTimer !== null) {
    clearInterval(_pollTimer);
    _pollTimer = null;
  }
}

export function restartScheduler(): void {
  stopScheduler();
  startScheduler().catch(e => logger.error({ err: e.message }, "Scheduler restart failed"));
}

/** Manual trigger — runs a report immediately. */
export async function triggerReportNow(): Promise<void> {
  const secs = await getIntervalSeconds();
  await runAutoReport(secs);
}

export { fmtMST, toMST, mstBoundary };
