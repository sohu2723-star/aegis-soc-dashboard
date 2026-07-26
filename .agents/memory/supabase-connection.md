---
name: Supabase connection details
description: How the project connects to Supabase PostgreSQL — pooler region, URL parser fix, why direct host fails
---

## Key facts

- Project uses Supabase Transaction Pooler (Supavisor), NOT direct connection
- Direct host (`db.*.supabase.co:5432`) is IPv6-only — unreachable from Replit (IPv4 only)
- Correct pooler region: `aws-1-ap-southeast-2` (NOT the standard `aws-0-*` prefix)
- Pooler port: **6543** (transaction mode)
- Env var: `SUPABASE_DB_URL` (not `DATABASE_URL` — that's runtime-managed by Replit)

## URL parser

Custom `parseConnectionUrl()` in both `lib/db/src/index.ts` and `lib/db/drizzle.config.ts`:
- Uses `lastIndexOf('@')` to handle `@` in passwords
- Strips query params from database name: `rawDb.split('?')[0]`
- Uses `safeDecode()` wrapper around `decodeURIComponent` that falls back to raw string on malformed `%` sequences (e.g. trailing `%` without hex digits)

**Why:** `postgres` npm package's built-in URL parser throws `URIError: URI malformed` on special chars in password. `new URL()` has the same problem. The custom parser avoids this.

## Critical: prepare: false required

Supavisor transaction mode (port 6543) does **not** support prepared statements.
`postgres-js` enables prepared statements by default — this causes every DB query to
fail with "Failed query" errors on Render, making `/api/dashboard/summary` return 500
and the dashboard show the "API warming up" banner.

**Fix already applied in `lib/db/src/index.ts`:** `prepare: false` in postgres options.
Do not remove this option.

## drizzle-kit push workaround

`drizzle-kit push` hangs when connecting to Supabase pooler (its internal pg driver has issues with Supavisor). Workaround:
1. Run `drizzle-kit generate` to produce SQL
2. Execute the SQL directly via `postgres` npm package with custom parser

## Tables

16 tables created via `lib/db/drizzle/0000_hot_jigsaw.sql` — all in `public` schema.
