# AEGIS SOC Dashboard — Project Development Log

> **Project:** AEGIS-SecureBank Cybersecurity Lab  
> **Type:** Real-device GNS3 Red/Blue Team SOC Dashboard  
> **Stack:** React + Vite (Vercel) · Express 5 (Render) · PostgreSQL (Supabase) · Python hub agent (AEGIS VM)  
> **Repo:** https://github.com/sohu2723-star/aegis-soc-dashboard

---

## Current System Architecture

### Lab Topology (v3 — Active)

```
[Attacker VM]
(any IP — not fixed)
      │
 [Switch1]
      │
 [Router-1 — MikroTik CHR]
   ether1: 192.168.122.2/24   ← attacker/GNS3 NAT side
   ether2: DHCP               ← NAT internet egress
   ether3: 10.0.23.1/30       ← pfSense WAN (direct, R2 removed)
      │
 [pfSense 2.7.2]
   WAN  (em0): 10.0.23.2/30
   DMZ  (em1): 10.10.10.1/24
   INT  (em2): 10.20.20.1/24
   MGMT (em3): 10.30.30.1/24
      │
 ┌────┼────────────────┐
[DMZ]              [INT]              [MGMT]
[bank-web]    [customer-db]    [aegis-forwarder]
10.10.10.10   10.20.20.20      10.30.30.10
Apache2        PostgreSQL       Hub agent
vsftpd         Suricata         SSH → bank VMs
Suricata        Fail2ban
Fail2ban
```

**Removed nodes:** R2 (MikroTik), bank-mail (10.10.10.20), teller-pc (10.20.20.10)

### Data Flow

```
Attacker → R1 → pfSense → bank-web / customer-db
                                │
                     Suricata / Fail2ban / SSH logs
                                │
                    aegis_forwarder.py (--mode hub)
                    on AEGIS VM (10.30.30.10)
                    SSHes into bank-web + customer-db
                    tails logs remotely
                                │
                    POST /api/ingest/*  (X-AEGIS-Key)
                                │
                    Render API Server (Express 5)
                    ├── auto-defense engine (evaluateEvent)
                    ├── Telegram alert push
                    ├── Groq AI analysis
                    └── SSE broadcast → Dashboard
                                │
                    Vercel Dashboard (React)
                    └── monitoring only (no write to VMs)
```

### Defense Chain

```
Attack detected
→ evaluateEvent() matches defense_rules
→ INSERT defense_commands {status: "pending", target_vm}
→ aegis_forwarder.py defense_agent_loop() polls every 5s
→ executes iptables / pfSense REST API
→ PATCH /api/defense/commands/:id/result
→ dashboard Defense Center updates live
```

---

## Platform Deployment

| Component | Platform | URL |
|---|---|---|
| Frontend | Vercel | https://aegis-soc-dashboard-aegis-dashboard.vercel.app |
| API Server | Render | https://aegis-api-server-jp3b.onrender.com |
| Database | Supabase | PostgreSQL pooler (aws-1-ap-southeast-2:6543) |
| AEGIS Agent | AEGIS VM (10.30.30.10) | systemd service — aegis-forwarder |

### Required Secrets

| Secret | Env Var | Used By |
|---|---|---|
| Supabase pooler URL | `SUPABASE_DB_URL` | API server (Drizzle ORM) |
| Ingest API key | `AEGIS_INGEST_KEY` | VM scripts → /api/ingest/* |
| Admin key | `AEGIS_ADMIN_KEY` | Dashboard + defense commands |
| Session secret | `SESSION_SECRET` | Express session |
| Groq API key | `GROQ_API_KEY` | AI analysis (optional) |
| Telegram bot token | `TELEGRAM_BOT_TOKEN` | Alert push (optional) |
| Telegram chat ID | `TELEGRAM_CHAT_ID` | Alert push (optional) |
| pfSense API key | `PFSENSE_API_KEY` | pfSense WAN block rules |

---

## Feature Development Log

### Phase 1 — Core SOC Dashboard
- Real-time event ingest from Suricata, Fail2ban, SSH, FTP, HTTP
- SSE streaming to dashboard (no polling)
- Security events table, incidents, alerts
- System status health monitoring per VM
- Network monitor: live host map, connection logs, SSH/FTP/TLS/HTTP sessions

### Phase 2 — Defense System
- Auto-defense engine: evaluateEvent() → defense_rules matching → iptables/pfSense command queue
- Manual IP block/unblock with full audit log
- Defense rules management (UI + API)
- Command history with per-VM targeting

### Phase 3 — Intelligence & Automation
- Groq AI integration (llama-3.3-70b-versatile):
  - Threat analysis (24h briefing)
  - Per-IP defense recommendation
  - Single event explanation
- Auto-report scheduler (configurable interval, Telegram delivery)
- Burmese language AI output with English technical terms

### Phase 4 — Hub Agent (aegis_forwarder.py --mode hub)
- Single agent on AEGIS VM SSHes into bank-web and customer-db
- Per-host health_services maps (bank-web: suricata/fail2ban/apache2/vsftpd; customer-db: suricata/fail2ban/postgresql)
- pfSense health monitoring via HTTP ping (30s interval)
- Hub sends offline status for all remote hosts on shutdown

### Phase 5 — pfSense Integration
- pfSense REST API block/unblock via `_exec_defense_pfsense()`
- API URL fixed: `http://{PFSENSE_IP}/api/v1` (not 127.0.0.1)
- Auth: `Authorization: <PFSENSE_API_KEY>` (v1 style, no Bearer prefix)
- Unblock: GET rules → filter by `AEGIS-block {ip}` description → DELETE by tracker
- `apply: True` on all rule create/delete calls (immediate effect)

### Phase 6 — Alert & Notification
- Telegram push for all high+ severity alerts (not just critical)
- `mkAlert()` sends Telegram immediately on alert creation
- `channel: "telegram"` for all high+ alerts in DB

### Phase 7 — UI / UX Fixes
- LastSeenTicker: shows actual `HH:mm:ss` timestamp + elapsed seconds (no reset on navigate)
- Network hosts: inline stale check on GET /network/hosts (handles Render cold-start gaps)
- Defense Center: per-device Fail2ban/Suricata status filter (GET /defense/status?device=IP)
- Removed Connect/Disconnect buttons from Network Monitor (WiFi icon buttons)
- Removed `markOffline`/`markOnline` dead code from network.tsx

---

## Key Technical Decisions

### 1. Hub Mode (not per-VM)
**Decision:** Single hub agent on AEGIS VM SSHes into bank VMs  
**Why:** Bank VMs cannot reach the internet (pfSense blocks outbound). Hub VM is on MGMT segment with management access.  
**Impact:** Only AEGIS VM needs outbound HTTPS to Render API.

### 2. Supabase Pooler + Custom URL Parser
**Decision:** Use Supabase connection pooler (port 6543), custom `lastIndexOf` URL parser  
**Why:** drizzle-kit push broken with pooler; `new URL()` fails on some pooler URL formats  
**Impact:** Use `drizzle-kit generate` + run SQL directly; never use `drizzle-kit push` in production.

### 3. pfSense API Auth (v1 style)
**Decision:** `Authorization: <api_key>` header without Bearer prefix  
**Why:** pfSense REST API community package v1 uses raw key auth; `Authorization: Bearer <key>` may fail  
**Impact:** Set `PFSENSE_API_KEY` to the raw API key generated from pfSense → System → API.

### 4. PostgreSQL UPDATE with LIMIT fix
**Decision:** Use subquery `WHERE id IN (SELECT id FROM ... LIMIT n)` instead of `UPDATE ... LIMIT n`  
**Why:** PostgreSQL does not support LIMIT in UPDATE statements (MySQL syntax)  
**Impact:** defense-rules.ts endpoint was returning 500 for all defense poll requests.

### 5. Attacker IP is NOT assumed
**Decision:** No hardcoded attacker IP range in any system component  
**Why:** Attacker can be any IP — lab VMs use 192.168.122.x but real attackers use any IP  
**Impact:** All prompts, filters, and rules treat any IP as a potential attacker.

### 6. Render Cold-Start Stale Hosts
**Decision:** Run `markStaleHostsOffline()` inline on every GET /network/hosts  
**Why:** Render free tier sleeps after 15min; setInterval doesn't run during sleep; hosts stay "online" forever  
**Impact:** First dashboard request after Render wakes up immediately marks timed-out hosts offline.

---

## Bug Fixes Log

| Bug | Root Cause | Fix |
|---|---|---|
| Defense poll 500 error | `UPDATE ... LIMIT 20` invalid PostgreSQL | Subquery pattern |
| pfSense block FAILED (HTML response) | API URL default `127.0.0.1` instead of PFSENSE_IP | Default changed to `http://{PFSENSE_IP}/api/v1` |
| pfSense unblock not implemented | Code just printed and returned true | Full GET→filter→DELETE by tracker |
| Hosts stay online after script stop | Render sleep skips setInterval | Inline stale check on GET |
| Last seen timer resets on navigate | Component remount reset state | `useEffect([lastSeen])` calculates from actual timestamp |
| Telegram only for critical alerts | `mkAlert` channel logic | All high+ → telegram, immediate push |
| AI text truncated/cut off | maxTokens 300-900, "under 220 words" constraint | maxTokens 800-2000, removed word limits |
| Burmese AI text wrong | English-only system prompt | Full Burmese system prompt with Myanmar script instructions |
| System Status missing AEGIS VM | hub mode skipped `service_health_loop` | Hub mode now also runs local service health |
| WiFi buttons not removed | Dead code left after UI change | Removed markOffline/markOnline functions entirely |

---

## AEGIS VM Setup (Quick Reference)

```bash
# Install
sudo apt install -y python3-pip python3-requests openssh-client
sudo pip3 install requests

# Download script
sudo mkdir -p /opt/aegis/scripts/src
cd /opt/aegis/scripts/src
wget -O aegis_forwarder.py \
  https://raw.githubusercontent.com/sohu2723-star/aegis-soc-dashboard/main/scripts/src/aegis_forwarder.py

# Config
sudo cp aegis_forwarder.local.conf.example aegis_forwarder.local.conf
sudo nano aegis_forwarder.local.conf
# Set: AEGIS_URL, AEGIS_KEY, AEGIS_ADMIN_KEY, BANK_WEB_IP, CUSTOMER_DB_IP,
#      BANK_WEB_SSH_USER, CUSTOMER_DB_SSH_USER, PFSENSE_IP, PFSENSE_API_KEY

# Run as service
sudo systemctl enable --now aegis-forwarder
sudo journalctl -u aegis-forwarder -f

# Update script
cd /opt/aegis/scripts/src
wget -O aegis_forwarder.py \
  https://raw.githubusercontent.com/sohu2723-star/aegis-soc-dashboard/main/scripts/src/aegis_forwarder.py
sudo systemctl restart aegis-forwarder
```

---

## Attack Test Commands

```bash
# Port scan (→ Suricata ET SCAN → medium/high event)
nmap -sS -p 1-65535 10.10.10.10

# SSH brute force (→ Fail2ban ban → high event + Telegram)
hydra -l root -P /usr/share/wordlists/rockyou.txt ssh://10.10.10.10

# SQL injection (→ Suricata SQLi rule → critical event)
sqlmap -u "http://10.10.10.10/login.php" --forms --batch

# DDoS SYN flood (→ Suricata DOS → high event)
hping3 -S --flood -V -p 80 10.10.10.10

# Web enumeration (→ Suricata/ModSec → web_attack events)
nikto -h http://10.10.10.10
gobuster dir -u http://10.10.10.10 -w /usr/share/wordlists/dirb/common.txt
```

> All attackers need route to 10.0.0.0/8 via R1: `sudo ip route add 10.0.0.0/8 via 192.168.122.2`
