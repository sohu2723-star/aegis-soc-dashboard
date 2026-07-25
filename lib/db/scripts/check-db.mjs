#!/usr/bin/env node
// pnpm --filter @workspace/db run check-db
// Verifies the database is reachable without printing connection identifiers.
import postgres from "postgres";

const url = process.env.SUPABASE_DB_URL;
if (!url) { console.error("SUPABASE_DB_URL not set"); process.exit(1); }

// Parsing catches malformed input locally. Do not print any URL component:
// host, user and database names can all be sensitive deployment metadata.
try {
  new URL(url);
} catch {
  console.error("SUPABASE_DB_URL is malformed");
  process.exit(1);
}

console.log("SUPABASE_DB_URL: present (value redacted)");

const sql = postgres(url, { ssl: "require", max: 1 });
await sql`SELECT 1 AS healthy`;
console.log("Database connection: OK ✓");
await sql.end();
