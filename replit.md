# AEGIS SOC Dashboard

> **⚠️ CRITICAL RULES FOR ALL AGENTS — READ FIRST**
>
> 1. **NEVER use Replit URLs** (`*.replit.app`, `*.repl.co`) anywhere in source code, documentation, or configuration. Replit is used for **code editing only**.
> 2. **API server URL** is `https://aegis-api-server-jp3b.onrender.com` (Render free tier, Singapore region).
> 3. **Frontend URL** is the Vercel deployment URL (e.g. `https://aegis-soc-dashboard.vercel.app`).
> 4. **Database** is **Supabase PostgreSQL** — env var is `SUPABASE_DB_URL` (pooler URL, port 6543). NOT TiDB/MySQL. The old `MYSQL_URL` reference is stale and wrong.
> 5. **No simulated/mock data** — only real events from real lab VMs.
> 6. Both `AEGIS_INGEST_KEY` and `AEGIS_ADMIN_KEY` **must** be set or the API server refuses to start.
> 7. `.returning()` does **not** work on TiDB/MySQL but does work on Supabase PostgreSQL.
> 8. Any URL in `setup.tsx` forwarder examples must use the Render API URL, not Replit.

---

A real-time Security Operations Center (SOC) dashboard that receives events from a real lab environment and displays them for monitoring. The web UI is **monitoring-only** — actual attacks and defenses happen on real VMs.

## Deployment Architecture

```
[Kali Linux]  ──attack──►  [Ubuntu VM]
                             │  Snort / Suricata / Fail2ban / Cowrie
                             │  aegis_forwarder.py
                             ▼
                    [Render — aegis-api-server]
                    https://aegis-api-server-jp3b.onrender.com
                             │  Express 5 + Drizzle ORM
                             │  Supabase PostgreSQL (SUPABASE_DB_URL)
                             │  SSE /api/stream
                             ▼
                    [Vercel — aegis-dashboard]
                    https://<your-vercel-app>.vercel.app
                    (rewrites /api/* → Render via vercel.json)
```

### How Vercel + Render fit together

- **Vercel** hosts the React frontend (static build). All `/api/*` requests are transparently proxied to Render via `vercel.json` rewrites — no CORS issues, no extra env vars needed on Vercel.
- **Render** runs the Express API server (`artifacts/api-server`). It connects to Supabase PostgreSQL. It receives ingest events from Ubuntu VM sensors and broadcasts them via SSE.
- **Supabase** provides the PostgreSQL database. Use the **pooler connection string** (port 6543, session mode) as `SUPABASE_DB_URL`.

### Required Environment Variables

#### On Render (aegis-api-server):
| Variable | Description |
|---|---|
| `SUPABASE_DB_URL` | Supabase → Settings → Database → Connection string → URI (port **6543** pooler) |
| `AEGIS_INGEST_KEY` | Secret key Ubuntu VMs send via `X-AEGIS-Key` header to authenticate ingest |
| `AEGIS_ADMIN_KEY` | Secret key for privileged admin endpoints (`X-AEGIS-Admin-Key` header) |
| `PORT` | Set to `3000` (already in render.yaml) |
| `NODE_ENV` | Set to `production` (already in render.yaml) |

#### On Vercel (aegis-dashboard):
No extra env vars required — all API calls proxy through vercel.json rewrites to Render.

### Why the Render Deploy Fails

The Render API server crashes at startup with:
> `SUPABASE_DB_URL must be set.`

**Fix**: Go to Render Dashboard → aegis-api-server → Environment → add `SUPABASE_DB_URL` with the Supabase pooler connection string. Also add `AEGIS_INGEST_KEY` and `AEGIS_ADMIN_KEY`. Then trigger a manual deploy.

### Why the Vercel Frontend Shows 404 / Blank Content

The sidebar loads (static HTML/JS) but page content is empty because all API calls fail — the Render API server is down. Fixing the Render deploy (above) fixes the frontend content too.

### Slow Cold Start on Render Free Tier

Render free tier spins down after 15 minutes of inactivity. First request after spindown takes ~50 seconds. This is a Render limitation, not a code bug. Upgrade Render to a paid plan to eliminate cold starts.

## Real Lab Architecture

- **Kali Linux** — Red Team attacker (runs nmap, hydra, sqlmap, hping3, metasploit, etc.)
- **Ubuntu VM** — Blue Team defender (runs Snort, Suricata, Fail2ban, Cowrie, ModSecurity, vsftpd)
- **pfSense** — Firewall/router (iptables / ufw rules, port blocking, null routing)
- **AEGIS Dashboard** — Web monitoring UI only; receives real events via ingest API

## Running on Replit (Development / Code Editing)

Replit is used for code editing. The workflows below let you preview the app locally while making changes.

### First-time setup
```bash
pnpm install   # installs all workspace dependencies
```

### Required Replit Secrets
Set these in the Replit Secrets panel before starting workflows:

| Secret | Description |
|---|---|
| `SUPABASE_DB_URL` | Supabase pooler URI — Settings → Database → URI, port **6543** |
| `AEGIS_INGEST_KEY` | Ingest authentication key (must match Ubuntu VM forwarder) |
| `AEGIS_ADMIN_KEY` | Admin endpoint key (`X-AEGIS-Admin-Key` header) |
| `SESSION_SECRET` | Random string for JWT/session signing |
| `GROQ_API_KEY` | *(optional)* Groq API key for AI report summaries |
| `TELEGRAM_BOT_TOKEN` | *(optional)* Telegram bot token for alert notifications |
| `TELEGRAM_CHAT_ID` | *(optional)* Telegram chat ID for alert notifications |

`ADMIN_EMAIL` and `GOOGLE_CLIENT_ID` are already set as environment variables in `.replit`.

### Workflows
- **Start application** — React/Vite frontend on port 5000 (`pnpm --filter @workspace/aegis-dashboard run dev`)
- **API Server** — Express API on port 3000 (`PORT=3000 pnpm --filter @workspace/api-server run dev`)

Both workflows run in parallel via the **Project** run button.

> **Note:** Google SSO will show a 403 on the Replit dev domain unless the `*.replit.dev` origin is added to the Google Cloud Console OAuth client. Use the access key login as an alternative during development.

## User Preferences

- **Replit is used for code editing only** — not for running or deploying the app.
- No simulated/fake attacks — only real events from real lab VMs.
- The dashboard monitors; the VMs do the actual attacking and defending.

## Lab Setup Journal Rule (ALL AGENTS MUST FOLLOW)

> `docs/lab-setup-journal.md` သည် lab setup မှတ်တမ်းစာအုပ်ဖြစ်သည်။

မည်သည့် agent မဆို lab နှင့်ပတ်သက်သောအလုပ်တစ်ခုခု ပြီးဆုံးတိုင်း **ထို file ကို update လုပ်ရမည်**—

1. Setup step တစ်ခု complete ဖြစ်ရင် → status `🔄 In Progress` မှ `✅ Done` ပြောင်း၊ result ရေး
2. Error/issue တစ်ခုခု တွေ့ရင် → Troubleshooting Log section ထဲ ထည့်
3. Setup step အသစ်တစ်ခု စမယ်ဆိုရင် → `[PENDING]` section အသစ်ထည့်
4. Format အမြဲတမ်း အောက်ပါအတိုင်း ဖြစ်ရမည်—

```
### [Date] — [Title]
**Status:** ✅ Done / 🔄 In Progress / ❌ Failed / ⏳ Not Started
**What:** ဘာလုပ်ခဲ့သလဲ
**How:** commands / steps
**Result:** outcome
**Next:** ဆက်လုပ်ရမည့်အဆင့်
```

ဤ journal ကို panel/judges များနှင့် project book အတွက် သုံးမည်ဖြစ်သောကြောင့် မှတ်တမ်းတင်ရေး တိကျ၊ ပြည့်စုံရမည်။

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

## Ubuntu VM မှာ Script Update လုပ်နည်း

> **IMPORTANT for all agents**: Ubuntu VM (`/opt/aegis/scripts/src/`) မှာ `git pull` **အလုပ်မလုပ်ဘူး**။ Script update လုပ်ဖို့ `wget` နဲ့ GitHub raw URL ကနေ တိုက်ရိုက် download ရမယ်။

```bash
# aegis_forwarder.py update
wget -O /opt/aegis/scripts/src/aegis_forwarder.py \
  https://raw.githubusercontent.com/sohu2723-star/aegis-soc-dashboard/main/scripts/src/aegis_forwarder.py
```

`aegis_forwarder.local.conf` ကိုတော့ မထိနဲ့ — machine-specific config ဆိုတော့ gitignore ထဲမှာပဲ ရှိတာ။

## Run & Operate (Replit code editing only)

- `pnpm --filter @workspace/aegis-dashboard run dev` — frontend (port 5000)
- `PORT=3000 pnpm --filter @workspace/api-server run dev` — API server (port 3000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes to Supabase (dev only)
- Required secret in dev: `SUPABASE_DB_URL` — Supabase pooler connection string (port 6543)
- Required secret in dev: `AEGIS_INGEST_KEY` — Sensor auth key
- Required secret in dev: `AEGIS_ADMIN_KEY` — Admin key for privileged endpoints

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- Frontend: React 19, Vite, TailwindCSS v4, shadcn/ui, Recharts
- API: Express 5 (port 3000 in dev)
- DB: **Supabase PostgreSQL** + Drizzle ORM (`postgres.js` driver) — pooler port 6543
- Validation: Zod, drizzle-zod
- API codegen: Orval (from OpenAPI spec)
- Real-time: Server-Sent Events (SSE) via `/api/stream`
- Build: esbuild (ESM bundle)
- Hosting: Vercel (frontend) + Render (API)

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
- `render.yaml` — Render deployment config (API server)
- `vercel.json` — Vercel deployment config (frontend + /api proxy to Render)

## Architecture Decisions

- Frontend proxies `/api` to backend via Vite dev server proxy (port 3000) in dev; via vercel.json rewrites in production
- SSE broadcaster singleton distributes real-time events to all dashboard clients
- DB is Supabase PostgreSQL — custom `parseConnectionUrl()` in `lib/db/src/index.ts` handles special chars in password (uses `lastIndexOf` + `safeDecode`); SSL required
- Both `AEGIS_INGEST_KEY` and `AEGIS_ADMIN_KEY` must be set or server refuses to start (no fallback)
- esbuild bundles the API server to ESM (`dist/index.mjs`) before Node runs it
- All IPs/ports are sanitized in `defense-sanitize.ts` before building shell commands
- Render free plan: cold start ~50s after inactivity — this is expected, not a bug

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
- Run both "API Server" (port 3000) and "Start application" (port 5000) workflows in Replit dev
- `pnpm --filter @workspace/db run push` must be run after any schema changes (requires `SUPABASE_DB_URL`)
- Supabase PostgreSQL requires SSL — `ssl: "require"` is set in `lib/db/src/index.ts`
- Render free tier cold start ~50s — expected behavior, not a bug
- Do NOT use Replit URLs anywhere — they are for the code editor only
