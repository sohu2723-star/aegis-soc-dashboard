# AEGIS-SecureBank — Project Book

> **ဖတ်သူ:** ဆရာမ၊ lab partner များ၊ future AEGIS team  
> **ရည်ရွယ်ချက်:** ဒီ document တစ်ခုဖတ်ပြီးရင် ဘာမှ မေးစရာမလိုဘဲ lab တစ်ခုလုံး operate လုပ်နိုင်ရမည်  
> **Last Updated:** 2026-07-20

---

## မာတိကာ

1. [Project ဘာလဲ](#1-project-ဘာလဲ)
2. [Network Topology ရှင်းလင်းချက်](#2-network-topology-ရှင်းလင်းချက်)
3. [Network တစ်ခုချင်းစီ ဘာအတွက်လဲ](#3-network-တစ်ခုချင်းစီ-ဘာအတွက်လဲ)
4. [Router MikroTik — Full Config](#4-router-mikrotik--full-config)
5. [Kali Attacker VM Config](#5-kali-attacker-vm-config)
6. [pfSense Config](#6-pfsense-config)
7. [Bank VMs Config](#7-bank-vms-config)
8. [AEGIS Forwarder (Hub)](#8-aegis-forwarder-hub)
9. [Dashboard + API](#9-dashboard--api)
10. [Attack Flow — အစမှ အဆုံး](#10-attack-flow--အစမှ-အဆုံး)
11. [Defense Flow — Auto Block](#11-defense-flow--auto-block)
12. [Common Operations](#12-common-operations)
13. [Troubleshooting](#13-troubleshooting)

---

## 1. Project ဘာလဲ

**AEGIS-SecureBank** ဆိုတာ GNS3 မှာ တည်ဆောက်ထားတဲ့ **real-device Red/Blue team cybersecurity lab** ဖြစ်တယ်။

```
[Kali Attacker]  →  [Router]  →  [pfSense]  →  [Bank VMs]
                                                     ↓
                                              [AEGIS Forwarder]
                                                     ↓
                                            [Render API Server]
                                                     ↓
                                          [Vercel Dashboard] + [Telegram]
```

**Replit ရဲ့ role:** Code editor သာဖြစ်တယ်။ Simulation မဟုတ်ဘူး — GNS3 VM တွေမှာ real attack/defense ဖြစ်တယ်။

**Production URLs:**
| Layer | URL |
|---|---|
| Dashboard | https://aegis-soc-dashboard-aegis-dashboard.vercel.app |
| API Server | https://aegis-api-server-jp3b.onrender.com |
| Database | Supabase PostgreSQL (pooler port 6543) |

---

## 2. Network Topology ရှင်းလင်းချက်

### Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│  Real Internet                                                      │
│  (GNS3 Host KVM — virbr0 bridge: 192.168.122.1)                    │
└──────────────────────┬──────────────────────────────────────────────┘
                       │ direct cable
                       │
          ┌────────────▼─────────────┐
          │   Router (MikroTik CHR)  │
          │  ether1: 192.168.122.2   │ ← internet side
          │  ether2: 192.168.10.1    │ ← kali side (DHCP server)
          │  ether3: 10.0.23.1       │ ← pfSense WAN link
          └──────┬──────────┬────────┘
                 │          │
      direct cable          │ direct cable
                 │          │
    ┌────────────▼──┐    ┌──▼───────────────────────────────────┐
    │ Kali Attacker │    │ pfSense 2.7.2 (Firewall)             │
    │ DHCP 192.168. │    │ WAN:         10.0.23.2/30            │
    │ 10.x (dynamic)│    │ BANK_WEB:    10.10.10.1/24           │
    └───────────────┘    │ CUSTOMER_DB: 10.20.20.1/24           │
                         │ MGMT:        10.30.30.1/24           │
                         └──────────────────┬───────────────────┘
                                            │
               ┌────────────────────────────┼──────────────────┐
               │                            │                  │
    ┌──────────▼──────────┐   ┌─────────────▼──────┐  ┌───────▼──────────┐
    │  Public-Svc Switch  │   │ Internal-Svc Switch │  │ Direct cable     │
    │                     │   │                     │  │                  │
    │  ┌──────────────┐   │   │  ┌──────────────┐   │  │ ┌──────────────┐ │
    │  │  bank-web    │   │   │  │ customer-db  │   │  │ │    aegis-    │ │
    │  │ 10.10.10.10  │   │   │  │ 10.20.20.20  │   │  │ │  forwarder  │ │
    │  │ Apache,FTP   │   │   │  │  PostgreSQL  │   │  │ │ 10.30.30.10 │ │
    │  │ Suricata     │   │   │  │  Suricata    │   │  │ │  Hub Agent  │ │
    │  │ Fail2ban     │   │   │  │  Fail2ban    │   │  │ └──────────────┘ │
    │  └──────────────┘   │   │  └──────────────┘   │  └──────────────────┘
    └─────────────────────┘   └─────────────────────┘
```

### IP Summary Table

| Device | Interface | IP Address | Network |
|---|---|---|---|
| Router | ether1 | 192.168.122.2/24 | Internet (virbr0) |
| Router | ether2 | 192.168.10.1/24 | Kali subnet |
| Router | ether3 | 10.0.23.1/30 | pfSense WAN link |
| Kali | eth0 | DHCP 192.168.10.x | Kali subnet (pool .2–.100) |
| pfSense | WAN (e0) | 10.0.23.2/30 | WAN link |
| pfSense | BANK_WEB (e1) | 10.10.10.1/24 | DMZ |
| pfSense | CUSTOMER_DB (e2) | 10.20.20.1/24 | Internal |
| pfSense | MGMT (e3) | 10.30.30.1/24 | Management |
| bank-web | eth0 | 10.10.10.10/24 | DMZ |
| customer-db | eth0 | 10.20.20.20/24 | Internal |
| aegis-forwarder | eth0 | 10.30.30.10/24 | Management |

---

## 3. Network တစ်ခုချင်းစီ ဘာအတွက်လဲ

### 192.168.122.0/24 — Internet Path (virbr0)

```
ဘာလဲ:   GNS3 host Linux ရဲ့ KVM virtual bridge (virbr0) network
ဘာအတွက်: Router ether1 ← ဒီကတဆင့် real internet ထွက်တယ်
          Bank VMs → pfSense → Router ether3 → Router ether1 → virbr0 → internet
Gateway:  192.168.122.1 (GNS3 host bridge)
```

**ဥပမာ route:**
```
bank-web wants to ping 8.8.8.8
→ 10.10.10.1 (pfSense) → 10.0.23.1 (Router ether3) → 192.168.122.1 (internet) → 8.8.8.8 ✅
```

---

### 192.168.10.0/24 — Kali Attacker Subnet

```
ဘာလဲ:   Router ether2 မှာ DHCP server ထားထားတဲ့ attacker-only network
ဘာအတွက်: Kali ကို "outside attacker" အဖြစ် simulate ဖို့
          Router = border router အဖြစ် Kali ↔ pfSense ကြား နေတယ်
Gateway:  192.168.10.1 (Router ether2)
DHCP:     192.168.10.2 – 192.168.10.100
```

**Real-world simulation:**
```
ဒီ topology မှာ Kali က "internet ကနေ လာတဲ့ attacker" ကိုကိုယ်စားပြုတယ်
Switch မသုံးဘဲ Router ether2 နဲ့ တိုက်ရိုက်ချိတ် → border router ဖြတ်ပြီး attack
Kali ရဲ့ IP ကို source IP အဖြစ် Suricata/Fail2ban မြင်တယ် → auto-block ဖြစ်နိုင်တယ်
```

---

### 10.0.23.0/30 — Router ↔ pfSense WAN Link

```
ဘာလဲ:   Point-to-point /30 link (host 2 ခုသာ)
ဘာအတွက်: Router ether3 ← → pfSense WAN တိုက်ရိုက်ချိတ်
.1 = Router (upstream gateway)
.2 = pfSense WAN
```

---

### 10.10.10.0/24 — DMZ (BANK_WEB Zone)

```
ဘာလဲ:   Publicly accessible services zone
VMs:     bank-web (10.10.10.10) — Apache, vsftpd, SSH
         Attacker attack target ဖြစ်တယ်
Gateway: 10.10.10.1 (pfSense BANK_WEB interface)
```

---

### 10.20.20.0/24 — Internal (CUSTOMER_DB Zone)

```
ဘာလဲ:   Internal private network zone
VMs:     customer-db (10.20.20.20) — PostgreSQL, SSH
         DMZ ကတဆင့် lateral movement target
Gateway: 10.20.20.1 (pfSense CUSTOMER_DB interface)
```

---

### 10.30.30.0/24 — Management (MGMT Zone)

```
ဘာလဲ:   Monitoring/management network
VMs:     aegis-forwarder (10.30.30.10) — Hub agent
         Bank VMs တွေထဲ SSH ဝင်ပြီး logs ဆွဲတယ်
Gateway: 10.30.30.1 (pfSense MGMT interface)
```

---

## 4. Router MikroTik — Full Config

### Complete Setup Commands (ကုန်)

```routeros
# ── Step 1: IP Addresses ──────────────────────────────────────
/ip address add address=192.168.122.2/24 interface=ether1 comment="Internet virbr0"
/ip address add address=192.168.10.1/24  interface=ether2 comment="Kali attacker network"
/ip address add address=10.0.23.1/30     interface=ether3 comment="pfSense WAN link"

# ── Step 2: Default Route (internet) ──────────────────────────
/ip route add dst-address=0.0.0.0/0  gateway=192.168.122.1 comment="Internet GW"

# ── Step 3: Internal Route (bank VMs via pfSense) ──────────────
/ip route add dst-address=10.0.0.0/8 gateway=10.0.23.2     comment="Bank zones via pfSense"

# ── Step 4: NAT masquerade (internet out via ether1) ───────────
/ip firewall nat add chain=srcnat action=masquerade out-interface=ether1

# ── Step 5: Forward filter (allow all forwarded) ───────────────
/ip firewall filter add chain=forward action=accept place-before=0

# ── Step 6: DHCP Server for Kali (ether2) ─────────────────────
/ip pool add name=kali-pool ranges=192.168.10.2-192.168.10.100
/ip dhcp-server add name=kali-dhcp interface=ether2 address-pool=kali-pool disabled=no
/ip dhcp-server network add address=192.168.10.0/24 gateway=192.168.10.1 dns-server=8.8.8.8
```

### Verify Commands

```routeros
/ip address print          # interfaces + IPs စစ်
/ip route print            # routes စစ်
/ip dhcp-server print      # DHCP server စစ်
/ip dhcp-server lease print # Kali ကို IP ဘာပေးထားလဲ
/ip firewall nat print     # masquerade စစ်
/ip firewall filter print  # forward filter စစ်

/ping 192.168.122.1        # internet gateway ပင်
/ping 8.8.8.8              # internet ပင် (success = internet ရနေ)
/ping 10.0.23.2            # pfSense WAN ပင်
```

### DHCP IP ပြောင်းချင်ရင် (Kali ကို IP အသစ်ပေးဖို့)

```routeros
# Router မှာ lease ဖျက်
/ip dhcp-server lease remove [find]
```
```bash
# Kali မှာ renew
sudo dhclient -r eth0
sudo dhclient eth0
ip a show eth0   # IP အသစ် စစ်
```

---

## 5. Kali Attacker VM Config

### Persistent Network Config (/etc/network/interfaces)

```bash
sudo nano /etc/network/interfaces
```
```
auto eth0
iface eth0 inet dhcp
    post-up ip route add 10.0.0.0/8 via 192.168.10.1 || true
```
```bash
sudo systemctl restart networking
```

**ဘာဖြစ်တာလဲ:**
- `inet dhcp` → Router ether2 ကနေ IP auto ရတယ်
- `post-up` → restart တိုင်း bank VM route auto ပြန်ထည့်တယ်
- `|| true` → route ရှိပြီးသားဆိုရင် error မဖြစ်ဘဲ ကျော်သွားတယ်

### Verify

```bash
ip a show eth0              # DHCP IP စစ် (192.168.10.x ဖြစ်ရမည်)
ip route show               # routes စစ်
ping -c 2 192.168.10.1      # Router gateway ပင်
ping -c 2 8.8.8.8           # Internet ပင်
ping -c 2 10.10.10.10       # bank-web ပင် (pfSense static route ထည့်ပြီးမှ)
```

---

## 6. pfSense Config

pfSense ဟာ lab ရဲ့ main firewall ဖြစ်တယ်။ Kali ↔ Bank VMs ကြားမှာ ကြားခံနေတယ်။

### Interface Assignment (Console Option 1)

```
WAN         → vtnet0 (e0)   IP: 10.0.23.2/30      GW: 10.0.23.1
BANK_WEB    → vtnet1 (e1)   IP: 10.10.10.1/24
CUSTOMER_DB → vtnet2 (e2)   IP: 10.20.20.1/24
MGMT        → vtnet3 (e3)   IP: 10.30.30.1/24
```

### Required Settings (WebGUI: http://10.0.23.2)

**1. Default Gateway**
```
System → Routing → Gateways
  Default IPv4: WANGW (10.0.23.1)
```

**2. WAN Interface Settings**
```
Interfaces → WAN
  ☐ Block private networks (uncheck)
  ☐ Block bogon networks (uncheck)
```

**3. Static Route for Kali return path** ← ဒါမပါဘဲ Kali က bank ping မရဘူး
```
System → Routing → Static Routes → Add
  Network:     192.168.10.0/24
  Gateway:     WANGW (10.0.23.1)
  Description: Return path to Kali attacker subnet
```

**4. WAN Firewall Rule** ← ဒါမပါဘဲ pfSense က Kali traffic block တယ်
```
Firewall → Rules → WAN → Add
  Action:      Pass
  Protocol:    Any
  Source:      192.168.10.0/24
  Destination: any
  Description: Allow Kali attacker subnet
```

---

## 7. Bank VMs Config

### bank-web (10.10.10.10) — Ubuntu Server

**Netplan config:**
```yaml
# /etc/netplan/00-installer-config.yaml
network:
  ethernets:
    ens3:
      addresses: [10.10.10.10/24]
      routes:
        - to: default
          via: 10.10.10.1
      nameservers:
        addresses: [8.8.8.8]
  version: 2
```
```bash
sudo netplan apply
```

**Services installed:**
```bash
sudo apt install -y apache2 php libapache2-mod-php php-mysql \
    vsftpd suricata fail2ban openssh-server
```

**Suricata config (forward logs to AEGIS):**
```
/etc/suricata/suricata.yaml
  outputs → eve-log → types: [alert, http, ssh, ftp]
  eve-log → filename: /var/log/suricata/eve.json
```

---

### customer-db (10.20.20.20) — Ubuntu Server

**Netplan config:**
```yaml
network:
  ethernets:
    ens3:
      addresses: [10.20.20.20/24]
      routes:
        - to: default
          via: 10.20.20.1
      nameservers:
        addresses: [8.8.8.8]
  version: 2
```

**Services:**
```bash
sudo apt install -y postgresql suricata fail2ban openssh-server
```

---

### aegis-forwarder (10.30.30.10) — Hub Agent VM

**Netplan config:**
```yaml
network:
  ethernets:
    ens3:
      addresses: [10.30.30.10/24]
      routes:
        - to: default
          via: 10.30.30.1
      nameservers:
        addresses: [8.8.8.8]
  version: 2
```

**ဒီ VM ရဲ့ role:** bank-web နဲ့ customer-db ထဲ SSH ဝင်ပြီး logs real-time ဆွဲပြီး Render API ကို POST လုပ်တယ်

---

## 8. AEGIS Forwarder (Hub)

### Install

```bash
# Dependencies
sudo apt update && sudo apt install -y python3-pip python3-requests openssh-client

# Script download
sudo mkdir -p /opt/aegis/scripts/src
cd /opt/aegis/scripts/src
wget -O aegis_forwarder.py \
  https://raw.githubusercontent.com/sohu2723-star/aegis-soc-dashboard/main/scripts/src/aegis_forwarder.py

# Config (gitignored — manual create)
wget -O aegis_forwarder.local.conf.example \
  https://raw.githubusercontent.com/sohu2723-star/aegis-soc-dashboard/main/scripts/src/aegis_forwarder.local.conf.example
cp aegis_forwarder.local.conf.example aegis_forwarder.local.conf
nano aegis_forwarder.local.conf
```

### Config File

```ini
# aegis_forwarder.local.conf
AEGIS_URL=https://aegis-api-server-jp3b.onrender.com/api
AEGIS_KEY=your-ingest-key-here
AEGIS_ADMIN_KEY=your-admin-key-here
```

### SSH Key Setup (bank VMs ထဲ ဝင်ဖို့)

```bash
# AEGIS VM မှာ key generate
ssh-keygen -t ed25519 -C "aegis-hub" -f ~/.ssh/aegis_hub -N ""

# bank-web ထဲ key ကူး
ssh-copy-id -i ~/.ssh/aegis_hub.pub bankadmin@10.10.10.10

# customer-db ထဲ key ကူး
ssh-copy-id -i ~/.ssh/aegis_hub.pub bankadmin@10.20.20.20

# Test
ssh -i ~/.ssh/aegis_hub bankadmin@10.10.10.10 "echo connected"
```

### Systemd Service

```bash
# /etc/systemd/system/aegis-forwarder.service
sudo nano /etc/systemd/system/aegis-forwarder.service
```
```ini
[Unit]
Description=AEGIS Log Forwarder (Hub Mode)
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/opt/aegis/scripts/src
ExecStart=/usr/bin/python3 aegis_forwarder.py
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```
```bash
sudo systemctl daemon-reload
sudo systemctl enable --now aegis-forwarder
sudo systemctl status aegis-forwarder
```

### Script Update (git pull မသုံးနဲ့ — Ubuntu VM မှာ အလုပ်မလုပ်)

```bash
# Correct way: wget from GitHub raw URL
cd /opt/aegis/scripts/src
sudo wget -O aegis_forwarder.py \
  https://raw.githubusercontent.com/sohu2723-star/aegis-soc-dashboard/main/scripts/src/aegis_forwarder.py
sudo systemctl restart aegis-forwarder
```

---

## 9. Dashboard + API

### API Endpoints (Render)

**Health Check:**
```bash
curl https://aegis-api-server-jp3b.onrender.com/api/health
# → {"status":"ok"}
```

**Manual Event Ingest:**
```bash
curl -X POST https://aegis-api-server-jp3b.onrender.com/api/ingest/ssh \
  -H "Content-Type: application/json" \
  -H "X-AEGIS-Key: your-ingest-key" \
  -d '{"src_ip":"192.168.10.99","username":"root","status":"failed","failures":10}'
```

**Manual IP Block (Admin):**
```bash
curl -X POST https://aegis-api-server-jp3b.onrender.com/api/defense/block \
  -H "Content-Type: application/json" \
  -H "X-AEGIS-Admin-Key: your-admin-key" \
  -d '{"ip":"192.168.10.99","reason":"manual block","vm":"bank-web"}'
```

**Pending Defense Commands (VM poll):**
```bash
curl "https://aegis-api-server-jp3b.onrender.com/api/defense/commands/pending?vm=bank-web" \
  -H "X-AEGIS-Key: your-ingest-key"
```

### Dashboard Pages

| Page | URL path | ဘာမြင်ရလဲ |
|---|---|---|
| Overview | / | Live stats, incidents, blocked IPs |
| Security Events | /events | Real-time log stream |
| Defense Center | /defense-rules | Active blocks, rules |
| Connections | /connections | Network hosts map |
| Threat Map | /threat-map | Live attack animation |
| Setup Guide | /setup | Lab setup instructions |

---

## 10. Attack Flow — အစမှ အဆုံး

### ဥပမာ — Kali က bank-web ကို SSH brute force

```
Step 1: Kali မှာ attack run
──────────────────────────
hydra -l root -P /usr/share/wordlists/rockyou.txt ssh://10.10.10.10

Step 2: bank-web မှာ Fail2ban မြင်
──────────────────────────────────
/var/log/auth.log မှာ failed login တွေပြ
Fail2ban: SSH_BRUTE trigger → log ရေး

Step 3: aegis-forwarder SSH tail
────────────────────────────────
aegis-forwarder → SSH into bank-web → tail /var/log/auth.log + /var/log/suricata/eve.json
→ POST to https://aegis-api-server-jp3b.onrender.com/api/ingest/ssh

Step 4: API Server process
──────────────────────────
evaluateEvent() → count failures > threshold
→ auto_defense_engine → insert defense_command to DB
→ SSE broadcast → Dashboard update (real-time)

Step 5: Dashboard show
──────────────────────
Security Events page: SSH brute force event (red)
Defense Center: Auto-block pending for 192.168.10.99

Step 6: aegis-forwarder poll + execute
──────────────────────────────────────
GET /api/defense/commands/pending?vm=bank-web
→ iptables -I INPUT -s 192.168.10.99 -j DROP  (Kali blocked)
→ POST /api/defense/commands/{id}/done

Step 7: Telegram notify
───────────────────────
"🛡 AEGIS blocked 192.168.10.99 — SSH brute force (12 attempts)"
```

---

## 11. Defense Flow — Auto Block

### Trigger Thresholds (API Server config)

| Attack Type | Threshold | Action |
|---|---|---|
| SSH brute force | 5 failures / 60s | Block source IP |
| FTP brute force | 5 failures / 60s | Block source IP |
| Port scan (Suricata ET SCAN) | 1 event | Block source IP |
| Web attack (SQLi/XSS) | 3 events | Block source IP |
| Honeypot hit | 1 event | Immediate block |
| DDoS/SYN flood | Suricata alert | Block source IP |

### Manual Block/Unblock

```bash
# Dashboard ကနေ — Defense Center → Block IP button

# API ကနေ (block)
curl -X POST https://aegis-api-server-jp3b.onrender.com/api/defense/block \
  -H "X-AEGIS-Admin-Key: YOUR_ADMIN_KEY" \
  -H "Content-Type: application/json" \
  -d '{"ip":"192.168.10.99","reason":"test","vm":"bank-web"}'

# API ကနေ (unblock)
curl -X POST https://aegis-api-server-jp3b.onrender.com/api/defense/unblock \
  -H "X-AEGIS-Admin-Key: YOUR_ADMIN_KEY" \
  -H "Content-Type: application/json" \
  -d '{"ip":"192.168.10.99","vm":"bank-web"}'

# bank-web မှာ local iptables စစ်
sudo iptables -L INPUT -n --line-numbers
sudo iptables -D INPUT -s 192.168.10.99 -j DROP  # manual remove
```

---

## 12. Common Operations

### GNS3 Lab Start Sequence

```
1. GNS3 ဖွင့်
2. Topology load → Start all nodes
3. Wait ~60s (pfSense boot time)
4. Router config စစ်: /ip address print
5. Kali DHCP စစ်: ip a show eth0
6. Connectivity test: ping 10.10.10.10 (from Kali)
7. AEGIS forwarder: systemctl status aegis-forwarder
8. API health: curl .../api/health
9. Dashboard ဖွင့်ပြီး events check
```

### Kali Session Start

```bash
# IP စစ် (DHCP ရပြီလား)
ip a show eth0

# IP မရသေးရင် force request
sudo dhclient eth0

# Route စစ်
ip route show

# Route မရှိရင်
sudo ip route add 10.0.0.0/8 via 192.168.10.1

# bank-web reachable စစ်
ping -c 2 10.10.10.10

# internet စစ်
ping -c 2 8.8.8.8
```

### Log Locations (Bank VMs)

```bash
# SSH logs
/var/log/auth.log

# Suricata alerts (JSON)
/var/log/suricata/eve.json

# Apache access log
/var/log/apache2/access.log

# FTP log
/var/log/vsftpd.log

# Fail2ban log
/var/log/fail2ban.log

# Watch live
sudo tail -f /var/log/suricata/eve.json | jq '.event_type'
```

---

## 13. Troubleshooting

### Kali IP မရဘူး (DHCP fail)

```
ဒါကြည့်: MikroTik မှာ
/ip dhcp-server print   → address-pool column စစ်

"static-only" ပြနေရင်:
/ip dhcp-server set 0 address-pool=kali-pool disabled=no

Kali မှာ dhclient မရှိရင်:
sudo apt install isc-dhcp-client -y
sudo dhclient eth0
```

### Kali က bank-web ping မရဘူး

```
1. Router route စစ်: /ip route print   → 10.0.0.0/8 via 10.0.23.2 ရှိမရှိ
2. pfSense static route စစ်: 192.168.10.0/24 via 10.0.23.1 ထည့်ထားမထားစစ်
3. pfSense WAN rule စစ်: 192.168.10.0/24 allow rule ရှိမရှိ
4. pfSense WAN interface: "block private" uncheck လုပ်ထားမထားစစ်
```

### Dashboard event မပြဘူး

```
1. API health: curl .../api/health  → ok?
2. Forwarder status: systemctl status aegis-forwarder
3. Forwarder logs: journalctl -u aegis-forwarder -n 50
4. SSH to bank-web ရမရစစ်: ssh -i ~/.ssh/aegis_hub bankadmin@10.10.10.10
5. Render API cold start? → first request after 15min idle ~50s delay
```

### pfSense WAN block (ping မရ)

```
pfSense WAN interface ကို ping block တာ default ဖြစ်တယ်
→ Firewall → Rules → WAN မှာ rule check
→ Kali traffic (192.168.10.0/24) allow ထည့်ထားရမည်
→ Test from pfSense console (Option 7): ping 192.168.10.x
```

### Render API cold start

```
Free tier → 15min idle ကျရင် sleep ဝင်တယ်
First request = ~50s delay (normal)
ဖြေရှင်းချင်ရင်: Task #3 (keep-alive ping cron) ထည့်
```

---

---

## 14. Future Topology — v4 (Confirmed Plan — 2026-07-20)

> **Status:** 📋 Planned — v3 လက်ရှိ run နေဆဲ၊ v4 ကို phase အလိုက် build မည်
> **ဆုံးဖြတ်ချက်:** VoIP ဖြုတ်ပြီ၊ VM တစ်ခုကို service group တစ်ခု၊ SSH only manage

---

### 14.1 Network Diagram

```
Internet (virbr0 192.168.122.0/24)
              │
         [Router — MikroTik CHR]
          ether1: 192.168.122.2   ← internet
          ether2: 192.168.10.1    ← Kali (DHCP, direct cable)
          ether3: 10.0.23.1       ← pfSense WAN
              │
         [pfSense 2.7.2]
          WAN: 10.0.23.2/30
              │
    ┌─────────┼──────────────────┬──────────┐
    │         │                  │          │
   em1       em2               em3        em4
  VLAN 10  VLAN 20            MGMT      VLAN 40
  Public   Internal           direct      IoT
10.10.10.x 10.20.20.x      10.30.30.x 10.40.40.x
    │           │                │          │
[Pub-SW]   [Int-SW]           aegis    cctv-server
    │           │            10.30.30.10 10.40.40.10
    ├─bank-web  ├─customer-db   (direct)   (direct)
    │ .10       │ .10
    ├─dns       ├─ad-server
    │ .20       │ .20
    └─mail      └─atm-server
      .30         .30
```

---

### 14.2 VLAN ခွဲချက်

| Interface | VLAN | Subnet | Zone | Switch |
|---|---|---|---|---|
| em1 | VLAN 10 | 10.10.10.0/24 | Public (internet-facing) | Public-Switch |
| em2 | VLAN 20 | 10.20.20.0/24 | Internal (staff/bank only) | Internal-Switch |
| em3 | MGMT | 10.30.30.0/24 | Admin (aegis only) | direct cable |
| em4 | VLAN 40 | 10.40.40.0/24 | IoT (CCTV) | direct cable |

> **Switch ဘာကြောင့် ရွေးသုံးသလဲ:**
> VM တစ်ခုထက်ပိုရင် switch ခံ (Public + Internal)
> VM တစ်ခုပဲဆိုရင် direct cable (MGMT, IoT)

---

### 14.3 VM List — IP + Services + RAM

| VM | VLAN | IP | Services | RAM | Connection |
|---|---|---|---|---|---|
| bank-web | 10 | 10.10.10.10 | Apache2, vsftpd, Suricata, Fail2ban | 256MB | Public-Switch |
| dns-server | 10 | 10.10.10.20 | BIND9 | 256MB | Public-Switch |
| mail-server | 10 | 10.10.10.30 | Postfix, Dovecot | 256MB | Public-Switch |
| customer-db | 20 | 10.20.20.10 | PostgreSQL, Suricata, Fail2ban | 256MB | Internal-Switch |
| ad-server | 20 | 10.20.20.20 | Samba4 (Active Directory) | 256MB | Internal-Switch |
| atm-server | 20 | 10.20.20.30 | Python Flask ATM API | 256MB | Internal-Switch |
| cctv-server | 40 | 10.40.40.10 | ffmpeg RTSP + status API | 256MB | direct |
| **aegis** | MGMT | 10.30.30.10 | Hub agent, SSH jump host | **1GB** | direct |
| pfSense | — | 10.0.23.2 | Firewall/Gateway | 1GB | — |
| Router | — | 192.168.122.2 | MikroTik CHR | 256MB | — |
| Kali | — | DHCP 192.168.10.x | Attack tools | 2GB | direct (Router ether2) |
| **စုစုပေါင်း** | | | | **~5.5GB** | |

> **RAM Logic:**
> - aegis = SSH jump host → connection handle လုပ်ရလို့ 1GB
> - ကျန် server VM = SSH only (no GUI) → 256MB လုံလောက်
> - VM အကုန် တပြိုင်တည်း run ရင် ~5.5GB → 15.46GB host RAM ထဲ ချောမွေ့စွာ ဝင်တယ်

---

### 14.4 Public vs Internal Service ခွဲချက်

**Public VLAN 10** — Internet ကနေ reach ရ:

| Service | Port | ဘာသုံးလဲ |
|---|---|---|
| Apache2 (bank-web) | 80, 443 | Customer website |
| vsftpd (bank-web) | 21 | File transfer |
| BIND9 (dns) | 53 | External domain resolve |
| Postfix (mail) | 25 | Internet SMTP (mail ဝင်/ထွက်) |

**Internal VLAN 20** — Staff/Bank only:

| Service | Port | ဘာသုံးလဲ |
|---|---|---|
| PostgreSQL (customer-db) | 5432 | Bank database |
| Samba4 AD (ad-server) | 389, 88, 445 | Staff authentication |
| ATM API (atm-server) | 5000 | ATM transaction |
| Dovecot (mail) | 143, 587 | Staff mailbox (cross-VLAN rule) |
| Apache admin (bank-web) | 8080 | Staff admin panel (cross-VLAN rule) |

> **Public + Internal နှစ်ဘက်လိုတဲ့ service (mail, dns, web):**
> VM က Public VLAN 10 မှာ ထားတယ်
> pfSense firewall rule က port အလိုက် ဘယ် zone ကနေ access ရလဲ သတ်မှတ်တယ်
> VM ကို ရွှေ့စရာမလို — rule ချင်းပဲ

---

### 14.5 Internal Service Connections (Real Bank Logic)

Service တွေ တကယ် interconnect ဖြစ်ရမည် — install ရုံသာမဟုတ်:

```
DNS (bank.local) — အကုန်ရဲ့ အခြေခံ
  → VM တွေအကုန် IP မဟုတ်ဘဲ hostname နဲ့ ဆက်သွယ်
  → web.bank.local, mail.bank.local, db.bank.local ...

Mail → customer-db
  → Staff mailbox account တွေ PostgreSQL (bankmail DB) မှာ သိမ်း
  → Postfix virtual_mailbox_maps = pgsql config

Mail → ad-server
  → Staff တွေ AD domain account နဲ့ mail login ဝင်
  → PAM Kerberos auth

ATM → customer-db
  → Account balance, transaction history — PostgreSQL (bankdb)
  → Real DB query — simulation မဟုတ်

bank-web → ad-server
  → Admin panel login = AD authentication
  → mod_authnz_external

CCTV → status API
  → aegis forwarder က HTTP GET /status နဲ့ stream uptime စစ်
  → Dashboard camera card အတွက်
```

**Internal DNS Records (bank.local):**

```
web.bank.local   → 10.10.10.10
dns.bank.local   → 10.10.10.20
mail.bank.local  → 10.10.10.30
db.bank.local    → 10.20.20.10
ad.bank.local    → 10.20.20.20
atm.bank.local   → 10.20.20.30
cctv.bank.local  → 10.40.40.10
aegis.bank.local → 10.30.30.10
```

---

### 14.6 pfSense Firewall Rules (v4)

| Source | Destination | Port | Action |
|---|---|---|---|
| WAN | 10.10.10.10 (bank-web) | 80, 443, 21 | ✅ Allow |
| WAN | 10.10.10.20 (dns) | 53 | ✅ Allow |
| WAN | 10.10.10.30 (mail) | 25 | ✅ Allow |
| WAN | VLAN 20 (internal) | any | ❌ Block |
| WAN | VLAN 40 (IoT) | any | ❌ Block |
| WAN | MGMT | any | ❌ Block |
| VLAN 20 | 10.10.10.30 (mail) | 143, 587 | ✅ Allow (staff mailbox) |
| VLAN 20 | 10.10.10.10 (bank-web) | 8080 | ✅ Allow (admin panel) |
| VLAN 10 | VLAN 20 | any | ❌ Block (isolation) |
| VLAN 40 | VLAN 20 | any | ❌ Block (IoT isolation) |
| MGMT | any | 22 | ✅ Allow (SSH monitoring) |

---

### 14.7 Aegis SSH Jump Host Setup

v4 မှာ aegis = **SSH jump host** — GNS3 console မဖွင့်ဘဲ laptop ကနေ VM အကုန် manage လုပ်နိုင်:

**ကိုယ့် laptop ~/.ssh/config:**

```
Host aegis
    HostName 10.30.30.10
    User     user
    Port     22

Host bank-web
    HostName  10.10.10.10
    User      user
    ProxyJump aegis

Host dns-server
    HostName  10.10.10.20
    User      user
    ProxyJump aegis

Host mail-server
    HostName  10.10.10.30
    User      user
    ProxyJump aegis

Host customer-db
    HostName  10.20.20.10
    User      user
    ProxyJump aegis

Host ad-server
    HostName  10.20.20.20
    User      user
    ProxyJump aegis

Host atm-server
    HostName  10.20.20.30
    User      user
    ProxyJump aegis

Host cctv-server
    HostName  10.40.40.10
    User      user
    ProxyJump aegis
```

**Usage:**
```bash
ssh bank-web       # laptop → aegis → bank-web (auto jump)
ssh mail-server    # laptop → aegis → mail-server
ssh atm-server     # laptop → aegis → atm-server
```

---

### 14.8 VM Clone Procedure (GNS3)

ရှိပြီးသား VM ကနေ clone ထုတ်ပြီး IP + service ပဲ ပြောင်းရတယ် — fresh install မလို:

```
bank-web     → clone → dns-server    (IP: 10.10.10.20)
bank-web     → clone → mail-server   (IP: 10.10.10.30)
bank-web     → clone → ad-server     (IP: 10.20.20.20)
bank-web     → clone → atm-server    (IP: 10.20.20.30)
bank-web     → clone → cctv-server   (IP: 10.40.40.10)
customer-db  → ရှိပြီး (IP: 10.20.20.10)
```

**GNS3 Clone Steps:**
```
1. bank-web node → Right-click → Clone
2. VM rename လုပ်
3. RAM: 256 MB သတ်မှတ် (Right-click → Configure)
4. Topology မှာ switch/pfSense port နဲ့ cable ချိတ်
5. GNS3 console ကနေ IP + SSH setup (တစ်ကြိမ်ပဲ)
6. ပြီးရင် SSH ကနေပဲ manage
```

**IP သတ်မှတ် (netplan):**
```yaml
# /etc/netplan/00-installer-config.yaml
network:
  ethernets:
    eth0:
      addresses: [10.10.10.20/24]   # ← VM IP ပြောင်း
      gateway4: 10.10.10.1           # ← pfSense interface IP
      nameservers:
        addresses: [10.10.10.20]     # ← dns-server
  version: 2
```

---

### 14.9 Service Install Commands

**bank-web** (ရှိပြီး — Suricata/Fail2ban ထပ် confirm):
```bash
sudo apt install apache2 vsftpd suricata fail2ban -y
sudo systemctl enable apache2 vsftpd suricata fail2ban
sudo systemctl start apache2 vsftpd suricata fail2ban
```

**dns-server:**
```bash
sudo apt install bind9 bind9utils -y
# /etc/bind/named.conf.options → listen-on { any; }; allow-query { any; };
# /etc/bind/db.bank.local → A records အကုန်ထည့်
sudo mkdir -p /var/log/named && sudo chown bind:bind /var/log/named
sudo systemctl enable bind9 && sudo systemctl start bind9
```

**mail-server:**
```bash
sudo apt install postfix dovecot-core dovecot-imapd libpam-krb5 -y
# postfix main.cf → myhostname=mail.bank.local, pgsql virtual_mailbox_maps
# dovecot.conf → protocols = imap, listen = *
sudo systemctl enable postfix dovecot && sudo systemctl start postfix dovecot
```

**customer-db** (ရှိပြီး — DB tables ထပ်ဆောက်):
```sql
-- bankmail DB (mail server အတွက်)
CREATE DATABASE bankmail;
CREATE USER mailuser WITH PASSWORD 'mail@pass';
GRANT ALL ON DATABASE bankmail TO mailuser;

-- bankdb (ATM အတွက်)
CREATE DATABASE bankdb;
CREATE USER atmuser WITH PASSWORD 'atm@pass';
GRANT ALL ON DATABASE bankdb TO atmuser;
\c bankdb
CREATE TABLE accounts (id TEXT PRIMARY KEY, name TEXT, balance NUMERIC);
CREATE TABLE transactions (id SERIAL, account TEXT, amount NUMERIC, type TEXT, ip TEXT, ts TIMESTAMP DEFAULT NOW());
INSERT INTO accounts VALUES ('123456','Ko Mg Mg',5000000),('789012','Ma Aye',3000000);
```

**ad-server:**
```bash
sudo apt install samba krb5-config winbind -y
sudo samba-tool domain provision \
    --use-rfc2307 --domain=BANK --realm=BANK.LOCAL \
    --server-role=dc --dns-backend=SAMBA_INTERNAL \
    --adminpass=Admin@12345
sudo systemctl enable samba-ad-dc && sudo systemctl start samba-ad-dc
# Staff users
sudo samba-tool user create teller Pass@1234
sudo samba-tool user create manager Pass@5678
sudo samba-tool group add Tellers && sudo samba-tool group addmembers Tellers teller
```

**atm-server:**
```bash
sudo apt install python3 python3-pip python3-flask python3-psycopg2 -y
# ~/atm/app.py → Flask API (withdraw, balance) → connects db.bank.local:5432
sudo nano /etc/systemd/system/atm.service
# ExecStart=/usr/bin/python3 /home/user/atm/app.py
sudo systemctl enable atm && sudo systemctl start atm
```

**cctv-server:**
```bash
sudo apt install ffmpeg python3-flask -y
# Generate test video loop
ffmpeg -f lavfi -i testsrc=size=640x480:rate=25 -t 3600 ~/bank_cctv.mp4
# systemd service → ffmpeg -re -stream_loop -1 -i ~/bank_cctv.mp4 -f rtsp rtsp://0.0.0.0:8554/cctv
# status API → Flask GET /status → checks pgrep ffmpeg
sudo systemctl enable cctv && sudo systemctl start cctv
```

---

### 14.10 Log Paths — Forwarder (v4)

Forwarder (aegis_forwarder.py) က SSH ကနေ ဒီ log တွေ tail ရမည်:

| VM | Log Path | Event Type |
|---|---|---|
| bank-web | `/var/log/suricata/eve.json` | IDS alerts |
| bank-web | `/var/log/fail2ban.log` | IP bans |
| bank-web | `/var/log/auth.log` | SSH login |
| bank-web | `/var/log/vsftpd.log` | FTP sessions |
| dns-server | `/var/log/named/queries.log` | DNS queries |
| mail-server | `/var/log/mail.log` | SMTP events |
| customer-db | `/var/log/postgresql/*.log` | DB connections |
| customer-db | `/var/log/suricata/eve.json` | IDS alerts |
| ad-server | `/var/log/samba/log.samba` | Auth events |
| atm-server | `/var/log/atm.log` | Transactions |
| cctv-server | `HTTP GET /status` | Stream status |

---

### 14.11 Attack Coverage (v4)

| Zone | VM | Attack Type | Tools |
|---|---|---|---|
| VLAN 10 | bank-web | SQLi, XSS, path traversal | sqlmap, nikto |
| VLAN 10 | bank-web | FTP brute force | hydra |
| VLAN 10 | dns-server | DNS amplification, zone transfer | dig, hping3 |
| VLAN 10 | mail-server | SMTP brute, open relay, phishing | hydra, swaks |
| VLAN 20 | customer-db | DB brute, SQL injection | hydra, sqlmap |
| VLAN 20 | ad-server | Pass-the-Hash, Kerberoasting, LDAP enum | impacket, enum4linux |
| VLAN 20 | atm-server | Transaction replay, MITM, logic flaw | curl, arpspoof |
| VLAN 40 | cctv-server | RTSP hijack, stream DoS | vlc, hping3 |

---

### 14.12 Connection Test Checklist

v4 setup ပြီးရင် ဒီ test တွေ pass ရမည်:

```bash
# aegis ကနေ run
ping web.bank.local      # 10.10.10.10 ✅
ping dns.bank.local      # 10.10.10.20 ✅
ping mail.bank.local     # 10.10.10.30 ✅
ping db.bank.local       # 10.20.20.10 ✅
ping ad.bank.local       # 10.20.20.20 ✅
ping atm.bank.local      # 10.20.20.30 ✅
ping cctv.bank.local     # 10.40.40.10 ✅

nc -zv web.bank.local  80      # Apache  ✅
nc -zv dns.bank.local  53      # DNS     ✅
nc -zv mail.bank.local 25      # SMTP    ✅
nc -zv db.bank.local   5432    # PgSQL   ✅
nc -zv atm.bank.local  5000    # ATM API ✅
nc -zv cctv.bank.local 8554    # RTSP    ✅

# ATM → DB connection
curl -X POST http://atm.bank.local:5000/withdraw \
  -H 'Content-Type: application/json' \
  -d '{"account":"123456","amount":100}'
# → {"success":true,"balance":4999900} ✅

# CCTV status
curl http://cctv.bank.local:8080/status
# → {"streaming":true,...} ✅
```

---

---

## 15. v4 Build Progress — GNS3 + pfSense + OVS (2026-07-20)

> **Status:** 🔨 Building — VM တွေ clone ပြီး၊ pfSense config လုပ်နေဆဲ
> **Date:** 2026-07-20 02:00+

---

### 15.1 Confirmed GNS3 Topology (2026-07-20 02:01)

Image မှာ confirm ဖြစ်ပြီးသား topology:

```
Internet (virbr0)
      │
   [Router — MikroTik CHR]
    192.168.122.2 / 10.0.23.1
      │                │
   [Attacker]       pfSense
  192.168.10.99    10.0.23.2
                    │  │  │  │
                   e1  e2  e3  e4(ထည့်ရမည်)
                   │   │   │   │
          Public  Int  MGMT  CCTV
         Switch  Switch
           │       │         │          │
        ┌──┴──┐  ┌─┴──┐    aegis     cctv-server
     bank-web  │ cust-db  10.30.30.10  10.40.40.10
    10.10.10.10 │ 10.20.20.10
      dns-server │ ad-server
    10.10.10.20  │ 10.20.20.20
     mail-server │ atm-server
    10.10.10.30  │ 10.20.20.30
```

**ရှိပြီးသား VM တွေ (2026-07-20):**
| VM | IP | Status |
|---|---|---|
| bank-web | 10.10.10.10 | ✅ running |
| DNS-Server | 10.10.10.20 | ✅ cloned |
| Mail-Server | 10.10.10.30 | ✅ cloned |
| customer-db | 10.20.20.10 | ✅ running |
| AD-Server | 10.20.20.20 | ✅ cloned |
| ATM-Server | 10.20.20.30 | ✅ cloned |
| CCTV-Server | 10.40.40.10 | ✅ cloned |
| aegis | 10.30.30.10 | ✅ running |

---

### 15.2 OpenVSwitch (OVS) Setup — အရေးကြီးသော Points

v4 topology မှာ GNS3 built-in Ethernet switch မဟုတ်ဘဲ **OpenVSwitch (OVS)** သုံးတယ်။
OVS က VLAN trunk support လုပ်တယ် — pfSense ↔ OVS ကြား trunk လိုင်းသွားတယ်။

**OVS `ovs-vsctl show` output (Public-Services):**
```
Bridge br0
    datapath_type: netdev
    Port eth0
        trunks: [10]          ← pfSense ချိတ် (trunk, VLAN 10 သာ)
        Interface eth0
    Port eth1
        tag: 10               ← bank-web ချိတ် (access port)
        Interface eth1
    Port eth2                 ← dns-server ချိတ်မည် (tag မသတ်မှတ်ရသေး)
    Port eth3                 ← mail-server ချိတ်မည်
    Port eth4,5,6,7           ← အသုံးမပြုသေး
    Port br0
        Interface br0
            type: internal
```

**OVS Port Mode ရှင်းလင်းချက်:**

| Port Mode | ဘာဆိုလဲ | VM ဘက်မှာ |
|---|---|---|
| `trunks: [10]` | VLAN tagged traffic သာ ဖြတ်ရ | pfSense သုံး |
| `tag: 10` | Access port — VLAN 10 ထဲ ထည့် | VM plain eth0 သုံးနိုင် |
| tag မပါ | Untagged (VLAN 1) | သတ်မှတ်ရမည် |

> **Key Point:** VM တွေ access port နဲ့ ချိတ်ထားတာကြောင့် VM ထဲမှာ VLAN subinterface မလို — plain `eth0` + IP ထည့်ရုံပဲ ✅

---

### 15.3 OVS Port Tag Command — New VM တစ်ခုထည့်တိုင်း

New VM cable ချိတ်ပြီးတိုင်း OVS console ထဲဝင်ပြီး tag သတ်မှတ်ရမည်:

**Public-Switch (VLAN 10):**
```bash
# dns-server ချိတ်ထားတဲ့ port (ဥပမာ eth2)
ovs-vsctl set port eth2 tag=10

# mail-server ချိတ်ထားတဲ့ port (ဥပမာ eth3)
ovs-vsctl set port eth3 tag=10

# confirm
ovs-vsctl show
# → tag: 10 ပါလာရမည်
```

**Internal-Switch (VLAN 20):**
```bash
# customer-db port
ovs-vsctl set port eth1 tag=20

# ad-server port
ovs-vsctl set port eth2 tag=20

# atm-server port
ovs-vsctl set port eth3 tag=20
```

> **မမေ့နဲ့:** OVS reboot ကျရင် tag တွေ ပျောက်နိုင်တယ် — `/etc/network/interfaces` သို့ startup script ထည့်ထားရမည် (ဆက်ပြမည်)

---

### 15.4 pfSense Interface Assignments — မှန်ကန်သော Config

**VLANs tab (Interfaces → VLANs):**

| Interface | VLAN Tag | Description |
|---|---|---|
| em1 | 10 | PUBLIC |
| em2 | 20 | INTERNAL |

> pfSense က em1/em2 ပေါ်မှာ VLAN subinterface ဖန်တီးပြီး OVS trunk port ကို tagged traffic ပို့တယ်

**Interface Assignments (မှန်ကန်သော ဖြစ်သင့်သည့် config):**

| Interface Name | Network Port | IP | Purpose |
|---|---|---|---|
| WAN | em0 | 10.0.23.2/30 | Router ဘက် |
| PUBLIC | VLAN 10 on em1 | **10.10.10.1/24** | Public VMs gateway |
| INTERNAL | VLAN 20 on em2 | **10.20.20.1/24** | Internal VMs gateway |
| MGMT | em3 | **10.30.30.1/24** | aegis gateway |
| CCTV | em4 | **10.40.40.1/24** | cctv-server gateway |

**ဟောင်းဟာ (မှားနေသည်) vs အသစ် (မှန်သည်):**

| ဟောင်း Name | အသစ် Name | ပြဿနာ |
|---|---|---|
| LAN | PUBLIC | နာမည်မကိုက် |
| BANK_WEB | INTERNAL | VLAN 20 ကို BANK_WEB လို့ခေါ် — မကိုက် |
| CUSTOMER_DB | MGMT | em3 = aegis, DB မဟုတ် |
| (မရှိ) | CCTV | em4 မဖောက်ရသေး |

**Rename လုပ်နည်း:**
```
Interfaces → LAN → General Config → Description: PUBLIC → Save
Interfaces → BANK_WEB → Description: INTERNAL → Save
Interfaces → CUSTOMER_DB → Description: MGMT → Save
→ Apply Changes
```

---

### 15.5 pfSense em4 ထပ်ဖောက်နည်း (CCTV)

```
1. GNS3 → pfSense node → Right-click → Configure
   → Network Adapters: 4 → 5 → OK
   → pfSense VM restart

2. pfSense web GUI → Interfaces → Assignments
   → Available ports ထဲ em4 ပေါ်လာမည်
   → + Add နှိပ်

3. Interfaces → (em4 interface) → Edit
   → Enable: ✅
   → Description: CCTV
   → IPv4 Config: Static
   → IP: 10.40.40.1 / 24
   → Save → Apply Changes

4. GNS3 → pfSense em4 ↔ CCTV-Server e0 (cable ဆွဲ)
```

---

### 15.6 pfSense Firewall Rules — Complete

#### WAN Interface Rules (Internet ကနေ Public ဝင်ခွင့်)

| # | Action | Protocol | Source | Destination | Port | Description |
|---|---|---|---|---|---|---|
| 1 | Pass | TCP | Any | 10.10.10.0/24 | 80 | HTTP to bank-web |
| 2 | Pass | TCP | Any | 10.10.10.0/24 | 443 | HTTPS to bank-web |
| 3 | Pass | TCP | Any | 10.10.10.10 | 21 | FTP to bank-web |
| 4 | Pass | UDP | Any | 10.10.10.20 | 53 | DNS queries |
| 5 | Pass | TCP | Any | 10.10.10.30 | 25 | SMTP inbound mail |
| 6 | Block | Any | Any | 10.20.20.0/24 | any | Block internet→Internal |
| 7 | Block | Any | Any | 10.40.40.0/24 | any | Block internet→CCTV |
| 8 | Block | Any | Any | 10.30.30.0/24 | any | Block internet→MGMT |

#### PUBLIC Interface Rules (Public VMs မှ ထွက်)

| # | Action | Protocol | Source | Destination | Port | Description |
|---|---|---|---|---|---|---|
| 1 | Block | Any | 10.10.10.0/24 | 10.20.20.0/24 | any | Public→Internal block |
| 2 | Pass | Any | 10.10.10.0/24 | Any | any | Internet access (apt update) |

#### INTERNAL Interface Rules (Staff/Bank zone)

| # | Action | Protocol | Source | Destination | Port | Description |
|---|---|---|---|---|---|---|
| 1 | Pass | TCP | 10.20.20.0/24 | 10.10.10.30 | 143 | Staff IMAP mail |
| 2 | Pass | TCP | 10.20.20.0/24 | 10.10.10.30 | 587 | Staff SMTP submit |
| 3 | Pass | TCP | 10.20.20.0/24 | 10.10.10.10 | 8080 | Staff admin panel |
| 4 | Block | Any | 10.20.20.0/24 | WAN | any | No internet egress |

#### MGMT Interface Rules (aegis only)

| # | Action | Protocol | Source | Destination | Port | Description |
|---|---|---|---|---|---|---|
| 1 | Pass | TCP | 10.30.30.10 | Any | 22 | aegis SSH to all VMs |
| 2 | Pass | TCP | 10.30.30.10 | 10.40.40.10 | 8080 | aegis → CCTV status |
| 3 | Block | Any | Any | 10.30.30.0/24 | any | No external MGMT access |

#### CCTV Interface Rules (IoT zone isolated)

| # | Action | Protocol | Source | Destination | Port | Description |
|---|---|---|---|---|---|---|
| 1 | Block | Any | 10.40.40.0/24 | 10.20.20.0/24 | any | CCTV→Internal block |
| 2 | Block | Any | 10.40.40.0/24 | 10.10.10.0/24 | any | CCTV→Public block |
| 3 | Pass | TCP | 10.30.30.10 | 10.40.40.10 | 8554 | aegis RTSP monitor |

**Rule ထည့်နည်း (pfSense GUI):**
```
Firewall → Rules → [Interface ရွေး] → + Add (↑ up arrow)

Action:              Pass / Block
Interface:           PUBLIC / INTERNAL / WAN / MGMT / CCTV
Address Family:      IPv4
Protocol:            TCP / UDP / Any
Source:              Any  (သို့) Network → IP/mask
Destination:         Network → IP/mask
Destination Port:    ရွေးရမဲ့ port
Description:         rule ဘာအတွက်လဲ

→ Save → Apply Changes (မမေ့နဲ့)
```

---

### 15.7 pfSense Firewall Rule Form — Field by Field

**Firewall → Rules → WAN → Add rule တစ်ခု ဥပမာ (HTTPS):**

```
Action:                 Pass
Disabled:               □ (uncheck)
Interface:              WAN
Address Family:         IPv4
Protocol:               TCP

─── Source ───
Source:                 Any
Invert match:           □

─── Destination ───
Destination:            Network
Destination IP:         10.10.10.0
Mask:                   /24
Destination Port From:  HTTPS (443)
Destination Port To:    (ထားခဲ့)

─── Extra Options ───
Log:                    □ (heavy traffic မဆိုရင် မဖွင့်)
Description:            Allow HTTPS to Public

→ Save
→ Apply Changes  ← မမေ့နဲ့
```

---

### 15.8 VM Netplan Config — တစ်ခုချင်းစီ

OVS access port (tag=VLAN) ကြောင့် VM ထဲမှာ plain eth0 ပဲသုံးရတယ် — VLAN subinterface မလို:

**dns-server:**
```yaml
# /etc/netplan/00-installer-config.yaml
network:
  ethernets:
    eth0:
      addresses: [10.10.10.20/24]
      gateway4: 10.10.10.1
      nameservers:
        addresses: [10.10.10.1]
  version: 2
```

**mail-server:**
```yaml
      addresses: [10.10.10.30/24]
      gateway4: 10.10.10.1
```

**customer-db** *(IP ပြောင်းရမည် .20 → .10)*:
```yaml
      addresses: [10.20.20.10/24]
      gateway4: 10.20.20.1
```

**ad-server:**
```yaml
      addresses: [10.20.20.20/24]
      gateway4: 10.20.20.1
```

**atm-server:**
```yaml
      addresses: [10.20.20.30/24]
      gateway4: 10.20.20.1
```

**cctv-server:**
```yaml
      addresses: [10.40.40.10/24]
      gateway4: 10.40.40.1
```

**Apply command (VM တစ်ခုချင်းစီ):**
```bash
sudo netplan apply
ping 10.10.10.1   # pfSense gateway ping စစ်
```

---

### 15.9 Aegis SSH Jump Host — RAM + Config

**GNS3 မှာ RAM တိုးနည်း:**
```
aegis node → Right-click → Configure
→ RAM: 256 → 1024 MB
→ OK → restart
```

**aegis VM ထဲ SSH config:**
```bash
sudo nano /etc/ssh/sshd_config
# ဒါတွေ confirm ဖြစ်ရမည်:
AllowTcpForwarding yes
GatewayPorts yes

sudo systemctl restart ssh
```

**aegis မှာ SSH key generate:**
```bash
ssh-keygen -t ed25519 -C "aegis-jump"
# Enter x3 (passphrase မထည့်)
cat ~/.ssh/id_ed25519.pub
# ← ဒီ key ကို VM တစ်ခုချင်းစီ ~/.ssh/authorized_keys ထဲ ထည့်ရမည်
```

**Laptop ~/.ssh/config:**
```
Host aegis
    HostName 10.30.30.10
    User     user
    Port     22

Host bank-web
    HostName  10.10.10.10
    User      user
    ProxyJump aegis

Host dns-server
    HostName  10.10.10.20
    User      user
    ProxyJump aegis

Host mail-server
    HostName  10.10.10.30
    User      user
    ProxyJump aegis

Host customer-db
    HostName  10.20.20.10
    User      user
    ProxyJump aegis

Host ad-server
    HostName  10.20.20.20
    User      user
    ProxyJump aegis

Host atm-server
    HostName  10.20.20.30
    User      user
    ProxyJump aegis

Host cctv-server
    HostName  10.40.40.10
    User      user
    ProxyJump aegis
```

**Test:**
```bash
ssh dns-server   # laptop → aegis → dns-server (auto)
```

---

### 15.10 CPU + RAM Estimate

**Host resource usage (VM အကုန် run ရင်):**

| Component | RAM | CPU (idle) |
|---|---|---|
| bank-web | 256MB | ~0.5% |
| dns-server | 256MB | ~0.2% |
| mail-server | 256MB | ~0.3% |
| customer-db | 256MB | ~0.5% |
| ad-server | 256MB | ~0.5% |
| atm-server | 256MB | ~0.2% |
| cctv-server | 256MB | ~1% (ffmpeg) |
| aegis | 1GB | ~0.5% |
| pfSense | 1GB | ~2% |
| Router | 256MB | ~0.5% |
| Kali | 2GB | ~3% |
| GNS3 overhead | — | ~5% |
| **Total** | **~6GB** | **~15% idle** |

> Attack tool run တဲ့အချိန် (nmap/hydra) မှသာ CPU spike ဖြစ်မည် — idle မှာ ပြဿနာမရှိ ✅

---

### 15.11 v4 Build Checklist

```
GNS3 Topology:
  ✅ Router
  ✅ pfSense
  ✅ Attacker (Kali)
  ✅ Public-Switch (OVS)
  ✅ Internal-Switch (OVS)
  ✅ aegis (10.30.30.10)
  ✅ bank-web (10.10.10.10)
  ✅ DNS-Server cloned
  ✅ Mail-Server cloned
  ✅ customer-db (10.20.20.10)
  ✅ AD-Server cloned
  ✅ ATM-Server cloned
  ✅ CCTV-Server cloned
  ⬜ pfSense em4 ဖောက် (CCTV)
  ⬜ CCTV-Server ↔ pfSense em4 cable

pfSense Config:
  ✅ VLAN 10 (em1) = PUBLIC
  ✅ VLAN 20 (em2) = INTERNAL
  ⬜ Interface rename (PUBLIC/INTERNAL/MGMT)
  ⬜ em4 add → CCTV (10.40.40.1/24)
  ⬜ WAN firewall rules (80,443,21,53,25)
  ⬜ INTERNAL rules (143,587,8080)
  ⬜ MGMT rules (SSH only)
  ⬜ CCTV rules (isolated)

OVS Config:
  ✅ eth0 trunk:10 (pfSense ↔ Public-Switch)
  ✅ eth1 tag:10 (bank-web)
  ⬜ dns-server port tag=10
  ⬜ mail-server port tag=10
  ⬜ customer-db port tag=20 (Internal-Switch)
  ⬜ ad-server port tag=20
  ⬜ atm-server port tag=20

VM IP + SSH:
  ⬜ DNS-Server netplan 10.10.10.20 + SSH
  ⬜ Mail-Server netplan 10.10.10.30 + SSH
  ⬜ customer-db IP ပြောင်း .20→.10
  ⬜ AD-Server netplan 10.20.20.20 + SSH
  ⬜ ATM-Server netplan 10.20.20.30 + SSH
  ⬜ CCTV-Server netplan 10.40.40.10 + SSH
  ⬜ aegis RAM 1GB + jump host config
  ⬜ Laptop SSH config

Services:
  ⬜ bind9 (dns-server)
  ⬜ postfix + dovecot (mail-server)
  ⬜ samba4 AD (ad-server)
  ⬜ flask ATM + psycopg2→DB (atm-server)
  ⬜ ffmpeg RTSP + status API (cctv-server)
  ⬜ bankdb + bankmail DB tables (customer-db)
```

---

*Document maintained by AEGIS Agent. Last updated: 2026-07-20*
