import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

const router: IRouter = Router();

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
