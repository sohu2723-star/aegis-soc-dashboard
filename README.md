# AEGIS Security Operations Center Dashboard

A full-stack real-time cybersecurity SOC (Security Operations Center) dashboard built for a 5-person internship team. Monitors Red Team (Kali Linux) attacks and Blue Team (Ubuntu/Snort/Suricata/Fail2ban/Cowrie) defenses live.

---

## Features

### Security Monitoring
- **Command Center** — Live dashboard with attack volume charts, event counts, critical threat indicators
- **Security Events** — Real-time event feed from all sensors (Snort, Suricata, Fail2ban, Cowrie)
- **Incidents** — Incident management with severity tracking and status updates
- **Active Alerts** — Alert triage panel with acknowledge/resolve actions
- **System Status** — Health monitoring for all defense components

### Network & Defense
- **Network Monitor** — Live topology map of VirtualBox lab (Kali, Ubuntu, Honeypot), connected hosts table, 12h traffic chart
- **Defense Center** — Auto defense status (Fail2ban, Suricata IDS) + Admin manual IP block/unblock with full action log

### Intelligence
- **Reports** — Security report generation and history
- **Setup Guide** — Step-by-step instructions for connecting real VMs to the dashboard

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    AEGIS Dashboard                      │
│         React + Vite + TailwindCSS + shadcn/ui          │
│              Real-time via SSE streaming                │
└───────────────────┬─────────────────────────────────────┘
                    │ HTTP / SSE
┌───────────────────▼─────────────────────────────────────┐
│                   API Server                            │
│            Express 5 + TypeScript                       │
│  Routes: events, incidents, alerts, system, network,    │
│          defense, ingest, stream, reports               │
└───────────────────┬─────────────────────────────────────┘
                    │ Drizzle ORM
┌───────────────────▼─────────────────────────────────────┐
│              PostgreSQL Database                        │
│  Tables: security_events, incidents, alerts,            │
│          system_status, reports, network_hosts,         │
│          blocked_ips, defense_actions                   │
└─────────────────────────────────────────────────────────┘
                    ▲
                    │ POST /api/ingest/*  (X-AEGIS-Key auth)
┌───────────────────┴─────────────────────────────────────┐
│            aegis_forwarder.py  (on Ubuntu VM)           │
│  Watches: Suricata eve.json, Snort alerts,              │
│           Fail2ban.log, Cowrie cowrie.json              │
└─────────────────────────────────────────────────────────┘
                    ▲
                    │ Attacks
┌───────────────────┴─────────────────────────────────────┐
│        Red Team — Kali Linux VM                         │
│  Tools: nmap, sqlmap, nikto, gobuster, hydra, metasploit│
└─────────────────────────────────────────────────────────┘
```

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 18, Vite, TypeScript, TailwindCSS v4, shadcn/ui |
| Backend | Express 5, Node.js 24, TypeScript |
| Database | PostgreSQL + Drizzle ORM |
| Validation | Zod, drizzle-zod |
| API Codegen | Orval (OpenAPI → React Query hooks) |
| Real-time | Server-Sent Events (SSE) |
| Monorepo | pnpm workspaces |

---

## Project Structure

```
aegis-soc-dashboard/
├── artifacts/
│   ├── aegis-dashboard/        # React frontend
│   │   └── src/
│   │       ├── pages/          # dashboard, events, incidents, alerts,
│   │       │                   # system, network, defense, reports, setup
│   │       ├── components/     # layout, ui components
│   │       └── hooks/          # use-sse, use-simulation
│   ├── api-server/             # Express API server
│   │   └── src/
│   │       ├── routes/         # events, incidents, alerts, system,
│   │       │                   # network, defense, ingest, stream, reports
│   │       └── lib/            # broadcaster, simulator
│   └── mockup-sandbox/         # Component preview (dev only)
├── lib/
│   ├── db/                     # Drizzle ORM schema + migrations
│   │   └── src/schema/         # security_events, incidents, alerts,
│   │                           # system_status, reports, network_hosts,
│   │                           # defense_actions
│   ├── api-spec/               # OpenAPI specification
│   ├── api-client-react/       # Generated React Query hooks
│   └── api-zod/                # Generated Zod schemas
├── scripts/
│   └── src/
│       └── aegis_forwarder.py  # Ubuntu VM sensor forwarder
└── docs/
    ├── SETUP.md                # VM setup guide
    ├── API.md                  # API reference
    └── ARCHITECTURE.md         # Architecture decisions
```

---

## Quick Start

### Prerequisites
- Node.js 24+
- pnpm 9+
- PostgreSQL database

### Installation

```bash
git clone https://github.com/sohu2723-star/aegis-soc-dashboard
cd aegis-soc-dashboard
pnpm install
```

### Environment Variables

```bash
# Required
DATABASE_URL=postgresql://user:password@localhost:5432/aegis
SESSION_SECRET=your-session-secret

# Ingest API key (change in production!)
AEGIS_INGEST_KEY=aegis-demo-key-change-me
```

### Run Development

```bash
# API Server (port 8080)
pnpm --filter @workspace/api-server run dev

# Dashboard (port auto-assigned)
pnpm --filter @workspace/aegis-dashboard run dev
```

### Database

```bash
# Push schema to database
pnpm --filter @workspace/db run push

# Regenerate API hooks from OpenAPI spec
pnpm --filter @workspace/api-spec run codegen
```

---

## Connecting Real VMs

See [docs/SETUP.md](docs/SETUP.md) for complete step-by-step instructions.

**Quick summary:**
1. Ubuntu VM — install Suricata, Fail2ban, Cowrie
2. Run `aegis_forwarder.py` with your AEGIS URL and API key
3. Kali VM — start attacking, watch dashboard update live

---

## Ingest API Endpoints

All endpoints require `X-AEGIS-Key` header.

| Endpoint | Source | Description |
|---|---|---|
| `POST /api/ingest/event` | Any | Generic security event |
| `POST /api/ingest/snort` | Snort IDS | Snort alert format |
| `POST /api/ingest/suricata` | Suricata | EVE JSON format |
| `POST /api/ingest/fail2ban` | Fail2ban | Ban/unban events |
| `POST /api/ingest/cowrie` | Cowrie | Honeypot session events |

---

## Defense System

### Auto Defense (Fail2ban + Suricata)
- SSH brute-force → Fail2ban auto-bans IP (1 hour)
- Port scan / exploit → Suricata drops packets + alerts
- Honeypot login → Cowrie logs attacker credentials

### Manual Defense (Dashboard)
- Defense Center → enter IP + reason → Block IP
- Unblock at any time from Active Blocks list
- Full audit log of all block/unblock actions

---

## Team

Internship project — 5-person team
- Red Team: Kali Linux attack simulation
- Blue Team: Ubuntu defense, monitoring, incident response

---

## License

MIT
