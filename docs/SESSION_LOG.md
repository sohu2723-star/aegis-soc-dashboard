# AEGIS SOC Dashboard — Session Log & Development History

> ဒီ document က AEGIS project တည်ဆောက်လာသည့် session အားလုံး၏ မှတ်တမ်းဖြစ်သည်။  
> Commands, fixes, decisions, current status အားလုံးကို ဒီမှာ ရှာနိုင်သည်။

---

## Project Overview

| Item | Value |
|------|-------|
| **Dashboard** | https://aegis-soc-dashboard.vercel.app |
| **API Server** | https://aegis-api-server-jp3b.onrender.com |
| **Database** | Supabase (PostgreSQL) |
| **Ubuntu VM IP** | `192.168.84.130` |
| **Kali Linux IP** | `192.168.84.135` |
| **Forwarder path** | `/opt/aegis_forwarder.py` on Ubuntu VM |

---

## Architecture

```
Kali Linux (192.168.84.135) — attacker
    │  nmap / hydra / sqlmap / nikto
    ▼
Ubuntu VM (192.168.84.130) — defender
    ├── Suricata IDS/IPS  (/var/log/suricata/eve.json)
    ├── Snort IDS          (/var/log/snort/alert)
    ├── Fail2ban           (/var/log/fail2ban.log)
    ├── Cowrie Honeypot    (/var/log/cowrie/cowrie.json)
    ├── SSH auth.log       (/var/log/auth.log)
    ├── vsftpd             (/var/log/vsftpd.log)
    └── aegis_forwarder.py ──→ API Server (Render)
                                        │
                                        ▼
                               Supabase PostgreSQL
                                        │
                                        ▼
                               Dashboard (Vercel) ←── SSE real-time
```

---

## Forwarder Thread Map

| Thread | Log Source | API Endpoint | Triggers When |
|--------|-----------|-------------|---------------|
| `watch_suricata` | `/var/log/suricata/eve.json` | `POST /api/ingest/suricata` | Suricata alert fires |
| `watch_snort` | `/var/log/snort/alert` | `POST /api/ingest/snort` | Snort rule match |
| `watch_fail2ban` | `/var/log/fail2ban.log` | `POST /api/ingest/fail2ban` | IP banned |
| `watch_cowrie` | `/var/log/cowrie/cowrie.json` | `POST /api/ingest/cowrie` | Honeypot connection |
| `watch_ssh` | `/var/log/auth.log` | `POST /api/ingest/ssh` | SSH failed/success login |
| `watch_ftp` | `/var/log/vsftpd.log` | `POST /api/ingest/ftp` | FTP login/transfer |
| `heartbeat_loop` | every 15s | `POST /api/network/hosts` | Always — keeps host ONLINE |
| `service_health_loop` | every 30s | `POST /api/system/status` | Reports service up/down |

---

## API Endpoints Reference

| Method | Endpoint | Purpose |
|--------|----------|---------|
| `POST` | `/api/network/hosts` | Register host / heartbeat |
| `PATCH` | `/api/network/hosts/:ip/online` | Mark host online |
| `PATCH` | `/api/network/hosts/:ip/offline` | Mark host offline |
| `GET` | `/api/network/hosts` | List all hosts |
| `GET` | `/api/network/hosts/sse` | SSE real-time host changes |
| `POST` | `/api/ingest/suricata` | Ingest Suricata alert |
| `POST` | `/api/ingest/suricata/tls` | Ingest Suricata TLS event |
| `POST` | `/api/ingest/snort` | Ingest Snort alert |
| `POST` | `/api/ingest/fail2ban` | Ingest Fail2ban ban event |
| `POST` | `/api/ingest/cowrie` | Ingest Cowrie honeypot event |
| `POST` | `/api/ingest/ssh` | Ingest SSH auth event |
| `POST` | `/api/ingest/ftp` | Ingest FTP session event |
| `POST` | `/api/system/status` | Update service health |
| `GET` | `/api/system/status` | Get service health |
| `GET` | `/api/system/sse` | SSE real-time service changes |
| `GET` | `/api/alerts` | List active alerts |
| `GET` | `/api/alerts/sse` | SSE real-time new alerts |

---

## Session 1 — Project Bootstrap

### What was built
- Monorepo: `artifacts/aegis-dashboard` (React + Vite) + `artifacts/api-server` (Express)
- Supabase schema: `hosts`, `security_events`, `alerts`, `system_status` tables
- Orval OpenAPI codegen for typed API client
- Deployed: Vercel (frontend) + Render (API)

---

## Session 2 — Real-time Features

### Features added
- **Network Monitor** — online/offline via heartbeat (15s interval, 45s timeout)
- **Defense Center** — service health cards (Suricata/Snort/Fail2ban/Cowrie)
- **Active Alerts** — enriched alert display with LEFT JOIN security_events
- **SSE** — Server-Sent Events real-time push to dashboard

### Bug fixes

| Bug | Root Cause | Fix |
|-----|-----------|-----|
| `window.confirm()` silently fails | Cross-origin iframe blocks dialogs | Replaced with shadcn `AlertDialog` |
| Host stuck ONLINE after forwarder stop | Auto-timeout too long (90s) | Heartbeat 60s→15s, timeout 90s→45s |
| No OFFLINE signal on script stop | No shutdown handler | Added SIGINT/SIGTERM → sends `status: offline` |
| Service status SSE not updating UI | Wrong query key `["system-status"]` | Fixed to `getGetSystemStatusQueryKey()` (Orval) |
| `sanitizeIp` throwing on invalid IP | No try/catch | Wrapped in try/catch in `network.ts` |

---

## Session 3 — Suricata Fix (2026-07-03)

### Problem
Suricata installed but failing to start — exit-code status=1/FAILURE, restart loop

### Diagnosis commands (Ubuntu)
```bash
journalctl -xeu suricata --no-pager | tail -20
ip link show | grep -E "^[0-9]" | awk '{print $2}'
sudo suricata -T -c /etc/suricata/suricata.yaml
```

### Fix — interface name mismatch
```bash
# 1. Check actual interface name
ip link show
# Result: enp1s0 (NOT eth0 as configured)

# 2. Fix suricata.yaml
sudo nano /etc/suricata/suricata.yaml
# Find: af-packet section → interface: eth0
# Change to: interface: enp1s0

# 3. Update ET rules
sudo suricata-update

# 4. Restart
sudo systemctl restart suricata
sudo systemctl status suricata   # should show: active (running)
```

---

## Session 4 — Defender Self-Block Bug (2026-07-03 10:10)

### What was observed
```
Dashboard Telemetry: 192.168.84.130 → 216.24.57.8 [Suspicious TLS]  ← flood
Command Center:      BLOCK_IP 192.168.84.130  ← defender blocking itself!
Kali nmap result:    ports 21/22/80 open on 192.168.84.130 (nmap working)
```

### Root cause explained
```
Ubuntu forwarder (192.168.84.130)
    │  sends HTTPS/TLS to Render API (216.24.57.8)
    │
    ↓ Suricata sees this OUTBOUND connection
    → Python requests library TLS fingerprint triggers ET rules
    → "Suspicious TLS" event with src_ip = 192.168.84.130
    → Auto-defense engine mistakes defender VM for attacker
    → Queues BLOCK_IP 192.168.84.130   ← catastrophic self-block
```

### Fixes applied (code)

**Fix 1 — `artifacts/api-server/src/lib/ip-classifier.ts` (NEW shared utility)**
```typescript
// Strict RFC1918 + loopback + link-local classifier
// IPv4: 10/8, 172.16/12, 192.168/16, 127/8, 169.254/16
// IPv6: ::1, fc00::/7, fe80::/10, ::ffff: mapped
export function isDefenderIp(ip: string | null | undefined): boolean
```

**Fix 2 — `artifacts/api-server/src/lib/auto-defense.ts`**
```typescript
// Added at top of evaluateEvent():
if (isDefenderIp(event.sourceIp)) {
    console.log(`[AutoDefense] Skipped — defender IP whitelisted`);
    return;
}
// → Private IPs never trigger auto-defense rules
```

**Fix 3 — `artifacts/api-server/src/routes/ingest.ts` (/ingest/suricata/tls)**
```typescript
// Outbound TLS from defender = log only, no alert
if (isDefenderIp(src_ip)) {
    // store in encrypted_traffic table (for telemetry view)
    // but NO security_event, NO alert, NO auto-defense
    return res.json({ isSuspicious: false, skipped: "outbound_from_defender" });
}
```

### Result
- Ubuntu VM (`192.168.84.130`) → never auto-blocked again
- Forwarder→Render outbound TLS → silently logged for telemetry only
- Real external attacker TLS (weak/self-signed cert) → still alerts normally

---

## Session 5 — Attack Testing & SSH Bug Fix (2026-07-03 10:30–11:00)

### Attack attempts log

#### Attempt 1 — nmap (failed to appear in dashboard)
```bash
# Kali
nmap -sS 192.168.84.130           # SYN scan
nmap -sS -T4 192.168.84.130       # Fast SYN scan

# Result: ports 21/22/80 open, but no dashboard alert
# Root cause: ET SCAN rules not loaded in Suricata
# Fix needed:
sudo suricata-update
sudo systemctl restart suricata
```

#### Attempt 2 — Suricata eve.json check (typo found)
```bash
# WRONG (typed by mistake)
tail -f /var/log/suricata/ece.json   # ← ece not eve

# CORRECT
tail -f /var/log/suricata/eve.json

# If eve.json not created → enable in config
sudo nano /etc/suricata/suricata.yaml
# outputs: → eve-log: → enabled: yes
sudo systemctl restart suricata
ls /var/log/suricata/eve.json        # should appear now
```

#### Attempt 3 — FTP Brute Force with Hydra (failed — rockyou missing)
```bash
# Kali — WRONG (rockyou.txt not extracted)
hydra -l ftp -P /usr/share/wordlists/rockyou.txt ftp://192.168.84.130

# Error: [ERROR] File for passwords not found: /usr/share/wordlists/rockyou.txt
# Fix:
sudo gunzip /usr/share/wordlists/rockyou.txt.gz

# Retry
hydra -l ftp -P /usr/share/wordlists/rockyou.txt ftp://192.168.84.130 -t 4 -V
```

**Why FTP still won't show in dashboard:**
- `vsftpd` does NOT log failed logins by default
- `/var/log/vsftpd.log` stays empty during brute force
- Forwarder's `watch_ftp` has no data to send
- **Fix:** Enable vsftpd logging (see below)

#### Attempt 4 — SSH Brute Force with Hydra (working at OS level, bug in API)
```bash
# Kali — mini password list (rockyou alternative)
echo -e "password\n123456\nadmin\nroot\ntest\nqwerty\nletmein" > /tmp/pass.txt

# SSH brute force
hydra -l root -P /tmp/pass.txt ssh://192.168.84.130 -t 4 -V
# OR single password:
hydra -l root -p password ssh://192.168.84.130 -t 4 -V
hydra -l root -p 123456 ssh://192.168.84.130 -t 4 -V
```

**Ubuntu — auth.log showed attacks arriving:**
```bash
sudo tail -f /var/log/auth.log | grep "Failed password"
# Output:
# Jul 3 10:50:14 sithu sshd[5800]: Failed password for root from 192.168.84.135 port 42290 ssh2
# Jul 3 10:50:30 sithu sshd[5806]: Failed password for root from 192.168.84.135 port 40000 ssh2
```

**But dashboard Security Events = empty**

### Bug found — SSH ingest handler (success-only)

```typescript
// OLD broken code in /ingest/ssh
if (st === "success") {          // only success created an event
    insertEvent(...)             // failed login → ssh_sessions only, not shown
}

// NEW fixed code
if (st === "failed" && (failCount === 1 || failCount % 5 === 0)) {
    insertEvent({
        type: "network_attack",
        subtype: "SSH Brute Force",
        severity: failCount >= 10 ? "high" : "medium",
        description: `SSH brute force from ${src_ip} — ${failCount} failed attempts`
    })
}
```

**Fix:** First failed login AND every 5th failure → creates security event in dashboard

### Forwarder process check (Ubuntu)
```bash
# Check how many instances running
ps aux | grep aegis_forwarder | grep -v grep
# Found: 3 instances running (should be 1)

# Fix — kill all, restart one
pkill -f aegis_forwarder
sleep 2
sudo python3 /opt/aegis_forwarder.py --mode all
```

### Confirmed working pipeline (Ubuntu)
```bash
# Verify: forwarder running
ps aux | grep aegis_forwarder | grep -v grep

# Verify: auth.log capturing SSH attempts
sudo tail -f /var/log/auth.log | grep "Failed password"

# Verify: Suricata running
sudo systemctl status suricata
```

---

## Optional Fix — vsftpd Logging (FTP attacks)

To make FTP brute force appear in dashboard:
```bash
# Ubuntu — enable vsftpd logging
sudo nano /etc/vsftpd.conf

# Add/enable these lines:
# xferlog_enable=YES
# log_ftp_protocol=YES
# vsftpd_log_file=/var/log/vsftpd.log

sudo systemctl restart vsftpd

# Verify
tail -f /var/log/vsftpd.log
```

---

## Current Lab Status (2026-07-03 11:00)

| Component | Status | Notes |
|-----------|--------|-------|
| Dashboard (Vercel) | ✅ Live | aegis-soc-dashboard.vercel.app |
| API Server (Render) | ✅ Live | auto-deploy on git push |
| Suricata IDS/IPS | ✅ ONLINE | Running, eve.json may need enable |
| Snort IDS | ✅ ONLINE | Running |
| Fail2ban | ❌ OFFLINE | Not started |
| Cowrie Honeypot | ❌ OFFLINE | Not installed |
| ModSecurity WAF | ❓ UNKNOWN | Not configured |
| Forwarder | ✅ Running | `--mode all`, 1 instance |
| Kali → Ubuntu SSH brute | ✅ Detected in auth.log | Dashboard fix deployed |
| Kali → Ubuntu nmap | ⚠️ Partial | Needs ET SCAN rules loaded |
| FTP brute force | ❌ Not detected | vsftpd logging not enabled |

---

## Code Fixes Summary (All Sessions)

| Date | File | Fix | Commit |
|------|------|-----|--------|
| 2026-07-03 | `auto-defense.ts` | RFC1918 IP whitelist | `a5d071a` |
| 2026-07-03 | `ingest.ts` | Outbound TLS = benign | `a5d071a` |
| 2026-07-03 | `ip-classifier.ts` | Shared utility, IPv6 support | `5376d02` |
| 2026-07-03 | `ingest.ts /ssh` | SSH brute force creates event | `113ee27` |

---

## Next Steps (TODO)

- [ ] `sudo suricata-update` → ET SCAN rules load → nmap appears in dashboard
- [ ] Enable `eve.json` in Suricata config → `sudo nano /etc/suricata/suricata.yaml`
- [ ] Enable vsftpd logging → FTP attacks appear
- [ ] `sudo systemctl start fail2ban` → SSH ban event test
- [ ] Install Cowrie honeypot → fake SSH test
- [ ] Kali: `hydra -l root -P /usr/share/wordlists/rockyou.txt ssh://192.168.84.130` → confirm SSH alerts in dashboard

---

## Quick Command Reference

### Ubuntu VM — Startup
```bash
# 1. Kill any old forwarder instances
pkill -f aegis_forwarder ; sleep 2

# 2. Start forwarder
export AEGIS_URL="https://aegis-api-server-jp3b.onrender.com/api"
export AEGIS_KEY="<your-ingest-key>"
sudo -E python3 /opt/aegis_forwarder.py --mode all

# 3. Verify services
sudo systemctl status suricata snort fail2ban
sudo tail -f /var/log/suricata/eve.json
sudo tail -f /var/log/auth.log | grep "Failed password"
```

### Kali — Attack Commands
```bash
# Port scan
nmap -sS -T4 192.168.84.130
nmap -sS -sV -O -A -p 1-65535 192.168.84.130

# SSH brute force
echo -e "password\n123456\nadmin\nroot\ntest" > /tmp/pass.txt
hydra -l root -P /tmp/pass.txt ssh://192.168.84.130 -t 4 -V

# FTP brute force
hydra -l ftp -P /tmp/pass.txt ftp://192.168.84.130 -t 4 -V

# Web scan
nikto -h http://192.168.84.130
```

### Pipeline Test (curl — no VM needed)
```bash
# Test SSH event directly to API
curl -X POST https://aegis-api-server-jp3b.onrender.com/api/ingest/ssh \
  -H "Content-Type: application/json" \
  -H "X-AEGIS-Key: $AEGIS_KEY" \
  -d '{"src_ip":"192.168.84.135","username":"root","status":"failed","failures":1}'

# Test Snort/nmap event
curl -X POST https://aegis-api-server-jp3b.onrender.com/api/ingest/snort \
  -H "Content-Type: application/json" \
  -H "X-AEGIS-Key: $AEGIS_KEY" \
  -d '{"src_ip":"192.168.84.135","dst_ip":"192.168.84.130","alert":"ET SCAN Nmap","severity":"high","timestamp":"'$(date -u +%Y-%m-%dT%H:%M:%SZ)'"}'
```

---

## Session 6 — Full Stack Expansion & Defense Engine (2026-07-10)

### Overview
Major expansion across schema, backend routes, forwarder scripts, and frontend pages. Auto-defense engine hardened with attack counters. Three highlight UI boxes added to System Status, Network Monitor, and Quick Connect sections.

### Schema Changes (lib/db/src/schema/)

| New Table / File | Purpose |
|---|---|
| `incidents.ts` — `incidents` | Groups related security events into trackable tickets with status/severity |
| `connections.ts` — `ssh_sessions` | Tracks SSH login attempts, source IPs, usernames, success/fail |
| `connections.ts` — `ftp_sessions` | FTP login/transfer events |
| `connections.ts` — `encrypted_traffic` | TLS metadata (cipher, cert validity, SNI) |
| `connections.ts` — `http_attacks` | WAF/ModSecurity events (SQLi, XSS, LFI, RFI) |
| `defense_engine.ts` — `defense_rules` | Configurable auto-defense rules (threshold, action) |
| `defense_engine.ts` — `defense_commands` | Command queue polled by on-VM defense agent |
| `defense_engine.ts` — `attack_counters` | Per-IP hit counters used for threshold-based escalation |
| `reports.ts` — `reports` | Metadata for generated security summary reports |

### New Backend Routes (artifacts/api-server/src/routes/)

| Route | Description |
|---|---|
| `GET/POST /api/incidents` | Incident CRUD — list, create, update status |
| `GET /api/reports` | Generated report retrieval |
| `GET /api/connections/ssh` | SSH session history |
| `GET /api/connections/ftp` | FTP session history |
| `GET /api/connections/tls` | TLS/encrypted traffic log |
| `GET /api/connections/tls/suspicious` | Suspicious TLS entries (weak cipher / self-signed) |
| `GET /api/connections/http-attacks` | HTTP attack log (WAF/ModSec) |
| `GET/POST /api/firewall/rules` | Firewall rule list and creation |
| `DELETE /api/firewall/rules/:id` | Deactivate a rule |
| `GET /api/firewall/rules/export` | Export active rules as bash script |
| `GET /api/defense/commands/pending` | Defense agent polls for pending commands |
| `POST /api/defense/commands/:id/done` | Defense agent marks command executed |
| `GET /api/stream` | Unified SSE stream endpoint |

### New Forwarder Scripts (scripts/src/)

| Script | Purpose |
|---|---|
| `aegis_forwarder_hub.py` | Central relay — aggregates multi-VM log sources, SSH-based collection, nmap scanning, tcpdump traffic capture |
| `pfsense_forwarder.py` | Ingests pfSense firewall logs, forwards to API |
| `defense_agent.py` | On-VM agent — polls `/api/defense/commands/pending`, executes iptables/ufw commands locally |
| `aegis-fail2ban-action.conf` | Fail2ban action config — directly calls AEGIS ingest API on ban event |

### New Frontend Pages (artifacts/aegis-dashboard/src/pages/)

| Page | Description |
|---|---|
| `incidents.tsx` / `incident-detail.tsx` | Incident management — lists grouped attack incidents, detail view with timeline |
| `reports.tsx` | Security reports — auto-generated summaries |
| `setup.tsx` | Guided setup/onboarding for new deployments; forwarder example commands use Render API URL |
| `architecture.tsx` | Lab topology visualizer — shows data flow: Sensors → Forwarder → API → Supabase → SSE → Dashboard |

### UI Improvements

- **Quick Connect box** — Ubuntu VM quick-connect helper on Dashboard and Network Monitor pages
- **Device Selector** — global device filter component (`device-selector.tsx`) added to layout; filters events by host
- **Highlight boxes** — 3 new status highlight boxes added: System Status summary, Network Monitor overview, Quick Connect section
- **`/pages/defense-center.tsx`** — full defense management UI: block/unblock IPs, rule creation, auto-defense toggle, pending command queue

### Auto-Defense Engine Hardening (artifacts/api-server/src/lib/auto-defense.ts)

- `attack_counters` table integration — per-IP event counts tracked across requests
- Threshold-based escalation: first hit → low, repeated hits → medium/high, threshold exceeded → auto-block
- `isDefenderIp()` whitelist from Session 4 kept; RFC1918 IPs never trigger auto-defense
- All IPs/ports sanitized through `defense-sanitize.ts` before building any shell command

### Data-Gap Caveats (known limitations)

- `targetHost` in ingest events is a mix of real destination IPs and generic labels (e.g. `"mail-server"`) — device filter matches on IP, some events won't scope to a specific device
- `encrypted_traffic` / TLS events from the forwarder itself (outbound to Render API) are logged but not alerted (outbound-from-defender filter)
- `attack_counters` are in-memory scoped per process restart — counters reset on Render cold start (free tier)

### Code Review Fixes Applied

- Removed `sys.exit(1)` from `aegis_forwarder_hub.py` when SSH threads fail — heartbeat/nmap/tcpdump keep running independently of SSH state
- Added `_has_passwordless_sudo()` pre-check before nmap install and tcpdump start — explicit error message instead of silent failure
- `setup.tsx` forwarder examples: all use `https://aegis-api-server-jp3b.onrender.com` (Render URL) — no Replit URLs

---

## Session 7 — Cowrie Honeypot Integration & System Status Fix (2026-07-19)

### ဆွေးနွေးခဲ့တာတွေ

**Cowrie Honeypot ဘယ် VM မှာ ထည့်သင့်သလဲ**
- Aegis VM (10.30.30.10) မှာ မထည့်ဘဲ company-web-server + company-customer-db မှာသာ ထည့်ရမယ်ဟု ဆုံးဖြတ်ချက်ချခဲ့
- Aegis VM က monitoring/forwarding hub ဖြစ်တာကြောင့် Red Team target မဟုတ်ဘူး၊ compromise ဖြစ်ရင် forwarder ပါ ရပ်သွားမယ်

**Port scan ဘယ် sensor ကဖမ်းသလဲ**
- Suricata IDS က network traffic signature နဲ့ ဖမ်းတယ်
- Fail2ban / SSH Monitor / Cowrie တွေက service-level ဘဲ၊ port scan မဖမ်းဘူး
- Auto-block ကျပြီးရင် attacker scan result မရတော့ဘူး (iptables DROP → timeout)

**Unblock လုပ်နည်း**
- Dashboard → Defense Center → Manual Block / Unblock → Unblock ခလုတ် (ရှိပြီးသား)
- API → iptables rule ဖျက် + DB `isActive=false` set
- pfSense block ဆိုရင် → `pfctl -t aegis_blocklist -T delete <IP>`

**iptables-persistent**
- Check: `dpkg -l iptables-persistent`
- Install: `sudo apt install iptables-persistent -y` → install ကတည်းက Save? Yes နှိပ်
- Lab မှာ မထည့်တာ သက်တောင့်သက်သာ ပိုရှိတယ် (reboot တိုင်း clean slate → attack/defense test ပြန်လုပ်လို့ ကောင်းတယ်)
- Production-grade persistent ဖြစ်ချင်ရင်သာ ထည့်ပါ

---

### Code Changes

#### 1. Cowrie Defense Rules ထည့် (`auto-defense.ts`)
- `OBSOLETE_RULE_NAMES` ထဲမှ `"Honeypot Touch → Instant Block"` ဖြုတ်ခဲ့
- Rules ၂ ခု ထပ်ထည့်ခဲ့:

```
Cowrie Honeypot Touch → Instant Block (company-web-server)
  triggerAttackType: "honeypot"  threshold: 1/60s
  actionType: "auto"  defenseType: "block_ip"  targetVm: "company-web-server"  priority: 5

Cowrie Honeypot Touch → Instant Block (company-customer-db)
  triggerAttackType: "honeypot"  threshold: 1/60s
  actionType: "auto"  defenseType: "block_ip"  targetVm: "company-customer-db"  priority: 5
```

Priority 5 = အမြင့်ဆုံး (honeypot ကို touch တာနဲ့ ချက်ချင်း block၊ zero false positive)

---

#### 2. System Status Page — Cowrie ထည့် (`routes/system.ts`)
`PER_HOST_SENSORS` ထဲ Cowrie Honeypot ၂ ခု ထည့်ခဲ့:

| hostIp | component | layer |
|---|---|---|
| 10.10.10.10 | Cowrie Honeypot | sensor |
| 10.20.20.20 | Cowrie Honeypot | sensor |

Total component count: 14 → **16** (Cowrie 2 ခု ထပ်)

Cowrie VM မှာ install + run ထားရင် **online** ပြမယ်၊ မရှိရင် **offline** ပြမယ်

---

#### 3. Forwarder Script — Cowrie Health Check ထည့် (`aegis_forwarder.py`)
company-web-server + company-customer-db ရဲ့ `health_services` list ထဲ ထည့်ခဲ့:

```python
("cowrie", "Cowrie Honeypot", "sensor")
```

Forwarder က SSH ကနေ remote VM မှာ `systemctl is-active cowrie` စစ်ပြီး `/api/system/status` ကို report လုပ်မယ်

---

#### 4. Dashboard Stale Check Bug Fix (`routes/dashboard.ts`)
**ပြဿနာ:** System Status "1 online" vs Command Center "2/14" — မကိုက်ဘူး

**Root cause:** `dashboard.ts` မှာ global component (no hostIp) တွေကို stale check မလုပ်ဘူး → AEGIS API Server stale ဖြစ်နေတာ "online" ထင်ပြီး count ထည့်မိတယ်

**Fix:** `system.ts` နဲ့ ညီတဲ့ logic ထည့်ခဲ့:
```
VM sensors (hostIp ရှိ)   → 3 min stale → offline
Global rows (hostIp မရှိ) → 2 min stale → offline
```

ယခုဆိုရင် နှစ်ဘက်တူညီတဲ့ count ပြမယ်

---

### VM မှာ လုပ်ရမည်

**Script update (Aegis VM မှာ):**
```bash
wget -O /opt/aegis/scripts/src/aegis_forwarder.py \
  https://raw.githubusercontent.com/sohu2723-star/aegis-soc-dashboard/main/scripts/src/aegis_forwarder.py
sudo systemctl restart aegis-forwarder
```

**Cowrie install (company-web-server + company-customer-db မှာ):**
```bash
sudo apt install cowrie -y
sudo systemctl enable cowrie --now
# Port 2222 မှာ listen လုပ်တာ သေချာစစ်ပါ
ss -tlnp | grep 2222
```

**iptables-persistent check:**
```bash
dpkg -l iptables-persistent
# ii ပြရင် install ပြီး၊ မပြရင် မ install ရသေးဘူး
```

---

*Last updated: 2026-07-19 (Session 7)*
