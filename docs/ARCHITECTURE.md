# AEGIS Architecture Decisions

---

## 1. Contract-First API (OpenAPI → Codegen)

**Decision:** Define API contract in OpenAPI YAML first, then generate React Query hooks and Zod schemas via Orval.

**Why:** Keeps frontend and backend in sync automatically. No manual type duplication between Express routes and React components.

**Files:**
- `lib/api-spec/` — OpenAPI YAML definition (source of truth)
- `lib/api-client-react/` — Generated React Query hooks
- `lib/api-zod/` — Generated Zod validation schemas

**Run codegen after changing API spec:**
```bash
pnpm --filter @workspace/api-spec run codegen
```

---

## 2. Server-Sent Events (SSE) for Real-time

**Decision:** Use SSE (`/api/events/stream`) instead of WebSockets for real-time event push.

**Why:** SSE is simpler, one-directional (server → client), works over HTTP/1.1, auto-reconnects, and sufficient for dashboard monitoring use case. WebSockets would add complexity without benefit since dashboard only needs to receive data, not send.

**Files:**
- `artifacts/api-server/src/routes/stream.ts` — SSE endpoint
- `artifacts/api-server/src/lib/broadcaster.ts` — Event broadcaster singleton
- `artifacts/aegis-dashboard/src/hooks/use-sse.ts` — React SSE hook

---

## 3. Ingest API with API Key Auth

**Decision:** Separate ingest endpoints (`/api/ingest/*`) authenticated by `X-AEGIS-Key` header, distinct from main API.

**Why:** Ubuntu VMs need a simple, scriptable way to push events. API key auth is easy to configure in Python scripts and cron jobs. Avoids session/JWT complexity for sensor scripts.

**Change the key in production:**
```bash
AEGIS_INGEST_KEY=your-secure-random-key-here
```

---

## 4. pnpm Workspaces Monorepo

**Decision:** Single monorepo with pnpm workspaces containing `artifacts/` (apps) and `lib/` (shared libraries).

**Why:** Enables code sharing between API server and frontend (shared types, DB schema). Single `pnpm install` for the entire project. TypeScript project references ensure lib builds before leaf packages.

**Key rule:** Artifacts (`artifacts/*`) are leaf packages — they import from libs but never from each other.

---

## 5. Drizzle ORM (no raw SQL)

**Decision:** Use Drizzle ORM for all database access instead of raw SQL or Prisma.

**Why:** Type-safe queries without code generation step (unlike Prisma). Lightweight. Schema defined in TypeScript, used directly for Zod validation via `drizzle-zod`.

**Schema location:** `lib/db/src/schema/`

**Push schema changes to DB:**
```bash
pnpm --filter @workspace/db run push
```

---

## 6. Defense System — Hybrid Auto + Manual

**Decision:** Dashboard supports both automatic defense (Fail2ban/Suricata native) and manual admin block/unblock.

**Why:** Auto defense runs on the Ubuntu VM without dashboard involvement (faster response). Manual block gives admin control for whitelisted IPs, investigation periods, or pre-emptive blocking. Both are logged to `defense_actions` table for audit trail.

**Flow:**
```
Auto: Fail2ban detects brute-force → iptables DROP → forwarder POSTs to /api/defense/block (blockedBy: "auto")
Manual: Admin enters IP in Defense Center → POST /api/defense/block (blockedBy: "manual")
```

---

## 7. No `zod/v4` in API Server

**Decision:** Use `import { z } from "zod"` (not `"zod/v4"`) in `artifacts/api-server`.

**Why:** esbuild cannot resolve the `zod/v4` subpath export when bundling the API server. The DB schema lib uses `zod/v4` (compiled separately by tsc), which is fine. But Express route files must use plain `zod`.
