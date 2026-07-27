import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

if (!process.env.SUPABASE_DB_URL) {
  throw new Error(
    "SUPABASE_DB_URL must be set. Get it from Supabase: Settings → Database → Connection string (URI mode, port 6543 for pooler).",
  );
}

/**
 * Parse a postgres URL robustly, handling special characters
 * (including @, %, etc.) in the password without URL-encoding assumptions.
 */
function parseConnectionUrl(rawUrl: string) {
  const noProto = rawUrl.replace(/^postgres(?:ql)?:\/\//, "");
  const atIdx = noProto.lastIndexOf("@");
  if (atIdx === -1) throw new Error("Invalid SUPABASE_DB_URL: missing @ separator");

  const credentials = noProto.slice(0, atIdx);
  const hostPart    = noProto.slice(atIdx + 1);

  const colonIdx = credentials.indexOf(":");
  const user     = colonIdx === -1 ? credentials : credentials.slice(0, colonIdx);
  const password = colonIdx === -1 ? ""           : credentials.slice(colonIdx + 1);

  const slashIdx = hostPart.indexOf("/");
  const hostPort = slashIdx === -1 ? hostPart : hostPart.slice(0, slashIdx);
  const rawDb    = slashIdx === -1 ? "postgres" : hostPart.slice(slashIdx + 1) || "postgres";
  const database = rawDb.split("?")[0] || "postgres";

  const portColon = hostPort.lastIndexOf(":");
  const host = portColon === -1 ? hostPort : hostPort.slice(0, portColon);
  const port = portColon === -1 ? 5432     : parseInt(hostPort.slice(portColon + 1), 10) || 5432;

  function safeDecode(s: string) {
    try { return decodeURIComponent(s); } catch { return s; }
  }

  return { user: safeDecode(user), password: safeDecode(password), host, port, database };
}

const conn = parseConnectionUrl(process.env.SUPABASE_DB_URL);

const client = postgres({
  ...conn,
  ssl:             "require",
  // 10 connections per server instance.  Supabase pooler (port 6543) allows 60
  // total; with 2 instances (local + Render) that's 20 — well within the limit.
  // We raised this from 5 because the dashboard opens SSE + 4-5 polling requests
  // simultaneously on login, exhausting a pool of 5 before startup seeding could
  // grab a slot, causing all DB-backed routes to hang indefinitely.
  max:             10,
  idle_timeout:    60,
  connect_timeout: 10,
  // A JavaScript Promise.race timeout does not cancel the SQL operation. Make
  // PostgreSQL cancel stalled statements too, otherwise timed-out dashboard
  // requests retain every pool slot and all later browser refreshes hang.
  connection: {
    statement_timeout: 10_000,
  },
  // NOTE: keep_alive omitted — Supabase Supavisor transaction-mode (port 6543)
  // doesn't maintain persistent connections per client; TCP keepalives can confuse it.
  // Supabase uses Supavisor in transaction mode (port 6543).
  // Transaction-mode poolers do not support prepared statements —
  // disable them or every query will fail with "Failed query" errors.
  prepare:         false,
});

export const db = drizzle(client, { schema });

export * from "./schema";
