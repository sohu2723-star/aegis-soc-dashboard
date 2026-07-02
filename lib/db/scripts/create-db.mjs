#!/usr/bin/env node
// pnpm --filter @workspace/db run create-db
// Verifies connectivity to the Replit PostgreSQL database.
import postgres from "postgres";

const url = process.env.DATABASE_URL;
if (!url) { console.error("DATABASE_URL not set"); process.exit(1); }

const sql = postgres(url, { ssl: "require", max: 1 });
const [row] = await sql`SELECT current_database() AS db`;
console.log("✓ Connected to database:", row.db);
console.log("Run: pnpm --filter @workspace/db run push  (to create all tables)");
await sql.end();
