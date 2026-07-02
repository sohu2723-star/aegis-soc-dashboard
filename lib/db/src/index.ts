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
  ssl:  "require",
  max:  10,
  idle_timeout: 20,
  connect_timeout: 10,
});

export const db = drizzle(client, { schema });

export * from "./schema";
