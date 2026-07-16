/**
 * Auto-report scheduler — generates a daily SOC report on a configurable interval.
 * Interval is stored in app_settings as "reportIntervalMinutes".
 * Default: 1440 min (24 h). Minimum: 1 min.
 */

import { db, reportsTable, securityEventsTable, incidentsTable } from "@workspace/db";
import { desc, count, gte } from "drizzle-orm";
import { getSetting, setSetting } from "./app-settings";
import { askGroq, groqAvailable } from "./groq-client";
import { sendTelegramMessage, telegramAvailable } from "./telegram";
import { logger } from "./logger";

const DEFAULT_INTERVAL_MINUTES = 1440; // 24 hours
const MIN_INTERVAL_MINUTES     = 1;

let _timer: ReturnType<typeof setTimeout> | null = null;

export async function getReportInterval(): Promise<number> {
  const v = await getSetting("reportIntervalMinutes");
  const n = v ? Number(v) : DEFAULT_INTERVAL_MINUTES;
  return isNaN(n) || n < MIN_INTERVAL_MINUTES ? DEFAULT_INTERVAL_MINUTES : n;
}

export async function setReportInterval(minutes: number): Promise<void> {
  const clamped = Math.max(MIN_INTERVAL_MINUTES, Math.round(minutes));
  await setSetting("reportIntervalMinutes", String(clamped));
  restartScheduler();
}

async function runAutoReport(): Promise<void> {
  logger.info("Auto-report: generating scheduled report");

  try {
    const [eventsResult]    = await db.select({ count: count() }).from(securityEventsTable);
    const [incidentsResult] = await db.select({ count: count() }).from(incidentsTable);
    const eventsCount    = Number(eventsResult?.count    ?? 0);
    const incidentsCount = Number(incidentsResult?.count ?? 0);

    const templateSummary =
      `Scheduled SOC report. Total events: ${eventsCount}. ` +
      `Total incidents: ${incidentsCount}. ` +
      `Covers Suricata IDS, Fail2ban, SSH/FTP monitoring, Web attack detection, Firewall rules.`;

    let summary      = templateSummary;
    let aiGenerated  = false;

    if (groqAvailable()) {
      try {
        const since = new Date(Date.now() - 24 * 3_600_000);
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
        const topAttackers  = Object.entries(bySourceIp).sort(([,a],[,b])=>b-a).slice(0,5).map(([ip,n])=>`${ip} (${n})`).join(", ");
        const attackTypes   = Object.entries(byType).sort(([,a],[,b])=>b-a).map(([t,n])=>`${t}: ${n}`).join(", ");
        const sevBreakdown  = Object.entries(bySeverity).map(([s,n])=>`${s}:${n}`).join(", ");

        summary = await askGroq({
          system: `You are AEGIS-AI SOC analyst. Write professional security reports in Burmese mixed with English technical terms.`,
          user: `SCHEDULED AUTO-REPORT — last 24h\nEvents: ${recentEvents.length} | Incidents: ${incidentsCount}\nSeverity: ${sevBreakdown || "none"}\nAttack types: ${attackTypes || "none"}\nTop attackers: ${topAttackers || "none"}\n\nWrite SOC summary: THREAT SUMMARY | TOP THREATS | DEFENSE STATUS | RECOMMENDATIONS (max 400 words, Burmese+English)`,
          maxTokens: 700,
        });
        aiGenerated = true;
      } catch (err: any) {
        logger.warn({ err: err.message }, "Auto-report AI failed, using template");
      }
    }

    const now   = new Date();
    const title = `Auto Report — ${now.toISOString().slice(0, 16).replace("T", " ")}`;

    await db.insert(reportsTable).values({
      title,
      type:     "daily",
      format:   "html",
      summary,
      eventsCount,
      incidentsCount,
    });

    logger.info({ aiGenerated, eventsCount, incidentsCount }, "Auto-report saved");

    // Send Telegram notification if configured
    if (telegramAvailable()) {
      const telegramEnabled = await getSetting("telegramEnabled");
      if (telegramEnabled !== "false") {
        const msg =
          `🛡 <b>AEGIS Auto-Report</b>\n` +
          `📅 ${title}\n` +
          `📊 Events: ${eventsCount} | Incidents: ${incidentsCount}\n` +
          `🤖 ${aiGenerated ? "AI-generated" : "Template"}\n\n` +
          summary.slice(0, 500) + (summary.length > 500 ? "…" : "");
        await sendTelegramMessage(msg).catch(e => logger.warn({ err: e.message }, "Telegram send failed"));
      }
    }
  } catch (err: any) {
    logger.error({ err: err.message }, "Auto-report generation failed");
  }
}

function scheduleNext(intervalMs: number): void {
  _timer = setTimeout(async () => {
    await runAutoReport();
    const nextMs = (await getReportInterval()) * 60_000;
    scheduleNext(nextMs);
  }, intervalMs);
}

export async function startScheduler(): Promise<void> {
  const minutes = await getReportInterval();
  logger.info({ intervalMinutes: minutes }, "Auto-report scheduler starting");
  scheduleNext(minutes * 60_000);
}

export function stopScheduler(): void {
  if (_timer !== null) {
    clearTimeout(_timer);
    _timer = null;
  }
}

export function restartScheduler(): void {
  stopScheduler();
  startScheduler().catch(e => logger.error({ err: e.message }, "Scheduler restart failed"));
}

/** Manual trigger — runs a report immediately regardless of schedule */
export async function triggerReportNow(): Promise<void> {
  await runAutoReport();
}
