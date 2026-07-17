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
          system: `သင်သည် AEGIS-AI SOC analyst ဖြစ်သည်။ မြန်မာဘာသာ (Burmese) ဖြင့် professional security report ရေးပါ။ Technical terms သာ English သုံးပါ။ မည်သည့် IP မဆို attacker ဖြစ်နိုင်သည် — range ကို မယူဆပါနှင့်။ Report ပြည့်ပြည့်စုံစုံ ဖြစ်ပါစေ — sentence ကြားမှာ မဖြတ်ပါနှင့်။`,
          user: `AEGIS SOC AUTO-REPORT — နောက်ဆုံး ၂၄ နာရီ\n\nEvent: ${recentEvents.length} ခု | Incident: ${incidentsCount} ခု\nSeverity: ${sevBreakdown || "မရှိ"}\nAttack types: ${attackTypes || "မရှိ"}\nTop attacker IPs: ${topAttackers || "မရှိ"}\n\nမြန်မာဘာသာဖြင့် SOC report ပြည့်ပြည့်စုံစုံ ရေးပါ:\n\nနေ့ရက် အကျဉ်းချုပ်:\n(ဘယ် IP တွေ ဘာ attack တွေ မည်မျှ ကြိမ် လုပ်ခဲ့သလဲ)\n\nအပြင်းထန်ဆုံး ခြိမ်းခြောက်မှုများ:\n(top 5 IPs — attack type, target, ကြိမ်ရေ)\n\nDefense ဆောင်ရွက်ချက်:\n(ဘာ block လုပ်ပြီး၊ ဘာ pending ကျန်)\n\nနောက်ရက်တွေ ကြိုတင် သတိပြု ရမည့် အချက်များ:\n(အနည်းဆုံး ၃ ချက် — တိကျသော action ပါဝင်)`,
          maxTokens: 2000,
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
        // Trim summary cleanly — cut at last sentence-end (။ or .) within 400 chars
        const MAX_CHARS = 400;
        let trimmedSummary = summary;
        if (summary.length > MAX_CHARS) {
          const chunk = summary.slice(0, MAX_CHARS);
          // find last sentence break: Burmese ။ or ASCII .
          const lastBreak = Math.max(chunk.lastIndexOf("။"), chunk.lastIndexOf("."));
          trimmedSummary = lastBreak > 50
            ? summary.slice(0, lastBreak + 1) + "\n\n📖 <i>Full report — dashboard မှာ ကြည့်ပါ</i>"
            : chunk + "…";
        }
        const msg =
          `🛡 <b>AEGIS Auto-Report</b>\n` +
          `📅 ${title}\n` +
          `📊 Events: ${eventsCount} | Incidents: ${incidentsCount}\n` +
          `🤖 ${aiGenerated ? "AI-generated" : "Template"}\n\n` +
          trimmedSummary;
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
