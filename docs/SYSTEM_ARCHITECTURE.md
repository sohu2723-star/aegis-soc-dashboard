# AEGIS-SecureBank — System Architecture
> Last updated: 2026-07-10
> Topology source: GNS3 project "AEGIS-SecureBank"

---

## 1. Lab Topology Overview

```
                           ┌─────────────────────────────────────────────────────────┐
                           │                GNS3 — AEGIS-SecureBank                   │
                           │                                                           │
  ┌──────────────┐         │  ┌──────────┐     ┌──────────┐     ┌──────────┐          │
  │  Kali Linux  │─(e0)────┼──┤ Switch1  ├─(e1)┤ Router-1 ├─(e0)┤ Router-2 ├─(e1)─┐  │
  │192.168.122.x │         │  └──────────┘     └────┬─────┘     └──────────┘      │  │
  └──────────────┘         │       │ (b2)            │ (e2)                         │  │
                           │  ┌────┴──────┐     ┌───┴────┐                          │  │
                           │  │ Internet  │     │  NAT   │                          │  │
                           │  │ (virbr0)  │     │ cloud  │                          │  │
                           │  └───────────┘     └────────┘                          │  │
                           │                                                         ▼  │
                           │                                                ┌──────────┐│
                           │                                                │  pfSense  ││
                           │                                                │ e0:WAN    ││
                           │                                                │ e1:DMZ    ││
                           │                                                │ e2:INT    ││
                           │                                                │ e3:MGMT   ││
                           │                                                └─┬──┬──┬──┘│
                           │                                         (e1)DMZ─┘  │  └─MGMT(e3)│
                           │                                                    │ (e2)INT     │
                           │                    ┌────────────────┐             ┌┴───────────┐  ┌────────────┐│
                           │                    │   DMZ-Switch   │             │ INT-Switch  │  │  MGMT      ││
                           │                    └─┬──────┬───┬───┘             └─┬────────┬─┘  └────┬───────┘│
                           │                      │      │   │                   │        │         │        │
                           │                   bank  bank  teller-pc        customer   aegis-     (direct) │
                           │                   -web  -mail  (e0)            -db (e0)   forwarder           │
                           │                   (e0)  (e0)                              (e0)                │
                           └─────────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Network Segments & IP Plan

| Segment | Subnet | pfSense IF | Purpose |
|---|---|---|---|
| WAN | 10.10.0.0/30 | vtnet0 (e0) | Router-2 → pfSense uplink |
| DMZ | 10.10.10.0/24 | vtnet1 (e1) | Public-facing bank services |
| Internal | 10.10.20.0/24 | vtnet2 (e2) | Internal bank systems |
| Management | 10.10.30.0/24 | vtnet3 (e3) | AEGIS monitoring segment |
| Attacker/Internet | 192.168.122.0/24 | virbr0 | KVM host network (Kali access) |
| R1↔R2 link | 10.0.12.0/30 | — | MikroTik-to-MikroTik backhaul |
| R2↔pfSense link | 10.10.0.0/30 | — | Edge-to-firewall WAN link |

### Node IP Reference

| Node | IP | Segment | Role |
|---|---|---|---|
| Kali Linux (GNS3 VM) | 192.168.122.132 (DHCP) | virbr0 | Red team attacker |
| Router-1 ether1 | 192.168.122.2/24 | virbr0 | LAN-side toward Kali |
| Router-1 ether2 | DHCP auto | NAT cloud | Internet egress |
| Router-1 ether3 | 10.0.12.1/30 | R1↔R2 | Link to R2 |
| Router-2 ether1 | 10.0.12.2/30 | R1↔R2 | Link from R1 |
| Router-2 ether2 | 10.10.0.1/30 | WAN link | Toward pfSense |
| pfSense WAN | 10.10.0.2/30 | WAN link | Edge firewall WAN |
| pfSense DMZ | 10.10.10.1/24 | DMZ | DMZ gateway |
| pfSense INT | 10.10.20.1/24 | Internal | INT gateway |
| pfSense MGMT | 10.10.30.1/24 | Management | MGMT gateway |
| bank-web | 10.10.10.10/24 | DMZ | Apache/nginx + ModSecurity |
| bank-mail | 10.10.10.20/24 | DMZ | Postfix mail server |
| teller-pc | 10.10.10.30/24 | DMZ | Teller workstation |
| customer-db | 10.10.20.20/24 | Internal | PostgreSQL database |
| aegis-forwarder | 10.10.30.10/24 | Management | AEGIS hub collector |

---

## 3. Component Roles

### Network Infrastructure
| Component | Type | Role |
|---|---|---|
| Switch1 | GNS3 managed switch | Connects Kali + Internet cloud to Router-1 |
| Router-1 | MikroTik CHR | Edge router — NAT masquerade for internet access |
| Router-2 | MikroTik CHR | Core router — routes between R1 and pfSense |
| pfSense | pfSense CE | Stateful firewall — zones: WAN, DMZ, INT, MGMT |
| DMZ-Switch | GNS3 managed switch | L2 switch for DMZ hosts |
| INT-Switch | GNS3 managed switch | L2 switch for internal + management hosts |

### Security Tools per VM

| VM | Tools Installed | Log Files |
|---|---|---|
| bank-web (10.10.10.10) | Apache/Nginx, ModSecurity WAF, Suricata | `/var/log/apache2/modsec_audit.log`, `/var/log/suricata/eve.json` |
| bank-mail (10.10.10.20) | Postfix, Fail2ban | `/var/log/mail.log`, `/var/log/fail2ban.log` |
| teller-pc (10.10.10.30) | Cowrie honeypot, Fail2ban, SSH | `/var/log/cowrie/cowrie.json`, `/var/log/auth.log` |
| aegis-forwarder (10.10.30.10) | `aegis_forwarder_hub.py`, nmap, tcpdump | Central collector |

### AEGIS Platform
| Component | Host | URL |
|---|---|---|
| Dashboard (React/Vite) | Vercel | https://aegis-soc-dashboard.vercel.app |
| API Server (Express 5) | Render | https://aegis-api-server-jp3b.onrender.com |
| Database (PostgreSQL) | Supabase | Port 6543 pooler |

---

## 4. Full Data Flow — Attack to Dashboard

```
┌─────────────────────────────────────────────────────────────────────┐
│                       ATTACK PHASE (Red Team)                        │
│                                                                      │
│  Kali Linux (192.168.122.132)                                        │
│  ├── nmap -sV -p- 10.10.10.10          ← port scan                 │
│  ├── hydra ssh://10.10.10.30           ← SSH brute-force            │
│  ├── sqlmap -u http://10.10.10.10      ← SQLi                       │
│  ├── hping3 --flood 10.10.10.10        ← DDoS/SYN flood             │
│  └── curl (malformed requests)         ← WAF bypass attempt         │
│                                                                      │
│  Path: Kali → Switch1 → R1 → R2 → pfSense (WAN→DMZ) → bank-web     │
└─────────────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────────────┐
│                     DETECTION PHASE (Blue Team)                      │
│                                                                      │
│  bank-web (10.10.10.10)                                              │
│  ├── Suricata detects → /var/log/suricata/eve.json                  │
│  ├── ModSecurity detects → /var/log/apache2/modsec_audit.log        │
│  └── Fail2ban detects → /var/log/fail2ban.log                       │
│                                                                      │
│  teller-pc (10.10.10.30)                                            │
│  ├── Fail2ban (SSH brute) → /var/log/fail2ban.log                   │
│  ├── Cowrie honeypot → /var/log/cowrie/cowrie.json                  │
│  └── auth.log → /var/log/auth.log                                   │
│                                                                      │
│  bank-mail (10.10.10.20)                                            │
│  └── Postfix/Fail2ban → /var/log/mail.log                           │
└─────────────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────────────┐
│                   FORWARDING PHASE (aegis-forwarder)                 │
│                                                                      │
│  aegis_forwarder_hub.py (10.10.30.10)                               │
│  ├── SSH into bank-web:22 → tail /var/log/suricata/eve.json         │
│  ├── SSH into bank-web:22 → tail modsec_audit.log                   │
│  ├── SSH into teller-pc:22 → tail cowrie.json + auth.log            │
│  ├── SSH into bank-mail:22 → tail fail2ban.log                      │
│  ├── tcpdump on MGMT interface → /api/ingest/traffic                │
│  └── nmap 10.10.10.0/24, 10.10.20.0/24 → /api/network/hosts        │
│                                                                      │
│  Each log line → parse → POST to API Server                         │
│  Header: X-AEGIS-Key: $AEGIS_KEY                                    │
└─────────────────────────────────────────────────────────────────────┘
                          │
                          ▼ HTTPS to Render
┌─────────────────────────────────────────────────────────────────────┐
│                    API SERVER (Express 5 on Render)                  │
│                                                                      │
│  POST /api/ingest/suricata  → parseAlert() → events table           │
│  POST /api/ingest/fail2ban  → parseBan()   → events + blocked_ips  │
│  POST /api/ingest/cowrie    → parseHoney() → events table           │
│  POST /api/ingest/ssh       → parseAuth()  → events table           │
│  POST /api/ingest/http      → parseWAF()   → events table           │
│  POST /api/ingest/traffic   → parseTraf()  → network_traffic table  │
│  POST /api/network/hosts    → upsert       → network_hosts table    │
│                                                                      │
│  After each ingest:                                                  │
│  └── evaluateEvent() → auto-defense engine                          │
│      ├── toTriggerType() — normalize event type                     │
│      ├── recordAttack() — count in rolling window (attack_tracker)  │
│      ├── match defense_rules table                                  │
│      ├── buildCommand() + sanitizeIp/Port/Protocol                  │
│      └── INSERT defense_commands (status=pending)                   │
│                                                                      │
│  SSE broadcaster: /api/events/stream                                 │
│  └── every new event → push to all connected dashboard clients      │
└─────────────────────────────────────────────────────────────────────┘
                          │                              │
               persist to DB                      SSE push
                          ▼                              ▼
┌──────────────────────┐         ┌───────────────────────────────────┐
│  Supabase PostgreSQL  │         │    Dashboard (React on Vercel)    │
│                       │         │                                   │
│  Tables:              │         │  Command Center  — live counters  │
│  ├── events           │◄────────┤  Security Events — live table     │
│  ├── network_hosts    │  query  │  Network Monitor — topology map   │
│  ├── network_traffic  │         │  System Status   — service health │
│  ├── blocked_ips      │         │  Defense Center  — block actions  │
│  ├── defense_rules    │         │  Incidents       — alert queue    │
│  ├── defense_commands │         │  Threat Intel    — geo + IOCs     │
│  ├── firewall_rules   │         └───────────────────────────────────┘
│  └── incidents        │
└──────────────────────┘
                          │
                          ▼ polling every 5s
┌─────────────────────────────────────────────────────────────────────┐
│                    DEFENSE AGENT (on VM)                             │
│                                                                      │
│  defense_agent.py --vm ubuntu  (on bank-web or teller-pc)          │
│  └── GET /api/defense/commands/pending                               │
│      ├── block_ip → sudo iptables -A INPUT -s <IP> -j DROP          │
│      ├── null_route → sudo ip route add blackhole <IP>              │
│      └── POST /api/defense/commands/:id/result (done/failed)        │
│                                                                      │
│  defense_agent.py --vm pfsense (on pfSense if API is enabled)       │
│  └── pfSense REST API → add firewall rule                           │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 5. Monorepo Code Structure

```
aegis-soc-dashboard/
├── artifacts/
│   ├── aegis-dashboard/          ← React 18 + Vite + Tailwind frontend
│   │   └── src/
│   │       ├── pages/            ← Dashboard pages (system, network, events, defense…)
│   │       ├── components/       ← UI components
│   │       └── hooks/            ← use-sse.ts, API query hooks
│   └── api-server/               ← Express 5 API server
│       └── src/
│           ├── routes/           ← ingest/, network/, defense/, stream.ts
│           ├── lib/
│           │   ├── auto-defense.ts   ← evaluateEvent() pipeline
│           │   ├── broadcaster.ts    ← SSE event push
│           │   ├── attack-tracker.ts ← rolling window counter
│           │   └── defense-sanitize.ts ← IP/port sanitization
│           └── middleware/       ← auth (AEGIS_INGEST_KEY, AEGIS_ADMIN_KEY)
├── lib/
│   ├── db/                       ← Drizzle ORM schema + migrations
│   │   └── src/schema/           ← events, network_hosts, defense_commands…
│   ├── api-spec/                 ← OpenAPI YAML (source of truth)
│   ├── api-client-react/         ← Generated React Query hooks (from OpenAPI)
│   └── api-zod/                  ← Generated Zod schemas (from OpenAPI)
├── scripts/src/
│   ├── aegis_forwarder.py        ← Agent-mode: runs ON Ubuntu VM, reads local logs
│   ├── aegis_forwarder_hub.py    ← Hub-mode: runs on aegis-forwarder, SSH-collects
│   ├── pfsense_forwarder.py      ← pfSense syslog UDP receiver
│   ├── defense_agent.py          ← Polls command queue, executes iptables/pfSense
│   └── aegis-fail2ban-action.conf← Fail2ban action to POST direct to API
└── docs/                         ← All documentation
```

---

## 6. API Ingest Endpoints

| Endpoint | Auth | Payload Source | What It Stores |
|---|---|---|---|
| `POST /api/ingest/suricata` | X-AEGIS-Key | Suricata EVE JSON `alert` event | events (network_scan / ddos / web_attack) |
| `POST /api/ingest/snort` | X-AEGIS-Key | Snort unified2/alert line | events |
| `POST /api/ingest/fail2ban` | X-AEGIS-Key | fail2ban.log ban line | events + blocked_ips |
| `POST /api/ingest/ssh` | X-AEGIS-Key | auth.log failed login | events (ssh_brute) |
| `POST /api/ingest/ftp` | X-AEGIS-Key | vsftpd.log failed | events (ftp_brute) |
| `POST /api/ingest/http` | X-AEGIS-Key | ModSecurity audit | events (web_attack) |
| `POST /api/ingest/cowrie` | X-AEGIS-Key | Cowrie JSON | events (honeypot) |
| `POST /api/ingest/pfsense` | X-AEGIS-Key | pfSense filterlog UDP | events |
| `POST /api/ingest/traffic` | X-AEGIS-Key | tcpdump byte count | network_traffic |
| `POST /api/ingest/event` | X-AEGIS-Key | Generic event object | events |
| `POST /api/network/hosts` | X-AEGIS-Key | Host discovery result | network_hosts |
| `GET /api/defense/commands/pending` | X-AEGIS-Admin-Key | — | Returns pending commands |
| `POST /api/defense/commands/:id/result` | X-AEGIS-Admin-Key | {success, output} | Updates command status |
| `GET /api/events/stream` | — | — | SSE stream to dashboard |

---

## 7. Auto-Defense Pipeline (Code Flow)

```
POST /api/ingest/* arrives
        │
        ▼
middlewares/ingest-auth.ts
  └── validateHeader("X-AEGIS-Key", AEGIS_INGEST_KEY)
        │
        ▼
routes/ingest/*.ts
  └── parse raw log line into normalized event object:
      { src_ip, type, subtype, severity, description, targetHost }
        │
        ▼
lib/auto-defense.ts → evaluateEvent(event)
  ├── toTriggerType(event.type) → maps "suricata_alert" → "ddos" etc.
  ├── attack-tracker.ts → recordAttack(src_ip, triggerType)
  │     └── Increment counter in Map<"ip::type", {count, firstSeen}>
  │         Rolling window: 60s default
  ├── db.select from defense_rules WHERE triggerAttackType matches
  │     and threshold <= currentCount
  │     and is_enabled = true
  └── If rule found:
      ├── defense-sanitize.ts → sanitizeIp(src_ip), sanitizePort(), sanitizeProtocol()
      ├── buildCommand(rule.actionType, sanitizedIp, port, protocol)
      │     block_ip    → "iptables -A INPUT -s {ip} -j DROP"
      │     null_route  → "ip route add blackhole {ip}"
      │     pfsense_block → pfSense REST API call object
      │     suggest     → no command, create incident only
      └── db.insert into defense_commands { command_text, status: "pending", target_vm }
                │
                ▼
        SSE broadcast → dashboard Defense Center updates live
                │
                ▼
        defense_agent.py on VM polls every 5s
        GET /api/defense/commands/pending
        → executes command → POST result back
```

---

## 8. Required Secrets

| Secret | Where Set | Used By |
|---|---|---|
| `SUPABASE_DB_URL` | Replit Secrets (Render env) | API server DB connection (port 6543 pooler) |
| `AEGIS_INGEST_KEY` | Replit Secrets (Render env) | VM scripts → API ingest auth header |
| `AEGIS_ADMIN_KEY` | Replit Secrets (Render env) | Dashboard admin + defense_agent auth |
| `SESSION_SECRET` | Replit Secrets (Render env) | Express session signing |

> ⚠️ Both `AEGIS_INGEST_KEY` and `AEGIS_ADMIN_KEY` are checked at **server startup**. If either is missing, the API server refuses to start.

---

## 9. Real-Time Architecture (SSE)

```
Dashboard browser
  └── useSSE() hook
      └── EventSource("/api/events/stream")
              │ persistent HTTP connection
              ▼
      GET /api/events/stream (Express route)
      └── broadcaster.ts singleton
          └── addClient(res) — adds response to client Set
              │
              When any ingest fires:
              broadcaster.broadcast(event)
              └── for each res in clients:
                  res.write(`data: ${JSON.stringify(event)}\n\n`)
              │
              Dashboard receives → React state update → UI re-renders
```

No WebSocket. No polling. One-directional SSE push, auto-reconnect built into EventSource API.
