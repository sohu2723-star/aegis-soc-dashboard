# AEGIS SOC — System Flow Documentation

> **Production stack**: Render (API) + Vercel (Frontend) + Supabase PostgreSQL  
> **Replit = code editing only**. Do NOT use Replit URLs anywhere.

---

## 1. Full System Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         LAB NETWORK (192.168.56.x)                          │
│                                                                              │
│  ┌────────────────┐   attack    ┌─────────────────────────────────────────┐ │
│  │  Kali Linux    │ ──────────► │           Ubuntu VM (Blue Team)          │ │
│  │  (Red Team)    │             │                                          │ │
│  │                │             │  Sensors:                                │ │
│  │  Tools:        │             │  ├─ Snort IDS         (/etc/snort/)      │ │
│  │  nmap          │             │  ├─ Suricata IDS      (EVE JSON)         │ │
│  │  hydra         │             │  ├─ Fail2ban          (/var/log/auth.log) │ │
│  │  sqlmap        │             │  ├─ Cowrie Honeypot   (SSH/Telnet fake)  │ │
│  │  hping3        │             │  ├─ ModSecurity/Nginx (HTTP attacks)     │ │
│  │  metasploit    │             │  └─ vsftpd/ProFTPd    (FTP sessions)     │ │
│  │  etc.          │             │                                          │ │
│  └────────────────┘             │  aegis_forwarder.py (tails logs)         │ │
│                                 └───────────┬─────────────────────────────┘ │
│                                             │                                │
│  ┌──────────┐                               │ POST /api/ingest/*             │
│  │ pfSense  │ ◄──── defense_agent.py ──────────────────────────────────────► │
│  │ Firewall │       polls pending commands  │    X-AEGIS-Key header          │
│  └──────────┘       executes pfSense API    │                                │
└─────────────────────────────────────────────┼────────────────────────────────┘
                                              │
                                              ▼ INTERNET
                              ┌───────────────────────────────┐
                              │  Render — aegis-api-server     │
                              │  https://aegis-api-server-     │
                              │  jp3b.onrender.com             │
                              │                                │
                              │  Express 5 + Drizzle ORM       │
                              │  Node.js 24, TypeScript        │
                              │                                │
                              │  ┌────────────────────────┐   │
                              │  │  Auto-Defense Engine    │   │
                              │  │  evaluateEvent()        │   │
                              │  └────────────────────────┘   │
                              │           │                    │
                              │           ▼                    │
                              │  ┌────────────────────────┐   │
                              │  │  Supabase PostgreSQL    │   │
                              │  │  (SUPABASE_DB_URL       │   │
                              │  │   port 6543 pooler)     │   │
                              │  └────────────────────────┘   │
                              │           │                    │
                              │  SSE /api/stream               │
                              └───────────┬───────────────────┘
                                          │
                                          ▼
                              ┌───────────────────────────────┐
                              │  Vercel — aegis-dashboard      │
                              │  React 19 + Vite               │
                              │  /api/* → proxied to Render    │
                              │                                │
                              │  Pages:                        │
                              │  ├─ Command Center             │
                              │  ├─ Security Events            │
                              │  ├─ Incidents                  │
                              │  ├─ Active Alerts              │
                              │  ├─ Network Monitor            │
                              │  ├─ Defense Center             │
                              │  ├─ System Status              │
                              │  ├─ Reports                    │
                              │  ├─ Architecture               │
                              │  └─ Setup Guide                │
                              └───────────────────────────────┘
```

---

## 2. Event Ingest Flow (Ubuntu VM → Dashboard)

```
Ubuntu VM                    Render API                      Supabase DB         Dashboard SSE
─────────                    ──────────                      ───────────         ─────────────
aegis_forwarder.py
│
│ tails:
│  /var/log/suricata/eve.json
│  /var/log/auth.log
│  /var/log/fail2ban.log
│  /var/log/snort/alert
│  /var/log/apache2/modsec_audit.log
│  cowrie.json
│
│ parses log line
│
├─ POST /api/ingest/suricata       ──►  auth(X-AEGIS-Key)
│   { alert, src_ip, dest_ip,          │
│     signature, severity }            ├─ INSERT security_events    ──►  broadcast("security_event")
│                                      └─ evaluateEvent()           ──►  broadcast("stats_update")
│                                            │
│                                            └─ [if rule fires]
│                                               INSERT defense_commands (pending)
│                                               INSERT blocked_ips
│                                               INSERT defense_actions
│                                               broadcast("defense_action")
│
├─ POST /api/ingest/fail2ban       ──►  auth
│   { ip, action, jail, timestamp }    │
│                                      ├─ INSERT security_events
│                                      ├─ INSERT blocked_ips (isActive=true)
│                                      ├─ INSERT defense_actions
│                                      └─ evaluateEvent()
│
├─ POST /api/ingest/ssh            ──►  auth
│   { src_ip, user, status, ... }      │
│                                      ├─ INSERT ssh_sessions
│                                      └─ INSERT security_events + evaluateEvent()
│
├─ POST /api/ingest/http           ──►  auth
│   { src_ip, uri, rule_id, ... }      │
│                                      ├─ INSERT http_attacks
│                                      └─ INSERT security_events + evaluateEvent()
│
├─ POST /api/ingest/suricata/tls   ──►  auth
│   { src_ip, sni, version, ... }      │
│                                      └─ INSERT encrypted_traffic
│
└─ POST /api/ingest/cowrie         ──►  auth
    { src_ip, session, command }       │
                                       ├─ INSERT security_events
                                       └─ evaluateEvent()   ← threshold=1, instant block
```

---

## 3. Auto-Defense Pipeline

```
Event arrives at evaluateEvent()
│
│  normalise attack type
│  (ssh_brute / port_scan / ddos / web_attack / honeypot / ...)
│
│  load active defense_rules from DB
│
├─ Rule: "SSH Brute Force → Auto Block"
│    triggerAttackType = ssh_brute
│    triggerThreshold  = 5  (5 events in 60s)
│    actionType        = auto
│    defenseType       = block_ip
│    targetVm          = ubuntu
│    priority          = 10
│
│  in-memory counter: recordAttack(sourceIp, "ssh_brute", 60)
│  count = 5  → threshold met → rule fires
│
│  sanitizeIp(sourceIp) → "192.168.56.101"  (validated)
│  buildCommand() →
│    commandText = "iptables -I INPUT -s 192.168.56.101 -j DROP"
│    undoCommand = "iptables -D INPUT -s 192.168.56.101 -j DROP"
│
│  INSERT defense_commands:
│    { targetVm: "ubuntu", commandText, status: "pending" }
│
│  INSERT blocked_ips:
│    { ip: "192.168.56.101", blockedBy: "auto", isActive: true }
│
│  INSERT defense_actions:
│    { type: "auto", action: "block_ip", status: "queued" }
│
│  SSE broadcast("defense_action") → Dashboard updates live
│
▼
defense_agent.py (on Ubuntu VM)
│
│  polls: GET /api/defense/commands/pending
│          X-AEGIS-Admin-Key: <AEGIS_ADMIN_KEY>
│
│  receives: [{ id, commandType: "iptables", commandText: "iptables -I INPUT -s ... -j DROP" }]
│
│  executes: subprocess.run(commandText, shell=False, ...)
│
│  reports: POST /api/defense/commands/{id}/done
│            { status: "executed" }
│
▼
API marks defense_actions.status = "success"
Dashboard Defense Action Log shows: BLOCK | 192.168.56.101 | Auto | SUCCESS
```

### Default defense rules (seeded on first startup)

| Priority | Rule | Trigger | Threshold | Defense |
|---|---|---|---|---|
| 5 | Honeypot Touch → Instant Block | honeypot, any severity | 1 in 1s | block_ip (ubuntu) |
| 8 | DDoS → Null Route | ddos, any severity | 50 in 30s | null_route (ubuntu) |
| 10 | SSH Brute Force → Auto Block | ssh_brute, any severity | 5 in 60s | block_ip (ubuntu) |
| 15 | Web Attack (High) → Auto Block | web_attack, high/critical | 1 in 60s | block_ip (ubuntu) |
| 20 | Port Scan → Auto Block | port_scan, any severity | 1 in 60s | block_ip (ubuntu) |
| 25 | FTP Brute Force → Block | ftp_brute, any severity | 10 in 60s | block_ip (ubuntu) |
| 30 | Mail Spam → Auto Block | mail_attack, any severity | 100 in 60s | block_ip (ubuntu) |
| 40 | MITM / ARP Spoof → Suggest Rule | mitm, any severity | 1 in 60s | alert_only (suggest) |
| 50 | Critical Attack → pfSense Block | any, critical | 1 in 60s | pfsense_block (pfsense) |

---

## 4. Defense Center — How Status Is Derived

```
GET /api/defense/status
│
├─ activeBlocks  = SELECT * FROM blocked_ips WHERE isActive = true
│                  → totalBlocked count
│
├─ recentActions = SELECT * FROM defense_actions ORDER BY createdAt DESC LIMIT 5
│
└─ sensorRows    = SELECT * FROM system_status
    │
    │  Ubuntu forwarder updates system_status via POST /api/ingest/event
    │  with component names: "Fail2ban", "Suricata", "Cowrie", etc.
    │
    ├─ fail2banActive = sensorRows.find("fail2ban")?.status === "online"
    │   → false if Ubuntu VM forwarder has not connected
    │   → true  if forwarder is running and reporting Fail2ban as online
    │
    └─ suricataActive = sensorRows.find("suricata")?.status === "online"
        → false if Ubuntu VM forwarder has not connected
        → true  if forwarder is running and reporting Suricata as online

WHY IT SHOWED "ACTIVE" BEFORE:
  The route hardcoded: { fail2banActive: true, suricataActive: true }
  This was WRONG — it showed ACTIVE even with no VM connected.
  FIXED: now reads from system_status table (real sensor state).
```

---

## 5. System Status Page — How It Works

```
Frontend: artifacts/aegis-dashboard/src/pages/system.tsx
  useGetSystemStatus() → GET /api/system/status

Backend: artifacts/api-server/src/routes/system.ts
  SELECT * FROM system_status ORDER BY layer

Database: system_status table
  ┌──────────────┬──────────────┬──────────────┬─────────────────┬────────────┐
  │ component    │ layer        │ status       │ description     │ lastCheck  │
  ├──────────────┼──────────────┼──────────────┼─────────────────┼────────────┤
  │ Suricata IDS │ perimeter    │ online       │ Network IDS     │ 2025-07-02 │
  │ Fail2ban     │ perimeter    │ online       │ SSH/FTP brute   │ 2025-07-02 │
  │ Cowrie       │ perimeter    │ online       │ SSH honeypot    │ 2025-07-02 │
  │ AEGIS API    │ brain        │ online       │ Express server  │ 2025-07-02 │
  │ Supabase DB  │ brain        │ online       │ PostgreSQL DB   │ 2025-07-02 │
  │ Snort IDS    │ perimeter    │ offline      │ Network IDS     │ 2025-07-02 │
  │ Kali Linux   │ attacker     │ online       │ Red team VM     │ 2025-07-02 │
  └──────────────┴──────────────┴──────────────┴─────────────────┴────────────┘

Layers displayed:
  perimeter → pfSense, Suricata, Snort, Fail2ban, Cowrie, ModSecurity
  brain     → AEGIS API Server, Supabase DB
  output    → Dashboard, Reports
  attacker  → Kali Linux (monitored)

HOW DATA GETS IN:
  aegis_forwarder.py on Ubuntu VM sends heartbeats:
  POST /api/ingest/event  { type: "system_status", component: "Suricata", status: "online", metrics: "..." }
  
  If forwarder is not running → no rows in system_status → page shows "Polling system components..." 
  with no cards (empty layers), not fake data.
```

---

## 6. Real-Time SSE Connection Flow

```
Browser (Dashboard)                    Render API (/api/stream)
────────────────────                   ────────────────────────
new EventSource("/api/stream")    ──►  broadcaster.addClient(res)
                                       res stays open (no timeout)

[Ubuntu VM sends event]
  POST /api/ingest/suricata         ──►  insertEvent()
                                         broadcaster.broadcast("security_event", data)
                                              │
                                              ▼
                                         writes to all open SSE clients:
                                         "event: security_event\ndata: {...}\n\n"
                                              │
                                              ▼
Browser onmessage handler              receives SSE message
  queryClient.invalidateQueries()    ─── React Query refetches
  → UI updates in real-time               latest data from API
```

---

## 7. Agent — Pending Command Poll Loop

```
defense_agent.py (running on Ubuntu VM and/or pfSense)

loop every 5 seconds:
│
├─ GET https://aegis-api-server-jp3b.onrender.com/api/defense/commands/pending
│   Header: X-AEGIS-Admin-Key: <AEGIS_ADMIN_KEY>
│
│  Response: [{ id, commandType, commandText, targetVm, targetIp }]
│
├─ For each pending command:
│   ├─ commandType == "iptables"   → subprocess.run(["iptables", ...])
│   ├─ commandType == "null_route" → subprocess.run(["ip", "route", "add", "blackhole", ...])
│   ├─ commandType == "custom"     → subprocess.run(commandText, shell=True)  # modsec_ban.sh etc.
│   └─ commandType == "pfsense_api"→ parse JSON → call pfSense REST API
│
└─ POST /api/defense/commands/{id}/done
    { status: "executed" | "failed", output: "..." }
```

---

## 8. Ubuntu VM Forwarder — Log Tailing

```
aegis_forwarder.py (scripts/src/aegis_forwarder.py)

Config:
  AEGIS_API_URL = https://aegis-api-server-jp3b.onrender.com
  AEGIS_INGEST_KEY = <secret>

Tailed files → endpoint mapping:
  /var/log/suricata/eve.json          → POST /api/ingest/suricata
  /var/log/suricata/eve.json (tls)    → POST /api/ingest/suricata/tls
  /var/log/auth.log                   → POST /api/ingest/ssh
  /var/log/fail2ban.log               → POST /api/ingest/fail2ban
  /var/log/snort/alert                → POST /api/ingest/snort
  /var/log/apache2/modsec_audit.log   → POST /api/ingest/http
  /var/log/vsftpd.log                 → POST /api/ingest/ftp
  /home/cowrie/var/log/cowrie.json    → POST /api/ingest/cowrie

System status heartbeat every 30s:
  POST /api/ingest/event
  { type: "system_status", component: "Suricata", status: "online", metrics: "alerts_today: N" }
  → updates system_status table → System Status page shows real data
```

---

## 9. Environment Variables

### Render (API server — production)

| Variable | Required | Description |
|---|---|---|
| `SUPABASE_DB_URL` | Yes | Supabase pooler URI, port 6543 |
| `AEGIS_INGEST_KEY` | Yes | Sensor auth key (`X-AEGIS-Key`) |
| `AEGIS_ADMIN_KEY` | Yes | Agent poll key (`X-AEGIS-Admin-Key`) |
| `PORT` | Yes | `3000` (set in render.yaml) |
| `NODE_ENV` | Yes | `production` (set in render.yaml) |

### Vercel (Frontend — production)

No env vars needed — all `/api/*` is proxied to Render via `vercel.json`.

### Local dev (Replit — code editing only)

| Variable | Value |
|---|---|
| `SUPABASE_DB_URL` | Supabase pooler connection string |
| `AEGIS_INGEST_KEY` | Any test key |
| `AEGIS_ADMIN_KEY` | Any test key |

---

## 10. Attack Coverage Matrix

| Attack Type | Detected By | Ingest Endpoint | Auto-Defense |
|---|---|---|---|
| Port scan (nmap) | Suricata | `/api/ingest/suricata` | block_ip (threshold=1) |
| SSH brute force | Fail2ban + auth.log | `/api/ingest/fail2ban` + `/api/ingest/ssh` | block_ip (threshold=5 in 60s) |
| DDoS / SYN flood | Suricata | `/api/ingest/suricata` | null_route (threshold=50 in 30s) |
| ARP spoofing / MITM | Suricata | `/api/ingest/suricata` | suggest manual (VLAN isolation) |
| SQLi / XSS / LFI / RFI | ModSecurity | `/api/ingest/http` | block_ip if high/critical |
| FTP brute force | vsftpd logs | `/api/ingest/ftp` | block_ip (threshold=10 in 60s) |
| Honeypot contact | Cowrie | `/api/ingest/cowrie` | instant block_ip (threshold=1) |
| TLS anomalies | Suricata TLS | `/api/ingest/suricata/tls` | stored in encrypted_traffic |
| Phishing / SMTP | Mail server logs | `/api/ingest/event` | block_ip |
| Critical (any type) | Any sensor | Any ingest | pfsense_block (threshold=1) |
