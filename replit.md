# AEGIS SOC Dashboard

A real-time Security Operations Center dashboard that monitors attacks from Kali Linux (Red Team) and tracks defenses on Ubuntu VMs (Blue Team) using tools like Snort, Suricata, Fail2ban, and Cowrie.

## Run & Operate

- `pnpm --filter @workspace/aegis-dashboard run dev` — run the frontend (port 5000)
- `PORT=3000 pnpm --filter @workspace/api-server run dev` — run the API server (port 3000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — PostgreSQL connection string (auto-provisioned by Replit)
- Required env: `AEGIS_INGEST_KEY` — Sensor API key for ingest endpoints (set in Replit Secrets)
- Required env: `AEGIS_ADMIN_KEY` — Admin API key for privileged endpoints (set in Replit Secrets)

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- Frontend: React 19, Vite, TailwindCSS v4, shadcn/ui, Recharts
- API: Express 5 (port 3000 in dev)
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod, drizzle-zod
- API codegen: Orval (from OpenAPI spec)
- Real-time: Server-Sent Events (SSE) via `/api/stream`
- Build: esbuild (ESM bundle)

## Where things live

- `artifacts/aegis-dashboard/` — React frontend (Vite)
- `artifacts/api-server/` — Express 5 API server
- `lib/db/src/schema/` — Drizzle ORM schema (source of truth for DB)
- `lib/api-spec/openapi.yaml` — OpenAPI spec (source of truth for API contract)
- `lib/db/src/schema/connections.ts` — SSH sessions, FTP sessions, TLS/encrypted traffic, HTTP attacks
- `lib/api-client-react/` — Generated React Query hooks (from Orval)
- `lib/api-zod/` — Generated Zod schemas (from Orval)
- `scripts/src/aegis_forwarder.py` — Python forwarder for Ubuntu VMs

## Architecture decisions

- Frontend proxies `/api` to the backend via Vite's dev server proxy (port 3000)
- SSE broadcaster singleton (`lib/broadcaster.ts`) distributes real-time events to all connected clients
- Ingest API uses `X-AEGIS-Key` header auth (defaults to `aegis-demo-key-change-me` if env not set)
- API client uses relative URLs in web context — no base URL needed; Vite proxy handles routing
- esbuild bundles the API server to ESM (`dist/index.mjs`) before Node runs it

## Product

- Command Center dashboard with live event counts, threat charts, and telemetry
- Security Events feed with filtering by source/severity
- Incidents management for aggregated attack events
- Active Alerts with priority notifications
- Network Monitor for connected hosts
- Defense Center for block/unblock actions (manual and auto)
- System Status for sensor health (Snort, Suricata, Fail2ban, Cowrie)
- Reports generation and storage
- Setup Guide and Architecture view for lab configuration

## User preferences

- Using Replit for code editing only — not for running or deploying the app.

## New Ingest Endpoints (v2)

| Endpoint | Source | Description |
|---|---|---|
| `POST /api/ingest/event` | Any | Generic security event |
| `POST /api/ingest/snort` | Snort IDS | Snort alert_fast format |
| `POST /api/ingest/suricata` | Suricata | EVE JSON alert |
| `POST /api/ingest/suricata/tls` | Suricata | EVE JSON TLS events (encrypted traffic) |
| `POST /api/ingest/fail2ban` | Fail2ban | Ban events → auto-blocks IP in DB |
| `POST /api/ingest/ssh` | auth.log | SSH login success/fail tracking |
| `POST /api/ingest/ftp` | vsftpd/proftpd | FTP session + file exfil detection |
| `POST /api/ingest/http` | ModSecurity/Nginx | Web attack (SQLi, XSS, LFI, RFI, DirTraversal) |
| `POST /api/ingest/cowrie` | Cowrie | Honeypot events |

## New API Endpoints (v2)

| Endpoint | Description |
|---|---|
| `GET /api/firewall/rules` | List all firewall rules |
| `POST /api/firewall/rules` | Add rule (builds iptables command) |
| `DELETE /api/firewall/rules/:id` | Deactivate a rule |
| `GET /api/firewall/rules/export` | Export active rules as bash script |
| `GET /api/connections/ssh` | SSH session history |
| `GET /api/connections/ftp` | FTP session history |
| `GET /api/connections/tls` | Encrypted traffic log |
| `GET /api/connections/tls/suspicious` | Suspicious TLS (weak version, self-signed, expired) |
| `GET /api/connections/http-attacks` | HTTP attack log |

## Gotchas

- API server must start before frontend polling begins; the Vite proxy will 502 until port 3000 is ready
- Run both the "API Server" workflow (console, port 3000) and "Start application" workflow (webview, port 5000)
- `AEGIS_INGEST_KEY` env var sets the ingest API key; defaults to `aegis-demo-key-change-me` if unset
- Run `pnpm --filter @workspace/db run push` after any schema changes before starting the server

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
