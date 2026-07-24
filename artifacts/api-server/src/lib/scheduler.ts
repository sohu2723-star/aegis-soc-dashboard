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

import { db, reportsTable, securityEventsTable, incidentsTable } from "@workspace/db";
import { desc, count, gte } from "drizzle-orm";
import { getSetting, setSetting } from "./app-settings";
import { askGroq, groqAvailable } from "./groq-client";
import { sendTelegramMessage, telegramAvailable } from "./telegram";
import { logger } from "./logger";

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
  if (secs < 60)    return `${secs} စက္ကန့်`;
  if (secs < 3600)  return `${Math.round(secs / 60)} မိနစ်`;
  if (secs < 86400) return `${Math.round(secs / 3600)} နာရီ`;
  if (secs === 86400) return `၂၄ နာရီ (Daily)`;
  return `${Math.round(secs / 86400)} ရက်`;
}

function reportType(secs: number): string {
  if (secs <= 3600)  return "hourly";
  if (secs < 86400)  return "periodic";
  return "daily";
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
  // Reset lastAutoReportAt so the new interval starts fresh from now
  await setSetting("lastAutoReportAt", new Date().toISOString());
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
    const now   = new Date();
    const since = new Date(now.getTime() - intervalSeconds * 1_000);

    const [windowEventsResult]   = await db.select({ count: count() }).from(securityEventsTable)
      .where(gte(securityEventsTable.createdAt, since));
    const [windowIncidentResult] = await db.select({ count: count() }).from(incidentsTable)
      .where(gte(incidentsTable.createdAt, since));
    const eventsCount    = Number(windowEventsResult?.count    ?? 0);
    const incidentsCount = Number(windowIncidentResult?.count  ?? 0);

    const periodLabel = intervalLabel(intervalSeconds);
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
      type:   reportType(intervalSeconds),
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

    if (now - lastRun >= intervalSecs * 1_000) {
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

  // Seed lastAutoReportAt if this is first ever start (so we don't fire on cold boot)
  const existing = await getSetting("lastAutoReportAt");
  if (!existing) {
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

export { fmtMST, toMST };
