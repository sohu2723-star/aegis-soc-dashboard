# AEGIS-SecureBank — System Architecture
> Last updated: 2026-07-09
> Topology source: GNS3 project "AEGIS-SecureBank" (photo 2026-07-10 02:10)
> IP source of truth: per-VM `scripts/src/aegis_forwarder.py` deployments (agent mode — no central hub, no SSH collection)

---

## 1. Lab Topology — GNS3 AEGIS-SecureBank

```
                   ┌──────────────────────────────────────────────────────────────────────┐
                   │                     GNS3 — AEGIS-SecureBank                          │
                   │                                                                       │
   [Kali/Attacker] ──(e0)──┐                                                             │
  192.168.122.132           │                                                             │
                   │  [Switch1] ──(e1)──→ [Router-1] ──(e2)──→ [Router-2] ──(e1)──┐     │
  [Internet virbr0]──(b2)──┘               │  192.168.122.2      │  10.0.12.2      │     │
                   │                       │  10.0.12.1           │  10.0.23.1      │     │
                   │                  (e1)─→[NAT cloud]           └────────────────┘     │
                   │                                                        │ 10.0.23.2   │
                   │                                                   [pfSense]          │
                   │                                              WAN:  10.0.23.2/30      │
                   │                                              DMZ:  10.10.10.1/24     │
                   │                                              INT:  10.20.20.1/24     │
                   │                                              MGMT: 10.30.30.1/24     │
                   │                                                   │        │         │
                   │                                          (e1/DMZ) │        │ (e2/INT)│
                   │                                                   │        │         │
                   │                                          [DMZ-Switch]  [INT-Switch]  │
                   │                                          │    │    │    │    │    │  │
                   │                                       bweb bmail  ---  tpc  cdb afwd │
                   │                                    .10  .20       .10  .20  .10     │
                   └──────────────────────────────────────────────────────────────────────┘

  bweb = bank-web     tpc  = teller-pc
  bmail= bank-mail    cdb  = customer-db
  afwd = aegis-forwarder (10.30.30.10 — on INT-Switch, pfSense MGMT routes to it)
```

> **Topology note from image:** The GNS3 screenshot shows teller-pc physically on DMZ-Switch port,
> but its IP (10.20.20.10) is in the Internal (10.20.20.0/24) segment routed by pfSense INT interface.
> aegis-forwarder is on INT-Switch with IP 10.30.30.10 (MGMT subnet, pfSense vtnet3 routes it).

> **Forwarder model (current):** There is no central SSH hub. Each VM (bank-web, bank-mail,
> teller-pc, customer-db, aegis-forwarder) runs its **own local copy** of `aegis_forwarder.py`,
> tailing its own log files and POSTing directly to the API server. No SSH between VMs is
> required for log collection. `aegis-forwarder` (10.30.30.10) still runs the nmap network
> scanner, tcpdump traffic capture, and heartbeat for itself — it no longer SSHes into the
> other VMs to collect their logs.

---

## 2. Network Segments & IP Plan

| Segment | Subnet | pfSense Interface | Purpose |
|---|---|---|---|
| Attacker / Internet | 192.168.122.0/24 | — (virbr0 host) | KVM network — Kali attack origin |
| R1 ↔ R2 link | 10.0.12.0/30 | — | MikroTik backbone |
| R2 ↔ pfSense WAN | 10.0.23.0/30 | vtnet0 / e0 | Edge uplink |
| DMZ | 10.10.10.0/24 | vtnet1 / e1 | Public-facing bank services |
| Internal | 10.20.20.0/24 | vtnet2 / e2 | Internal bank systems |
| Management | 10.30.30.0/24 | vtnet3 / e3 | AEGIS monitoring segment |

### Node IP Reference (canonical — matches per-VM aegis_forwarder.py deployments)

| Node | IP | Subnet | Role |
|---|---|---|---|
| Kali Linux (GNS3 VM) | 192.168.122.132 (DHCP) | virbr0 | Red team attacker |
| Router-1 ether1 | 192.168.122.2/24 | virbr0 | LAN-side toward Switch1/Kali |
| Router-1 ether2 | DHCP auto | NAT cloud | Internet egress (NAT masquerade) |
| Router-1 ether3 | 10.0.12.1/30 | R1↔R2 | Uplink to Router-2 |
| Router-2 ether1 | 10.0.12.2/30 | R1↔R2 | Downlink from Router-1 |
| Router-2 ether2 | 10.0.23.1/30 | R2↔pfSense | Uplink to pfSense WAN |
| pfSense WAN (vtnet0) | 10.0.23.2/30 | R2↔pfSense | Firewall edge |
| pfSense DMZ (vtnet1) | 10.10.10.1/24 | DMZ | DMZ zone gateway |
| pfSense INT (vtnet2) | 10.20.20.1/24 | Internal | Internal zone gateway |
| pfSense MGMT (vtnet3) | 10.30.30.1/24 | Management | MGMT zone gateway |
| bank-web | 10.10.10.10/24 | DMZ | Apache/nginx + ModSecurity WAF |
| bank-mail | 10.10.10.20/24 | DMZ | Postfix mail server |
| teller-pc | 10.20.20.10/24 | Internal | Teller workstation + Cowrie honeypot |
| customer-db | 10.20.20.20/24 | Internal | PostgreSQL database |
| aegis-forwarder | 10.30.30.10/24 | Management | Runs its own local agent + nmap/tcpdump scanner |

---

## 3. Component Roles

### Network Infrastructure
| Component | Type | Config |
|---|---|---|
| Switch1 | GNS3 Ethernet switch | L2 — connects Kali + virbr0 cloud to R1 |
| Router-1 | MikroTik CHR | ether1=virbr0 side, ether2=NAT DHCP, ether3=10.0.12.1 |
| Router-2 | MikroTik CHR | ether1=10.0.12.2, ether2=10.0.23.1 |
| pfSense | pfSense CE | Stateful FW — 4 zones: WAN/DMZ/INT/MGMT |
| DMZ-Switch | GNS3 Ethernet switch | bank-web + bank-mail |
| INT-Switch | GNS3 Ethernet switch | teller-pc + customer-db + aegis-forwarder |

### Security Tools per VM
| VM | IP | Tools | Log Files |
|---|---|---|---|
| bank-web | 10.10.10.10 | Apache, ModSecurity WAF, Suricata | `/var/log/apache2/modsec_audit.log`, `/var/log/suricata/eve.json` |
| bank-mail | 10.10.10.20 | Postfix, Fail2ban, Suricata | `/var/log/fail2ban.log`, `/var/log/suricata/eve.json` |
| teller-pc | 10.20.20.10 | Cowrie honeypot, Fail2ban, Suricata, SSH | `/var/log/cowrie/cowrie.json`, `/var/log/auth.log`, `/var/log/fail2ban.log` |
| customer-db | 10.20.20.20 | PostgreSQL, Fail2ban, SSH audit | `/var/log/auth.log` |
| aegis-forwarder | 10.30.30.10 | aegis_forwarder.py (local mode), nmap, tcpdump | Runs its own local forwarder + network scanner/traffic capture — no SSH into other VMs |

### AEGIS Platform
| Component | Host | URL |
|---|---|---|
| Dashboard (React/Vite) | Vercel | https://aegis-soc-dashboard.vercel.app |
| API Server (Express 5) | Render | https://aegis-api-server-jp3b.onrender.com |
| Database (PostgreSQL) | Supabase | Port 6543 pooler (aws-1-ap-southeast-2) |

---

## 4. Full Data Flow — Attack → Dashboard

```
┌──────────────────────────────────────────────────────────────────────┐
│                     ATTACK PHASE (Red Team — Kali)                   │
│                                                                       │
│  Kali (192.168.122.132) → Switch1 → R1 → R2 → pfSense WAN → DMZ    │
│  ├── nmap -sV -p- 10.10.10.10           ← port scan → Suricata      │
│  ├── hydra ssh://10.20.20.10            ← SSH brute → Fail2ban       │
│  ├── sqlmap -u http://10.10.10.10       ← SQLi → ModSecurity WAF     │
│  ├── hping3 --flood 10.10.10.10         ← DDoS → Suricata            │
│  └── nc/telnet 10.20.20.10:2222         ← honeypot → Cowrie          │
└──────────────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌──────────────────────────────────────────────────────────────────────┐
│                   DETECTION PHASE (Blue Team VMs)                    │
│                                                                       │
│  bank-web (10.10.10.10)                                               │
│  ├── Suricata     → /var/log/suricata/eve.json                       │
│  └── ModSecurity  → /var/log/apache2/modsec_audit.log                │
│                                                                       │
│  bank-mail (10.10.10.20)                                              │
│  └── Fail2ban     → /var/log/fail2ban.log                            │
│                                                                       │
│  teller-pc (10.20.20.10)                                             │
│  ├── Cowrie       → /var/log/cowrie/cowrie.json                      │  ← NOTE: Cowrie path
│  ├── Fail2ban     → /var/log/fail2ban.log                            │  actual path in script:
│  └── SSH auth     → /var/log/auth.log                                │  /home/cowrie/cowrie/var/log/cowrie/cowrie.json
└──────────────────────────────────────────────────────────────────────┘
                          │  each VM tails its OWN logs locally
                          ▼
┌──────────────────────────────────────────────────────────────────────┐
│           FORWARDING PHASE (per-VM agent — no central hub)           │
│                                                                       │
│  aegis_forwarder.py runs locally on EACH VM (bank-web, bank-mail,    │
│  teller-pc, customer-db, aegis-forwarder) — no SSH between VMs.      │
│                                                                       │
│  Per VM, `--mode` selects which local sensors to tail:               │
│  ├── bank-web   : --mode all      (suricata, fail2ban, ssh, http)   │
│  ├── bank-mail  : --mode all      (suricata, fail2ban, ssh)         │
│  ├── teller-pc  : --mode all      (suricata, fail2ban, ssh, cowrie) │
│  └── customer-db: --mode all      (suricata, fail2ban, ssh)         │
│                                                                       │
│  aegis-forwarder VM additionally runs, for itself only:              │
│  ├── nmap_scanner_loop  — scan 10.10.10.0/24, 10.20.20.0/24, 10.30.30.0/24 │
│  ├── tcpdump_loop       — capture on any iface, count packets        │
│  ├── traffic_reporter   — POST /api/ingest/traffic every 60s         │
│  └── heartbeat_loop     — POST /api/network/hosts every 15s          │
│                                                                       │
│  Each VM's parsed events → POST directly to API Server               │
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
│                 DEFENSE AGENT (runs on bank-web / teller-pc)         │
│                                                                       │
│  defense_agent.py --vm ubuntu                                        │
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
    ├── aegis_forwarder.py            ← Agent mode: runs locally on EVERY VM, reads local logs
    ├── pfsense_forwarder.py          ← UDP syslog receiver for pfSense filterlog
    ├── defense_agent.py              ← Polls command queue, executes iptables
    └── aegis-fail2ban-action.conf    ← Fail2ban action → direct API curl call

> `aegis_forwarder_hub.py` (central SSH-based collector) has been removed — every VM now
> runs its own local `aegis_forwarder.py` instance instead.
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
