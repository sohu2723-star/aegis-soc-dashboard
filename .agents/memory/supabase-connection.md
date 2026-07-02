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

## drizzle-kit push workaround

`drizzle-kit push` hangs when connecting to Supabase pooler (its internal pg driver has issues with Supavisor). Workaround:
1. Run `drizzle-kit generate` to produce SQL
2. Execute the SQL directly via `postgres` npm package with custom parser

## Tables

16 tables created via `lib/db/drizzle/0000_hot_jigsaw.sql` — all in `public` schema.
