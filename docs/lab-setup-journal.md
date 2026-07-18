# AEGIS SOC Dashboard — Lab Setup Journal

---

## Project Overview

**Goal:** Real-time Security Operations Center dashboard for a GNS3 home lab.  
**Replit role:** Code editor only — no simulation, no mocked data.  
**Production stack:**
| Layer | Service | URL |
|---|---|---|
| Frontend | Vercel (auto-deploy from GitHub) | `https://aegis-soc-dashboard-aegis-dashboard.vercel.app` |
| API Server | Render (auto-deploy from GitHub) | `https://aegis-api-server-jp3b.onrender.com` |
| Database | Supabase PostgreSQL | via `SUPABASE_DB_URL` |
| Alerts | Telegram Bot | via `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID` |

---

## GNS3 Lab Topology

```
Attacker ──► R1 MikroTik ──► pfSense/Suricata ──► bank-web     (10.10.10.10, DMZ)
                                                ──► aegis-forwarder (10.30.30.10, MGMT)
                                                ──► customer-db  (10.20.20.20, INT)

aegis-forwarder ──► AEGIS API (Render) ──► Dashboard (Vercel)
                                       ──NOTIFY──► Telegram Bot
```

**Node IPs:**
- R1 WAN (NAT cloud): `192.168.122.2` (DHCP, GNS3 NAT uses `192.168.122.0/24`)
- R1 ether3 (LAN-side): `10.0.23.1` → pfSense WAN: `10.0.23.2`
- pfSense DMZ → `10.10.10.0/24` (bank-web)
- pfSense INT → `10.20.20.0/24` (customer-db)
- pfSense MGMT → `10.30.30.0/24` (aegis-forwarder)

---

## Repository Structure

```
/ (monorepo — pnpm workspaces)
├── artifacts/
│   ├── aegis-dashboard/        React + Vite (port 5000)
│   │   └── src/
│   │       ├── pages/
│   │       │   ├── dashboard.tsx        Command Center
│   │       │   ├── events.tsx           Security Events log
│   │       │   ├── incidents.tsx        Incident tracker
│   │       │   ├── alerts.tsx           Active Alerts
│   │       │   ├── connections.tsx      Connection Logs
│   │       │   ├── network.tsx          Network Monitor
│   │       │   ├── defense.tsx          Defense Center
│   │       │   ├── defense-rules.tsx    Auto-defense Rules
│   │       │   ├── system.tsx           System Status
│   │       │   ├── attack-flow.tsx      Live Threat Map (SVG topology)
│   │       │   ├── reports.tsx          AI Reports
│   │       │   ├── settings.tsx         Settings
│   │       │   └── login.tsx            Auth page
│   │       ├── components/
│   │       │   ├── layout.tsx           Sidebar nav + session footer
│   │       │   └── auth-guard.tsx       Route protection
│   │       ├── contexts/
│   │       │   └── auth-context.tsx     JWT auth state
│   │       └── hooks/
│   │           ├── use-sse.ts           Global SSE listener
│   │           └── use-keep-alive.ts    Render anti-sleep ping (4 min)
│   └── api-server/             Express + TypeScript (port 3000)
│       └── src/
│           ├── routes/
│           │   ├── ingest.ts            POST /api/ingest (receive lab events)
│           │   ├── events.ts            GET /api/events + SSE /api/events/stream
│           │   ├── dashboard.ts         GET /api/dashboard (aggregated stats)
│           │   ├── ai.ts                Groq AI endpoints
│           │   ├── auth.ts              JWT auth routes
│           │   └── health.ts            GET /api/healthz
│           ├── lib/
│           │   ├── db.ts                Drizzle ORM + Supabase connection
│           │   ├── auto-defense.ts      Auto-block engine (attack→rule→command)
│           │   ├── telegram.ts          Telegram Bot alerts
│           │   ├── groq-client.ts       Groq LLM wrapper
│           │   └── jwt-auth.ts          JWT sign/verify + requireAuth middleware
│           └── app.ts                   Express app + CORS + middleware
└── docs/
    └── lab-setup-journal.md    ← this file
```

---

## Environment Variables / Secrets

All secrets managed via **Replit Secrets** (dev) and **Render Environment** (prod).  
Never hardcoded in source.

| Key | Where used | Notes |
|---|---|---|
| `SUPABASE_DB_URL` | API Server | Pooler URL — custom parser (lastIndexOf + safeDecode) |
| `AEGIS_ADMIN_KEY` | API Server | Admin key login; server refuses to start if missing |
| `AEGIS_INGEST_KEY` | API Server | Bearer token for lab→server event ingestion |
| `GROQ_API_KEY` | API Server | Groq llama-3.3-70b for AI summaries |
| `TELEGRAM_BOT_TOKEN` | API Server | Telegram Bot for critical/high alerts |
| `TELEGRAM_CHAT_ID` | API Server | Target chat; verify via `@userinfobot` |
| `SESSION_SECRET` | API Server | JWT signing secret (random hex 32) |
| `ADMIN_EMAIL` | API Server | Allowed Google SSO email (env var, not hardcoded) |
| `GOOGLE_CLIENT_ID` | API Server + Frontend | Public OAuth client ID |

---

## Authentication System

**Two login methods:**
1. **Admin Key** → POST `/api/auth/admin-key` → checks `AEGIS_ADMIN_KEY` env var
2. **Google SSO** → POST `/api/auth/google` → verifies Google ID token → checks `ADMIN_EMAIL`

**Flow:**
```
Login Page → POST credential → API verifies → JWT (24h) → localStorage → AuthGuard passes
```

**JWT:** Signed with `SESSION_SECRET`, payload: `{ role, method, email? }`  
**Google Console:** Authorized JS origin must include Vercel URL  
**Error messages:** Generic only — email not revealed in any error response  

---

## Live Threat Map (Topology Page)

**Route:** `/attack-flow`  
**Tech:** SVG + requestAnimationFrame + SSE

**Topology nodes:**
```
Attacker → R1 Router → pfSense → bank-web        (green, DMZ)
                               → aegis-forwarder  (cyan, MGMT)
                               → customer-db      (green, INT)
aegis-forwarder → AEGIS SOC   --NOTIFY-->  Telegram
```

**SSE events handled:**
| Event | Effect |
|---|---|
| `security_event` | Spawn attack packet, pulse Attacker node, log entry |
| `defense_action` | Block in-flight packets, flash pfSense red, log defense |
| `alert` | Spawn blue packet AEGIS→Telegram, pulse Telegram node, floating toast |

**Live Feed sidebar:** Shows last 60 events with `📱 TG` badge for alerted events.

---

## Auto-Defense Engine

**Pipeline:** Attack event → match defense rules → generate shell command → SSH to target agent → execute block

**Rules stored in DB** (`defense_rules` table):  
- Pattern match on `type`, `severity`, `targetHost`  
- Actions: `block_ip`, `rate_limit`, `alert_only`  
- All IPs/ports sanitized before shell command construction  

**Both `AEGIS_INGEST_KEY` and `AEGIS_ADMIN_KEY` must be set** or server refuses to start.

---

## AI Reports (Groq)

**Model:** `llama-3.3-70b-versatile`  
**Endpoints** (`/api/ai/...`):
- `summary` — incident summary
- `threat-analysis` — threat breakdown
- `recommendations` — defense recommendations  
- `report` — full report generation (saved to `summary` column in DB)

**Language:** Burmese + English mixed output  
**Fallback:** Template-based summary if Groq fails

---

## Render Anti-Sleep

Render free tier sleeps after ~15 min idle.  
**Solution:** `useKeepAlive` hook — pings `/api/healthz` every **4 minutes** while dashboard tab is open.  
Server stays warm as long as at least one browser tab is open.

---

## Data Loading Performance

**React Query config:**
- `staleTime: 0` — always background-refetch for freshest data
- `gcTime: 60_000` — cache kept 1 min before garbage collection
- `retry: 2`, `retryDelay: 2000`
- Dashboard refetch interval: 8s
- Events refetch interval: 5s

---

## Database (Supabase PostgreSQL)

**ORM:** Drizzle  
**Key tables:**
- `security_events` — raw events from lab
- `incidents` — grouped incidents
- `defense_rules` — auto-defense rule config
- `network_hosts` — known hosts/IPs with labels and roles
- `connections` — connection log
- `reports` — AI-generated reports (with `summary` text column)

**Supabase quirk:** `drizzle-kit push` broken with pooler URL.  
**Workaround:** Use `drizzle-kit generate` → run SQL directly in Supabase SQL editor.  
**Pooler region:** `aws-1-ap-southeast-2:6543`

---

## Deployment Flow

```
Code edit (Replit) → git push (gitPush callback) → GitHub main
  → Vercel auto-deploy (frontend, ~1-2 min)
  → Render auto-deploy (API server, ~3-5 min)
```

**No manual deploy step needed after push.**

---

## Known Issues / TODOs

- [ ] **Telegram CHAT_ID** — verify correct chat ID via `@userinfobot` or `getUpdates` API
- [ ] **Google OAuth on Replit dev** — `GSI_LOGGER` origin error expected in dev; works on Vercel
- [ ] **API read routes** — currently public; can add `requireAuth` middleware if needed
- [ ] **Render env vars to add** — `SESSION_SECRET`, `ADMIN_EMAIL`, `GOOGLE_CLIENT_ID` (if not already set)

---

*Last updated: 2026-07-18*
