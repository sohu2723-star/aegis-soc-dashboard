# AEGIS-SecureBank — Project Book

> **ဖတ်သူ:** ဆရာမ၊ lab partner များ၊ future AEGIS team  
> **ရည်ရွယ်ချက်:** ဒီ document တစ်ခုဖတ်ပြီးရင် ဘာမှ မေးစရာမလိုဘဲ lab တစ်ခုလုံး operate လုပ်နိုင်ရမည်  
> **Last Updated:** 2026-07-19

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

*Document maintained by AEGIS Agent. Last updated: 2026-07-19*
