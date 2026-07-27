import app from "./app";
import { logger } from "./lib/logger";
import { startScheduler } from "./lib/scheduler";
import { startSelfHeartbeat, ensureSystemStatusSeeded } from "./routes/system";

// Prevent uncaught promise rejections (e.g. postgres.js internal timeouts on
// cold-start) from crashing the process. Log them and keep running.
process.on("unhandledRejection", (reason: unknown) => {
  logger.error({ err: reason instanceof Error ? reason.message : String(reason) },
    "Unhandled promise rejection — server continues");
});

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

/** Start scheduler with retry — first DB query may time out on cold start. */
async function startSchedulerWithRetry(attempt = 1): Promise<void> {
  try {
    await startScheduler();
  } catch (e: any) {
    const delay = Math.min(attempt * 10_000, 60_000); // 10s, 20s … max 60s
    logger.warn({ err: e.message, attempt, retryInMs: delay },
      "Scheduler start failed — will retry");
    setTimeout(() => startSchedulerWithRetry(attempt + 1), delay);
  }
}

// Seed system_status BEFORE accepting HTTP connections so that no incoming
// request has to compete with seeding for DB pool slots.  This was previously
// done inside app.listen (fire-and-forget), which caused pool exhaustion:
// the dashboard's SSE + 4-5 polling requests grabbed all 5 pool slots on
// login, leaving none for the seed, causing all DB routes to hang indefinitely.
// Attempt seed before accepting connections, but cap at 5 s so a locked
// system_status table (Supabase statement_timeout) never delays server start.
logger.info("Seeding system_status before accepting connections…");
try {
  await Promise.race([
    ensureSystemStatusSeeded(),
    new Promise<void>((_, rej) => setTimeout(() => rej(new Error("startup seed timed out")), 5000)),
  ]);
  logger.info("system_status seed complete");
} catch (e: any) {
  logger.warn({ err: e?.message ?? String(e) }, "startup seed failed — server will proceed without it");
}

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
  startSchedulerWithRetry();
  startSelfHeartbeat();
});
