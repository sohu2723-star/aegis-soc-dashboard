#!/usr/bin/env node
// pnpm --filter @workspace/db run check-db
// Prints connection details and verifies the database is reachable.
import postgres from "postgres";

const url = process.env.DATABASE_URL;
if (!url) { console.error("DATABASE_URL not set"); process.exit(1); }

const u = new URL(url);
console.log("Host    :", u.hostname);
console.log("Port    :", u.port);
console.log("User    :", u.username);
console.log("DB path :", u.pathname.replace(/^\//, "") || "(none)");

const sql = postgres(url, { max: 1 });
const [row] = await sql`SELECT current_database() AS db`;
console.log("Connected DB:", row.db, "✓");
await sql.end();
