import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

const router: IRouter = Router();

// Ultra-lightweight keep-alive / latency probe (no DB query)
router.get("/ping", (_req, res) => {
  res.json({ ok: true, ts: Date.now() });
});

// ~50 KB payload for client-side download-speed measurement
router.get("/speedtest", (_req, res) => {
  const buf = Buffer.alloc(51200, 65); // 50 KB of 'A'
  res.set({
    "Content-Type": "application/octet-stream",
    "Content-Length": String(buf.length),
    "Cache-Control": "no-store, no-cache",
    "X-Payload-Bytes": String(buf.length),
  });
  res.send(buf);
});

router.get("/healthz", async (_req, res) => {
  let dbStatus: "ok" | "error" = "ok";
  let dbError: string | undefined;

  try {
    await db.execute(sql`SELECT 1`);
  } catch (err) {
    dbStatus = "error";
    dbError = err instanceof Error ? err.message : String(err);
  }

  const status = dbStatus === "ok" ? "ok" : "degraded";
  const data = HealthCheckResponse.parse({ status });
  res.status(dbStatus === "ok" ? 200 : 503).json({
    ...data,
    db: dbStatus,
    ...(dbError ? { dbError } : {}),
  });
});

export default router;
