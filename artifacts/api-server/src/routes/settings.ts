/**
 * Settings API — auto-report interval + Telegram configuration.
 *
 *  GET  /settings                  — get all settings
 *  POST /settings/report-interval  — set interval (seconds, min 15, max 604800)
 *  POST /settings/telegram         — save telegram toggle
 *  POST /settings/test-telegram    — test bot connection
 */
import { Router } from "express";
import { z } from "zod";
import { getSetting, setSetting } from "../lib/app-settings";
import { getIntervalSeconds, setIntervalSeconds } from "../lib/scheduler";
import { testTelegramConnection, telegramAvailable } from "../lib/telegram";

const router = Router();

// ── GET all settings ──────────────────────────────────────────────────────────

router.get("/settings", async (_req, res) => {
  const [intervalSeconds, telegramEnabled] = await Promise.all([
    getIntervalSeconds(),
    getSetting("telegramEnabled"),
  ]);

  res.json({
    reportIntervalSeconds: intervalSeconds,
    // Legacy field — kept so old clients don't break
    reportIntervalMinutes: Math.round(intervalSeconds / 60),
    telegramEnabled:       telegramEnabled !== "false",
    telegramConfigured:    telegramAvailable(),
  });
});

// ── Set auto-report interval (seconds) ───────────────────────────────────────

const intervalSchema = z.object({
  seconds: z.number().min(15).max(604800).optional(),
  // Legacy: accept "minutes" from old clients and convert
  minutes: z.number().min(1).max(10080).optional(),
}).refine(d => d.seconds !== undefined || d.minutes !== undefined, {
  message: "seconds or minutes required",
});

router.post("/settings/report-interval", async (req, res) => {
  const body = intervalSchema.parse(req.body);
  const secs = body.seconds !== undefined ? body.seconds : (body.minutes! * 60);
  await setIntervalSeconds(secs);
  res.json({ ok: true, reportIntervalSeconds: secs, reportIntervalMinutes: Math.round(secs / 60) });
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

export default router;
