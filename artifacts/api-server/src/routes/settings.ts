/**
 * Settings API — auto-report interval + Telegram configuration.
 *
 *  GET  /settings                  — get all settings
 *  POST /settings/report-interval  — set interval (minutes)
 *  POST /settings/telegram         — save telegram toggle
 *  POST /settings/test-telegram    — test bot connection
 *  POST /settings/send-report-now  — trigger report immediately
 */
import { Router } from "express";
import { z } from "zod";
import { getSetting, setSetting } from "../lib/app-settings";
import { getReportInterval, setReportInterval, triggerReportNow } from "../lib/scheduler";
import { testTelegramConnection, telegramAvailable } from "../lib/telegram";

const router = Router();

// ── GET all settings ──────────────────────────────────────────────────────────

router.get("/settings", async (_req, res) => {
  const [intervalMinutes, telegramEnabled] = await Promise.all([
    getReportInterval(),
    getSetting("telegramEnabled"),
  ]);

  res.json({
    reportIntervalMinutes: intervalMinutes,
    telegramEnabled:       telegramEnabled !== "false",
    telegramConfigured:    telegramAvailable(),
  });
});

// ── Set auto-report interval ──────────────────────────────────────────────────

const intervalSchema = z.object({ minutes: z.number().min(1).max(10080) });

router.post("/settings/report-interval", async (req, res) => {
  const { minutes } = intervalSchema.parse(req.body);
  await setReportInterval(minutes);
  res.json({ ok: true, reportIntervalMinutes: minutes });
});

// ── Telegram toggle ───────────────────────────────────────────────────────────

router.post("/settings/telegram", async (req, res) => {
  const { enabled } = z.object({ enabled: z.boolean() }).parse(req.body);
  await setSetting("telegramEnabled", enabled ? "true" : "false");
  res.json({ ok: true, telegramEnabled: enabled });
});

// ── Test Telegram connection ──────────────────────────────────────────────────

router.post("/settings/test-telegram", async (_req, res) => {
  const result = await testTelegramConnection();
  res.json(result);
});

// ── Send report now ───────────────────────────────────────────────────────────

router.post("/settings/send-report-now", async (_req, res) => {
  try {
    await triggerReportNow();
    res.json({ ok: true, message: "Report generated and sent" });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

export default router;
