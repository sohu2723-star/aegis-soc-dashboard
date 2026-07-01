---
name: MySQL migration
description: The project was migrated from PostgreSQL (Replit-hosted) to MySQL. Key differences that cause TypeScript errors.
---

## Rule
Use `.$returningId()` (returns `[{ id }]`) then re-select by id. Never use `.returning()` — MySQL does not support it.

**Why:** Drizzle ORM's MySQL adapter omits the `.returning()` method entirely; calling it produces a TS2551/TS2339 type error.

**How to apply:** On every `db.insert().values(...)`, chain `.$returningId()` to get the id, then `db.select().from(table).where(eq(table.id, row.id))` to fetch the full row. Same for updates: `db.update().set().where()` then a follow-up select.

## Connection
- Dialect: `mysql` in `lib/db/drizzle.config.ts`
- Driver: `mysql2` in `lib/db/package.json`
- URL format: `mysql://user:password@host:3306/aegis`
- Tables: `lib/db/src/schema/` — all use `mysqlTable`, `int().autoincrement()` for PKs
