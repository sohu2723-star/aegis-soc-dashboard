#!/usr/bin/env node
// pnpm --filter @workspace/db run create-db
// Supabase creates the database automatically — this just verifies connectivity.
import postgres from "postgres";

const url = process.env.SUPABASE_DB_URL;
if (!url) { console.error("SUPABASE_DB_URL not set"); process.exit(1); }

const sql = postgres(url, { ssl: "require", max: 1 });
const [row] = await sql`SELECT current_database() AS db`;
console.log("✓ Connected to database:", row.db);
console.log("Run: pnpm --filter @workspace/db run push  (to create all tables)");
await sql.end();
