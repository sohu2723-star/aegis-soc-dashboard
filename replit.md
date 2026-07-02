# AEGIS SOC Dashboard

A real-time Security Operations Center (SOC) dashboard that receives events from a real lab environment and displays them for monitoring. The web UI is **monitoring-only** — actual attacks and defenses happen on real VMs.

## Real Lab Architecture

- **Kali Linux** — Red Team attacker (runs nmap, hydra, sqlmap, hping3, metasploit, etc.)
- **Ubuntu VM** — Blue Team defender (runs Snort, Suricata, Fail2ban, Cowrie, ModSecurity, vsftpd)
- **pfSense** — Firewall/router (iptables / ufw rules, port blocking, null routing)
- **AEGIS Dashboard** — Web monitoring UI only; receives real events via ingest API

## User Preferences

- **Replit is used for code editing only** — not for running or deploying the app.
- No simulated/fake attacks — only real events from real lab VMs.
- The dashboard monitors; the VMs do the actual attacking and defending.

## Attack Coverage (all must be supported)

- **Network attacks**: port scan, DDoS, SYN flood, ARP spoofing, ICMP flood
- **Web attacks**: SQLi, XSS, LFI, RFI, directory traversal, brute force, CSRF
- **SSH/FTP attacks**: brute force, credential stuffing, unauthorized access
- **Phishing / mail server attacks**: SMTP relay abuse, phishing email detection
- **Encrypted traffic**: TLS anomalies, weak ciphers, self-signed/expired certs (Suricata TLS)
- **Honeypot**: Cowrie SSH/Telnet honeypot events
- **Any other attack** detected by Snort/Suricata/Fail2ban/ModSecurity

## Defense Model

1. **Auto-defense**: If a defense rule matches → auto-block IP, port, or apply iptables rule automatically
2. **Manual rule writing**: If auto-defense can't handle it → create firewall rule or defense rule from the dashboard for the VM agent to execute
3. Defense actions are queued in `defense_commands` table → Ubuntu/pfSense agent polls and executes them
4. Auto-block triggers: Fail2ban bans, Cowrie hits, repeated SSH/web brute force, DDoS thresholds

## Run & Operate

- `pnpm --filter @workspace/aegis-dashboard run dev` — frontend (port 5000)
- `PORT=3000 pnpm --filter @workspace/api-server run dev` — API server (port 3000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes to TiDB Cloud (dev only)
- Required secret: `MYSQL_URL` — TiDB Cloud connection string (`mysql://user:pass@host:4000/aegis`)
- Required secret: `AEGIS_INGEST_KEY` — Sensor auth key; Ubuntu VMs send this via `X-AEGIS-Key` header
- Required secret: `AEGIS_ADMIN_KEY` — Admin key for privileged endpoints (`X-AEGIS-Admin-Key` header)

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- Frontend: React 19, Vite, TailwindCSS v4, shadcn/ui, Recharts
- API: Express 5 (port 3000 in dev)
- DB: **TiDB Cloud (MySQL-compatible)** + Drizzle ORM (`mysql2` driver)
- Validation: Zod, drizzle-zod
- API codegen: Orval (from OpenAPI spec)
- Real-time: Server-Sent Events (SSE) via `/api/stream`
- Build: esbuild (ESM bundle)

## Where Things Live

- `artifacts/aegis-dashboard/` — React frontend (Vite)
- `artifacts/api-server/` — Express 5 API server
- `artifacts/api-server/src/lib/auto-defense.ts` — Auto-defense engine (attack → rule → command)
- `artifacts/api-server/src/lib/defense-sanitize.ts` — IP/port sanitization before shell commands
- `lib/db/src/schema/` — Drizzle ORM schema (source of truth for DB)
- `lib/db/src/schema/defense_engine.ts` — Defense rules, commands queue, attack counters
- `lib/db/src/schema/connections.ts` — SSH/FTP sessions, TLS traffic, HTTP attacks
- `lib/api-spec/openapi.yaml` — OpenAPI spec (source of truth for API contract)
- `lib/api-client-react/` — Generated React Query hooks (from Orval)
- `lib/api-zod/` — Generated Zod schemas (from Orval)
- `scripts/src/aegis_forwarder.py` — Python log forwarder for Ubuntu VMs (tails Suricata/Snort/Fail2ban/auth.log)

## Architecture Decisions

- Frontend proxies `/api` to backend via Vite dev server proxy (port 3000)
- SSE broadcaster singleton distributes real-time events to all dashboard clients
- DB is TiDB Cloud MySQL — `.returning()` is unavailable; use `.$returningId()` + re-select pattern
- Both `AEGIS_INGEST_KEY` and `AEGIS_ADMIN_KEY` must be set or server refuses to start (no fallback)
- esbuild bundles the API server to ESM (`dist/index.mjs`) before Node runs it
- All IPs/ports are sanitized in `defense-sanitize.ts` before building shell commands

## Ingest Endpoints (Ubuntu VM → Dashboard)

| Endpoint | Source | Description |
|---|---|---|
| `POST /api/ingest/event` | Any | Generic security event |
| `POST /api/ingest/snort` | Snort IDS | Snort alert_fast format |
| `POST /api/ingest/suricata` | Suricata | EVE JSON alert |
| `POST /api/ingest/suricata/tls` | Suricata | EVE JSON TLS events |
| `POST /api/ingest/fail2ban` | Fail2ban | Ban events → auto-blocks IP |
| `POST /api/ingest/ssh` | auth.log | SSH login success/fail |
| `POST /api/ingest/ftp` | vsftpd/proftpd | FTP session + file exfil |
| `POST /api/ingest/http` | ModSecurity/Nginx | Web attacks (SQLi/XSS/LFI/RFI) |
| `POST /api/ingest/cowrie` | Cowrie | Honeypot events |

## Defense & Firewall API Endpoints

| Endpoint | Description |
|---|---|
| `GET /api/firewall/rules` | List all firewall rules |
| `POST /api/firewall/rules` | Add rule (builds iptables command) |
| `DELETE /api/firewall/rules/:id` | Deactivate a rule |
| `GET /api/firewall/rules/export` | Export active rules as bash script |
| `GET /api/defense/commands/pending` | Agent polls for pending commands |
| `POST /api/defense/commands/:id/done` | Agent marks command executed |
| `GET /api/connections/ssh` | SSH session history |
| `GET /api/connections/ftp` | FTP session history |
| `GET /api/connections/tls` | Encrypted traffic log |
| `GET /api/connections/tls/suspicious` | Suspicious TLS entries |
| `GET /api/connections/http-attacks` | HTTP attack log |

## Dashboard Pages

- **Command Center** — live event counts, threat charts, telemetry
- **Security Events** — filterable feed by source/severity
- **Incidents** — aggregated attack incidents
- **Active Alerts** — priority notifications
- **Network Monitor** — connected hosts
- **Defense Center** — block/unblock IPs, manual + auto defense
- **System Status** — sensor health (Snort, Suricata, Fail2ban, Cowrie)
- **Reports** — generated and stored reports
- **Architecture** — lab topology view
- **Setup Guide** — lab configuration instructions

## Gotchas

- API server must start before frontend polling; Vite proxy 502s until port 3000 is ready
- Run both "API Server" (port 3000) and "Start application" (port 5000) workflows
- `pnpm --filter @workspace/db run push` must be run after any schema changes
- TiDB Cloud requires SSL by default; set `MYSQL_SSL_REJECT_UNAUTH=false` only for local non-TLS dev
