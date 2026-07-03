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
| **Ubuntu VM IP** | `192.168.122.225` |
| **Kali Linux** | Attacker VM (KVM guest) |
| **Forwarder** | `/opt/aegis_forwarder.py` on Ubuntu VM |

---

## Architecture

```
Kali Linux (attacker)
    │  nmap / hydra / sqlmap
    ▼
Ubuntu VM (defender)
    ├── Suricata IDS/IPS  (/var/log/suricata/eve.json)
    ├── Snort IDS          (/var/log/snort/alert)
    ├── Fail2ban           (/var/log/fail2ban.log)
    ├── Cowrie Honeypot    (/var/log/cowrie/cowrie.json)
    └── aegis_forwarder.py ──→ API Server (Render)
                                        │
                                        ▼
                               Supabase PostgreSQL
                                        │
                                        ▼
                               Dashboard (Vercel) ←── SSE real-time
```

---

## Session 1 — Project Bootstrap

### What was built
- Monorepo setup: `artifacts/aegis-dashboard` (React + Vite) + `artifacts/api-server` (Express)
- Supabase schema: `hosts`, `security_events`, `alerts`, `system_status` tables
- Orval OpenAPI codegen for typed API client
- Deployed: Vercel (frontend) + Render (API)

### Key files created
- `artifacts/api-server/src/routes/network.ts` — host registration + heartbeat
- `artifacts/api-server/src/routes/alerts.ts` — alert ingestion + SSE
- `artifacts/api-server/src/routes/system.ts` — service health
- `artifacts/aegis-dashboard/src/pages/` — Network Monitor, Defense Center, Active Alerts
- `scripts/src/aegis_forwarder.py` — Ubuntu forwarder script

---

## Session 2 — Real-time Features

### Features added
- **Network Monitor** — online/offline auto-detection via heartbeat
- **Defense Center** — Suricata/Snort/Fail2ban/Cowrie service health cards
- **Active Alerts** — enriched alert display with LEFT JOIN security_events
- **SSE (Server-Sent Events)** — real-time push to dashboard without polling

### Bug fixes
| Bug | Root Cause | Fix |
|-----|-----------|-----|
| `window.confirm()` silently blocked | Cross-origin iframe (Vercel/Replit preview) blocks `window.confirm()` | Replaced with shadcn `AlertDialog` in `network.tsx` + `reports.tsx` |
| Host goes ONLINE then never OFFLINE | Auto-timeout was 90s, too long | Reduced heartbeat 60s→15s, timeout 90s→45s |
| Forwarder stop doesn't mark OFFLINE | No shutdown handler | Added `SIGINT/SIGTERM` handler → sends `status: offline` immediately |
| Service status SSE not updating UI | Query key mismatch: used `["system-status"]` instead of Orval-generated key | Fixed to `getGetSystemStatusQueryKey()` |
| `sanitizeIp` throwing on invalid IP | No try/catch | Wrapped in try/catch in `network.ts` |

### Commands run on Ubuntu VM
```bash
# Start forwarder (all modes)
sudo python3 /opt/aegis_forwarder.py --mode all

# Check service health
systemctl status suricata
systemctl status snort
systemctl status fail2ban
```

---

## Session 3 — Suricata Fix & Attack Testing (2026-07-03)

### Problem
Suricata installed but failing to start — `status=1/FAILURE`, restart loop

### Diagnosis steps
```bash
journalctl -xeu suricata --no-pager | tail -20
ip link show | grep -E "^[0-9]" | awk '{print $2}'
sudo suricata -T -c /etc/suricata/suricata.yaml
```

### Fix
```bash
# 1. Check interface name (was eth0 in config, actual = enp1s0)
ip link show

# 2. Edit suricata.yaml — change interface
sudo nano /etc/suricata/suricata.yaml
# Find: af-packet → interface: eth0
# Change to: interface: enp1s0

# 3. Update rules (ET SCAN rules needed for nmap detection)
sudo suricata-update
sudo systemctl restart suricata

# 4. Verify
sudo systemctl status suricata
# → should show: active (running)
```

### Current lab status (2026-07-03 04:50)
| Service | Status | Notes |
|---------|--------|-------|
| Suricata IDS/IPS | ✅ ONLINE | Showing in Defense Center |
| Snort IDS | ✅ ONLINE | Showing in Defense Center |
| Fail2ban | ❌ OFFLINE | Not started |
| Cowrie Honeypot | ❌ OFFLINE | Not installed/started |
| ModSecurity WAF | ❓ UNKNOWN | Not configured |
| Forwarder | ✅ Running | Connected to Render API |

### Attack test — nmap from Kali
```bash
# Kali မှာ run
nmap -sS 192.168.122.225
nmap -sS -sV -O -A -p 1-65535 192.168.122.225

# Result: "All 1000 scanned ports are in ignored states (reset)"
# → Suricata/Snort running ဖြစ်ပေမဲ့ dashboard မှာ alert မပေါ်
```

### Why alerts not appearing — checklist
```bash
# Ubuntu မှာ ဒီ commands run ပါ

# 1) Suricata eve.json မှာ entries ရှိလား
sudo tail -f /var/log/suricata/eve.json

# 2) Snort alert log ကြည့်
sudo tail -20 /var/log/snort/alert

# 3) Forwarder process + mode စစ်
ps aux | grep aegis_forwarder

# 4) ET SCAN rules loaded ဆိုတာ စစ်
ls /etc/suricata/rules/ | grep -i "scan\|emerging"
```

### Probable root cause
ET SCAN Nmap detection rules မ load ဖြစ်ဘဲ Suricata က nmap scan ကို detect မလုပ်နိုင်
```bash
# Fix
sudo suricata-update           # ET rules download + install
sudo systemctl restart suricata
sudo tail -f /var/log/suricata/eve.json &   # live watch
nmap -sS 192.168.122.225                    # trigger scan
# → eve.json မှာ alert entries ပါလာရမည် → dashboard Active Alerts မှာ ပေါ်မည်
```

### Quick pipeline test (Suricata မလိုဘဲ)
```bash
# API ကို curl တိုက်ရိုက် POST → dashboard ချက်ချင်းပြမည်
curl -X POST https://aegis-api-server-jp3b.onrender.com/api/ingest/snort \
  -H "Content-Type: application/json" \
  -H "X-AEGIS-Key: $AEGIS_KEY" \
  -d '{
    "src_ip": "192.168.122.100",
    "dst_ip": "192.168.122.225",
    "alert": "ET SCAN Nmap Scripting Engine User-Agent Detected",
    "severity": "high",
    "timestamp": "'$(date -u +%Y-%m-%dT%H:%M:%SZ)'"
  }'
```

---

## Forwarder Quick Reference

### Start forwarder
```bash
cd /opt
sudo python3 aegis_forwarder.py --mode all
```

### Environment variables required
```bash
export AEGIS_URL="https://aegis-api-server-jp3b.onrender.com/api"
export AEGIS_KEY="your-ingest-key-here"
```

### What forwarder does
| Thread | Source | API Endpoint |
|--------|--------|-------------|
| `watch_suricata` | `/var/log/suricata/eve.json` | `POST /api/ingest/suricata` |
| `watch_snort` | `/var/log/snort/alert` | `POST /api/ingest/snort` |
| `watch_fail2ban` | `/var/log/fail2ban.log` | `POST /api/ingest/fail2ban` |
| `watch_cowrie` | `/var/log/cowrie/cowrie.json` | `POST /api/ingest/cowrie` |
| `watch_ssh` | `/var/log/auth.log` | `POST /api/ingest/ssh` |
| `heartbeat_loop` | every 15s | `POST /api/network/hosts` |
| `service_health_loop` | every 30s | `POST /api/system/status` |

---

## API Endpoints Reference

| Method | Endpoint | Purpose |
|--------|----------|---------|
| `POST` | `/api/network/hosts` | Register host / heartbeat |
| `PATCH` | `/api/network/hosts/:ip/online` | Mark host online |
| `PATCH` | `/api/network/hosts/:ip/offline` | Mark host offline |
| `GET` | `/api/network/hosts` | List all hosts |
| `GET` | `/api/network/hosts/sse` | SSE stream for host changes |
| `POST` | `/api/ingest/suricata` | Ingest Suricata alert |
| `POST` | `/api/ingest/snort` | Ingest Snort alert |
| `POST` | `/api/ingest/fail2ban` | Ingest Fail2ban ban event |
| `POST` | `/api/ingest/cowrie` | Ingest Cowrie honeypot event |
| `POST` | `/api/system/status` | Update service health |
| `GET` | `/api/system/status` | Get service health |
| `GET` | `/api/system/sse` | SSE stream for service changes |
| `GET` | `/api/alerts` | List active alerts |
| `GET` | `/api/alerts/sse` | SSE stream for new alerts |

---

---

## Session 4 — Defender Self-Block Bug Fix (2026-07-03 10:10)

### What was observed
- Dashboard Telemetry: `192.168.84.130 → 216.24.57.8/9 [Suspicious TLS]` — repeated flood
- Forwarder log: `SURICATA/TLS → AEGIS` every few seconds
- Command Center: `BLOCK_IP 192.168.84.130` queued (AUTO, QUEUED status) — defender being blocked!
- Kali nmap worked: ports 21/22/80 open on `192.168.84.130`

### Root cause
```
Ubuntu VM (192.168.84.130)
    │ forwarder sends heartbeat/events to Render API via HTTPS
    ▼
Render servers (216.24.57.8, 216.24.57.9)
         ↑
Suricata detects this OUTBOUND TLS connection
→ Python requests TLS fingerprint triggers ET rules → "Suspicious TLS"
→ auto-defense engine sees src_ip = 192.168.84.130 (our own VM)
→ queues BLOCK_IP 192.168.84.130   ← defender blocking itself!
```

### Fixes applied

**Fix 1 — auto-defense.ts: RFC1918 IP whitelist**
Added `isDefenderIp()` check at top of `evaluateEvent()`:
- Any `src_ip` in `10.x.x.x`, `172.16-31.x.x`, `192.168.x.x`, `127.x.x.x` → skip auto-defense
- Log: `[AutoDefense] Skipped — defender IP x.x.x.x is whitelisted (RFC1918)`

**Fix 2 — ingest.ts: Outbound TLS from defender = benign**
Added `isPrivateIp()` helper + check in `/ingest/suricata/tls`:
- If `src_ip` is private → log to encrypted_traffic table (for telemetry) but NO alert, NO auto-defense
- Returns `{ isSuspicious: false, skipped: "outbound_from_defender" }`
- Genuine suspicious TLS (from external attackers with bad certs) still alerts normally

### Result
- Ubuntu VM will no longer be auto-blocked
- Forwarder→Render outbound TLS = silently logged only
- Real external attacker TLS with weak/expired/self-signed certs = still alerts

---

## Next Steps (TODO)

- [ ] Load ET SCAN rules → `sudo suricata-update && sudo systemctl restart suricata`
- [ ] Confirm: nmap from Kali now generates alerts in Security Events
- [ ] Start: Fail2ban service on Ubuntu VM → test SSH brute-force → Fail2ban ban alert
- [ ] Install: Cowrie honeypot → test fake SSH login
- [ ] Deploy updated API to Render (git push → auto-deploy)
- [ ] Document: Real IP addresses in Lab IP Reference table

---

*Last updated: 2026-07-03 (Session 4)*
