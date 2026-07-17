# AEGIS Security Operations Center Dashboard

Full-stack real-time SOC (Security Operations Center) dashboard for the GNS3 AEGIS-SecureBank lab. Monitors live attacks and defenses — dashboard is monitoring-only; all real attack and defense happens on the GNS3 virtual machines.

---

## Lab Topology (Current)

```
[Attacker]           Switch1     Router-1 (MikroTik CHR)
(any IP)  ───────────────────── ether1: 192.168.122.2/24
                                 ether2: DHCP (NAT internet)
                                 ether3: 10.0.23.1/30 ──────┐
                                                             │
                                                      [pfSense 2.7.2]
                                                   WAN:  10.0.23.2/30
                                                   DMZ:  10.10.10.1/24
                                                   INT:  10.20.20.1/24
                                                   MGMT: 10.30.30.1/24
                                                             │
                                        ┌────────────────────┼──────────────┐
                                   [DMZ Zone]          [INT Zone]      [MGMT Zone]
                                        │                   │                │
                                  [bank-web]          [customer-db]   [aegis-forwarder]
                                 10.10.10.10          10.20.20.20      10.30.30.10
                                Apache, vsftpd         PostgreSQL       Hub agent
                                Suricata               Suricata         (SSH → VMs)
                                Fail2ban               Fail2ban
```

> ⚠️ **Attackers can come from any IP address** — no fixed IP range is assumed. Lab test VMs typically use the 192.168.122.0/24 virbr0 network, but any external or internal IP is valid.

**Removed from topology:** R2 (MikroTik), bank-mail server, teller-pc workstation.

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
│          defense, ingest, stream, reports, ai           │
└───────────────────┬─────────────────────────────────────┘
                    │ Drizzle ORM
┌───────────────────▼─────────────────────────────────────┐
│              PostgreSQL (Supabase)                      │
│  Tables: security_events, incidents, alerts,            │
│          system_status, reports, network_hosts,         │
│          blocked_ips, defense_actions, defense_rules    │
└─────────────────────────────────────────────────────────┘
                    ▲
                    │ POST /api/ingest/*  (X-AEGIS-Key)
┌───────────────────┴─────────────────────────────────────┐
│   aegis_forwarder.py  (hub mode — runs on AEGIS VM)     │
│   10.30.30.10 — SSHes into bank-web and customer-db     │
│   to tail their Suricata / Fail2ban / SSH / FTP logs,   │
│   then POSTs events to the API server.                  │
│   Also monitors pfSense health via HTTP ping.           │
└─────────────────────────────────────────────────────────┘
                    ▲
                    │ Attacks (via R1 → pfSense → DMZ/INT)
┌───────────────────┴─────────────────────────────────────┐
│        Attacker VM (any IP)                             │
│  Tools: nmap, sqlmap, nikto, hydra, hping3, metasploit  │
└─────────────────────────────────────────────────────────┘
```

---

## Features

### Security Monitoring
- **Command Center** — Live dashboard with attack volume charts, event counts, critical threat indicators
- **Security Events** — Real-time event feed from all sensors (Suricata, Fail2ban, SSH monitor)
- **Incidents** — Incident management with severity tracking and status updates
- **Active Alerts** — Alert triage panel with acknowledge/resolve actions, Telegram notifications
- **System Status** — Health monitoring for all defense components (per-VM service status)

### Network & Defense
- **Network Monitor** — Live topology map (pfSense, bank-web, customer-db, aegis-forwarder), connected hosts table with real last-seen timestamps
- **Defense Center** — Auto defense status (Fail2ban, Suricata) per device + Admin manual IP block/unblock + pfSense WAN block via REST API

### Intelligence
- **AI Analysis** — Groq llama-3.3-70b threat analysis, per-IP defense recommendations, event explanations (Burmese + English)
- **Reports** — Auto-scheduled SOC reports (Burmese language), Telegram delivery
- **Setup Guide** — Step-by-step hub-mode setup instructions

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 18, Vite, TypeScript, TailwindCSS v4, shadcn/ui |
| Backend | Express 5, Node.js 24, TypeScript |
| Database | PostgreSQL + Drizzle ORM (Supabase pooler) |
| AI | Groq API — llama-3.3-70b-versatile |
| Alerts | Telegram Bot API |
| Validation | Zod, drizzle-zod |
| Real-time | Server-Sent Events (SSE) |
| Monorepo | pnpm workspaces |
| Hosting | Render (API) + Vercel (Dashboard) + Supabase (DB) |

---

## Project Structure

```
aegis-soc-dashboard/
├── artifacts/
│   ├── aegis-dashboard/        # React frontend
│   │   └── src/
│   │       ├── pages/          # dashboard, events, incidents, alerts,
│   │       │                   # system, network, defense, reports, setup
│   │       └── components/     # layout, ui components
│   └── api-server/             # Express API server
│       └── src/
│           ├── routes/         # events, incidents, alerts, system,
│           │                   # network, defense, ingest, stream, reports, ai
│           └── lib/            # broadcaster, auto-defense, groq-client,
│                               # telegram, scheduler, attack-tracker
├── lib/
│   ├── db/                     # Drizzle ORM schema + migrations
│   ├── api-spec/               # OpenAPI specification
│   ├── api-client-react/       # Generated React Query hooks
│   └── api-zod/                # Generated Zod schemas
├── scripts/
│   └── src/
│       └── aegis_forwarder.py  # Hub-mode agent (runs on AEGIS VM 10.30.30.10)
└── docs/
    ├── AEGIS_VM_SETUP.md       # AEGIS VM hub setup guide
    ├── network-architecture.md # Full network topology & IP plan
    ├── SYSTEM_ARCHITECTURE.md  # System data flow & code structure
    ├── API.md                  # API endpoint reference
    └── PROJECT_LOG.md          # Project development log
```

---

## Quick Start (Development)

### Prerequisites
- Node.js 24+
- pnpm 9+
- PostgreSQL database (or Supabase)

### Installation

```bash
git clone https://github.com/sohu2723-star/aegis-soc-dashboard
cd aegis-soc-dashboard
pnpm install
```

### Environment Variables

```bash
# Required — API Server
DATABASE_URL=postgresql://user:password@localhost:5432/aegis
SESSION_SECRET=your-session-secret
AEGIS_INGEST_KEY=your-ingest-key
AEGIS_ADMIN_KEY=your-admin-key

# Optional
GROQ_API_KEY=your-groq-key          # AI analysis
TELEGRAM_BOT_TOKEN=your-bot-token   # Alert notifications
TELEGRAM_CHAT_ID=your-chat-id
```

### Run

```bash
# API Server (port 3000)
PORT=3000 pnpm --filter @workspace/api-server run dev

# Dashboard
pnpm --filter @workspace/aegis-dashboard run dev
```

---

## Connecting the AEGIS VM

See [docs/AEGIS_VM_SETUP.md](docs/AEGIS_VM_SETUP.md) for complete step-by-step setup.

**Quick summary:**
1. AEGIS VM (10.30.30.10) runs `aegis_forwarder.py --mode hub`
2. Hub SSHes into bank-web (10.10.10.10) and customer-db (10.20.20.20)
3. Tails their Suricata, Fail2ban, SSH, FTP logs remotely
4. POSTs all events to Render API — dashboard updates live

---

## Ingest API

All endpoints require `X-AEGIS-Key` header.

| Endpoint | Source | Description |
|---|---|---|
| `POST /api/ingest/event` | Any | Generic security event |
| `POST /api/ingest/suricata` | Suricata | EVE JSON format |
| `POST /api/ingest/fail2ban` | Fail2ban | Ban/unban events |
| `POST /api/ingest/ssh` | auth.log | SSH login events |
| `POST /api/ingest/ftp` | vsftpd.log | FTP session events |
| `POST /api/ingest/http` | ModSecurity | Web attack events |
| `POST /api/network/hosts` | Forwarder | Heartbeat / host registration |

---

## Defense System

### Auto Defense
- SSH brute-force → iptables DROP on bank-web
- Port scan / web attack → iptables DROP + pfSense WAN block
- Critical event → pfSense REST API block rule (persistent, applied immediately)
- All high+ alerts → Telegram notification (immediate push)

### Manual Defense (Dashboard)
- Defense Center → enter any IP + reason → Block
- pfSense WAN block via REST API (if PFSENSE_API_KEY configured)
- Unblock at any time from Active Blocks list
- Full audit log of all block/unblock/pfSense actions

---

## Team

Internship project — cybersecurity lab  
- Red Team: Attack simulation (nmap, sqlmap, hydra, hping3, metasploit)
- Blue Team: Defense (Suricata/Fail2ban), monitoring, incident response, AI analysis

---

## License

MIT
