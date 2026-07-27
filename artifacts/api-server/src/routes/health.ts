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

  try {
    // Race the DB probe against a hard 8 s wall-clock timeout.
    // Without this, a paused/unreachable Supabase causes the request to hang
    // indefinitely even though connect_timeout is set on the pool — the pool
    // timeout only governs the TCP handshake, not query execution stalls.
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("DB probe timed out after 8 s")), 8000),
    );
    await Promise.race([db.execute(sql`SELECT 1`), timeout]);
  } catch {
    dbStatus = "error";
  }

  const status = dbStatus === "ok" ? "ok" : "degraded";
  const data = HealthCheckResponse.parse({ status });
  res.status(dbStatus === "ok" ? 200 : 503).json({
    ...data,
    db: dbStatus,
  });
});

export default router;
