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

---

## [2026-07-18] — pfSense SSH Bridge Implementation & Defense System Testing

**Status:** ✅ Done  
**What:** pfSense firewall ကို dashboard ကနေ control လုပ်ဖို့ REST API approach ကနေ SSH + `easyrule` approach သို့ ပြောင်းလဲ implement လုပ်ခဲ့တယ်။ Block/Unblock အပြည့်အဝ test ပြီး အောင်မြင်တယ်။

---

### ဘာကြောင့် REST API မသုံးတော့ဘဲ SSH သုံးသလဲ

pfSense REST API သုံးဖို့ pfSense မှာ **"pfSense-API" community package** install လုပ်ထားဖို့ လိုတယ်။ ဒါ default မပါဘဲ install ခက်ခဲနိုင်တယ်။ SSH + `easyrule` ကတော့ pfSense built-in ဆိုတော့ package မလိုဘဲ SSH ဖွင့်ရုံနဲ့ အလုပ်လုပ်တယ်။

---

### Implementation

**Flow:**
```
Dashboard → AEGIS API (Render) → defense_commands table
    → aegis_forwarder.py (10.30.30.10) polls
    → SSH → pfSense (10.30.30.1)
    → easyrule block WAN <ip>
    → Firewall → Rules → WAN မှာ static rule ပေါ်လာ
```

**Code change** (`scripts/src/aegis_forwarder.py`):
- `PFSENSE_SSH_KEY` = `/home/sithu/.ssh/pfsense_key`
- `PFSENSE_SSH_USER` = `admin`
- `_exec_defense_pfsense()` function — REST API calls အားလုံး ဖျက်၊ SSH + easyrule နဲ့ replace

**Commands:**
| Action | SSH Command |
|---|---|
| block_ip | `easyrule block WAN <ip>` |
| unblock_ip | `easyrule unblock WAN <ip>` |
| block_port | `easyrule block WAN <ip> <port> <proto>` |

**`commandType: "pfsense_api"`** — forwarder dispatch routing label အနေနဲ့ ကျန်ထားတယ် (command JSON payload ကို parse ပြီး SSH execute လုပ်တယ်)။

---

### pfSense Setup (One-time)

```bash
# AEGIS VM (10.30.30.10) မှာ
ssh-keygen -t ed25519 -f ~/.ssh/pfsense_key -N ""
cat ~/.ssh/pfsense_key.pub   # copy ယူ → pfSense ထဲ paste
```

pfSense Web UI:
- **System → Advanced → Admin Access** → Enable Secure Shell ✅
- **System → User Manager → admin → Edit → Authorized SSH Keys** → public key paste → Save

```bash
# aegis_forwarder.local.conf မှာ
PFSENSE_SSH_KEY=/home/sithu/.ssh/pfsense_key
PFSENSE_SSH_USER=admin
PFSENSE_IP=10.30.30.1
# PFSENSE_API_KEY= မလိုတော့ဘူး (SSH သုံးတာဆိုတော့)
```

**Script update လုပ်နည်း (IMPORTANT):**
Ubuntu VM မှာ `git pull` **မအလုပ်လုပ်ဘူး** — `wget` သုံးရမယ်—
```bash
wget -O /opt/aegis/scripts/src/aegis_forwarder.py \
  https://raw.githubusercontent.com/sohu2723-star/aegis-soc-dashboard/main/scripts/src/aegis_forwarder.py
```

---

### Test Results ✅

```
# Block test
[defense-hub] Command #X: [pfsense_api] vm=pfsense ip=192.168.122.132
[defense] pfSense SSH → admin@10.30.30.1: easyrule block WAN 192.168.122.132
[defense] ✓ pfSense block_ip 192.168.122.132 OK

# Unblock test
[defense] pfSense SSH → admin@10.30.30.1: easyrule unblock WAN 192.168.122.132
[defense] ✓ pfSense unblock_ip 192.168.122.132 OK
```

pfSense **Firewall → Rules → WAN** မှာ `EasyRuleBlockHostsWAN` rule ပေါ်လာတယ် ✅

**Note:** `easyrule` က pfSense `config.xml` ထဲ rule ရေးတာဆိုတော့ reboot ရင်လည်း rule ကျန်နေတယ် (persistent static rule)။ Unblock လုပ်ရင် IP က table ထဲကပျောက်တယ်၊ rule row ကတော့ ကျန်နေနိုင်တယ် — ဒါ pfSense normal behavior ဖြစ်တယ်၊ block မဖြစ်တော့ဘူး။

---

### Defense System Architecture (အကျဉ်းချုပ်)

Dashboard မှာ firewall control လုပ်နည်း ၃ မျိုး—

**① Defense Center → Block IP**
- Manual, ချက်ချင်း
- pfSense WAN layer ကနေ block → network ဝင်ပေါက်မှာပဲ ဖြတ် → VM အားလုံးသို့ မရောက်နိုင်

**② Defense Rules → Auto Defense Rules**
- Attack pattern threshold ပြည့်ရင် အလိုအလျောက် trigger
- `targetVm = pfsense` → pfSense WAN block
- `targetVm = ubuntu` → Ubuntu iptables block

**③ Defense Rules → ADD FIREWALL RULE**
- Ubuntu VM iptables manual rule
- Port-specific block ဖြစ်နိုင် (SSH ပဲ, web ပဲ စသည်)
- Ubuntu VM တစ်ခုတည်းသာ သက်ရောက်

**pfSense block vs Ubuntu iptables block:**
| | pfSense block | Ubuntu iptables |
|---|---|---|
| Layer | Network (WAN) | OS |
| သက်ရောက်မည်သူ | VM အားလုံး | Ubuntu တစ်ခုတည်း |
| Port-specific | ❌ | ✅ |
| ပိုထိရောက် | ✅ | — |

---

### Known Issues

- `customer-db` VM မှာ PostgreSQL install မရသေးဘူး (`postgresql.service not found`) → `sudo apt install -y postgresql postgresql-contrib` လိုအပ်သေးတယ်

---

## 2026-07-19 — Cowrie Honeypot Full Integration

### Cowrie VM Placement Decision
- Aegis VM (10.30.30.10) မှာ **မထည့်ဘူး** — management hub ဖြစ်တာကြောင့် Red Team target မဟုတ်
- bank-web (10.10.10.10) + customer-db (10.20.20.20) မှာသာ ထည့်မယ်

### Sensor Roles (ဘယ် sensor က ဘာဖမ်းသလဲ)
| Sensor | ဖမ်းတာ |
|---|---|
| **Suricata IDS** | Port scan, DDoS, SQLi, XSS, TLS anomaly, network-level attacks |
| **Fail2ban** | SSH/FTP brute force (service-level ban) |
| **SSH Monitor** | SSH login success/fail |
| **Apache Monitor** | Web attacks (ModSecurity/WAF) |
| **FTP Monitor** | FTP sessions |
| **Cowrie Honeypot** | Honeypot SSH touch (port 2222) |
| **PostgreSQL Monitor** | DB auth failures, suspicious queries |

### Auto-block After Port Scan
- Suricata detect → `port_scan` event → rule match → iptables block
- Block ကျပြီးရင် attacker nmap timeout ဘဲ ပြမယ် — scan result မရတော့ဘူး
- Unblock: Defense Center → Manual Block/Unblock → Unblock ခလုတ်

### iptables-persistent
- Lab မှာ **မထည့်တာ အကောင်းဆုံး** — reboot တိုင်း clean slate ဖြစ်လို့ attack/defense test ပြန်ပြန်လုပ်ရ အဆင်ပြေ
- Check: `dpkg -l iptables-persistent`
- Production persistent ဖြစ်ချင်ရင်: `sudo apt install iptables-persistent -y` → Save? Yes

### Code Changes (2026-07-19)
| File | Change |
|---|---|
| `auto-defense.ts` | Cowrie rules ၂ ခု ထည့် (bank-web + customer-db, priority 5, threshold 1) |
| `routes/system.ts` | PER_HOST_SENSORS ထဲ Cowrie Honeypot ၂ ခု ထည့် |
| `aegis_forwarder.py` | bank-web + customer-db health_services ထဲ cowrie ထည့် |
| `routes/dashboard.ts` | Global component stale check bug fix (2min grace, system.ts နဲ့ ညှိ) |

### Cowrie Install on VMs
```bash
# bank-web + customer-db မှာ run
sudo apt install cowrie -y
sudo systemctl enable cowrie --now
ss -tlnp | grep 2222   # port 2222 listen စစ်ပါ
```

### Forwarder Update
```bash
# Aegis VM မှာ run
wget -O /opt/aegis/scripts/src/aegis_forwarder.py \
  https://raw.githubusercontent.com/sohu2723-star/aegis-soc-dashboard/main/scripts/src/aegis_forwarder.py
sudo systemctl restart aegis-forwarder
```

---

*Last updated: 2026-07-19*
