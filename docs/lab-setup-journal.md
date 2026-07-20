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

---

## 2026-07-19 — GNS3 Network Interface များ နားလည်မှု (virbr0 vs Bridge vs NAT)

**Status:** ✅ Done  
**What:** GNS3 NAT Cloud မှာ ဘယ် interface သုံးရမလဲ၊ virbr0/bridge/NAT ကွာခြားချက် နားလည်ပြီး မှတ်တမ်းတင်ခြင်း  
**How:** Lab မေးခွန်းများမှ ရှင်းလင်းချက်  
**Result:** virbr0 သာ GNS3 NAT cloud မှာ သုံးရမယ်ဆိုတာ confirm ဖြစ်တယ်  
**Next:** virbr0 ကို GNS3 NAT cloud မှာ ထည့်ပြီး bank-web internet access ရယူ → Cowrie install ဆက်လုပ်

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
Kali → bank-web (real LAN IP ရတယ်) → Home Router, NAS, PC တွေ ← အန္တရာယ်
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
**What:** Cowrie honeypot ကို system မှ ဖြုတ်ပြီး bank-web + customer-db + aegis VM သုံးခုနဲ့ attack/defense test စတင်ရန် ပြင်ဆင်  
**How:** auto-defense rules + system status sensors မှ Cowrie ဖြုတ်လိုက်တယ်  
**Result:** System clean ဖြစ်ပြီ၊ Cowrie မပါဘဲ core sensors တွေနဲ့ attack/defense test ဆင်းလို့ ရပြီ  
**Next:** Kali ကနေ attack စမ်း → dashboard မှာ detect ဖြစ်မဖြစ် + auto-defense trigger မဖြစ် စစ်

---

### ဖြုတ်လိုက်တဲ့ Cowrie items

| File | ဖြုတ်လိုက်တာ |
|---|---|
| `auto-defense.ts` | Cowrie Honeypot Touch rules ၂ ခု (bank-web + customer-db) |
| `routes/system.ts` | Cowrie Honeypot sensor ၂ ခု (bank-web + customer-db) |

`/api/ingest/cowrie` endpoint တော့ ကျန်ထားတယ် — ဖျက်မထားဘူး (နောက်မှ လိုချင်ရင် ပြန်သုံးလို့ရ)

---

### Current System — Attack/Defense Test အတွက် လုံလောက်မလား

**✅ လုံလောက်တယ်** — core attack scenarios အားလုံး cover ဖြစ်နေတယ်

#### Active Sensors (VM ၃ ခု)

**bank-web (10.10.10.10)**
| Sensor | ဖမ်းတာ |
|---|---|
| Suricata IDS | Port scan, DDoS, SQLi, XSS, TLS anomaly |
| Fail2ban | SSH/FTP brute force |
| SSH Monitor | SSH login success/fail |
| FTP Monitor | FTP sessions |
| Apache Monitor | Web attacks (ModSecurity/WAF) |

**customer-db (10.20.20.20)**
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
| Port scan | nmap | bank-web / customer-db | Suricata |
| SSH brute force | hydra | bank-web / customer-db / aegis | Fail2ban + SSH Monitor |
| Web attack (SQLi/XSS) | sqlmap / curl | bank-web | Suricata + Apache Monitor |
| FTP brute force | hydra | bank-web | Fail2ban + FTP Monitor |
| DDoS / SYN flood | hping3 | bank-web | Suricata |
| DB attack | hydra / sqlmap | customer-db | PostgreSQL Monitor + Suricata |

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
**Result:** Kali internet ✅, bank-web ping ✅, real-world topology ✅  
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

*Last updated: 2026-07-19*

---

## 2026-07-19 — OVS Switch VLAN Setup + pfSense VLAN Sub-Interface + Firewall Rules

**Status:** ✅ Done  
**What:** GNS3 topology မှာ OVS switch ၂ ခု (Public-Services, Internal-Services) ထည့်ပြီး VLAN 10/20 ခွဲ၊ pfSense VLAN sub-interface config လုပ်၊ firewall rules ထည့်ကာ attacker → internal network block လုပ်  
**Result:** Kali → bank-web ✅ reach ရ၊ Kali → customer-db ❌ pfSense block ဖြစ် — VLAN separation အလုပ်လုပ်တယ်

---

### Topology ပြောင်းလဲချက် (v3 → v3.1)

| မူလ | ခု |
|---|---|
| pfSense e1 တိုက်ရိုက် bank-web | pfSense e1 → Public-Services OVS → bank-web |
| pfSense e2 တိုက်ရိုက် customer-db | pfSense e2 → Internal-Services OVS → customer-db |
| pfSense em1: plain interface | pfSense em1.10: VLAN 10 sub-interface |
| pfSense em2: plain interface | pfSense em2.20: VLAN 20 sub-interface |

**ရည်ရွယ်ချက်:** OVS switch က L2 VLAN ခွဲ၊ pfSense firewall rule က L3 access control လုပ် — attacker က Public zone (bank-web) ကို attack လုပ်လို့ရ၊ Internal zone (customer-db) ကို access မရအောင် ကာကွယ်

---

### Step 1 — OVS-Public Switch Config (VLAN 10)

**GNS3 → Public-Services node → Console**

```bash
# br0 နဲ့ port တွေ auto-created ဖြစ်နေတယ် — add-br / add-port မလုပ်ရဘူး
# set သာ လုပ်ရမယ်

ovs-vsctl set port eth0 vlan-mode=trunk trunks=10   # pfSense ဘက် — trunk
ovs-vsctl set port eth1 vlan-mode=access tag=10      # bank-web ဘက် — access VLAN 10
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
ovs-vsctl set port eth1 vlan-mode=access tag=20      # customer-db ဘက် — access VLAN 20
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
| BANK_WEB | `VLAN 20 on em2 - opt1 (INTERNAL)` |
| CUSTOMER_DB | `em3` (မပြောင်းဘူး — aegis management) |

Save → Apply Changes

**Interface IPs (ကျန်တူတူပဲ):**
- LAN (em1.10): `10.10.10.1/24`
- BANK_WEB (em2.20): `10.20.20.1/24`
- CUSTOMER_DB (em3): `10.30.30.1/24`

---

### Step 5 — Firewall Rules

**Firewall → Rules → WAN → + Add**

| Rule | Action | Protocol | Source | Destination | Description |
|---|---|---|---|---|---|
| 1 | Block | **Any** | * | `10.20.20.0/24` | Block attacker from Internal |
| 2 | Pass | **Any** | * | `10.10.10.0/24` | Allow attacker to bank-web |

Apply Changes

> ⚠️ **Protocol = Any** ဖြစ်ရမယ် — TCP သာ ထားရင် ICMP (ping) မဖြတ်ဘူး၊ ALLOW rule ကို bypass ဖြစ်မသွားဘူး

---

### Step 6 — VM Gateway Verify

**bank-web:**
```bash
ip route show | grep default
# default via 10.10.10.1 dev ens3 ← ✅
```

**customer-db:**
```bash
ip route show | grep default
# default via 10.20.20.1 ← ✅
```

---

### Step 7 — Final Verification

**Kali ကနေ test:**
```bash
ping -c 3 10.10.10.10   # bank-web   → ✅ reach ရ (ALLOW rule)
ping -c 3 10.20.20.20   # customer-db → ❌ blocked (BLOCK rule)
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
    │                   └─ bank-web (10.10.10.10)    ← attack target ✅
    │
    └─ BLOCK ──► pfSense em2.20 (VLAN 20)
                    └─ OVS-Internal (trunk eth0 / access eth1)
                        └─ customer-db (10.20.20.20)  ← protected ❌
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
- pfSense WAN tab မှာ BLOCK INTERNAL rule ထည့်ထားသော်လည်း Kali ကနေ `ping 10.20.20.20` (customer-db) ကို ဖြတ်သန်းနေတယ်

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
- `ping 10.10.10.10` → ✅ Reply (bank-web reach ရတယ်)
- `ping 10.20.20.20` → ❌ Blocked (customer-db ကာကွယ်ပြီး)

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
│   ├── bank-web      10.10.10.10  ✅ Done
│   ├── dns-server    10.10.10.20  📋 Planned
│   └── mail-mx       10.10.10.30  📋 Planned
│
├── VLAN 20 — Internal (10.20.20.0/24)        ← Staff only, internet block
│   ├── customer-db   10.20.20.10  ✅ Done
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
| bank-web | ✅ | ✅ | ✅ (ရှိပြီး) |
| customer-db | ✅ | ✅ | ✅ (ရှိပြီး) |
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
Public-Switch  → bank-web (10.10.10.10) + dns-server (10.10.10.20)
Internal-Switch → customer-db (10.20.20.10) + atm-server (10.20.20.20)
MGMT (direct)  → aegis-forwarder (10.30.30.10)
```

**Code changes:**
- `system.ts` — customer-db IP `.20`→`.10`, DNS/ATM sensor rows ထည့်, obsolete hostIP purge
- `auto-defense.ts` — DNS/ATM SSH brute force rules ထည့်, DNS attack rule ထည့်
- `host-utils.tsx` — atm-server/dns-server generic labels ထည့်
- `attack-flow.tsx` — dns-server/atm-server nodes + edges ထည့်, customer-db IP fix
- `setup.tsx` — topology diagram, IP assignments, pfSense interfaces, VM table update

**Next (GNS3 side):**
- DNS-Server: OVS port `tag=10` → netplan `10.10.10.20/24` → BIND9 install
- customer-db: netplan IP `10.20.20.20`→`10.20.20.10` → netplan apply
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

## 2026-07-20 — Topology v4 Final — OVS Switches + DNS + LDAP + customer-db IP Change

**Status:** ✅ Done  
**What:** GNS3 lab topology ကို v3 မှ v4 (Final) သို့ upgrade လုပ်ခဲ့သည်။ OVS switch ၂ ခု ထည့်ပြီး DNS-Server (10.10.10.20) + LDAP-Server (10.20.20.20) VM အသစ် ၂ ခု ထည့်သည်။ customer-db IP ကို 10.20.20.20 မှ 10.20.20.10 သို့ ပြောင်းသည်။  
**How:** GNS3 GUI မှ node ထည့်၊ OVS console မှ VLAN tag configure၊ docs အားလုံး v4 update  
**Result:** v4 topology active ဖြစ်ပြီ — GNS3 lab ဓာတ်ပုံ confirm ဖြစ်တယ်  
**Next:** DNS-Server (BIND9) + LDAP-Server (OpenLDAP) services install + aegis_forwarder.py hub mode မှာ new VMs ထည့် configure

---

### v4 Topology Changes Summary

| Change | v3 | v4 |
|---|---|---|
| customer-db IP | 10.20.20.20 | **10.20.20.10** |
| DNS-Server | မရှိ | **10.10.10.20** (DMZ) |
| LDAP-Server | မရှိ | **10.20.20.20** (Internal) |
| DMZ switch | မရှိ | **Public-Services OVS Switch** |
| Internal switch | မရှိ | **Internal-Services OVS Switch** |
| aegis VM name | aegis-forwarder | **aegis-ADMIN** |
| Forwarder targets | bank-web + customer-db | bank-web + DNS + customer-db + LDAP |

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
| bank-web | **10.10.10.10** | DMZ |
| DNS-Server | **10.10.10.20** | DMZ (NEW) |
| customer-db | **10.20.20.10** | Internal (IP ပြောင်း) |
| LDAP-Server | **10.20.20.20** | Internal (NEW) |
| aegis-ADMIN | **10.30.30.10** | MGMT |

### OVS Switch VLAN Config

```bash
# Public-Services Switch
ovs-vsctl set port eth1 tag=10   # bank-web
ovs-vsctl set port eth2 tag=10   # DNS-Server

# Internal-Services Switch
ovs-vsctl set port eth1 tag=20   # customer-db
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
**What:** atm-server → ldap-server ပြောင်းထားတဲ့ v4 topology ကို code တွေမှာ sync လုပ်ပြီး DB health check ထည့်
**How:**
- `attack-flow.tsx` — `atmserver` node → `ldapserver` (OpenLDAP · slapd, 10.20.20.20); EDGES + getAttackPath routing update
- `setup.tsx` — atm-server ရှိသမျှ → ldap-server; slapd install commands ထည့်
- `host-utils.tsx` — GENERIC_LABELS မှာ `ldap-server` ထည့်
- `auto-defense.ts` — SSH brute force rule `atm-server` → `ldap-server` (targetVm ပါ)
- `routes/health.ts` — `/api/healthz` မှာ real DB ping (`SELECT 1`) ထည့်; DB down ဆိုရင် 503 + `{ status: "degraded", db: "error" }` return
**Result:** API server build ✅, both workflows running; health endpoint DB-aware ဖြစ်သွား
**Next:** aegis_forwarder.py မှာ ldap-server (slapd) log watcher ထည့်ရမယ်

---

### [2026-07-20] — pfSense Suricata Custom Rules + Rules Tab Guide

**Status:** ✅ Done
**What:** pfSense Suricata "Rules tab မတွေ့" ပြဿနာ ဖြေရှင်း; complete custom rules ထည့်
**How:** `docs/commands/pfsense-suricata.md` Step 5b အသစ် ထည့် —
- Rules tab navigation: Interfaces → em1 row → ✏️ Edit icon → Rules tab → Custom Rules textarea
- AEGIS lab custom rules ၈ ခု (sid:9000001–9000008): Nmap scan, SSH brute, SQLi, XSS, SYN flood, DNS amp, LDAP brute, FTP brute
**Result:** docs push ✅ to GitHub main
**Next:** em1 + em2 interfaces ၂ ခုလုံးမှာ custom rules paste ပြီး restart လုပ်ပြီး eve.json ထဲ AEGIS signatures ပေါ်လာတာ စစ်ရမယ်
