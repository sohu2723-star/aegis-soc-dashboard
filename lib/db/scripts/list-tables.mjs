#!/usr/bin/env node
import postgres from "postgres";

const url = process.env.DATABASE_URL;
if (!url) { console.error("DATABASE_URL not set"); process.exit(1); }

const sql = postgres(url, { ssl: "require", max: 1 });
const rows = await sql`
  SELECT tablename FROM pg_tables
  WHERE schemaname = 'public'
  ORDER BY tablename
`;
console.log("Tables in database:");
rows.forEach(r => console.log(" -", r.tablename));
await sql.end();
