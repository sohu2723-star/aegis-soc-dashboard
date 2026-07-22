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
Attacker ──► R1 MikroTik ──► pfSense/Suricata ──► company-web-server     (10.10.10.10, DMZ)
                                                ──► aegis-forwarder (10.30.30.10, MGMT)
                                                ──► company-customer-db  (10.20.20.20, INT)

aegis-forwarder ──► AEGIS API (Render) ──► Dashboard (Vercel)
                                       ──NOTIFY──► Telegram Bot
```

**Node IPs:**
- R1 WAN (NAT cloud): `192.168.122.2` (DHCP, GNS3 NAT uses `192.168.122.0/24`)
- R1 ether3 (LAN-side): `10.0.23.1` → pfSense WAN: `10.0.23.2`
- pfSense DMZ → `10.10.10.0/24` (company-web-server)
- pfSense INT → `10.20.20.0/24` (company-customer-db)
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
Attacker → R1 Router → pfSense → company-web-server        (green, DMZ)
                               → aegis-forwarder  (cyan, MGMT)
                               → company-customer-db      (green, INT)
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

- `company-customer-db` VM မှာ PostgreSQL install မရသေးဘူး (`postgresql.service not found`) → `sudo apt install -y postgresql postgresql-contrib` လိုအပ်သေးတယ်

---

## 2026-07-19 — Cowrie Honeypot Full Integration

### Cowrie VM Placement Decision
- Aegis VM (10.30.30.10) မှာ **မထည့်ဘူး** — management hub ဖြစ်တာကြောင့် Red Team target မဟုတ်
- company-web-server (10.10.10.10) + company-customer-db (10.20.20.20) မှာသာ ထည့်မယ်

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
| `auto-defense.ts` | Cowrie rules ၂ ခု ထည့် (company-web-server + company-customer-db, priority 5, threshold 1) |
| `routes/system.ts` | PER_HOST_SENSORS ထဲ Cowrie Honeypot ၂ ခု ထည့် |
| `aegis_forwarder.py` | company-web-server + company-customer-db health_services ထဲ cowrie ထည့် |
| `routes/dashboard.ts` | Global component stale check bug fix (2min grace, system.ts နဲ့ ညှိ) |

### Cowrie Install on VMs
```bash
# company-web-server + company-customer-db မှာ run
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

---

## 2026-07-19 — GNS3 Network Interface များ နားလည်မှု (virbr0 vs Bridge vs NAT)

**Status:** ✅ Done  
**What:** GNS3 NAT Cloud မှာ ဘယ် interface သုံးရမလဲ၊ virbr0/bridge/NAT ကွာခြားချက် နားလည်ပြီး မှတ်တမ်းတင်ခြင်း  
**How:** Lab မေးခွန်းများမှ ရှင်းလင်းချက်  
**Result:** virbr0 သာ GNS3 NAT cloud မှာ သုံးရမယ်ဆိုတာ confirm ဖြစ်တယ်  
**Next:** virbr0 ကို GNS3 NAT cloud မှာ ထည့်ပြီး company-web-server internet access ရယူ → Cowrie install ဆက်လုပ်

---

### virbr0 vs Bridge vs enp1s0 — ကွာခြားချက်

#### virbr0 (libvirt NAT Bridge)

libvirt (KVM/QEMU) က အလိုအလျောက် ဆောက်ပေးတဲ့ virtual NAT bridge ဖြစ်တယ်။

```
VM (192.168.122.x)
       │
   virbr0 (192.168.122.1)   ← host ရဲ့ virtual interface
       │
  iptables NAT (masquerade)
       │
  Host ရဲ့ real NIC (enp1s0)
       │
  Internet / LAN
```

- VM တွေကို `192.168.122.x` IP ပေးတယ် (DHCP)
- VM ကနေ internet ထွက်ရင် host ရဲ့ IP နဲ့ NAT လုပ်ပြီး ထွက်တယ်
- Outside ကနေ VM ကို တိုက်ရိုက် ဝင်လို့ **မရဘူး**
- VMware ရဲ့ NAT mode နဲ့ အတူတူပဲ၊ libvirt version သာ ကွာတယ်

စစ်ကြည့်နည်း (host မှာ):
```bash
ip addr show virbr0
# → 192.168.122.1 ပြမယ်

sudo iptables -t nat -L -n | grep 122
# → MASQUERADE rule ပြမယ်
```

---

#### enp1s0 (Physical NIC)

`enp1s0` က software bridge **မဟုတ်ဘူး** — physical ethernet NIC (network card) ဖြစ်တယ်။  
သို့သော် GNS3 NAT cloud မှာ enp1s0 သုံးရင် **bridge effect ဖြစ်တယ်** — NAT မပါဘဲ VM traffic ကို real LAN ထဲ တိုက်ရိုက် ထုတ်လိုက်တယ်။

```
enp1s0 GNS3 မှာ သုံးရင်:
GNS3 VM ──► enp1s0 ──► Real LAN (192.168.1.x)
              ↑
         NAT မပါ = bridge လိုပဲ အလုပ်လုပ်
```

---

#### NAT Layer နှစ်ထပ် (ပြည့်စုံတဲ့ picture)

```
Internet
    │
[ISP Router NAT]    ← LAN တစ်ခုလုံးကို internet ကနေ ကာတယ်
    │
Host PC (192.168.1.x)
    │
[virbr0 NAT]        ← VM တွေကို LAN ကနေ ကာတယ်
    │
GNS3 VM (192.168.122.x)
```

- **Router NAT** — Internet ↔ LAN ကြား ကာတယ်
- **virbr0 NAT** — LAN ↔ VM ကြား ကာတယ်
- နှစ်ခု မတူဘူး၊ တစ်ခုကနောက်တစ်ခု **အစားမထိုးနိုင်**

---

### GNS3 NAT Cloud — Interface ရွေးချယ်မှု

GNS3 → NAT Cloud → Node Properties → Ethernet interfaces မှာ—

| Interface | သုံးသင့်? | ဘာကြောင့် |
|---|---|---|
| `lo` | ❌ | Loopback — internet မရဘူး |
| `enp1s0` | ⚠️ | Physical NIC — real LAN ထဲ bridge effect ဖြစ်မယ် |
| `virbr0` | ✅ | NAT — safe, internet ရတယ်, LAN မထိ |
| `wlp0s20f3` | ⚠️ | WiFi — ရပေမဲ့ unstable ဖြစ်နိုင် |

**→ virbr0 သာ ရွေးပါ**

---

### Bridge Mode သုံးရင် ဘာဆိုးသလဲ

Lab မှာ enp1s0 (bridge effect) သုံးမိရင်—

```
Kali → company-web-server (real LAN IP ရတယ်) → Home Router, NAS, PC တွေ ← အန္တရာယ်
```

- Hydra, nmap, sqlmap attack တွေ real LAN device တွေကို ပါ ထိနိုင်တယ်
- Suricata alert တွေ real internet traffic ကြောင့် noisy ဖြစ်မယ်
- Lab isolated မဖြစ်တော့ဘူး

**Lab မှာ bridge/enp1s0 မသုံးပါနဲ့ — virbr0 NAT သာ သုံးပါ။**

---

### Speed နှိုင်းယှဉ် (Bridge vs NAT)

| | virbr0 (NAT) | Bridge (enp1s0) |
|---|---|---|
| Overhead | NAT translation ရှိ | တိုက်ရိုက် pass |
| Latency | အနည်းငယ် မြင့် | နိမ့် |
| Speed | အနည်းငယ် နှေး | ပိုမြန် |
| Lab အတွက် | ✅ မကွာဘူး | ⚠️ Security risk |

Lab attack/defense test အတွက် speed ကွာချင် မကွာဘူး — **security isolation ပိုအရေးကြီးတယ်**။

---

---

## 2026-07-19 — Cowrie Honeypot ဖြုတ်ခြင်း + Attack/Defense Test Ready စစ်ဆေး

**Status:** ✅ Done  
**What:** Cowrie honeypot ကို system မှ ဖြုတ်ပြီး company-web-server + company-customer-db + aegis VM သုံးခုနဲ့ attack/defense test စတင်ရန် ပြင်ဆင်  
**How:** auto-defense rules + system status sensors မှ Cowrie ဖြုတ်လိုက်တယ်  
**Result:** System clean ဖြစ်ပြီ၊ Cowrie မပါဘဲ core sensors တွေနဲ့ attack/defense test ဆင်းလို့ ရပြီ  
**Next:** Kali ကနေ attack စမ်း → dashboard မှာ detect ဖြစ်မဖြစ် + auto-defense trigger မဖြစ် စစ်

---

### ဖြုတ်လိုက်တဲ့ Cowrie items

| File | ဖြုတ်လိုက်တာ |
|---|---|
| `auto-defense.ts` | Cowrie Honeypot Touch rules ၂ ခု (company-web-server + company-customer-db) |
| `routes/system.ts` | Cowrie Honeypot sensor ၂ ခု (company-web-server + company-customer-db) |

`/api/ingest/cowrie` endpoint တော့ ကျန်ထားတယ် — ဖျက်မထားဘူး (နောက်မှ လိုချင်ရင် ပြန်သုံးလို့ရ)

---

### Current System — Attack/Defense Test အတွက် လုံလောက်မလား

**✅ လုံလောက်တယ်** — core attack scenarios အားလုံး cover ဖြစ်နေတယ်

#### Active Sensors (VM ၃ ခု)

**company-web-server (10.10.10.10)**
| Sensor | ဖမ်းတာ |
|---|---|
| Suricata IDS | Port scan, DDoS, SQLi, XSS, TLS anomaly |
| Fail2ban | SSH/FTP brute force |
| SSH Monitor | SSH login success/fail |
| FTP Monitor | FTP sessions |
| Apache Monitor | Web attacks (ModSecurity/WAF) |

**company-customer-db (10.20.20.20)**
| Sensor | ဖမ်းတာ |
|---|---|
| Suricata IDS | Network attacks |
| Fail2ban | Brute force |
| SSH Monitor | SSH attacks |
| PostgreSQL Monitor | DB auth failures |

**aegis (10.30.30.10)**
| Sensor | ဖမ်းတာ |
|---|---|
| Hub Forwarder | Log collection hub |
| SSH Monitor | MGMT zone SSH attack |
| Fail2ban | AEGIS VM ကာကွယ် |

#### Attack Scenarios — ဆင်းလို့ ရပြီ

| Attack | Tool | ဘယ် VM target | Sensor ဖမ်းမယ် |
|---|---|---|---|
| Port scan | nmap | company-web-server / company-customer-db | Suricata |
| SSH brute force | hydra | company-web-server / company-customer-db / aegis | Fail2ban + SSH Monitor |
| Web attack (SQLi/XSS) | sqlmap / curl | company-web-server | Suricata + Apache Monitor |
| FTP brute force | hydra | company-web-server | Fail2ban + FTP Monitor |
| DDoS / SYN flood | hping3 | company-web-server | Suricata |
| DB attack | hydra / sqlmap | company-customer-db | PostgreSQL Monitor + Suricata |

---

## 2026-07-19 — Kali DHCP IP ပြောင်းနည်း

**Status:** ✅ Done  
**What:** DHCP lease persistence — Kali restart တိုင်း IP တူနေတာ (MAC address ကြောင့်)  
**Result:** Normal behavior — `.99` နဲ့ attack test ဆင်းလို့ ရပြီ  
**IP ပြောင်းချင်ရင်:**

MikroTik:
```routeros
/ip dhcp-server lease remove [find]
```
Kali:
```bash
sudo dhclient -r eth0
sudo dhclient eth0
```

---

## 2026-07-19 — Topology v3 မှတ်တမ်း — Documentation Full Update

**Status:** ✅ Done  
**What:** ဆရာမ ညွှန်ကြားချက်အတိုင်း topology v3 ကို docs/code files အားလုံး update လုပ်ပြီး git push  

**Topology Changes (v2 → v3):**

| ပြောင်းတာ | မူလ | ခု |
|---|---|---|
| Switch1 | NAT+R1+Kali ကြား | ဖြုတ်ပြီ |
| Kali connection | Switch1 ကတဆင့် | Router ether2 တိုက်ရိုက် |
| Kali subnet | 192.168.122.0/24 (virbr0) | 192.168.10.0/24 (Router DHCP) |
| Router ether2 | NAT DHCP client | 192.168.10.1/24 + DHCP server |
| pfSense WAN rule | 192.168.122.0/24 | 192.168.10.0/24 |
| pfSense static route | မရှိ | 192.168.10.0/24 via 10.0.23.1 |

**Files Updated:** network-architecture.md, ip-plan.md, router-config.md, GNS3_SETUP.md, vm-config.md, README.md, setup.tsx, memory  
**Result:** Kali internet ✅, company-web-server ping ✅, real-world topology ✅  
**Next:** Attack test ဆင်းပြီး dashboard ရောက်မရောက် စစ်

---

## 2026-07-19 — Topology ပြောင်းလဲ + Kali IP Update

**Status:** ✅ Done  
**What:** ဆရာမ ညွှန်ကြားချက်အတိုင်း GNS3 topology logic စစ်ဆေး၊ Kali IP ပြောင်းလဲမှု code မှာ update လုပ်  
**How:** GNS3 screenshot စစ်ဆေး၊ code ထဲ hardcoded Kali IP `192.168.122.132` → `192.168.122.153` update  
**Result:**
- Topology structure ✅ မှန်ကန်တယ် (Router → pfSense → DMZ/Internal/MGMT zones)
- Kali IP code files updated: `architecture.tsx`, `defense-rules.tsx`, `docs/network-architecture.md`, `docs/GNS3_SETUP.md`, `docs/API.md`
- Kali internet မရတဲ့ ပြဿနာ: default gateway `192.168.122.1` (virbr0 host bridge) ထည့်ပေးရမည်  
**Next:** Kali မှာ `sudo ip route replace default via 192.168.122.1` run ပြီး internet ရမရ စစ်

### Kali Internet Fix Commands
```bash
sudo ip route replace default via 192.168.122.1 dev eth0
sudo ip route add 10.0.0.0/8 via 192.168.122.2
echo "nameserver 8.8.8.8" | sudo tee /etc/resolv.conf
ping -c 3 8.8.8.8
```

---

*Last updated: 2026-07-21*

---

## [2026-07-21] — Replit Re-import #2 + Full State Audit

**Status:** ✅ Done
**What:** GitHub repo ကို Replit မှာ ထပ်မံ import လုပ်ပြီး environment setup + full code audit လုပ်ခဲ့တယ်

**How:**
1. `pnpm install` — 473 packages from lockfile (no changes needed)
2. Secrets set via Replit Secrets panel: `SUPABASE_DB_URL`, `AEGIS_INGEST_KEY`, `AEGIS_ADMIN_KEY` (SESSION_SECRET ရှိပြီး)
3. Full state audit — docs, journal, session log, all code files ဖတ်ပြီး verify

**Verified in-sync (all ✅):**
- TypeScript: 0 errors (api-server + aegis-dashboard)
- `signature_text` column — schema + ingest + UI display
- Breach/Authorized Login classification — events.tsx
- LDAP conn→IP tracking — `_watch_remote_slapd()`
- http_access sensor — company-web-server sensors list
- Cowrie removed — GLOBAL_OBSOLETE_COMPONENTS + forwarder + auto-defense rules ဖယ်ပြီး
- ModSecurity removed — forwarder http sensor မပါ
- OBSOLETE_HOST_IPS = [] — LDAP IP (10.20.20.20) bug fixed
- connectivity checker script — `scripts/src/check_connectivity.sh` ✅

**Workflows:**
- Start application → ✅ port 5000 (React/Vite)
- API Server → ✅ port 3000 (Express + Supabase connected)

**Result:** Code + GitHub (f7b4381) fully in-sync. No pending code changes.
**Next:**
1. Aegis VM မှာ forwarder update: `wget -O /opt/aegis/scripts/src/aegis_forwarder.py https://raw.githubusercontent.com/sohu2723-star/aegis-soc-dashboard/main/scripts/src/aegis_forwarder.py && sudo systemctl restart aegis-forwarder`
2. `aegis_forwarder.local.conf` မှာ `DNSSERVER_IP=10.10.10.20` + `LDAPSERVER_IP=10.20.20.20` ထည့် (မထည့်ရသေးဘဲဆိုရင်)
3. company-dns-server မှာ BIND9 logging config ထည့်
4. `./scripts/src/check_connectivity.sh` run ပြီး results စစ်

---

## [2026-07-21] — Replit Re-import + TypeScript Fix

**Status:** ✅ Done  
**What:** Replit မှာ project ပြန် import လုပ်ပြီး environment setup + TypeScript error fix လုပ်ခဲ့တယ်

**How:**
1. GitHub repo (sohu2723-star/aegis-soc-dashboard) ကို Replit မှာ fresh pull ဆင်းပြီး `pnpm install` run
2. Secrets set: `SUPABASE_DB_URL`, `AEGIS_INGEST_KEY`, `AEGIS_ADMIN_KEY` (SESSION_SECRET ရှိပြီး)
3. TypeScript error fix — `artifacts/api-server/src/routes/defense.ts` line 175-176:
   - Bug: `?.status === "online" ?? null` — `??` operand unreachable (TS2869) — because `undefined === "online"` returns `false`, not `null`
   - Fix: sensor row ကို variable မှာ ကြိုဆွဲပြီး `r != null ? r.status === "online" : null` ဖြင့် စစ်

**Result:**
- `pnpm run typecheck` → ✅ 0 errors (api-server + aegis-dashboard)
- API Server workflow → ✅ running (port 3000)
- Start application workflow → ✅ running (port 5000)
- Build warnings (esbuild `??` warning) → warnings only, not errors; safe to ignore

**Next:** Aegis VM မှာ `wget` forwarder update + `systemctl restart aegis-forwarder` → DNS/LDAP sensor threads confirm

---

## [2026-07-21] — LDAP src_ip Fix + Connectivity Checker Script

**Status:** ✅ Done
**What:** Previous agent session ကနေ ကျန်ခဲ့တဲ့ issues ၃ ခု fix + full connectivity checker script တည်ဆောက်

**Issues fixed:**

**1. LDAP src_ip "unknown" bug** (`scripts/src/aegis_forwarder.py` — `_watch_remote_slapd`)
- **Root cause:** slapd RESULT line (`err=49`) မှာ IP မပါဘူး — IP သည် ACCEPT line မှာသာ ပါတယ်
  ```
  ACCEPT: slapd[N]: conn=5 fd=15 ACCEPT from IP=192.168.10.99:54321 (IP=0.0.0.0:389)
  RESULT: slapd[N]: conn=5 op=0 RESULT tag=97 err=49 text=Invalid credentials  ← IP မပါ
  ```
- **Old regex:** `r"([\d.]+)(?::\d+)?"` → numbers ကို match ဖြစ်ပေမဲ့ IP မဟုတ်ဘဲ `128` (method), `97` (tag), `49` (err) တွေ match ဖြစ်ပြီး IP extract မရဘဲ `unknown` ဖြစ်တယ်
- **Fix:** `conn→IP` dictionary tracking — ACCEPT line မှ conn ID နဲ့ IP ကို မှတ်ထား၊ RESULT line မှာ conn ID နဲ့ look up လုပ်

**2. local.conf.example** — `DNSSERVER_IP=10.10.10.20` + `LDAPSERVER_IP=10.20.20.20` + `CUSTOMERDB_IP=10.20.20.10` (v4 IP fix) ထည့်

**3. Connectivity Checker** (`scripts/src/check_connectivity.sh`) — 10 section checker:
- Ping reachability (6 hosts + internet)
- SSH passwordless auth (5 hosts: 4 company VMs + pfSense)
- Port check (SSH/HTTP/DNS/MySQL/LDAP/HTTPS)
- systemctl service status per VM
- Log path existence check
- iptables INPUT rules + pfSense EasyRule table
- Fail2ban jail status
- DNS resolution test (bank.local zone)
- aegis-forwarder service + journal
- AEGIS API healthz

**BIND9 logging config** (company-dns-server မှာ run ရမည် — `/var/log/named/named.log` မတည်ဆောက်ရသေးဘဲ ဖြစ်ရင်):
```bash
sudo mkdir -p /var/log/named && sudo chown bind:bind /var/log/named
sudo tee -a /etc/bind/named.conf.local << 'EOF'
logging {
    channel query_log {
        file "/var/log/named/named.log" versions 3 size 5m;
        severity dynamic;
    };
    category queries  { query_log; };
    category default  { query_log; };
};
EOF
sudo systemctl restart named
```

**Result:** Python syntax ✅ clean. check_connectivity.sh ✅ created (chmod +x).
**Next:**
1. Aegis VM မှာ forwarder update: `wget -O /opt/aegis/scripts/src/aegis_forwarder.py https://raw.githubusercontent.com/sohu2723-star/aegis-soc-dashboard/main/scripts/src/aegis_forwarder.py && sudo systemctl restart aegis-forwarder`
2. local.conf မှာ `DNSSERVER_IP=10.10.10.20` နဲ့ `LDAPSERVER_IP=10.20.20.20` ထည့်
3. company-dns-server မှာ BIND9 logging config ထည့်
4. `./check_connectivity.sh` run ပြီး results စစ်

---

## [2026-07-20] — Attack → Rule → Command Chain: Full Transparency in Dashboard

**Status:** ✅ Done
**What:** Dashboard မှာ "VM ထဲမှာ actual လုပ်ဆောင်တဲ့ command/rule ကို exact mirror ပြ" feature — 3 layer:
1. **Event detail panel** → "Defense Actions Triggered" section — ဒီ attack ကြောင့် ဘာ command run သွားသလဲ ပြ
2. **Defense Rules History tab** → Attack → Rule → Command chain card view, expandable commandText
3. **API join** → `/ui/defense/commands/history` + `/ui/events/:id/commands` new endpoint

**Code changes:**
- `artifacts/api-server/src/routes/ui-rules.ts`
  - `/ui/defense/commands/history` — LEFT JOIN `defense_rules` (rule name) + `security_events` (attack info) ထည့်
  - `GET /ui/events/:id/commands` — new endpoint: event တစ်ခုကြောင့် trigger ဖြစ်တဲ့ commands လုံးဝ ပြ
- `artifacts/aegis-dashboard/src/pages/events.tsx`
  - `useEventCommands(eventId)` hook ထည့် (fetch `/ui/events/:id/commands`)
  - `DefenseActionsPanel` component — event detail sheet ထဲမှာ `Rule → commandType → commandText` chain + execution status ပြ (cyan border block)
- `artifacts/aegis-dashboard/src/pages/defense-rules.tsx`
  - `DefenseCommand` interface — `ruleName`, `eventSourceIp`, `eventSubtype`, `eventType`, `eventDescription` joined fields ထည့်
  - `HistoryTab` — table မှ card view သို့ ပြောင်း; orange Attack → cyan Rule → badge command chain header; commandText click-to-expand; timestamp + status display

**UI behavior:**
- Event detail sheet → scroll down → cyan "Defense Actions Triggered" block → rule name + actual `iptables -I INPUT...` / `easyrule block WAN ...` command ပေါ်မယ်
- Defense Rules → History tab → card တစ်ခုစီ → header = `[attack subtype] → [rule name] → [commandType]`; command text click → expand full

**Result:** API build ✅, TypeScript errors (pre-existing reports.tsx ဘဲ) — ours clean
**Next:** Aegis VM forwarder update + real attack test ပြုလုပ်ပြီး Events detail panel မှာ defense commands ပေါ်မပေါ် confirm ရမည်

---

## [2026-07-20] — Forwarder: company-web-server http_access Sensor + pfSense Suricata Dual-Interface

**Status:** ✅ Done
**What:** forwarder script ၂ ခု fix —
1. `company-web-server` sensors list မှာ `http_access` (Apache access.log login breach detection) ထည့်
2. `_watch_pfsense_suricata()` ကို dual-interface support (PUBLIC em1.10 + INTERNAL em2.20) ဖို့ update; hub mode မှာ ၂ thread spawn ဖြစ်အောင် ပြောင်း

**Code changes:**
- `scripts/src/aegis_forwarder.py`
  - `company-web-server` sensors: `["fail2ban", "ssh", "http"]` → `["fail2ban", "ssh", "http", "http_access"]`
  - `_watch_pfsense_suricata(log_path)` — path parameter accept ဖို့ refactor; default path ကို `suricata_em0` မှ lab v4 path `suricata_em110` (PUBLIC) သို့ ပြောင်း
  - Hub mode launcher — `PFSENSE_SURICATA_LOGS` (comma-separated) config check ထည့်; default = PUBLIC `em1.10` + INTERNAL `em2.20` ၂ thread
- `scripts/src/aegis_forwarder.local.conf.example` — `PFSENSE_SURICATA_LOGS` / `PFSENSE_SURICATA_LOG` documentation ထည့်

**How:**
```
# hub mode မှာ ခု ဒီ threads run မယ်:
►  pfSense Suricata IDS [PUBLIC(em1.10)]   → /var/db/suricata/suricata_em110/eve.json
►  pfSense Suricata IDS [INTERNAL(em2.20)] → /var/db/suricata/suricata_em220/eve.json
```
**Result:** Python syntax ✅, API server build ✅
**Next:** Aegis VM မှာ forwarder update (`wget` + `systemctl restart`) လုပ်ပြီး pfSense Suricata threads connect ဖြစ်မဖြစ် journalctl မှာ စစ်ရမည်

---

## [2026-07-21] — Behavioral Analysis: Breach vs Authorized Login Classification

**Status:** ✅ Done
**What:** SSH/Web login success event တွေကို context (prior failures) ဖြင့် classify လုပ်သည် — "ဝင်ခဲ့တယ်" ဆိုတာသာမကဘဲ "ဘယ်လိုဝင်ခဲ့တာလဲ" ကို dashboard မှာပြမည်

**Concept (Behavioral Analysis):**
- `prior_failures = 0` → **Authorized Login** (low severity — ပုံမှန် login)
- `prior_failures ≥ 3` → **Brute Force Success / Web Login Breach** (critical — attacker ဝင်သွားပြီ!)
- SSH နှင့် Web login endpoint ၂ ခုလုံးမှာ တူညီတဲ့ logic

**Layer 1 — Forwarder (`scripts/src/aegis_forwarder.py`):**
- `watch_ssh()` — success မတိုင်မီ `prior = fail_counts.pop(ip, 0)` ကြိုယူပြီး `prior_failures` field ထည့်ပို့
- `_watch_remote_ssh()` — same fix; `"failures": 0` → `"prior_failures": prior`
- `watch_http_access()` — Apache `access.log` ကြည့်သည် (ModSec မဟုတ်); login URL (401/403 → 200) pattern ဖမ်း
- `_watch_remote_http_access()` — hub mode version; SSH မှ remote access.log tail
- Sensor registration: `_SENSOR_FN["http_access"]` + `MODES["http_access"]`

**Layer 2 — API (`artifacts/api-server/src/routes/ingest.ts`):**
- `POST /ingest/ssh` — `prior_failures` field read; `≥3` → type=`network_attack`, subtype=`Brute Force Success`, severity=`critical`, status=`breach`; `0` → type=`auth_event`, subtype=`Authorized Login`, severity=`low`, status=`allowed`
- `POST /ingest/http_access` (NEW) — same logic for web login; `≥3` → `Web Login Breach` critical; success clean → `Web Authorized Login` low; failed attempts → `Web Login Brute Force` medium/high

**Layer 3 — Dashboard (`artifacts/aegis-dashboard/src/pages/events.tsx`):**
- Breach rows: red background `bg-red-950/40`, left red border, `Skull` icon, pulsing `BREACH` badge
- Authorized rows: green background `bg-green-950/20`, `CheckCircle2` icon, green `allowed` badge
- Detail sheet: Breach banner (red, "Breach Confirmed") or Authorized banner (green, "Authorized Access")

**Result:** Build ✅ clean. API server ✅ built. Events page ✅ no new type errors.
**Next:**
- VM မှာ forwarder update: `wget` + `systemctl restart aegis-forwarder`
- `http_access` sensor ကို company-web-server REMOTE_HOSTS sensors list မှာ ထည့်ချင်ရင်: `"sensors": ["fail2ban", "ssh", "http", "http_access"]`

---

## 2026-07-19 — OVS Switch VLAN Setup + pfSense VLAN Sub-Interface + Firewall Rules

**Status:** ✅ Done  
**What:** GNS3 topology မှာ OVS switch ၂ ခု (Public-Services, Internal-Services) ထည့်ပြီး VLAN 10/20 ခွဲ၊ pfSense VLAN sub-interface config လုပ်၊ firewall rules ထည့်ကာ attacker → internal network block လုပ်  
**Result:** Kali → company-web-server ✅ reach ရ၊ Kali → company-customer-db ❌ pfSense block ဖြစ် — VLAN separation အလုပ်လုပ်တယ်

---

### Topology ပြောင်းလဲချက် (v3 → v3.1)

| မူလ | ခု |
|---|---|
| pfSense e1 တိုက်ရိုက် company-web-server | pfSense e1 → Public-Services OVS → company-web-server |
| pfSense e2 တိုက်ရိုက် company-customer-db | pfSense e2 → Internal-Services OVS → company-customer-db |
| pfSense em1: plain interface | pfSense em1.10: VLAN 10 sub-interface |
| pfSense em2: plain interface | pfSense em2.20: VLAN 20 sub-interface |

**ရည်ရွယ်ချက်:** OVS switch က L2 VLAN ခွဲ၊ pfSense firewall rule က L3 access control လုပ် — attacker က Public zone (company-web-server) ကို attack လုပ်လို့ရ၊ Internal zone (company-customer-db) ကို access မရအောင် ကာကွယ်

---

### Step 1 — OVS-Public Switch Config (VLAN 10)

**GNS3 → Public-Services node → Console**

```bash
# br0 နဲ့ port တွေ auto-created ဖြစ်နေတယ် — add-br / add-port မလုပ်ရဘူး
# set သာ လုပ်ရမယ်

ovs-vsctl set port eth0 vlan-mode=trunk trunks=10   # pfSense ဘက် — trunk
ovs-vsctl set port eth1 vlan-mode=access tag=10      # company-web-server ဘက် — access VLAN 10
ovs-vsctl show
```

**Expected output:**
```
Bridge br0
    Port eth0
        trunks: [10]
    Port eth1
        tag: 10
```

---

### Step 2 — OVS-Internal Switch Config (VLAN 20)

**GNS3 → Internal-Services node → Console**

```bash
ovs-vsctl set port eth0 vlan-mode=trunk trunks=20   # pfSense ဘက် — trunk
ovs-vsctl set port eth1 vlan-mode=access tag=20      # company-customer-db ဘက် — access VLAN 20
ovs-vsctl show
```

**Expected output:**
```
Bridge br0
    Port eth0
        trunks: [20]
    Port eth1
        tag: 20
```

---

### ⚠️ OVS Gotcha — မှတ်သားရမည်

OVS GNS3 image မှာ `br0` နဲ့ `eth0`–`eth7` **auto-created** ဖြစ်နေတယ်:
- `ovs-vsctl add-br br0` → **error**: bridge named br0 already exists
- `ovs-vsctl add-port br0 eth0` → **error**: port named eth0 already exists

**Fix:** `add-br` / `add-port` မသုံးနဲ့ — `ovs-vsctl set port <name> ...` သာ သုံးရမယ်

---

### Step 3 — pfSense VLAN Sub-Interfaces Create

**pfSense Web UI:** `https://10.30.30.1` (aegis ကနေ browser ဖွင့်)

**Interfaces → Assignments → VLANs tab → + Add**

| | VLAN 10 | VLAN 20 |
|---|---|---|
| Parent interface | `em1` | `em2` |
| VLAN tag | `10` | `20` |
| Description | `PUBLIC` | `INTERNAL` |

Save

> ⚠️ pfSense 2.7.2 မှာ VLANs က **Interfaces → Assignments → VLANs tab** အောက်မှာရှိတယ် — Interfaces dropdown မှာ မပေါ်ဘူး

---

### Step 4 — Interface Assignments ပြောင်း

**Interfaces → Assignments (Interface Assignments tab)**

| Interface | Network Port (ပြောင်းမယ်) |
|---|---|
| LAN | `VLAN 10 on em1 - lan (PUBLIC)` |
| COMPANY_WEB | `VLAN 20 on em2 - opt1 (INTERNAL)` |
| COMPANY_DB | `em3` (မပြောင်းဘူး — aegis management) |

Save → Apply Changes

**Interface IPs (ကျန်တူတူပဲ):**
- LAN (em1.10): `10.10.10.1/24`
- COMPANY_WEB (em2.20): `10.20.20.1/24`
- COMPANY_DB (em3): `10.30.30.1/24`

---

### Step 5 — Firewall Rules

**Firewall → Rules → WAN → + Add**

| Rule | Action | Protocol | Source | Destination | Description |
|---|---|---|---|---|---|
| 1 | Block | **Any** | * | `10.20.20.0/24` | Block attacker from Internal |
| 2 | Pass | **Any** | * | `10.10.10.0/24` | Allow attacker to company-web-server |

Apply Changes

> ⚠️ **Protocol = Any** ဖြစ်ရမယ် — TCP သာ ထားရင် ICMP (ping) မဖြတ်ဘူး၊ ALLOW rule ကို bypass ဖြစ်မသွားဘူး

---

### Step 6 — VM Gateway Verify

**company-web-server:**
```bash
ip route show | grep default
# default via 10.10.10.1 dev ens3 ← ✅
```

**company-customer-db:**
```bash
ip route show | grep default
# default via 10.20.20.1 ← ✅
```

---

### Step 7 — Final Verification

**Kali ကနေ test:**
```bash
ping -c 3 10.10.10.10   # company-web-server   → ✅ reach ရ (ALLOW rule)
ping -c 3 10.20.20.20   # company-customer-db → ❌ blocked (BLOCK rule)
```

**Result:** ✅ VLAN separation + firewall rules အလုပ်လုပ်တယ်

---

### Architecture Summary (Post-Setup)

```
Kali (192.168.10.99)
    │
    ▼ Router → pfSense WAN (10.0.23.2)
    │
    ├─ ALLOW ──► pfSense em1.10 (VLAN 10)
    │               └─ OVS-Public (trunk eth0 / access eth1)
    │                   └─ company-web-server (10.10.10.10)    ← attack target ✅
    │
    └─ BLOCK ──► pfSense em2.20 (VLAN 20)
                    └─ OVS-Internal (trunk eth0 / access eth1)
                        └─ company-customer-db (10.20.20.20)  ← protected ❌
```

**Next:** Dashboard Defense Center ကနေ block/unblock rule control လုပ်ခြင်း + Attack demo ဆင်းခြင်း

---

## 2026-07-19 — Render + Vercel Deployment Guide စစ်ဆေး

**Status:** ✅ Done  
**What:** Production deployment config (render.yaml + vercel.json) မှန်ကန်ကြောင်း verify လုပ်ပြီး deployment steps ရေး  
**How:** `pnpm --filter @workspace/api-server run build` run ကြည့်၊ render.yaml + vercel.json စစ်ဆေး  
**Result:** API build clean (warnings only, no errors). Config files ၂ ခုလုံး ready ဖြစ်တယ်။ Render မှာ env vars ၃ ခု (`SUPABASE_DB_URL`, `AEGIS_INGEST_KEY`, `AEGIS_ADMIN_KEY`) ထည့်ပေးဖို့ ကျန်တယ်  
**Next:** Render → Blueprint (render.yaml) သုံးပြီး deploy၊ Vercel → GitHub repo connect ပြီး deploy

---

## 2026-07-19 — Network Switch Types ရှင်းလင်းချက်

### L2 Managed Switch vs L3 Multi-layer Switch

| | L2 Managed Switch | L3 Multi-layer Switch |
|---|---|---|
| **VLAN** | ✅ ရတယ် | ✅ ရတယ် |
| **Inter-VLAN Routing** | ❌ မရဘူး (router လိုတယ်) | ✅ switch ထဲမှာပဲ ရတယ် |
| **ACL** | Limited | ✅ Full ACL |
| **Config ရေးတဲ့နေရာ** | port/VLAN setting သာ | routing + ACL ထဲမှာပါ ရေးနိုင် |
| **GNS3 example** | OVS | Cisco IOSvL2 / c3725 |

### ခု Lab မှာ သုံးနေတာ

```
OVS-Public / OVS-Internal  = L2 Managed Switch (VLAN tagging သာ)
pfSense                    = Router + Firewall (inter-VLAN routing + ACL)
```

**OVS သည် L2 switch** ဖြစ်တဲ့အတွက် routing မလုပ်နိုင်ဘူး — pfSense က VLAN sub-interface (em1.10, em2.20) ဖြင့် inter-VLAN routing လုပ်ပေးတယ်။

### L3 Switch သုံးလို့ ရတဲ့အခြေအနေ

GNS3 မှာ Cisco IOSvL2 (`.qcow2`) image ရှိရင် L3 switch ထည့်ပြီး switch ထဲမှာပဲ config ရေးနိုင်:

```cisco
! VLAN ဖန်တီး
vlan 10
vlan 20

! SVI — inter-VLAN routing
interface vlan 10
  ip address 10.10.10.1 255.255.255.0
interface vlan 20
  ip address 10.20.20.1 255.255.255.0

! ACL — Internal ကို block
ip access-list extended BLOCK-INTERNAL
  deny ip 192.168.10.0 0.0.0.255 10.20.20.0 0.0.0.255
  permit ip any any

interface vlan 10
  ip access-group BLOCK-INTERNAL in
```

pfSense မပါဘဲ switch တစ်ခုတည်းနဲ့ VLAN + routing + firewall ACL အကုန် ဖြေရှင်းနိုင်တယ်။

---

## 2026-07-19 — pfSense Control Method: SSH Remote (API မဟုတ်)

### စစ်ဆေးချက်

AEGIS dashboard ကနေ pfSense ကို control တဲ့နည်းလမ်းကို codebase စစ်ဆေးခဲ့တယ်။

**ရလဒ် — SSH Remote သုံးနေတယ် (pfSense REST API package မဟုတ်)**

### အလုပ်လုပ်ပုံ

```
Dashboard → API Server → defense_commands table
                              ↓
                    aegis_forwarder.py (Aegis VM မှာ run)
                              ↓
                    SSH → pfSense → easyrule command
```

### Code Evidence (`auto-defense.ts`, `defense.ts`)

```typescript
// pfSense block
commandType: "ssh_pfsense",
commandText: `easyrule block WAN ${ip}`

// pfSense unblock
commandType: "ssh_pfsense",
commandText: `easyrule pass WAN ${ip}`
```

### ကုဒ် comment (auto-defense.ts)
```
// SSH into pfSense via forwarder and run easyrule (no REST API package needed)
```

### ဘာကြောင့် SSH သုံးတာလဲ

| | pfSense REST API | SSH + easyrule |
|---|---|---|
| Extra package | pfSense-pkg-API install လိုတယ် | မလိုဘူး |
| Setup | Token generate, HTTPS config | SSH key/password သာ |
| Reliability | Package version ပေါ် မူတည် | pfSense built-in command |
| ခု Lab မှာ | ❌ မသုံးဘူး | ✅ သုံးနေတယ် |

**`aegis_forwarder.py`** က `defense_commands` table ကို poll လုပ်ပြီး `ssh_pfsense` commandType တွေ့ရင် pfSense ထဲ SSH ဝင်ကာ `easyrule` run တယ်။

---

## 2026-07-19 — pfSense WAN Firewall Rule Fix (BLOCK INTERNAL မအလုပ်လုပ်တဲ့ ပြဿနာ)

**Status:** ✅ Fixed  

### ပြဿနာ
- pfSense WAN tab မှာ BLOCK INTERNAL rule ထည့်ထားသော်လည်း Kali ကနေ `ping 10.20.20.20` (company-customer-db) ကို ဖြတ်သန်းနေတယ်

### Root Cause (၂ ခု)

**1. Protocol = TCP သာ ဖြစ်နေတယ်**
- ping သည် ICMP ဆိုတော့ TCP rule မှာ match မဖြစ်ဘူး → skip ဖြစ်သွားတယ်

**2. "Allow any" rule ရှိနေတယ်**
- Source: `192.168.10.0/24` (Kali subnet) ကနေ ဘယ် destination မဆို allow လုပ်တဲ့ rule
- pfSense က top-down first-match ဆိုတော့ BLOCK rule skip ပြီး "Allow any" rule မှာ match ဖြစ်ကာ ping ဖြတ်သွားတယ်

### Fix

**WAN Rules ကို အောက်ပါအတိုင်း ပြင်:**

| # | Action | Protocol | Destination | Description |
|---|---|---|---|---|
| 1 | Block | **Any** | 10.20.20.0/24 | BLOCK INTERNAL |
| 2 | Pass | **Any** | 10.10.10.0/24 | ALLOW PUBLIC |

- "Allow any" rule (source 192.168.10.0/24) → **Delete**
- BLOCK INTERNAL + ALLOW PUBLIC Protocol → **Any** (TCP မဟုတ်ဘဲ)
- pfSense default policy က implicit deny ဆိုတော့ rule ၂ ကြောင်းသာ ထားရမယ်

### ရလဒ်
- `ping 10.10.10.10` → ✅ Reply (company-web-server reach ရတယ်)
- `ping 10.20.20.20` → ❌ Blocked (company-customer-db ကာကွယ်ပြီး)

---

## 2026-07-19 — GNS3 Docker 409 Conflict Error Fix + Permanent Solution

**Status:** ✅ Fixed  

### ပြဿနာ
GNS3 ပြန်ဖွင့်တိုင်း CRITICAL error ထွက်:
```
Docker has returned an error: 409 Conflict.
The container name "/GNS3.Public-Services.xxxx" is already in use by container "c001ba20cb77..."
You have to remove (or rename) that container to be able to reuse that name.
```

### Root Cause
GNS3 ကို properly stop မလုပ်ဘဲ ပိတ်လိုက်ရင် Docker container တွေ background မှာ `Exited` state နဲ့ ကျန်ရစ်တယ်။ နောက်ကြိမ် GNS3 ဖွင့်ရင် same name ဖြင့် container အသစ် create လုပ်ဖို့ ကြိုးစားတဲ့အခါ conflict ဖြစ်တယ်။

### One-time Fix (ဖြစ်ပြီးသားအခြေအနေမှာ)
```bash
# Public-Services container ရှာပြီး ဖျက်
docker ps -a | grep "Public-Services"
docker rm -f <container_id>

# သို့မဟုတ် GNS3 container အကုန်တစ်ကြိမ်တည်း ဖျက်
docker ps -a | grep GNS3 | awk '{print $1}' | xargs -r docker rm -f
```

### Permanent Fix — Bash Alias
`~/.bashrc` မှာ alias ထည့်ထားတာဆိုတော့ GNS3 ဖွင့်တိုင်း auto-clean ဖြစ်တယ်:

```bash
echo "alias gns3='docker ps -a | grep GNS3 | awk \"{print \$1}\" | xargs -r docker rm -f; /usr/bin/gns3'" >> ~/.bashrc && source ~/.bashrc
```

**နောက်ကြိမ်ကစပြီး GNS3 ဖွင့်ချင်ရင်:**
```bash
gns3
```
→ GNS3 container တွေ အကုန် auto-remove + GNS3 launch တစ်ပြိုင်တည်း ဖြစ်သွားတယ်

### မှတ်ချက်
- Docker container ဖျက်တာသည် GNS3 project file (`.gns3`) ကို မထိဘူး
- Topology, node config, IP settings အားလုံး disk မှာ ကျန်တယ်
- GNS3 ပြန်ဖွင့်ရင် project အတိုင်း ပြန် load ဖြစ်ပြီး nodes start ပြန်လုပ်လို့ ရတယ်

---

## 2026-07-19 — Future Bank Services Plan (Final Internship Project)

**Status:** 📋 Planned (not yet implemented)
**Context:** Final internship project — 2 person team. ခု ရှိပြီးသား system ကို base အဖြစ်ထား၍ realistic bank SOC topology ဖြစ်အောင် ဆက်တိုက် ထည့်မည်။

---

### Real Bank Network Segmentation (Target Architecture)

Real bank မှာ services တွေကို security level အရ VLAN ခွဲထားတယ်:

```
pfSense
├── VLAN 10 — DMZ/Public (10.10.10.0/24)     ← Internet ကနေ reach နိုင်
│   ├── company-web-server      10.10.10.10  ✅ Done
│   ├── company-dns-server    10.10.10.20  📋 Planned
│   └── mail-mx       10.10.10.30  📋 Planned
│
├── VLAN 20 — Internal (10.20.20.0/24)        ← Staff only, internet block
│   ├── company-customer-db   10.20.20.10  ✅ Done
│   ├── cctv-nvr      10.20.20.20  📋 Planned
│   ├── voip-pbx      10.20.20.30  📋 Planned
│   └── ad-server     10.20.20.40  📋 Planned
│
└── MGMT — Management (10.30.30.0/24)         ← Admin/SOC only
    └── aegis-forwarder 10.30.30.10  ✅ Done
```

**Firewall logic (Real-world aligned):**
- Kali → VLAN 10 ✅ (DMZ — attacker can try)
- Kali → VLAN 20 ❌ (Internal — blocked by pfSense)
- VLAN 10 → VLAN 20 ❌ (DMZ cannot reach internal DB)

---

### Future Services — Priority Order

#### 🔴 Priority 1 — ထည့်ရလွယ်၊ demo impact ကြီး

**DNS Server (BIND9)** — VLAN 10, IP: 10.10.10.20
- Ubuntu VM + BIND9
- Attack: DNS amplification, zone transfer, tunneling
- Log: `/var/log/named/queries.log`
- Dashboard: DNS flood alert, suspicious query alert

**Email MX (Postfix)** — VLAN 10, IP: 10.10.10.30
- Ubuntu VM + Postfix
- Attack: SMTP relay abuse, phishing flood, spam
- Log: `/var/log/mail.log`
- Dashboard: Mail anomaly, relay abuse alert

#### 🟡 Priority 2 — Visual impact ကြီး (Demo impressive)

**CCTV/NVR Server** — VLAN 20, IP: 10.20.20.20
- Ubuntu VM + ffmpeg RTSP stream
- Real/fake video stream (vlc နဲ့ ကြည့်လို့ ရ)
- Attack: RTSP brute force, unauthorized access, DoS
- Dashboard: Camera offline alert, unauthorized stream access
- Demo: Kali မြင်လို့ ရတဲ့ stream → block → stream ပြတ်

**VoIP PBX (Asterisk)** — VLAN 20, IP: 10.20.20.30
- Ubuntu VM + Asterisk SIP server
- Attack: SIP flood, registration hijack, toll fraud
- Log: `/var/log/asterisk/messages`
- Dashboard: SIP anomaly, call volume spike alert

#### 🟠 Priority 3 — Advanced (Extension)

**Active Directory (Samba4)** — VLAN 20, IP: 10.20.20.40
- Ubuntu VM + Samba4
- Attack: Pass-the-hash, Kerberos brute force, LDAP enum
- Dashboard: Auth failure flood, privilege escalation

---

### Dashboard Control — ဘယ်ဟာအားလုံး Control ရတယ်

Service အားလုံးကို dashboard ကနေ **security level** မှာ control ရတယ်:

```
Service မှာ Attack ဖြစ်
        ↓
Dashboard Alert ထွက်
        ↓
Auto-defense / Manual Block
        ↓
pfSense → easyrule block WAN <attacker_ip>
VM      → iptables DROP <attacker_ip>
```

| Service | Monitor | Block Attacker | Auto-defense |
|---|---|---|---|
| company-web-server | ✅ | ✅ | ✅ (ရှိပြီး) |
| company-customer-db | ✅ | ✅ | ✅ (ရှိပြီး) |
| CCTV | ✅ | ✅ | 📋 rule ထည့်ရမည် |
| VoIP | ✅ | ✅ | 📋 rule ထည့်ရမည် |
| DNS | ✅ | ✅ | 📋 rule ထည့်ရမည် |
| Mail | ✅ | ✅ | 📋 rule ထည့်ရမည် |

---

### [2026-07-20] — Topology Simplification: Mail/AD/CCTV ဖြုတ်, DNS/ATM ထည့်

**Status:** ✅ Done  
**What:** v4 topology ကို simplify လုပ်ခဲ့တယ်။ Mail-Server, AD-Server, CCTV-Server ဖြုတ်၊ DNS-Server + ATM-Server သာ ထည့်မယ်ဟု ဆုံးဖြတ်ခဲ့တယ်။ Customer-db IP ကိုလည်း `10.20.20.20` မှ `10.20.20.10` ပြောင်းခဲ့တယ် (ATM-Server က `.20` ကိုသုံးမည်)

**Final Topology (v4 Simplified):**
```
Public-Switch  → company-web-server (10.10.10.10) + company-dns-server (10.10.10.20)
Internal-Switch → company-customer-db (10.20.20.10) + atm-server (10.20.20.20)
MGMT (direct)  → aegis-forwarder (10.30.30.10)
```

**Code changes:**
- `system.ts` — company-customer-db IP `.20`→`.10`, DNS/ATM sensor rows ထည့်, obsolete hostIP purge
- `auto-defense.ts` — DNS/ATM SSH brute force rules ထည့်, DNS attack rule ထည့်
- `host-utils.tsx` — atm-server/company-dns-server generic labels ထည့်
- `attack-flow.tsx` — company-dns-server/atm-server nodes + edges ထည့်, company-customer-db IP fix
- `setup.tsx` — topology diagram, IP assignments, pfSense interfaces, VM table update

**Next (GNS3 side):**
- DNS-Server: OVS port `tag=10` → netplan `10.10.10.20/24` → BIND9 install
- company-customer-db: netplan IP `10.20.20.20`→`10.20.20.10` → netplan apply
- ATM-Server: OVS port `tag=20` → netplan `10.20.20.20/24` → Flask ATM install
- aegis_forwarder.py: `DNS_SERVER_IP`, `ATM_SERVER_IP` config ထည့်

---

### New Service ထည့်တိုင်း Checklist

```
□ GNS3: Ubuntu VM node ထည့်
□ GNS3: OVS switch မှာ port ချိတ် (VLAN tag assign)
□ VM: service install + config
□ VM: log path မှတ်
□ aegis_forwarder.py: watch_<service>() function ထည့်
□ aegis_forwarder.py: REMOTE_HOSTS မှာ new VM + sensors ထည့်
□ auto-defense.ts: new attack type rule seed ထည့် (မလိုရင် existing သုံး)
□ Dashboard: service status card ထည့်
□ Dashboard: alert display ထည့်
```

---

### Team Split (2 Person)

| Person 1 — Network/Infrastructure | Person 2 — SOC Dashboard/App |
|---|---|
| GNS3 topology + VLAN config | React UI + components |
| pfSense firewall rules | API Server routes |
| VM setup (all services) | Supabase DB schema |
| aegis_forwarder.py hub mode | Auto-defense rules |
| Kali attack execution | Dashboard alert display |
| New VMs: DNS, Mail, CCTV, VoIP | New cards for each service |

---

---

## 2026-07-20 — Topology v4 Final — OVS Switches + DNS + LDAP + company-customer-db IP Change

**Status:** ✅ Done  
**What:** GNS3 lab topology ကို v3 မှ v4 (Final) သို့ upgrade လုပ်ခဲ့သည်။ OVS switch ၂ ခု ထည့်ပြီး DNS-Server (10.10.10.20) + LDAP-Server (10.20.20.20) VM အသစ် ၂ ခု ထည့်သည်။ company-customer-db IP ကို 10.20.20.20 မှ 10.20.20.10 သို့ ပြောင်းသည်။  
**How:** GNS3 GUI မှ node ထည့်၊ OVS console မှ VLAN tag configure၊ docs အားလုံး v4 update  
**Result:** v4 topology active ဖြစ်ပြီ — GNS3 lab ဓာတ်ပုံ confirm ဖြစ်တယ်  
**Next:** DNS-Server (BIND9) + LDAP-Server (OpenLDAP) services install + aegis_forwarder.py hub mode မှာ new VMs ထည့် configure

---

### v4 Topology Changes Summary

| Change | v3 | v4 |
|---|---|---|
| company-customer-db IP | 10.20.20.20 | **10.20.20.10** |
| DNS-Server | မရှိ | **10.10.10.20** (DMZ) |
| LDAP-Server | မရှိ | **10.20.20.20** (Internal) |
| DMZ switch | မရှိ | **Public-Services OVS Switch** |
| Internal switch | မရှိ | **Internal-Services OVS Switch** |
| aegis VM name | aegis-forwarder | **aegis-company-admin** |
| Forwarder targets | company-web-server + company-customer-db | company-web-server + DNS + company-customer-db + LDAP |

### v4 Full IP Plan

| Node | IP | Zone |
|---|---|---|
| Router (ether1) | 192.168.122.2 | Internet |
| Router (ether2) | 192.168.10.1 | Attacker GW |
| Router (ether3) | 10.0.23.1 | pfSense WAN link |
| pfSense WAN | 10.0.23.2 | — |
| pfSense DMZ GW | 10.10.10.1 | DMZ |
| pfSense INT GW | 10.20.20.1 | Internal |
| pfSense MGMT GW | 10.30.30.1 | MGMT |
| Attacker (Kali) | DHCP 192.168.10.x | Attacker |
| company-web-server | **10.10.10.10** | DMZ |
| DNS-Server | **10.10.10.20** | DMZ (NEW) |
| company-customer-db | **10.20.20.10** | Internal (IP ပြောင်း) |
| LDAP-Server | **10.20.20.20** | Internal (NEW) |
| aegis-company-admin | **10.30.30.10** | MGMT |

### OVS Switch VLAN Config

```bash
# Public-Services Switch
ovs-vsctl set port eth1 tag=10   # company-web-server
ovs-vsctl set port eth2 tag=10   # DNS-Server

# Internal-Services Switch
ovs-vsctl set port eth1 tag=20   # company-customer-db
ovs-vsctl set port eth2 tag=20   # LDAP-Server
```

### Docs Updated

| File | Changes |
|---|---|
| `docs/GNS3_SETUP.md` | Full v4 rewrite — v3 content အကုန် ဖျက်၊ OVS/DNS/LDAP sections ထည့်၊ Router-2 section ဖျက် |
| `docs/PROJECT_LOG.md` | v4 topology diagram + platform table + Phase 4 update |
| `docs/PROJECT_BOOK.md` | v4 topology (ခုနကအဆက်ကတည်းကပြီး) |

---

### [2026-07-20] — v4 Topology Code Sync + DB Health Endpoint

**Status:** ✅ Done
**What:** atm-server → company-ldap-server ပြောင်းထားတဲ့ v4 topology ကို code တွေမှာ sync လုပ်ပြီး DB health check ထည့်
**How:**
- `attack-flow.tsx` — `atmserver` node → `ldapserver` (OpenLDAP · slapd, 10.20.20.20); EDGES + getAttackPath routing update
- `setup.tsx` — atm-server ရှိသမျှ → company-ldap-server; slapd install commands ထည့်
- `host-utils.tsx` — GENERIC_LABELS မှာ `company-ldap-server` ထည့်
- `auto-defense.ts` — SSH brute force rule `atm-server` → `company-ldap-server` (targetVm ပါ)
- `routes/health.ts` — `/api/healthz` မှာ real DB ping (`SELECT 1`) ထည့်; DB down ဆိုရင် 503 + `{ status: "degraded", db: "error" }` return
**Result:** API server build ✅, both workflows running; health endpoint DB-aware ဖြစ်သွား
**Next:** aegis_forwarder.py မှာ company-ldap-server (slapd) log watcher ထည့်ရမယ်

---

### [2026-07-20] — pfSense Suricata Custom Rules + Rules Tab Guide

**Status:** ✅ Done
**What:** pfSense Suricata "Rules tab မတွေ့" ပြဿနာ ဖြေရှင်း; complete custom rules ထည့်
**How:** `docs/commands/pfsense-suricata.md` Step 5b အသစ် ထည့် —
- Rules tab navigation: Interfaces → em1 row → ✏️ Edit icon → Rules tab → Custom Rules textarea
- AEGIS lab custom rules ၈ ခု (sid:9000001–9000008): Nmap scan, SSH brute, SQLi, XSS, SYN flood, DNS amp, LDAP brute, FTP brute
**Result:** docs push ✅ to GitHub main
**Next:** em1 + em2 interfaces ၂ ခုလုံးမှာ custom rules paste ပြီး restart လုပ်ပြီး eve.json ထဲ AEGIS signatures ပေါ်လာတာ စစ်ရမယ်

---

### [2026-07-20] — pfSense Suricata Interface Setup + Custom Rules (လက်တွေ့ Lab)

**Status:** ✅ Done — PUBLIC + INTERNAL Suricata run နေပြီ
**Duration:** ~2hr troubleshooting session

**ပြဿနာတွေနဲ့ ဖြေရှင်းချက်:**

| ပြဿနာ | အကြောင်းရင်း | ဖြေရှင်းချက် |
|---|---|---|
| Rules tab မတွေ့ဘူး | Interface list row ကနေ မတွေ့ဘူး | Interface row → ✏️ edit icon ဝင်မှ tabs ပေါ်မည် |
| Custom Rules textarea မပါဘူး | pfSense Suricata version ကွာတယ် | Diagnostics → Edit File နည်း သုံး |
| `/var/db/suricata/suricata_em110/` မရှိဘူး | Suricata မ start ရသေးလို့ folder မတည်ဆောက်ရသေးဘူး | `mkdir -p` + `touch` command နဲ့ folder/file ကိုယ်တိုင် တည်ဆောက် |
| Suricata Start မဖြစ်ဘူး | Categories မ enable ရသေးဘူး + Hardware Offloading | System → Advanced → Networking မှာ offloading disable; Categories tick လုပ် |
| Alert မပေါ်ဘူး | PUBLIC/INTERNAL Suricata မ run ဘူး (WAN ပဲ run တယ်) | WAN ဖျက်၊ PUBLIC + INTERNAL အသစ် ထည့်ပြီး Start |

**Final Interface Setup:**
- WAN (em0) — ဖျက်လိုက် (optional ပဲ)
- **PUBLIC (em1.10)** — ✅ Running; company-web-server + company-dns-server traffic monitor
- **INTERNAL (em2.20)** — ✅ Running; company-customer-db + company-ldap-server traffic monitor
- Blocking Mode: **DISABLED** (lab testing အတွက် — attack ဆက်လုပ်နိုင်ဖို့)

**Custom Rules (confirmed):**

PUBLIC `/var/db/suricata/suricata_em110/rules/custom.rules`:
- SSH Brute company-web-server (10.10.10.10:22) sid:9000001
- HTTP Attack company-web-server (10.10.10.10:80) sid:9000002
- DNS Attack company-dns-server (10.10.10.20:53) sid:9000004
- SSH Brute company-dns-server (10.10.10.20:22) sid:9000005

INTERNAL `/var/db/suricata/suricata_em220/rules/custom.rules`:
- SSH Brute company-customer-db (10.20.20.10:22) sid:9000006
- MySQL Brute company-customer-db (10.20.20.10:3306) sid:9000007
- SSH Brute company-ldap-server (10.20.20.20:22) sid:9000008
- LDAP Brute company-ldap-server (10.20.20.20:389) sid:9000009

**Categories enabled:** emerging-scan.rules, emerging-bruteforce.rules

**Test:** `nmap -sS 10.10.10.10` Kali မှာ run → Services → Suricata → Alerts tab → PUBLIC instance ရွေး → alert ပေါ်လာရမည်

**Next:** ~~Eve.json AEGIS signatures confirm + aegis_forwarder.py မှာ pfSense Suricata log path connect လုပ်ရမည်~~ ✅ Done (see entry below)

---

## [2026-07-21] — ModSecurity ဖြုတ်ခြင်း (HTTP plaintext → Suricata လုံလောက်)

**Status:** ✅ Done
**What:** HTTP traffic ဖြစ်တဲ့အတွက် pfSense Suricata က payload အပြည့် မြင်တယ် — ModSecurity ထပ်ထည့်မလိုဘူး
**How:**
- `aegis_forwarder.py` — company-web-server sensors မှာ `"http"` (modsec) ဖယ်၊ `"http_access"` ပဲ ထား; `_SENSOR_FN` မှာလည်း ဖယ်
- `system.ts` — Apache Monitor description update (access.log only)
**Result:** Build ✅ clean. Final sensor stack: **Suricata (pfSense) + Fail2ban + SSH/HTTP_access/MySQL/DNS/LDAP monitors**

---

## [2026-07-21] — Cowrie Honeypot ဖယ်ရှားခြင်း (Topology Decision)

**Status:** ✅ Done
**What:** Cowrie honeypot ကို topology မှ ဖယ်ထုတ်ခဲ့တယ်။ Sensor stack = **Suricata (pfSense) + Fail2ban** သာ ကျန်မည်။
**How:**
- `system.ts` — "Cowrie Honeypot" ကို GLOBAL_OBSOLETE_COMPONENTS ပြန်ထည့် (DB ထဲ ကျန်ရှိနေသော stale rows clean ဖို့)
- `auto-defense.ts` — honeypot auto-block rules ၂ ခု ဖယ်
- `aegis_forwarder.py` — cowrie sensor entry + `_watch_remote_cowrie()` function ဖယ်
**Result:** Build ✅ clean. API server ✅ running.
**Next:** Suricata (pfSense) + Fail2ban sensors သာ active ဖြစ်နေမည်

---

## [2026-07-21] — Signature Text (Full Rule) Display in Security Events

**Status:** ✅ Done
**What:** Security event တစ်ခု click ဖြင့် ကြည့်ရင် ဘယ် rule နဲ့ match ဖြစ်တာလဲ ဆိုတဲ့ rule text အပြည့်အစုံ dashboard မှာ ပေါ်လာအောင် implement လုပ်ခဲ့တယ်
**How:**
- `lib/db/src/schema/security_events.ts` — `signature_text text` column ထည့်
- `artifacts/api-server/src/routes/ingest.ts`:
  - Suricata: `alert.rule` (EVE JSON) or `signature_text` top-level field accept + store
  - Fail2ban: `filter_regex` field accept; fallback = jail config string (`jail=sshd | maxretry=5 | ...`)
  - Generic `/ingest/event`: optional `signature_text` field accept + store
- `artifacts/aegis-dashboard/src/pages/events.tsx` — "Matched Detection Rule" block ထဲ "Full Rule Text" pre block ထည့် (font-mono, dark bg, yellow text)
**Result:** Build clean ✅. API server restart ✅. Supabase column migration ကျန်တယ် (user run ရမည်).
**Next:** ~~Supabase SQL editor မှာ `ALTER TABLE security_events ADD COLUMN IF NOT EXISTS signature_text text;` run ပြီး forwarder က `signature_text` field ထည့်ပို့ရမည်~~ ✅ Migration already run (confirmed in memory).

---

## [2026-07-22] — Repo Cleanup (836MB → 2.4MB)

**Status:** ✅ Done
**What:** GitHub repo size ကြီးနေတာကြောင့် Replit import fail/နှေးဖြစ်ခဲ့တယ်။ မလိုအပ်တဲ့ files တွေ ဖယ်ရှားပြီး repo size ကို 836MB → 2.4MB ဖြစ်အောင် လုပ်ခဲ့တယ်

**ဖျက်ခဲ့တာ:**
| Category | Path | Size |
|---|---|---|
| Chat screenshots | `attached_assets/` (275 × .jpg) | 834MB |
| Dead UI component | `artifacts/aegis-dashboard/src/components/ui/drawer.tsx` | 5KB |
| Empty placeholders | `artifacts/api-server/src/lib/.gitkeep` | — |
| Empty placeholders | `artifacts/api-server/src/middlewares/.gitkeep` | — |

**`.gitignore` ထည့်:**
```
attached_assets/    # chat screenshots — never commit
```

**Duplicate code analysis:**
- `requireAuth` (jwt-auth.ts) = JWT Bearer only → dashboard session middleware
- `maybeAdmin` (ui-rules.ts) = X-AEGIS-Admin-Key **or** JWT → write API — purpose ကွဲတာမို့ duplicate မဟုတ်ဘူး၊ ထိုင်ထားတာ မှန်တယ်

**Result:** 836MB → **2.4MB** ✅, TypeScript 0 errors ✅, workflows running ✅

---

## [2026-07-22] — Lab Connectivity Check (`check_connectivity.sh`)

**Status:** ✅ Script created + run ပြီး
**What:** Aegis VM မှ lab hosts အားလုံးကို automated connectivity, service, log, DNS, iptables, fail2ban စစ်ဆေးနိုင်ဖို့ script တစ်ခု ရေးခဲ့တယ်

**Script location:** `scripts/src/check_connectivity.sh`

**VM မှာ run နည်း:**
```bash
wget -O ~/check_connectivity.sh \
  https://raw.githubusercontent.com/sohu2723-star/aegis-soc-dashboard/main/scripts/src/check_connectivity.sh
chmod +x ~/check_connectivity.sh
~/check_connectivity.sh
```

**Script စစ်တာ (10 sections):**
| Section | ဘာစစ်လဲ |
|---|---|
| 1. Ping | VM 5 ခု + internet reachability |
| 2. SSH | Passwordless key auth (aegis_id_rsa) |
| 3. Port | HTTP/DNS/MySQL/LDAP/pfSense ports |
| 4. Service | apache2, named, mysql, slapd, fail2ban (systemctl) |
| 5. Log paths | auth.log, fail2ban.log, named.log, access.log, mysql/error.log, syslog |
| 6. iptables | Block rules per VM |
| 7. fail2ban | Banned IPs per VM |
| 8. DNS | BIND9 zone resolution (bank.local) |
| 9. Forwarder | aegis-forwarder service status + last 10 journal lines |
| 10. API | Render healthz HTTP 200 check |

**pfSense SSH fix (script မှာ):**
pfSense SSH က interactive menu ထဲ force ဝင်တာကြောင့် `BatchMode=yes` + `echo "ok"` method fail ဖြစ်တယ်
Fix: pfSense section ကို `nc -zw 3 10.30.30.1 22` port check သာ သုံးပြင်ခဲ့တယ်

**pfSense passwordless key setup:**
Script က `~/.ssh/pfsense_key` သုံးတယ် — `aegis_id_rsa` ကို copy လုပ်ရမည်
```bash
cp ~/.ssh/aegis_id_rsa ~/.ssh/pfsense_key
chmod 600 ~/.ssh/pfsense_key
```

**Connectivity test ရလဒ် (2026-07-22):**
| Check | Status | မှတ်ချက် |
|---|---|---|
| Ping all VMs | ✅ | အားလုံး reachable |
| SSH all 4 VMs | ✅ | Passwordless OK |
| SSH pfSense port 22 | ✅ | Port open, key installed |
| Port 80 company-web-server | ❌ | UFW blocking |
| Port 53 company-dns-server | ❌ | named not installed |
| Port 3306 company-customer-db | ✅ | MySQL running |
| Port 389 company-ldap-server | ❌ | slapd inactive |
| Port 443 pfSense WebGUI | ⚠️ | Interface ကွဲနေနိုင် |
| apache2, mysql, fail2ban | ✅ | |
| named (BIND9) | ❌ | Not installed → fix below |
| slapd | ❌ | Inactive → fix below |
| named.log | ⚠️ | BIND9 logging config မလုပ်ရသေးဘူး |
| aegis-forwarder | ❌ | Not started (intentional) |
| AEGIS API healthz | ✅ | HTTP 200 |

---

## [2026-07-22] — BIND9 Install + Logging Setup (company-dns-server)

**Status:** ✅ Done
**VM:** `company-dns-server` (10.10.10.20)
**ဘာကြောင့်:** `named.service not found` = BIND9 install မရသေးဘူး

**Install:**
```bash
ssh sithu@10.10.10.20
sudo apt update
sudo apt install -y bind9 bind9utils bind9-doc
sudo systemctl start named
sudo systemctl enable named
sudo systemctl status named
```

**Query Logging Setup:**
```bash
sudo mkdir -p /var/log/named
sudo chown bind:bind /var/log/named

sudo tee -a /etc/bind/named.conf.local << 'EOF'
logging {
    channel query_log {
        file "/var/log/named/named.log" versions 3 size 5m;
        severity dynamic;
    };
    category queries  { query_log; };
    category default  { query_log; };
};
EOF

sudo systemctl restart named
ls -lh /var/log/named/named.log
```

**Result:** named.log ✅ ပေါ်လာမည်၊ forwarder `_watch_remote_bind9()` မှ SSH ဝင်ပြီး read နိုင်မည်
**မှတ်ချက်:** `ls lh` (dash မပါ) = syntax error → `ls -lh` လုပ်ရမည်

---

## [2026-07-22] — slapd Install (company-ldap-server)

**Status:** 🔄 In progress
**VM:** `company-ldap-server` (10.20.20.20)
**ဘာကြောင့်:** `slapd — inactive` + port 389 CLOSED

**Install + Start:**
```bash
ssh sithu@10.20.20.20
sudo apt update
sudo apt install -y slapd ldap-utils
# Install ဆောင်းရင် admin password တောင်းမည် — မှတ်ထားပါ
sudo systemctl start slapd
sudo systemctl enable slapd
sudo systemctl status slapd
```

**Verify:**
```bash
# Aegis VM မှ
nc -zv 10.20.20.20 389
```

**Result:** slapd ✅ running ဖြစ်ရင် forwarder `_watch_remote_slapd()` event detect နိုင်မည်

---

## [2026-07-22] — Pending Lab Fixes (VM-side TODO)

**Status:** 🔄 မပြီးသေးတာတွေ

### Fix 1 — company-web-server: UFW port 80 allow
```bash
ssh sithu@10.10.10.10
sudo ufw allow 80/tcp
sudo ufw status
```

### Fix 2 — Fail2ban sudo NOPASSWD (VM 4 ခုလုံး)
Script section 7 မှာ "Fail2ban status unavailable" = `sudo fail2ban-client status` မှာ password တောင်းတာ
```bash
# company-web-server, dns-server, customer-db, ldap-server မှာ run
echo "sithu ALL=(ALL) NOPASSWD: /usr/bin/fail2ban-client" | sudo tee /etc/sudoers.d/aegis-fail2ban
```

### Fix 3 — local.conf စစ် + ထည့်
```bash
# Aegis VM မှာ
cat /opt/aegis/scripts/src/aegis_forwarder.local.conf
# ဒီ lines မရှိရင် ထည့်
echo "DNSSERVER_IP=10.10.10.20" >> /opt/aegis/scripts/src/aegis_forwarder.local.conf
echo "LDAPSERVER_IP=10.20.20.20" >> /opt/aegis/scripts/src/aegis_forwarder.local.conf
```

### Fix 4 — Forwarder update + start (Fix 1-3 ပြီးမှ)
```bash
wget -O /opt/aegis/scripts/src/aegis_forwarder.py \
  https://raw.githubusercontent.com/sohu2723-star/aegis-soc-dashboard/main/scripts/src/aegis_forwarder.py
sudo systemctl start aegis-forwarder
sudo systemctl enable aegis-forwarder
journalctl -u aegis-forwarder -f
```

---

## [2026-07-20] — Replit Project Import + Environment Setup

**Status:** ✅ Done
**What:** GitHub repo ကို Replit ထဲ import လုပ်ပြီး development environment setup လုပ်ခဲ့တယ်။ Dependencies install + secrets configure + workflows run

**How:**
```bash
pnpm install   # 473 packages installed from lockfile
```

Required secrets (Replit Secrets panel မှာ set):
- `SUPABASE_DB_URL` — Supabase pooler URI (port 6543)
- `AEGIS_INGEST_KEY` — VM sensor auth key
- `AEGIS_ADMIN_KEY` — Admin endpoint key
- `SESSION_SECRET` — JWT signing secret
- `GROQ_API_KEY` — Groq AI summaries
- `TELEGRAM_BOT_TOKEN` — Alert notifications
- `TELEGRAM_CHAT_ID` — Telegram target chat

**Workflows running:**
- **Start application** — `pnpm --filter @workspace/aegis-dashboard run dev` (port 5000)
- **API Server** — `PORT=3000 pnpm --filter @workspace/api-server run dev` (port 3000)

**Bug fixed — `system.ts` OBSOLETE_HOST_IPS:**
- `"10.20.20.20"` ကို OBSOLETE_HOST_IPS ထဲ ထည့်ထားတယ် (old company-customer-db IP မှ ကျန်ခဲ့တာ)
- v4 topology မှာ 10.20.20.20 = LDAP-Server ဆိုတော့ delete မလုပ်ရဘူး
- seededPairs protection ကြောင့် seeded rows မပျက်ပေမဲ့ forwarder-registered non-seeded rows ကို incorrectly delete လုပ်နိုင်ခဲ့
- **Fix:** OBSOLETE_HOST_IPS ကို empty array `[]` ဖြစ်အောင် ပြောင်း + comment update

**Result:** API server ✅ running, Dashboard ✅ running (login page ပြနေ), LDAP-Server rows bug ✅ fixed
**Next:** Aegis VM မှာ forwarder update (`wget` + `systemctl restart aegis-forwarder`) လုပ်ပြီး DNS/LDAP threads connect ဖြစ်မဖြစ် journalctl မှာ စစ်ရမည်

---

## [2026-07-20] — VM Log → Dashboard Pipeline Full Audit + `srcIp` Bug Fix

**Status:** ✅ Done
**What:** VM log file → forwarder → API ingest → dashboard display pipeline တစ်ခုလုံး trace လုပ်ကာ field name mismatch bug တစ်ခု ရှာတွေ့ပြီး fix လုပ်ခဲ့တယ်

**Bug Found:** `scripts/src/aegis_forwarder.py` ထဲ `post("event", ...)` ခေါ်တဲ့ ၆ ခုမှာ field name `srcIp` (camelCase) သုံးနေပြီး `/ingest/event` endpoint က `sourceIp` လိုချင်တဲ့အတွက် 400 error ဖြစ်ကာ events dashboard မပေါ်ဘူး

**Affected sensors (all now fixed):**
| Sensor | Function | Bug |
|---|---|---|
| PostgreSQL Monitor | `_watch_remote_postgresql()` | `srcIp` → `sourceIp` |
| MySQL Monitor | `_watch_remote_mysql()` | `srcIp` → `sourceIp` |
| DNS Monitor (BIND9) | `_watch_remote_bind9()` | `srcIp` → `sourceIp` (×2) |
| LDAP Monitor (slapd) | `_watch_remote_slapd()` | `srcIp` → `sourceIp` |

**Pipeline Status (Post-Fix):**

| Service | VM Log | Forwarder Function | API Endpoint | Dashboard Display | ✅/❌ |
|---|---|---|---|---|---|
| SSH brute force | `/var/log/auth.log` | `watch_ssh()` | `/ingest/ssh` | red row + BRUTE FORCE | ✅ |
| SSH 1 success (authorized) | `/var/log/auth.log` | `watch_ssh()` | `/ingest/ssh` | green row + Authorized Login | ✅ |
| SSH breach (brute→success) | `/var/log/auth.log` | `watch_ssh()` | `/ingest/ssh` | red + pulsing BREACH + Skull icon | ✅ |
| Fail2ban ban | `/var/log/fail2ban.log` | `watch_fail2ban()` | `/ingest/fail2ban` | high severity + auto-blocked | ✅ |
| Suricata IDS | pfSense eve.json (SSH) | `_watch_pfsense_suricata()` | `/ingest/suricata` | network_attack + rule SID | ✅ |
| HTTP ModSecurity | modsec_audit.log | `watch_http()` | `/ingest/http` | web_attack + SQLi/XSS badge | ✅ |
| Web login breach | Apache access.log | `watch_http_access()` | `/ingest/http_access` | red + WEB BREACH banner | ✅ |
| PostgreSQL auth fail | MySQL error.log (SSH) | `_watch_remote_postgresql()` | `/ingest/event` | db_auth_failure | ✅ (fixed) |
| MySQL auth fail | MySQL error.log (SSH) | `_watch_remote_mysql()` | `/ingest/event` | db_auth_failure | ✅ (fixed) |
| DNS zone transfer | named.log (SSH) | `_watch_remote_bind9()` | `/ingest/event` | dns_zone_transfer | ✅ (fixed) |
| LDAP auth fail | syslog (SSH) | `_watch_remote_slapd()` | `/ingest/event` | ldap_auth_failure | ✅ (fixed) |

**Auto-defense rules (all services):**
- SSH ≥5 failures → `iptables` block (company-web-server, company-customer-db, company-dns-server, company-ldap-server)
- DNS attack → company-dns-server block
- Fail2ban ban → auto-block + DB record

**Result:** Python syntax ✅ clean (no srcIp remaining), all 6 occurrences fixed
**Next:** Aegis VM မှာ forwarder update (`wget` + `systemctl restart`) — DNS/LDAP events ခု dashboard ရောက်မရောက် test ရမည်

---

### [2026-07-21] — Replit Re-import & Dev Environment Restore

**Status:** ✅ Done
**What:** GitHub repo ကို Replit ထဲ ထပ် import လုပ်ပြီး development environment restore လုပ်ခဲ့တယ်
**How:**
```bash
pnpm install   # 473 packages restored from lockfile (14.5s)
```
**Code state verified:**
- `OBSOLETE_HOST_IPS = []` ✅ (10.20.20.20 ကို မဖျက်တော့ — LDAP-Server)
- `sourceIp` field ✅ (srcIp bug ကို ပြင်ပြီးသား)
- LDAP-Server (10.20.20.20) `system.ts` ထဲ ✅ properly seeded

**Workflows:**
- **Start application** (port 5000) ✅ Running — login page ပြနေ
- **API Server** (port 3000) ❌ `SUPABASE_DB_URL` secret မ set ရသေးလို့ fail — Replit Secrets panel မှာ ထည့်ရမည်

**Required secrets (Replit Secrets panel မှာ ထပ် set ရမည်):**
```
SUPABASE_DB_URL    ← Supabase → Settings → Database → URI (port 6543)
AEGIS_INGEST_KEY   ← VM forwarder auth key
AEGIS_ADMIN_KEY    ← Admin endpoint key
GROQ_API_KEY       ← (optional) AI summaries
TELEGRAM_BOT_TOKEN ← (optional) Telegram alerts
TELEGRAM_CHAT_ID   ← (optional) Telegram chat
```
*(SESSION_SECRET ✅ already set)*

**Result:** Frontend ✅ running, API server ⏳ pending secrets
**Next:** Secrets ထည့်ပြီး API Server workflow restart → Aegis VM forwarder update test

---

### [2026-07-22] — Forwarder SSH Key Fix + CUSTOMERDB_IP Bug Diagnosis

**Status:** ✅ Done (code side) / ⏳ VM-side actions pending
**What:** Screenshots မှာ remote host 5 ခု မပြ (customer-db ပျောက်) + health check exit 255 issue ဖြေရှင်းခဲ့

**Root Cause 1 (Critical): `CUSTOMERDB_IP=10.20.20.20` in local.conf — WRONG**
- Forwarder log: `company-customer-db SSH disconnected from 10.20.20.20`
- 10.20.20.20 = LDAP-Server IP — customer-db thread နဲ့ ldap thread ၂ ခုလုံး same IP ကို SSH ဝင်
- Fix: Aegis VM မှာ local.conf ထဲ `CUSTOMERDB_IP=10.20.20.10` ပြောင်းရမည်

**Root Cause 2: All company VM SSH commands မှာ `-i` flag မပါ**
- Health check + log tail + defense exec အားလုံး `~/.ssh/aegis_id_rsa` key ကို explicitly မသုံးဘူး
- Systemd service အနေနဲ့ run တဲ့အခါ SSH agent မရှိလို့ BatchMode=yes = exit 255
- **Code fix done:** `REMOTE_SSH_KEY` config ထည့် (default: `~/.ssh/aegis_id_rsa`)
  - `_ssh_tail()` — `-i REMOTE_SSH_KEY` ထည့်
  - `_remote_service_health_loop()` — `-i REMOTE_SSH_KEY` ထည့်
  - `_exec_defense_ssh_remote()` — `-i REMOTE_SSH_KEY` ထည့် (defense + session kill)
  - `_fetch_fail2ban_regex()` — `-i REMOTE_SSH_KEY` ထည့်
  - `_fetch_remote_host_info()` — `-i REMOTE_SSH_KEY` ထည့်

**VM-side fixes still needed:**
1. Aegis VM: `local.conf` ထဲ `CUSTOMERDB_IP=10.20.20.10` ဖြစ်မဖြစ် စစ်/ပြောင်း
2. Aegis VM: `wget` + `systemctl restart aegis-forwarder` (script update)
3. DNS server: `sudo systemctl start named && sudo systemctl enable named`
4. DNS server: BIND9 logging config run (named.log ဖန်တီး)

**Result:** Code ✅ fixed and committed — Aegis VM မှာ script update လုပ်ရမည်

---

## [2026-07-21] — Replit Secrets Restore + Both Workflows Running

**Status:** ✅ Done
**What:** Replit re-import ပြီးနောက် secrets အားလုံး re-enter လုပ်ပြီး API server + dashboard နှစ်ခုလုံး run ဖြစ်အောင် ပြန်ဆောက်ခဲ့

**How:**
Replit Secrets panel မှာ အောက်ပါ secrets အားလုံး set:
```
SUPABASE_DB_URL    ← Supabase pooler URI (port 6543)
AEGIS_INGEST_KEY   ← VM sensor auth key
AEGIS_ADMIN_KEY    ← Admin endpoint key
GROQ_API_KEY       ← Groq AI summaries
TELEGRAM_BOT_TOKEN ← Alert notifications
TELEGRAM_CHAT_ID   ← Telegram target chat
SESSION_SECRET     ← JWT signing (already set)
```

**Result:**
- **Start application** (port 5000) ✅ Running — AEGIS login page ပြနေ
- **API Server** (port 3000) ✅ Running — `Server listening port: 3000`, auto-report scheduler started
- Supabase connection ✅ (SUPABASE_DB_URL accepted by custom URL parser)
- Google SSO — ⚠️ 403 (Replit dev domain not in Google Console authorized origins — normal, use access key login instead)

**Next:** Aegis VM မှာ VM-side fixes apply လုပ်ရမည် (ကြည့်: [2026-07-22] Pending Lab Fixes section)

---

## [2026-07-21] — local.conf.example Update (v4 Topology + REMOTE_SSH_KEY)

**Status:** ✅ Done
**What:** `scripts/src/aegis_forwarder.local.conf.example` ကို v4 topology နဲ့ ကိုက်ညီအောင် update လုပ်ခဲ့

**Changes:**
1. `BANKWEB_IP` → `COMPANYWEB_IP` (BANKWEB_IP ကို ဟောင်းတဲ့ local.conf compatibility အတွက် forwarder script ထဲ fallback ပါဆဲ)
2. `REMOTE_SSH_KEY=~/.ssh/aegis_id_rsa` entry ထည့် (systemd service mode မှာ SSH agent မရှိလို့ explicit key path လိုသည်)
3. Prerequisites section update — ပြင်ဆင်ခဲ့တာ:
   - Company VM names (company-web-server, company-customer-db, company-dns-server, company-ldap-server)
   - customer-db IP `10.20.20.10` (မှားနေတဲ့ `10.20.20.20` comment fix)
   - ssh-copy-id commands 4 ခုလုံး ထည့် (DNS + LDAP server ပါ)
   - sudoers entries for iptables + fail2ban-client နှစ်ခုလုံး ထည့်
4. "Bank VM IPs" → "Company VM IPs" header rename

**Result:** `local.conf.example` ✅ v4 topology + correct IPs + REMOTE_SSH_KEY — Aegis VM မှာ cp + nano လုပ်ရင် မှားဖို့ ခဲဆင်းတော့မယ်

---

## [2026-07-22] — DNS Watcher: Internal IP Filter Fix

**Status:** ✅ Done
**What:** Dashboard Telemetry မှာ `10.30.30.10 → company-dns-server [dns_query_refused]` spam ပေါ်နေတာ ဖြေရှင်းခဲ့

**Root Cause:** `_watch_remote_bind9()` မှာ `_defender_ips` filter မပါ — aegis hub VM (10.30.30.10) ကိုယ်တိုင် DNS query လုပ်တဲ့အခါ (health check, internal resolution) BIND9 refused ဖြေပြီး query log ကျ → forwarder က event အဖြစ် POST → dashboard telemetry မှာ ပေါ်နေ

**Fix:** `_watch_remote_bind9()` ထဲ `_defender_ips` set ထည့် (other watchers pattern နဲ့ ညီ):
```python
_defender_ips = {h["ip"] for h in REMOTE_HOSTS} | {"10.30.30.10", PFSENSE_IP}
```
- `dns_query_refused` → src_ip in _defender_ips ဆိုရင် skip (internal routine query)
- `dns_zone_transfer` (AXFR/IXFR) → filter မပါ (always suspicious, any source)

**Filter logic:**
| Source IP | dns_query_refused | dns_zone_transfer |
|---|---|---|
| 10.30.30.10 (aegis hub) | ❌ skip | ✅ alert |
| 10.10.10.10 (company-web-server) | ❌ skip | ✅ alert |
| 10.30.30.1 (pfSense) | ❌ skip | ✅ alert |
| 192.168.10.x (Kali attacker) | ✅ alert | ✅ alert |
| unknown external IP | ✅ alert | ✅ alert |

**File:** `scripts/src/aegis_forwarder.py` — `_watch_remote_bind9()`
**Result:** aegis VM internal DNS queries → dashboard မပေါ်တော့ / Attacker DNS queries → ပေါ်ဆဲ
**Next:** Aegis VM မှာ `wget` + `systemctl restart aegis-forwarder` — script update လုပ်ရမည်

---

## [2026-07-22] — pfSense Suricata Watcher: FreeBSD tail -F Fix

**Status:** ✅ Done (code) / ⏳ pfSense Suricata install pending
**What:** pfSense SSH connect → immediately disconnect (15s loop) ဖြစ်နေတာ ဖြေရှင်းခဲ့

**Root Cause:** pfSense runs FreeBSD. GNU/Linux မှာ `tail -F` on missing file → wait/retry. FreeBSD မှာ `tail -F` on missing file → immediately exit with error. Suricata eve.json မရှိသေးတဲ့အတွက် SSH session ချက်ချင်း ပြတ်ပြီး reconnect loop ဖြစ်နေ.

**Fix:** `_watch_pfsense_suricata()` ထဲ remote command ကို sh wait-loop သို့ ပြောင်း:
```python
# Before (exits immediately on FreeBSD if file missing):
f"tail -F {log_path} 2>/dev/null"

# After (waits for file, then tails — SSH session stays alive):
f"sh -c 'while [ ! -f {log_path} ]; do sleep 5; done; tail -F {log_path} 2>/dev/null'"
```
Also bumped ServerAliveInterval 15→30, ServerAliveCountMax 3→6 for long-lived idle SSH.

**Status after fix:** pfSense SSH stays connected (one stable session), waiting silently until Suricata creates eve.json.

**pfSense-side still needed:** Install + configure Suricata on pfSense:
- Packages → suricata → Install
- Interfaces: em1.10 (PUBLIC) + em2.20 (INTERNAL) → Enable + ET Open rules
- After enable, verify: `ls /var/db/suricata/suricata_em110/eve.json`

---

## [2026-07-22] — check_connectivity.sh pfSense SSH Key Guard + Better Error Messages ✅

**Status:** ✅ Done
**What:** pfSense SSH section မှာ key မရှိရင် misleading warning အစား ရှင်းရှင်းလင်းလင်း ပြပြီး fix instructions ပါ ပြအောင် ပြင်ခဲ့

**Root Cause:** `~/.ssh/pfsense_key` မရှိရင် ssh_cmd fail → pipefail → `|| warn "Could not check pfSense Suricata paths"` ပဲ ပြ — ဘာပြဿနာဆိုတာ မသိနိုင်ဘူး

**Fix:**
```bash
# Before: မသိနိုင်တဲ့ generic warning
|| warn "Could not check pfSense Suricata paths"

# After: key check → connection check → real error
if [[ ! -f "$PF_KEY" ]]; then
    warn "pfSense SSH key not found: ~/.ssh/pfsense_key"
    warn "  → Fix: ssh-keygen -t ed25519 -f ~/.ssh/pfsense_key -N ''"
    warn "  → Then add public key to pfSense: System → User Manager → admin → Authorized Keys"
elif ! ssh connection test; then
    warn "pfSense SSH connection failed"
    warn "  → Check SSH enabled in pfSense + public key added?"
else
    # actual check
fi
# Same guard logic for pfctl table check too
```

**Also fixed:** `pfctl table empty` → now shows ✅ "empty (no IPs blocked)" instead of ⚠️ warning

**Pushed to:** GitHub main ✅

**VM-side fix needed (pfSense SSH key setup):**
```bash
# Aegis VM မှာ — key မရှိရင် generate
ls ~/.ssh/pfsense_key || ssh-keygen -t ed25519 -f ~/.ssh/pfsense_key -N ""
cat ~/.ssh/pfsense_key.pub   # ← copy this

# pfSense Web UI:
# System → User Manager → admin → Authorized SSH Keys → paste public key → Save
# System → Advanced → Admin Access → Secure Shell → Enable SSH ✅
```

---

## [2026-07-22] — check_connectivity.sh pfSense Suricata Path Fix ✅

**Status:** ✅ Done
**What:** `check_connectivity.sh` မှာ pfSense Suricata eve.json path ဟောင်းကြောင်း (`/var/db/suricata/`) ကျန်နေတာ fix လုပ်ခဲ့

**Root Cause:** Previous journal entry မှာ "check_connectivity.sh fixed" လို့ ရေးထားပေမဲ့ actual code ထဲမှာ မပြင်ရသေးဘူး — `aegis_forwarder.py` ပဲ fix ခဲ့တာ

**Fix (scripts/src/check_connectivity.sh):**
```bash
# Before (WRONG — rules dir, not logs):
"ls /var/db/suricata/suricata_em110/eve.json /var/db/suricata/suricata_em220/eve.json 2>&1"

# After (correct):
"ls -lh /var/log/suricata/eve.json 2>&1 && echo OK || echo MISSING"
```

**Pushed to:** GitHub main ✅

**Next:** Aegis VM မှာ `check_connectivity.sh` ပါ update လုပ်ရမည် (aegis_forwarder.py နဲ့ အတူ):
```bash
wget -O /opt/aegis/scripts/src/check_connectivity.sh \
  https://raw.githubusercontent.com/sohu2723-star/aegis-soc-dashboard/main/scripts/src/check_connectivity.sh
chmod +x /opt/aegis/scripts/src/check_connectivity.sh
```

---

## [2026-07-22] — pfSense Suricata eve.json Actual Path Discovered ✅

**Status:** ✅ Path confirmed + code fixed
**What:** pfSense Suricata EVE JSON log path ကို diagnostics ဖြင့် confirm လုပ်ကာ code update လုပ်ခဲ့

**Diagnosis Commands Run (pfSense Diagnostics → Command Prompt):**
```sh
ls -la /var/db/suricata/
# Result: suricata_em110/ + suricata_em220/ directories exist — rules only, no eve.json

ls -la /var/db/suricata/suricata_em110/
# Result: only "rules/" subdir — log files မရှိ

ps aux | grep suricata
# Result: Suricata IS running on both interfaces:
#   /usr/local/bin/suricata -i em1.10 -D -c /usr/local/etc/suricata/suricata_42709_em1.10/suricata.yaml
#   /usr/local/bin/suricata -i em2.20 -D -c /usr/local/etc/suricata/suricata_62963_em2.20/suricata.yaml

ls /var/log/suricata/
# Result: eve.json ← HERE! Plus suricata_em1.1042709/ suricata_em2.2062963/ suricata_rules_update.log

grep -i "eve|filename|log-dir" /usr/local/etc/suricata/suricata_42709_em1.10/suricata.yaml
# Result: default-log-dir: /var/log/suricata/suricata_em1.1042709 | filename: eve.json
```

**Root Cause:**
- `/var/db/suricata/` = rules directory only (NOT logs)
- Actual logs → `/var/log/suricata/`
- Instance subdirs (`suricata_em1.1042709/`) include **dynamic PID numbers** — change on every Suricata restart
- Root-level `/var/log/suricata/eve.json` exists and is stable

**Code Fix (scripts/src/aegis_forwarder.py):**
```python
# Before (WRONG path):
_default_public   = "/var/db/suricata/suricata_em110/eve.json"
_default_internal = "/var/db/suricata/suricata_em220/eve.json"

# After (correct):
_default_log = "/var/log/suricata/eve.json"
# Single thread monitoring root-level combined log
```

**Also fixed:**
- `scripts/src/check_connectivity.sh` — Suricata path check updated
- `scripts/src/aegis_forwarder.local.conf.example` — correct path documented

**Files changed:** `aegis_forwarder.py`, `check_connectivity.sh`, `aegis_forwarder.local.conf.example`
**Pushed to:** GitHub main ✅

**Next:** Aegis VM `wget` + `systemctl restart aegis-forwarder` → forwarder connects to pfSense and reads live Suricata alerts

---

## [2026-07-22] — lab/company-web-server/ + DNS Zone + LDAP Setup Files Built

**Status:** ✅ Done (code side) / ⏳ VM deploy pending

**What:** Project Book Chapter 14 plan အတိုင်း `goldenmyanmar.trading.com` company infrastructure ၏ code artifacts အားလုံး build လုပ်ခဲ့သည်

### Files Created

#### `lab/company-web-server/` — Golden Myanmar Trading Staff Portal (PHP)
| File | Purpose |
|------|---------|
| `db.php` | DB connection → `db.goldenmyanmar.trading.com` (DNS hostname) / `gmuser` / `goldenmyanmardb` |
| `index.php` | Login page — **intentionally SQLi-vulnerable** (`' OR '1'='1` bypass demo) |
| `nav.php` | Shared navbar |
| `dashboard.php` | Staff dashboard — KPI cards (customers, accounts, funds, products, orders) + recent activity |
| `customers.php` | Customer directory — **SQLi-vulnerable** `?search=` param (sqlmap data dump target) |
| `accounts.php` | Account management — balance deposit/withdraw |
| `products.php` | Trading product catalog (timber, gems, jade, rice, seafood, minerals) |
| `orders.php` | Order management — place + list orders |
| `transactions.php` | Transaction ledger |
| `logout.php` | Session destroy |
| `style.css` | Dark gold theme (company branding — `#d4a017` gold, `#0a1218` bg) |
| `setup.sql` | Full MySQL schema + seed: `staff`, `customers`, `accounts`, `products`, `orders`, `transactions` |
| `README.md` | Deploy steps + attack demo commands |

**DB:** `goldenmyanmardb` on `db.goldenmyanmar.trading.com` → 10.20.20.10  
**User:** `gmuser` / `gm1234`  
**Staff logins (SQLi target):** admin / Admin@2024! , teller01 / teller@123

#### `lab/dns-server/` — BIND9 Zone Files
| File | Purpose |
|------|---------|
| `named.conf.local` | Zone declarations for BIND9 (`/etc/bind/named.conf.local` append) |
| `db.goldenmyanmar.trading.com` | Zone file — web→10.10.10.10, db→10.20.20.10, ldap→10.20.20.20, aegis→10.30.30.10 |
| `db.bank.local` | Legacy bank.local zone (backward compat) |
| `README.md` | Install + deploy steps + AXFR attack demo |

**Attack demo:** `allow-transfer { none; }` ← comment out to enable AXFR zone-transfer vuln demo

#### `lab/ldap-server/` — OpenLDAP Setup
| File | Purpose |
|------|---------|
| `setup.ldif` | OU + staff account LDIF (`dc=goldenmyanmar,dc=com`) |
| `README.md` | Install steps + anonymous bind / brute force / credential dump attack demos |

### Attack Coverage Added

| Attack | Target | Tool | AEGIS Alert |
|--------|--------|------|-------------|
| SQLi login bypass | `index.php` | Manual: `' OR '1'='1` | `web_attack (sqli)` |
| SQLi data dump | `customers.php?search=` | sqlmap | `web_attack (sqli)` → ModSecurity |
| Staff brute force | `index.php` | hydra http-post-form | `web_brute` → fail2ban block |
| Zone transfer | DNS AXFR | dig AXFR | `dns_zone_transfer` |
| LDAP anonymous bind | port 389 | ldapsearch -x anon | slapd log → AEGIS |
| LDAP brute force | port 389 | hydra ldap2 | fail2ban → auto-block |

### VM-Side Actions Needed (run on respective VMs)

**company-web-server (10.10.10.10):**
```bash
sudo cp -r /opt/lab/company-web-server/* /var/www/html/
sudo chown -R www-data:www-data /var/www/html/
sudo ufw allow 80/tcp && sudo systemctl restart apache2
```

**company-customer-db (10.20.20.10):**
```bash
mysql -u root -p < lab/company-web-server/setup.sql
# Creates: goldenmyanmardb + gmuser + all tables + seed data
```

**company-dns-server (10.10.10.20):**
```bash
sudo cp lab/dns-server/db.goldenmyanmar.trading.com /etc/bind/
sudo tee -a /etc/bind/named.conf.local < lab/dns-server/named.conf.local
sudo named-checkconf && sudo systemctl restart bind9
```

**company-ldap-server (10.20.20.20):**
```bash
sudo dpkg-reconfigure slapd   # domain: goldenmyanmar.trading.com
ldapadd -x -H ldap://localhost -D "cn=admin,dc=goldenmyanmar,dc=com" -W -f lab/ldap-server/setup.ldif
```

**Pushed to:** GitHub main ✅
**Next:** VM deploy → DNS resolution test (`dig @10.10.10.20 web.goldenmyanmar.trading.com`) → web app test (`curl http://10.10.10.10`) → SQLi attack demo

---

## [2026-07-22] — check_connectivity.sh: SSH Auth Fail Bug Fix + Diagnostics Upgrade

**Status:** ✅ Done
**What:** `check_connectivity.sh` script မှာ SSH auth fail ဖြစ်ရင် script တစ်ခုလုံး early exit ဖြစ်နေတဲ့ bug fix + diagnostics ပိုကောင်းအောင် upgrade

### Root Cause

`set -euo pipefail` ကို script ထဲ enable လုပ်ထားတဲ့ အတွက် `ssh_ok` function ကနေ `return 1` ပြန်ပေးတဲ့ အခါ script ချက်ချင်း exit ဖြစ်သည်။ SSH auth fail ဖြစ်သော VM တစ်ခုနောက် ကျန် VM တွေ check မဖြစ်ဘဲ report incomplete ဖြစ်တယ်။

```bash
# ပြဿနာ — set -e + return 1 = script exit
ssh_ok() {
    ...
    else
        fail "..."
        return 1   # ← set -e ကြောင့် script ကို abort လုပ်တယ်
    fi
}
```

### Fix Applied

1. **`set -euo pipefail` → `set -uo pipefail`** — `-e` ကို ဖြုတ်လိုက် (pipefail + nounset ထားတယ်)
2. **`ssh_ok` function** — `return 0` / `return 1` ဖြုတ်ကာ function က always 0 return ဖြစ်အောင် ပြောင်း
3. **`_ssh_auth_hint()` helper ထည့်** — SSH fail ဖြစ်ရင် actionable hint ပြပေး:
   - Key file missing → generate + copy-id commands
   - Wrong permissions → chmod 600
   - Port closed → systemctl start ssh
   - Auth denied → ssh-copy-id + public key ပြ
   - Stale known_hosts → ssh-keygen -R
4. **Section 0: Pre-flight check ထည့်** — SSH check မပြုလုပ်ခင် key file existence + permissions စစ်
5. **Pass/Fail/Warn counter ထည့်** — `PASS_COUNT`, `FAIL_COUNT`, `WARN_COUNT` summary at bottom
6. **goldenmyanmar DNS zone test ထည့်** — Section 8 ထဲ `web/db/ldap.goldenmyanmar.trading.com` expected IP check
7. **suricata service check ထည့်** — Section 4 ထဲ company-web-server + company-dns-server + company-customer-db + company-ldap-server တွေမှာ `suricata` ပါ စစ်တယ်
8. **Quick fix hints at bottom** — FAIL_COUNT > 0 ဖြစ်ရင် ssh-copy-id + ssh-keygen -R commands ပြ

### File Changed

`scripts/src/check_connectivity.sh` — 388 → ~388 lines (upgraded)

**Pushed to:** GitHub main ✅

**VM command to update (aegis-company-admin):**
```bash
wget -O /opt/aegis/scripts/src/check_connectivity.sh \
  https://raw.githubusercontent.com/sohu2723-star/aegis-soc-dashboard/main/scripts/src/check_connectivity.sh
chmod +x /opt/aegis/scripts/src/check_connectivity.sh
./opt/aegis/scripts/src/check_connectivity.sh
```

---

## [2026-07-22] — pfSense SSH Auth Fail: Diagnosis + Fix + Project Book Update

**Status:** ✅ Done

### ပြဿနာ (symptoms)

`check_connectivity.sh` run ရင် pfSense SSH auth fail ဖြစ်နေ:
```
admin@10.30.30.1: Permission denied (publickey,password,keyboard-interactive)
sign_and_send_pubkey: signing failed for ED25519 "..." from agent: agent refused operation
identity_sign: private key /home/sithu/.ssh/pfsense_key contents do not match public key
```

### Root Cause (အဆင့်ဆင့် စစ်ထွက်ခဲ့တာ)

**Root cause: SSH keypair mismatch**
`~/.ssh/pfsense_key` (private) နဲ့ `~/.ssh/pfsense_key.pub` (public) မတိုက်ဆိုင်ဘူး — previous session တစ်ခုတည်းတည်းမှာ file တစ်ဖိုင်ကိုသာ overwrite ဖြစ်သွားမည် ဟု ခန့်မှန်းရ

**Secondary cause: SSH agent interference**
Agent ထဲ mismatched key ကို cache လုပ်ထားတာကြောင့် `-i` flag ပါပေမဲ့ SSH က agent ကိုဦးစိုက်ကြိုးစားပြီး agent refuse ဖြစ်သည်

### Concepts ရရှိ

| Concept | သဘောတရား |
|---|---|
| Keypair mismatch | Private + Public key တစ်ပြိုင်နက် generate မမှုရင် match မဖြစ်၊ SSH sign fail |
| Agent refused operation | SSH agent ထဲ key cache ရှိတာ agent refuse → `-i` flag ပါပေမဲ့ agent priority ကြောင့် fail |
| `-o IdentityAgent=none` | Agent ကို လုံးဝ bypass ကာ key file ကိုသာ တိုက်ရိုက် သုံး |
| pfSense WebGUI paste bug | Browser copy-paste → key တစ်ကြောင်း ၂ ကြောင်း split → pfSense reject |
| scp + Diagnostics fix | scp ကနေ raw file transfer → pfSense Command Prompt မှ install → format ပျက်မည် မဟုတ် |

### Fix (VM မှာ လုပ်ရမည်)

```bash
# 1. Keypair စစ်
ssh-keygen -y -f ~/.ssh/pfsense_key | diff - ~/.ssh/pfsense_key.pub && echo "MATCH" || echo "MISMATCH"

# 2. Mismatch ဆိုရင် အသစ် generate
ssh-keygen -t ed25519 -f ~/.ssh/pfsense_key -N "" -C "sithu@Aegis-admin"

# 3. pfSense ထဲ push
scp ~/.ssh/pfsense_key.pub admin@10.30.30.1:/tmp/pfsense_key.pub

# 4. pfSense WebGUI → Diagnostics → Command Prompt:
# cat /tmp/pfsense_key.pub > /root/.ssh/authorized_keys && chmod 600 /root/.ssh/authorized_keys

# 5. Test (agent bypass)
ssh -i ~/.ssh/pfsense_key -o IdentityAgent=none -o BatchMode=yes -o StrictHostKeyChecking=no admin@10.30.30.1 exit
echo "Exit: $?"   # 0 ရရင် OK
```

### Code Changes

**`scripts/src/aegis_forwarder.py`** — SSH blocks ၆ ခုလုံးမှာ `-o IdentityAgent=none` ထည့်:
- `_fetch_fail2ban_signature()` SSH call
- `_lookup_pfsense_rule()` SSH call
- `_exec_defense_pfsense_ssh()` SSH call
- `_exec_defense_pfsense()` ssh_base
- `_exec_defense_ssh_remote()` main SSH call
- `_exec_defense_ssh_remote()` kill_cmd SSH call

**`docs/PROJECT_BOOK.md`** — New concepts ထည့်:
- Section 4e: scp + Diagnostics method (WebGUI paste method ကို replace)
- Section 7: Keypair mismatch concept + verify + fix subsection ထည့်
- Section 7: SSH Agent Refused Operation concept + IdentityAgent=none subsection ထည့်
- Section 7: pfSense SSH Key ထည့်နည်း ← correct method ညွှန်
- Section 12: pfSense SSH auth fail troubleshooting table ထည့်
- Section 12: Browser paste line-break bug ထည့်
- Quick Reference: pfSense SSH commands block ထည့်
- Quick Reference: check_connectivity.sh reference ထည့်

**Pushed to:** GitHub main ✅

**VM forwarder update command:**
```bash
wget -O /opt/aegis/scripts/src/aegis_forwarder.py \
  https://raw.githubusercontent.com/sohu2723-star/aegis-soc-dashboard/main/scripts/src/aegis_forwarder.py
sudo systemctl restart aegis-forwarder
journalctl -u aegis-forwarder -f
```

---

## [2026-07-22] — Replit Re-import #3 + Full State Audit

**Status:** ✅ Done
**What:** GitHub repo ကို Replit မှာ ထပ်မံ import + environment setup + full code/docs audit

**How:**
1. `pnpm install` — 473 packages installed from lockfile
2. Secrets set: `SUPABASE_DB_URL`, `AEGIS_INGEST_KEY`, `AEGIS_ADMIN_KEY` (SESSION_SECRET ရှိပြီး)
3. Full audit: replit.md, SYSTEM_ARCHITECTURE.md, PROJECT_BOOK.md, lab-setup-journal.md (2345 lines), SESSION_LOG.md, forwarder source, API routes, dashboard pages

**Verified in-sync (all ✅):**
- Topology v4 Final — company-web-server(10.10.10.10), DNS-Server(10.10.10.20), company-customer-db(10.20.20.10), LDAP-Server(10.20.20.20), aegis-company-admin(10.30.30.10)
- Forwarder: `-o IdentityAgent=none` SSH fix ✅, pfSense Suricata auto-discover ✅, LDAP conn→IP tracking ✅
- check_connectivity.sh: SSH early-exit bug fix ✅, goldenmyanmar DNS zone test ✅
- Behavioral analysis: Breach vs Authorized Login classification ✅
- Defense chain transparency: Attack→Rule→Command dashboard ✅
- host-utils.tsx: all v4 IPs + label aliases ✅
- system.ts: DNS Monitor + LDAP Monitor sensors ✅

**Workflows:**
- Start application → ✅ port 5000 (React/Vite)
- API Server → ✅ port 3000 (Express + Supabase connected)

**Result:** Code + Replit fully in-sync. No pending code changes.

**Next (VM-side tasks, code ပြင်စရာ မလို):**
1. aegis-company-admin မှာ forwarder update: `wget -O /opt/aegis/scripts/src/aegis_forwarder.py https://raw.githubusercontent.com/sohu2723-star/aegis-soc-dashboard/main/scripts/src/aegis_forwarder.py && sudo systemctl restart aegis-forwarder`
2. aegis-company-admin မှာ check_connectivity.sh update: `wget -O /opt/aegis/scripts/src/check_connectivity.sh https://raw.githubusercontent.com/sohu2723-star/aegis-soc-dashboard/main/scripts/src/check_connectivity.sh && chmod +x /opt/aegis/scripts/src/check_connectivity.sh`
3. `aegis_forwarder.local.conf` မှာ `DNSSERVER_IP=10.10.10.20` + `LDAPSERVER_IP=10.20.20.20` ထည့် (မထည့်ရသေးဘဲဆိုရင်)
4. company-dns-server မှာ BIND9 logging config ထည့် (`/var/log/named/named.log`)
5. `./check_connectivity.sh` run ပြီး results စစ်
6. Kali ကနေ real attack test ဆင်း → dashboard detect + auto-defense confirm

---

## [2026-07-22] — Replit Re-import #4 + Environment Restore

**Status:** ✅ Done
**What:** GitHub repo ကို Replit မှာ ထပ်မံ import ပြီး development environment restore လုပ်ခဲ့

**How:**
```bash
pnpm install   # 473 packages installed from lockfile (10.4s)
```

**Secrets re-entered (Replit Secrets panel):**
```
SUPABASE_DB_URL    ← Supabase pooler URI (port 6543)
AEGIS_INGEST_KEY   ← VM sensor auth key
AEGIS_ADMIN_KEY    ← Admin endpoint key
GROQ_API_KEY       ← Groq AI summaries
TELEGRAM_BOT_TOKEN ← Alert notifications
TELEGRAM_CHAT_ID   ← Telegram target chat
```
*(SESSION_SECRET ✅ already set from previous session)*

**Result:**
- **Start application** (port 5000) ✅ Running — AEGIS login page ပြနေ
- **API Server** (port 3000) ✅ Running — `Server listening`, Supabase connected, auto-report scheduler started

**Code state:** No pending code changes — all fixes from previous sessions ✅ committed to GitHub main

**Next (VM-side tasks, code ပြင်စရာ မလို):**
1. aegis-company-admin: forwarder + check_connectivity.sh update via `wget`
2. VM-side pending fixes apply (BIND9 logging, slapd start, UFW port 80, fail2ban sudoers)
3. Run `./check_connectivity.sh` + review results
4. Kali ကနေ real attack test → dashboard detect + auto-defense confirm

---

## [2026-07-23] — DNS Query Refused: Rate-Limit Fix (No-Attack Spam)

**Status:** ✅ Done (code) / ⏳ VM script update pending
**What:** Attack မလုပ်ဘဲ website ကြည့်ရုံနဲ့ `dns_query_refused` MEDIUM events dashboard ထဲ spam ပေါ်နေသော bug ဖြေရှင်းခဲ့

**Root Cause ၂ ခု:**
1. `10.30.30.10` (aegis hub VM) events — forwarder VM script အဟောင်းဆဲ run နေလို့ (`wget` မလုပ်ရသေး) → ဟောင်း events DB ထဲ ကျန် နေ
2. `192.168.10.99` (Kali) events — Kali DNS `10.10.10.20` ကို ညွှန်ထားလို့ browser request တစ်ခုချင်း = refused query တစ်ခု = MEDIUM event တစ်ခု — threshold မရှိဘူး

**Fix (`scripts/src/aegis_forwarder.py` — `_watch_remote_bind9()`):**
- `_refused_ts: dict[str, list[float]]` rate-limit tracker ထည့် (IP → timestamp list)
- **60s sliding window ထဲ same IP ကနေ ≥ 5 refused queries မှ** MEDIUM alert တစ်ကြိမ်သာ fire ပြီး counter reset
- Alert မ fire ဘဲ accumulate ထားတဲ့ queries = no event = dashboard clean
- Zone transfer (AXFR/IXFR) = threshold မပါ = ချက်ချင်း high alert (ဟောင်း behavior ထား)

**Before vs After:**
| Scenario | Before | After |
|---|---|---|
| Kali browse website (1-2 DNS lookups) | MEDIUM event တက် | ❌ မတက် |
| Kali DNS recon (5+ queries/60s) | MEDIUM event တက် | ✅ MEDIUM event တက် (consolidated) |
| DNS zone transfer (AXFR) | HIGH alert | ✅ HIGH alert (unchanged) |
| 10.30.30.10 internal query | ❌ မတက်သင့် (filter ရှိ) | ❌ မတက် |

**Pushed to:** GitHub main ✅
**VM-side:** `wget` + `systemctl restart aegis-forwarder` လုပ်ရမည်

---

### [2026-07-22] — pfSense Suricata eve.json auto-discovery fix

**Status:** ✅ Done  
**What:** pfSense Suricata log path `/var/log/suricata/eve.json` သည် broken symlink ဖြစ်နေ (`suricata_em011157/eve.json` မရှိ)၊ real files တွေက PID-based subdirectories မှာပဲ ရှိ — `suricata_em1.1042709/eve.json` နဲ့ `suricata_em2.2062963/eve.json`။ Suricata restart တိုင်း PID ပြောင်းတော့ path ပြောင်း၊ forwarder path missing error ဖြစ်နေ။  
**How:** `_watch_pfsense_suricata()` မှာ `remote_cmd` ကို auto-discover logic ထည့်ပြင်—  
- Configured path `-f` test fail ရင် `find /var/log/suricata/ -maxdepth 2 -name eve.json -type f | sort | head -1` နဲ့ real path ရှာ  
- Path မတွေ့သေးရင် 5s loop နဲ့ ထပ်ရှာ (Suricata မ start ရသေးလို့ wait)  
- Path တွေ့ပြီးရင် `tail -F` ဆက်တိုက် tail လုပ်  
**Result:** Suricata restart → PID ပြောင်း → forwarder auto-rediscover ဖြစ်မယ်၊ `PFSENSE_SURICATA_LOG` config ပြင်စရာမလို  
**Next:** Ubuntu VM မှာ `wget` နဲ့ script update ၊ forwarder restart ၊ `[pfSense-suricata] Connected` ပြန်ထွက်လာသည်အထိ log ကြည့်
