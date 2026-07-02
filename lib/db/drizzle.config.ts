import { defineConfig } from "drizzle-kit";
import path from "path";

const raw = process.env.SUPABASE_DB_URL;
if (!raw) {
  throw new Error("SUPABASE_DB_URL must be set.");
}

/** Parse a postgres URL robustly, handling special chars in passwords. */
function parseConnectionUrl(rawUrl: string) {
  const noProto = rawUrl.replace(/^postgres(?:ql)?:\/\//, "");
  const atIdx = noProto.lastIndexOf("@");
  if (atIdx === -1) throw new Error("Invalid SUPABASE_DB_URL: missing @");

  const credentials = noProto.slice(0, atIdx);
  const hostPart    = noProto.slice(atIdx + 1);

  const colonIdx = credentials.indexOf(":");
  const user     = colonIdx === -1 ? credentials : credentials.slice(0, colonIdx);
  const password = colonIdx === -1 ? ""           : credentials.slice(colonIdx + 1);

  const slashIdx = hostPart.indexOf("/");
  const hostPort = slashIdx === -1 ? hostPart : hostPart.slice(0, slashIdx);
  // Strip query params from database name (e.g. postgres?sslmode=require → postgres)
  const rawDb   = slashIdx === -1 ? "postgres" : hostPart.slice(slashIdx + 1) || "postgres";
  const database = rawDb.split("?")[0] || "postgres";

  const portColon = hostPort.lastIndexOf(":");
  const host = portColon === -1 ? hostPort : hostPort.slice(0, portColon);
  const port = portColon === -1 ? 5432     : parseInt(hostPort.slice(portColon + 1), 10) || 5432;

  // Percent-decode credentials; fall back to raw value if the sequence is invalid
  function safeDecode(s: string) {
    try { return decodeURIComponent(s); } catch { return s; }
  }

  return { user: safeDecode(user), password: safeDecode(password), host, port, database };
}

const conn = parseConnectionUrl(raw);

export default defineConfig({
  schema: path.join(__dirname, "./src/schema/index.ts"),
  dialect: "postgresql",
  dbCredentials: {
    host:     conn.host,
    port:     conn.port,
    user:     conn.user,
    password: conn.password,
    database: conn.database,
    ssl:      true,
  },
});
