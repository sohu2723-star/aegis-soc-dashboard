/**
 * Auto-report scheduler — generates SOC reports on a configurable interval.
 * Interval is stored in app_settings as "reportIntervalMinutes".
 * Default: 1440 min (24 h). Minimum: 1 min.
 *
 * Events pulled for each report cover exactly the SAME duration as the interval.
 * e.g. interval=60 → pulls the last 60 minutes of events.
 *
 * All timestamps shown to users are Myanmar Standard Time (UTC+6:30).
 */

import { db, reportsTable, securityEventsTable, incidentsTable } from "@workspace/db";
import { desc, count, gte } from "drizzle-orm";
import { getSetting, setSetting } from "./app-settings";
import { askGroq, groqAvailable } from "./groq-client";
import { sendTelegramMessage, telegramAvailable } from "./telegram";
import { logger } from "./logger";

const DEFAULT_INTERVAL_MINUTES = 1440; // 24 hours
const MIN_INTERVAL_MINUTES     = 1;

// ── Myanmar Standard Time helper (UTC+6:30) ───────────────────────────────────
const MST_OFFSET_MS = (6 * 60 + 30) * 60 * 1000; // 6h 30m in ms

/** Return a Date object shifted to Myanmar Standard Time (for display only). */
function toMST(date: Date): Date {
  return new Date(date.getTime() + MST_OFFSET_MS);
}

/**
 * Format a UTC Date as a Myanmar-time string.
 * e.g. "2026-07-19 10:35 (MST)"
 */
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

/** Human-readable label for the interval. */
function intervalLabel(minutes: number): string {
  if (minutes < 60)   return `${minutes} မိနစ်`;
  if (minutes < 1440) return `${Math.round(minutes / 60)} နာရီ`;
  if (minutes === 1440) return `၂၄ နာရီ (Daily)`;
  return `${Math.round(minutes / 1440)} ရက်`;
}

/** Report type tag stored in DB */
function reportType(minutes: number): string {
  if (minutes <= 60)  return "hourly";
  if (minutes < 1440) return "periodic";
  return "daily";
}

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

// ── Core report generation ────────────────────────────────────────────────────

async function runAutoReport(intervalMinutes: number): Promise<void> {
  logger.info({ intervalMinutes }, "Auto-report: generating scheduled report");

  try {
    const now   = new Date();
    const since = new Date(now.getTime() - intervalMinutes * 60_000); // exactly the interval window

    // Events & incidents within the interval window
    const [windowEventsResult]  = await db.select({ count: count() }).from(securityEventsTable)
      .where(gte(securityEventsTable.createdAt, since));
    const [windowIncidentResult] = await db.select({ count: count() }).from(incidentsTable)
      .where(gte(incidentsTable.createdAt, since));
    const eventsCount    = Number(windowEventsResult?.count    ?? 0);
    const incidentsCount = Number(windowIncidentResult?.count  ?? 0);

    const periodLabel = intervalLabel(intervalMinutes);
    const sinceLabel  = fmtMST(since);
    const nowLabel    = fmtMST(now);

    const templateSummary =
      `AEGIS SOC Scheduled Report — ကာလ: နောက်ဆုံး ${periodLabel} (${sinceLabel} ~ ${nowLabel})\n` +
      `Events: ${eventsCount} ခု | Incidents: ${incidentsCount} ခု\n` +
      `Suricata IDS (pfSense), Fail2ban, SSH monitoring, Web attack detection, Firewall rules ပါဝင်သည်။`;

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
        for (const e of recentEvents) {
          byType[e.type]         = (byType[e.type]         ?? 0) + 1;
          bySourceIp[e.sourceIp] = (bySourceIp[e.sourceIp] ?? 0) + 1;
          bySeverity[e.severity] = (bySeverity[e.severity] ?? 0) + 1;
        }
        const topAttackers = Object.entries(bySourceIp).sort(([,a],[,b])=>b-a).slice(0,5).map(([ip,n])=>`${ip} (${n})`).join(", ");
        const attackTypes  = Object.entries(byType).sort(([,a],[,b])=>b-a).map(([t,n])=>`${t}: ${n}`).join(", ");
        const sevBreakdown = Object.entries(bySeverity).map(([s,n])=>`${s}:${n}`).join(", ");

        summary = await askGroq({
          system: `သင်သည် AEGIS-AI SOC analyst ဖြစ်သည်။ မြန်မာဘာသာ (Burmese) ဖြင့် professional security report ရေးပါ။ Technical terms နှင့် IP address သာ English သုံးပါ။ STRICT RULES: (1) IP address နှင့် number အားလုံး English digits သာ — မြန်မာဂဏန်း လုံးဝ မသုံးရ။ (2) Response ကို sentence အလယ်မှာ မဖြတ်ရ — sections အားလုံး ပြည့်ပြည့်စုံစုံ ပြောပြီးမှ ဆုံးရမည်။`,
          user: `AEGIS SOC AUTO-REPORT — နောက်ဆုံး ${periodLabel} (မြန်မာစံတော်ချိန်: ${sinceLabel} ~ ${nowLabel})\n\nEvent: ${recentEvents.length} ခု | Incident: ${incidentsCount} ခု\nSeverity: ${sevBreakdown || "မရှိ"}\nAttack types: ${attackTypes || "မရှိ"}\nTop attacker IPs: ${topAttackers || "မရှိ"}\n\nမြန်မာဘာသာဖြင့် SOC report ပြည့်ပြည့်စုံစုံ ရေးပါ — section တိုင်း ပြည့်ပြည့်စုံစုံ ဖြည့်ပြပါ:\n\nကာလ အကျဉ်းချုပ်:\n(ဘယ် IP တွေ ဘာ attack တွေ မည်မျှ ကြိမ် လုပ်ခဲ့သလဲ — အပြည့်အစုံ)\n\nအပြင်းထန်ဆုံး ခြိမ်းခြောက်မှုများ:\n(top 5 IPs — attack type, target, ကြိမ်ရေ — တစ်ခုချင်းစီ)\n\nDefense ဆောင်ရွက်ချက်:\n(ဘာ block လုပ်ပြီး၊ ဘာ pending ကျန် — အပြည့်အစုံ)\n\nနောက်ကာလ ကြိုတင် သတိပြု ရမည့် အချက်များ:\n(အနည်းဆုံး ၄ ချက် — တစ်ချက်ချင်းစီ တိကျသော command ပါဝင်)`,
          maxTokens: 4000,
        });
        aiGenerated = true;
      } catch (err: any) {
        logger.warn({ err: err.message }, "Auto-report AI failed, using template");
      }
    }

    const title = `Auto Report — ${nowLabel} (နောက်ဆုံး ${periodLabel})`;

    await db.insert(reportsTable).values({
      title,
      type:   reportType(intervalMinutes),
      format: "html",
      summary,
      eventsCount,
      incidentsCount,
    });

    logger.info({ aiGenerated, eventsCount, incidentsCount, intervalMinutes }, "Auto-report saved");

    // ── Telegram notification ─────────────────────────────────────────────────
    if (telegramAvailable()) {
      const telegramEnabled = await getSetting("telegramEnabled");
      if (telegramEnabled !== "false") {
        const MAX_CHARS = 400;
        let trimmedSummary = summary;
        if (summary.length > MAX_CHARS) {
          const chunk     = summary.slice(0, MAX_CHARS);
          const lastBreak = Math.max(chunk.lastIndexOf("။"), chunk.lastIndexOf("."));
          trimmedSummary  = lastBreak > 50
            ? summary.slice(0, lastBreak + 1) + "\n\n📖 <i>Full report — dashboard မှာ ကြည့်ပါ</i>"
            : chunk + "…";
        }

        const msg =
          `🛡 <b>AEGIS Auto-Report</b>\n` +
          `📅 <b>${nowLabel}</b>\n` +
          `⏱ ကာလ: နောက်ဆုံး ${periodLabel} (${sinceLabel} ~ ${nowLabel})\n` +
          `📊 Events: <b>${eventsCount}</b> ခု | Incidents: <b>${incidentsCount}</b> ခု\n` +
          `🤖 ${aiGenerated ? "AI-generated" : "Template"}\n\n` +
          trimmedSummary;

        await sendTelegramMessage(msg).catch(e => logger.warn({ err: e.message }, "Telegram send failed"));
      }
    }
  } catch (err: any) {
    logger.error({ err: err.message }, "Auto-report generation failed");
  }
}

// ── Scheduler loop ────────────────────────────────────────────────────────────

function scheduleNext(intervalMs: number): void {
  _timer = setTimeout(async () => {
    const minutes = await getReportInterval();
    await runAutoReport(minutes);
    const nextMs = minutes * 60_000;
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

/** Manual trigger — runs a report immediately using the current interval setting. */
export async function triggerReportNow(): Promise<void> {
  const minutes = await getReportInterval();
  await runAutoReport(minutes);
}

/** Expose Myanmar time formatter for use in other modules. */
export { fmtMST, toMST };
