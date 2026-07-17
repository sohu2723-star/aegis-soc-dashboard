# AEGIS-SecureBank — System Architecture
> Last updated: 2026-07-17
> Topology version: v3 — R2 removed, bank-mail removed, teller-pc removed, hub mode active
> IP source of truth: `docs/ip-plan.md` and `docs/network-architecture.md`

---

## 1. Lab Topology — GNS3 AEGIS-SecureBank (v3 Current)

```
  [Attacker VM]                                                                    │
  (any IP)                                                                         │
       │                                                                            │
  [Switch1] ──→ [Router-1 / MikroTik CHR]                                         │
  [GNS3 NAT]     ether1: 192.168.122.2/24   ← attacker/Switch1 side               │
                 ether2: DHCP               ← NAT internet egress (masquerade)     │
                 ether3: 10.0.23.1/30       ← pfSense WAN (R2 removed — direct)   │
                                │                                                   │
                         [pfSense 2.7.2]                                            │
                      WAN  (em0): 10.0.23.2/30                                     │
                      DMZ  (em1): 10.10.10.1/24                                    │
                      INT  (em2): 10.20.20.1/24                                    │
                      MGMT (em3): 10.30.30.1/24                                    │
                                │                                                   │
             ┌──────────────────┼──────────────────┐                               │
        [DMZ-Switch]       [INT-Switch]         [MGMT]                             │
             │                  │                   │                               │
        [bank-web]        [customer-db]    [aegis-forwarder]                        │
        10.10.10.10        10.20.20.20      10.30.30.10                             │
       Apache, vsftpd       PostgreSQL       Hub agent (--mode hub)                │
       Suricata             Suricata         SSHes → bank-web + customer-db         │
       Fail2ban             Fail2ban         POSTs events to Render API             │
```

**Removed nodes (v3):** Router-2, bank-mail (10.10.10.20), teller-pc (10.20.20.10)

> **Attacker note:** Attackers can come from **any IP address** — not just 192.168.122.x.
> Any external, internal, or VPN IP should be treated as a potential threat source.

> **Forwarder model (hub mode):** A single `aegis_forwarder.py --mode hub` runs on the AEGIS VM
> (10.30.30.10). It SSHes into bank-web and customer-db every 15 seconds to tail their Suricata,
> Fail2ban, SSH, and FTP logs, then POSTs all events directly to the API server.
> Bank VMs do NOT run the forwarder script themselves — hub handles all collection.

---

## 2. Network Segments & IP Plan (v3 Current)

| Segment | Subnet | pfSense Interface | Purpose |
|---|---|---|---|
| Attacker path (virbr0) | 192.168.122.0/24 | — | GNS3 NAT — attacker VM side (any IP valid) |
| R1 ↔ pfSense WAN | 10.0.23.0/30 | vtnet0 / em0 | Edge uplink (direct, R2 removed) |
| DMZ | 10.10.10.0/24 | vtnet1 / em1 | Public-facing bank services |
| Internal | 10.20.20.0/24 | vtnet2 / em2 | Internal bank systems |
| Management | 10.30.30.0/24 | vtnet3 / em3 | AEGIS monitoring segment |

### Node IP Reference (canonical)

| Node | IP | Subnet | Role |
|---|---|---|---|
| Attacker VM | any (192.168.122.x typical) | virbr0 | Red team — any IP possible |
| Router-1 ether1 | 192.168.122.2/24 | virbr0 | Switch1/attacker side |
| Router-1 ether2 | DHCP auto | NAT cloud | Internet egress (masquerade) |
| Router-1 ether3 | 10.0.23.1/30 | R1↔pfSense | Direct to pfSense WAN (R2 removed) |
| pfSense WAN (em0) | 10.0.23.2/30 | R1↔pfSense | Firewall WAN |
| pfSense DMZ (em1) | 10.10.10.1/24 | DMZ | DMZ gateway |
| pfSense INT (em2) | 10.20.20.1/24 | Internal | Internal gateway |
| pfSense MGMT (em3) | 10.30.30.1/24 | Management | MGMT gateway |
| bank-web | 10.10.10.10/24 | DMZ | Apache2, vsftpd, Suricata, Fail2ban |
| customer-db | 10.20.20.20/24 | Internal | PostgreSQL, Suricata, Fail2ban |
| aegis-forwarder | 10.30.30.10/24 | Management | Hub agent — SSHes into bank VMs |

**Removed nodes:** Router-2, bank-mail (10.10.10.20), teller-pc (10.20.20.10)

---

## 3. Component Roles (v3 Current)

### Network Infrastructure
| Component | Type | Config |
|---|---|---|
| Switch1 | GNS3 Ethernet switch | L2 — connects attacker VM + virbr0 cloud to R1 |
| Router-1 (R1) | MikroTik CHR | ether1=virbr0 side, ether2=NAT DHCP, ether3=10.0.23.1 (pfSense direct) |
| pfSense | pfSense CE 2.7.x | Stateful FW — 4 zones: WAN/DMZ/INT/MGMT |
| DMZ-Switch | GNS3 Ethernet switch | bank-web only |
| INT-Switch | GNS3 Ethernet switch | customer-db + aegis-forwarder |

### Security Tools per VM
| VM | IP | Tools | Log Files (tailed by hub) |
|---|---|---|---|
| bank-web | 10.10.10.10 | Apache2, vsftpd, ModSecurity WAF, Suricata, Fail2ban | `/var/log/suricata/eve.json`, `/var/log/fail2ban.log`, `/var/log/auth.log`, `/var/log/vsftpd.log` |
| customer-db | 10.20.20.20 | PostgreSQL, Suricata, Fail2ban | `/var/log/suricata/eve.json`, `/var/log/fail2ban.log`, `/var/log/auth.log` |
| aegis-forwarder | 10.30.30.10 | `aegis_forwarder.py --mode hub` | SSHes into bank-web + customer-db every 15s, tails their logs, POSTs to API |

### AEGIS Platform
| Component | Host | URL |
|---|---|---|
| Dashboard (React/Vite) | Vercel | https://aegis-soc-dashboard.vercel.app |
| API Server (Express 5) | Render | https://aegis-api-server-jp3b.onrender.com |
| Database (PostgreSQL) | Supabase | Port 6543 pooler (aws-1-ap-southeast-2) |

---

## 4. Full Data Flow — Attack → Dashboard (Hub Mode, v3)

```
┌──────────────────────────────────────────────────────────────────────┐
│              ATTACK PHASE (Red Team — any IP)                        │
│                                                                       │
│  Attacker (any IP) → Switch1 → R1 → pfSense WAN → DMZ/INT          │
│  ├── nmap -sV -p- 10.10.10.10           ← port scan → Suricata      │
│  ├── hydra ssh://10.10.10.10            ← SSH brute → Fail2ban       │
│  ├── sqlmap -u http://10.10.10.10       ← SQLi → ModSecurity WAF     │
│  ├── hping3 --flood 10.10.10.10         ← DDoS → Suricata            │
│  └── hydra postgres://10.20.20.20       ← DB brute → Fail2ban        │
└──────────────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌──────────────────────────────────────────────────────────────────────┐
│                   DETECTION PHASE (Bank VMs)                         │
│                                                                       │
│  bank-web (10.10.10.10)                                               │
│  ├── Suricata     → /var/log/suricata/eve.json                       │
│  ├── Fail2ban     → /var/log/fail2ban.log                            │
│  ├── SSH auth     → /var/log/auth.log                                │
│  └── vsftpd       → /var/log/vsftpd.log                              │
│                                                                       │
│  customer-db (10.20.20.20)                                            │
│  ├── Suricata     → /var/log/suricata/eve.json                       │
│  ├── Fail2ban     → /var/log/fail2ban.log                            │
│  └── SSH auth     → /var/log/auth.log                                │
└──────────────────────────────────────────────────────────────────────┘
                          │  logs written locally on each bank VM
                          ▼
┌──────────────────────────────────────────────────────────────────────┐
│           FORWARDING PHASE (Hub — aegis_forwarder --mode hub)        │
│                                                                       │
│  aegis_forwarder.py runs on AEGIS VM (10.30.30.10) only.            │
│  No forwarder script on bank VMs.                                     │
│                                                                       │
│  Every 15 seconds, hub SSHes into each bank VM and tails new lines: │
│  ├── bank-web   : suricata eve.json, fail2ban.log, auth.log, vsftpd │
│  └── customer-db: suricata eve.json, fail2ban.log, auth.log          │
│                                                                       │
│  Hub also monitors its own local services:                            │
│  ├── service_health_loop — reports AEGIS VM's own service status     │
│  ├── _remote_service_health_loop — SSH checks bank VM services       │
│  ├── _pfsense_health_loop — HTTP ping pfSense every 30s              │
│  ├── heartbeat_loop — POST /api/network/hosts every 15s              │
│  └── defense_agent_loop — polls + executes defense commands every 5s │
│                                                                       │
│  All parsed events → POST to API Server                              │
│  Header: X-AEGIS-Key: $AEGIS_KEY                                     │
└──────────────────────────────────────────────────────────────────────┘
                          │ HTTPS (Render)
                          ▼
┌──────────────────────────────────────────────────────────────────────┐
│                  API SERVER (Express 5 — Render)                      │
│                                                                       │
│  POST /api/ingest/suricata → parse EVE alert → events table          │
│  POST /api/ingest/fail2ban → parse ban line → events + blocked_ips  │
│  POST /api/ingest/ssh      → parse auth.log → events (ssh_brute)    │
│  POST /api/ingest/http     → parse ModSec → events (web_attack)     │
│  POST /api/ingest/traffic  → packet counts → network_traffic         │
│  POST /api/network/hosts   → upsert → network_hosts                  │
│  POST /api/ingest/event    → generic → events                        │
│                                                                       │
│  After each ingest → evaluateEvent() auto-defense pipeline:          │
│  ├── toTriggerType()    normalize event type                         │
│  ├── recordAttack()     rolling window counter (attack_tracker.ts)   │
│  ├── match defense_rules (threshold + severity + type)               │
│  ├── buildCommand() + sanitizeIp/Port/Protocol                       │
│  └── INSERT defense_commands {status: "pending", target_vm}          │
│                                                                       │
│  SSE: /api/events/stream → broadcaster.ts → dashboard clients        │
└──────────────────────────────────────────────────────────────────────┘
          │ persist                              │ SSE push
          ▼                                      ▼
┌────────────────────┐         ┌────────────────────────────────────┐
│ Supabase PostgreSQL│         │  Dashboard (React — Vercel)        │
│                    │         │                                    │
│  events            │◄────────│  Command Center  — live counters  │
│  network_hosts     │  query  │  Security Events — live table     │
│  network_traffic   │         │  Network Monitor — host map       │
│  blocked_ips       │         │  System Status   — service health │
│  defense_rules     │         │  Defense Center  — block log      │
│  defense_commands  │         │  Incidents       — alert queue    │
│  firewall_rules    │         └────────────────────────────────────┘
│  incidents         │
└────────────────────┘
          │ poll every 5s
          ▼
┌──────────────────────────────────────────────────────────────────────┐
│                 DEFENSE AGENT (hub handles this — no separate script) │
│                                                                       │
│  aegis_forwarder.py --mode hub (defense_agent_loop thread)           │
│  ├── GET /api/defense/commands/pending  (auth: X-AEGIS-Admin-Key)   │
│  ├── block_ip   → sudo iptables -A INPUT -s <IP> -j DROP            │
│  ├── null_route → sudo ip route add blackhole <IP>                  │
│  └── POST /api/defense/commands/:id/result  (done/failed)           │
└──────────────────────────────────────────────────────────────────────┘
```

---

## 5. Auto-Defense Code Flow

```
POST /api/ingest/* arrives
  │
  ▼ middlewares/ingest-auth.ts
  └─ validateHeader("X-AEGIS-Key", process.env.AEGIS_INGEST_KEY)
  │
  ▼ routes/ingest/<type>.ts
  └─ parse raw log → normalized event:
     { src_ip, type, subtype, severity, description, targetHost }
  │
  ▼ lib/auto-defense.ts → evaluateEvent(event)
  ├─ toTriggerType(event.type)
  │    "suricata_alert"   → "ddos" | "port_scan" | "web_attack" …
  │    "fail2ban"         → "ssh_brute" | "ftp_brute" …
  │    "cowrie"           → "honeypot"
  ├─ attack-tracker.ts → recordAttack(src_ip, triggerType)
  │    key = "${src_ip}::${triggerType}"
  │    increments counter in 60s rolling window
  ├─ db.select defense_rules WHERE
  │    triggerAttackType IN (triggerType, "any")
  │    AND threshold <= currentCount
  │    AND is_enabled = true
  └─ If rule matched:
      ├─ defense-sanitize.ts:
      │    sanitizeIp()       — IPv4 + optional CIDR only; throws on anything else
      │    sanitizePort()     — integer 1–65535 only
      │    sanitizeProtocol() — "tcp" | "udp" | "icmp" | "all" only
      ├─ buildCommand(actionType, sanitizedIp, port, protocol)
      │    "block_ip"      → "iptables -A INPUT -s {ip} -j DROP"
      │    "null_route"    → "ip route add blackhole {ip}"
      │    "pfsense_block" → pfSense REST API payload
      │    "suggest"       → no command, create incident only
      └─ db.insert defense_commands { command_text, status:"pending", target_vm }
           │
           ▼ SSE broadcast → dashboard Defense Center live update
           │
           ▼ defense_agent.py polls (5s)
             GET /api/defense/commands/pending
             → executes sudo command
             → POST /api/defense/commands/:id/result
```

---

## 6. Monorepo Code Structure

```
aegis-soc-dashboard/
├── artifacts/
│   ├── aegis-dashboard/              ← React 18 + Vite + Tailwind (frontend)
│   │   └── src/
│   │       ├── pages/                ← system.tsx, network.tsx, events.tsx, defense.tsx …
│   │       ├── components/           ← UI components
│   │       └── hooks/use-sse.ts      ← EventSource → live push
│   └── api-server/                   ← Express 5 API (backend)
│       └── src/
│           ├── routes/
│           │   ├── ingest/           ← suricata.ts, fail2ban.ts, ssh.ts, http.ts …
│           │   ├── network/          ← hosts.ts, traffic.ts
│           │   ├── defense/          ← commands.ts, rules.ts
│           │   └── stream.ts         ← SSE endpoint
│           ├── lib/
│           │   ├── auto-defense.ts   ← evaluateEvent() pipeline
│           │   ├── broadcaster.ts    ← SSE event push singleton
│           │   ├── attack-tracker.ts ← rolling window counters
│           │   └── defense-sanitize.ts ← IP/port sanitization (no shell injection)
│           └── middleware/           ← ingest-auth.ts, admin-auth.ts
├── lib/
│   ├── db/src/schema/                ← Drizzle ORM tables (events, network_hosts …)
│   ├── api-spec/                     ← OpenAPI YAML (source of truth)
│   ├── api-client-react/             ← Generated React Query hooks
│   └── api-zod/                      ← Generated Zod schemas
└── scripts/src/
    └── aegis_forwarder.py            ← Hub agent (--mode hub): runs on AEGIS VM only,
                                         SSHes into bank VMs to tail logs, executes defense
                                         commands, monitors pfSense health via HTTP ping
```

---

## 7. API Endpoint Reference

| Endpoint | Auth Header | Parsed From | Stored In |
|---|---|---|---|
| `POST /api/ingest/suricata` | X-AEGIS-Key | Suricata EVE JSON | events |
| `POST /api/ingest/snort` | X-AEGIS-Key | Snort alert text | events |
| `POST /api/ingest/fail2ban` | X-AEGIS-Key | fail2ban.log | events + blocked_ips |
| `POST /api/ingest/ssh` | X-AEGIS-Key | auth.log | events (ssh_brute) |
| `POST /api/ingest/ftp` | X-AEGIS-Key | vsftpd.log | events (ftp_brute) |
| `POST /api/ingest/http` | X-AEGIS-Key | ModSecurity audit | events (web_attack) |
| `POST /api/ingest/cowrie` | X-AEGIS-Key | Cowrie JSON | events (honeypot) |
| `POST /api/ingest/pfsense` | X-AEGIS-Key | pfSense filterlog UDP | events |
| `POST /api/ingest/traffic` | X-AEGIS-Key | tcpdump byte counts | network_traffic |
| `POST /api/ingest/event` | X-AEGIS-Key | Generic object | events |
| `POST /api/network/hosts` | X-AEGIS-Key | nmap / heartbeat | network_hosts |
| `GET /api/defense/commands/pending` | X-AEGIS-Admin-Key | — | Returns pending commands |
| `POST /api/defense/commands/:id/result` | X-AEGIS-Admin-Key | {success, output} | Updates command status |
| `GET /api/events/stream` | — | — | SSE live stream to dashboard |

---

## 8. Real-Time SSE Architecture

```
Dashboard browser
  └── useSSE() hook → new EventSource("/api/events/stream")
                              │ persistent HTTP/1.1 connection
                              ▼
               GET /api/events/stream (Express route)
               └── broadcaster.ts singleton
                   └── addClient(res) — adds res to Set<Response>
                        │
                        When any ingest handler fires:
                        broadcaster.broadcast(normalizedEvent)
                        └── for each res in clients:
                            res.write(`data: ${JSON.stringify(event)}\n\n`)
                        │
                        Dashboard: EventSource.onmessage → setState → re-render
```

Auto-reconnect is built into the browser EventSource API. No WebSocket, no polling.

---

## 9. Required Secrets

| Secret | Env Var Name | Used By | Consequence if Missing |
|---|---|---|---|
| Supabase pooler URL | `SUPABASE_DB_URL` | API server (Drizzle) | Server refuses to start |
| Ingest key | `AEGIS_INGEST_KEY` | VM scripts → `/api/ingest/*` | Server refuses to start |
| Admin key | `AEGIS_ADMIN_KEY` | Dashboard + defense_agent | Server refuses to start |
| Session secret | `SESSION_SECRET` | Express session signing | Server refuses to start |

> ⚠️ All four secrets are validated at module load time. The server will not start if any one is missing.
> VM scripts use `AEGIS_KEY` environment variable (set to the value of `AEGIS_INGEST_KEY`).
