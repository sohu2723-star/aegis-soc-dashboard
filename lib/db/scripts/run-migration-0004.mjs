#!/usr/bin/env node
// pnpm --filter @workspace/db run migrate-0004
// Runs migration 0004: adds log_source/matched_rule columns + new protocol attack tables

import postgres from "postgres";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));

const url = process.env.SUPABASE_DB_URL;
if (!url) { console.error("SUPABASE_DB_URL not set"); process.exit(1); }

// Robust URL parser (handles special chars in password) — mirrors lib/db/src/index.ts
function parseConnectionUrl(rawUrl) {
  const noProto = rawUrl.replace(/^postgres(?:ql)?:\/\//, "");
  const atIdx = noProto.lastIndexOf("@");
  const credentials = noProto.slice(0, atIdx);
  const hostPart    = noProto.slice(atIdx + 1);
  const colonIdx    = credentials.indexOf(":");
  const user        = colonIdx === -1 ? credentials : credentials.slice(0, colonIdx);
  const password    = colonIdx === -1 ? ""          : credentials.slice(colonIdx + 1);
  const slashIdx    = hostPart.indexOf("/");
  const hostPort    = slashIdx === -1 ? hostPart : hostPart.slice(0, slashIdx);
  const rawDb       = slashIdx === -1 ? "postgres" : hostPart.slice(slashIdx + 1) || "postgres";
  const database    = rawDb.split("?")[0] || "postgres";
  const portColon   = hostPort.lastIndexOf(":");
  const host        = portColon === -1 ? hostPort : hostPort.slice(0, portColon);
  const port        = portColon === -1 ? 5432     : parseInt(hostPort.slice(portColon + 1), 10) || 5432;
  function safeDecode(s) { try { return decodeURIComponent(s); } catch { return s; } }
  return { user: safeDecode(user), password: safeDecode(password), host, port, database };
}

const conn = parseConnectionUrl(url);
console.log(`Connecting to ${conn.host}:${conn.port}/${conn.database} …`);

const sql = postgres({ ...conn, ssl: "require", max: 1, connect_timeout: 15 });

const migrationSql = readFileSync(
  resolve(__dirname, "../drizzle/0004_add_connection_log_tables.sql"),
  "utf8"
);

// Split on semicolons, skip blank/comment-only blocks
const stmts = migrationSql
  .split(";")
  .map(s => s.trim())
  .filter(s => s && !s.replace(/--[^\n]*/g, "").trim() === false);

let ok = 0, fail = 0;
for (const stmt of stmts) {
  const label = stmt.split("\n").find(l => l.trim() && !l.trim().startsWith("--")) ?? stmt;
  try {
    await sql.unsafe(stmt);
    console.log("✅", label.slice(0, 90));
    ok++;
  } catch (e) {
    console.error("❌", label.slice(0, 90));
    console.error("   →", e.message);
    fail++;
  }
}

console.log(`\nMigration 0004: ${ok} statements OK, ${fail} failed`);
await sql.end();
if (fail > 0) process.exit(1);
