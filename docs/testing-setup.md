# AEGIS SOC — Testing Setup Guide

> **VM Setup**: Kali `192.168.56.101` | Ubuntu `192.168.56.100` | pfSense `192.168.56.1`  
> **API**: `https://aegis-api-server-jp3b.onrender.com`  
> **Dashboard**: `https://aegis-soc-dashboard.vercel.app`

---

## Architecture Diagram

```
Host Machine (VirtualBox / VMware)
├── Kali Linux       192.168.56.101   Red Team attacker
├── Ubuntu 22.04     192.168.56.100   Blue Team defender (sensors)
└── pfSense          192.168.56.1     Firewall / gateway
         │
         │ POST /api/ingest/*
         ▼
Render (aegis-api-server-jp3b.onrender.com)
         │
         │ SSE /api/stream
         ▼
Vercel (aegis-soc-dashboard.vercel.app)
```

---

## Step 1: Ubuntu VM Setup (Blue Team / Defender)

### 1.1 Install Sensors

```bash
# Update system
sudo apt update && sudo apt upgrade -y

# Suricata IDS
sudo apt install -y suricata suricata-update
sudo suricata-update
sudo systemctl enable suricata
sudo systemctl start suricata

# Fail2ban
sudo apt install -y fail2ban
sudo systemctl enable fail2ban
sudo systemctl start fail2ban

# Cowrie Honeypot
sudo apt install -y python3-pip python3-venv git
git clone https://github.com/cowrie/cowrie.git /opt/cowrie
cd /opt/cowrie
python3 -m venv cowrie-env
source cowrie-env/bin/activate
pip install -r requirements.txt
cp etc/cowrie.cfg.dist etc/cowrie.cfg

# Redirect real SSH to port 2200, Cowrie takes port 22
sudo iptables -t nat -A PREROUTING -p tcp --dport 22 -j REDIRECT --to-port 2222
sudo sed -i 's/#Port 22/Port 2200/' /etc/ssh/sshd_config
sudo systemctl restart sshd

# Start Cowrie
cd /opt/cowrie && bin/cowrie start

# Snort IDS (optional, alongside Suricata)
sudo apt install -y snort

# ModSecurity + Apache
sudo apt install -y apache2 libapache2-mod-security2
sudo a2enmod security2
sudo cp /etc/modsecurity/modsecurity.conf-recommended /etc/modsecurity/modsecurity.conf
sudo sed -i 's/SecRuleEngine DetectionOnly/SecRuleEngine On/' /etc/modsecurity/modsecurity.conf

# vsftpd (for FTP attack testing)
sudo apt install -y vsftpd
sudo systemctl enable vsftpd
sudo systemctl start vsftpd

# Install OWASP ModSecurity CRS
cd /etc/modsecurity
sudo git clone https://github.com/coreruleset/coreruleset.git
sudo cp coreruleset/crs-setup.conf.example coreruleset/crs-setup.conf
echo 'IncludeOptional /etc/modsecurity/coreruleset/*.conf' | sudo tee -a /etc/apache2/mods-enabled/security2.conf
sudo systemctl restart apache2
```

### 1.2 Configure Suricata

```bash
# Edit suricata config
sudo nano /etc/suricata/suricata.yaml

# Key settings:
# af-packet:
#   - interface: enp0s8    ← your interface name (check with: ip a)
# 
# outputs:
#   - eve-log:
#       enabled: yes
#       filename: /var/log/suricata/eve.json
#       types:
#         - alert
#         - tls
#         - dns

# Check interface name
ip a   # look for 192.168.56.100

# Restart with correct interface
sudo suricata -D -i enp0s8 -c /etc/suricata/suricata.yaml

# Verify Suricata is writing alerts
sudo tail -f /var/log/suricata/eve.json
```

### 1.3 Install aegis_forwarder.py

```bash
# Copy forwarder to Ubuntu
scp scripts/src/aegis_forwarder.py user@192.168.56.100:/opt/aegis/

# Or on Ubuntu:
mkdir -p /opt/aegis
cat > /opt/aegis/aegis_forwarder.py << 'EOF'
# (paste content of scripts/src/aegis_forwarder.py here)
EOF

# Install Python dependencies
pip3 install requests

# Set environment variables
cat > /opt/aegis/.env << 'EOF'
AEGIS_API_URL=https://aegis-api-server-jp3b.onrender.com
AEGIS_INGEST_KEY=YOUR_INGEST_KEY_HERE
EOF

# Run forwarder
cd /opt/aegis
python3 aegis_forwarder.py

# Run as systemd service
cat > /etc/systemd/system/aegis-forwarder.service << 'EOF'
[Unit]
Description=AEGIS Log Forwarder
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/opt/aegis
EnvironmentFile=/opt/aegis/.env
ExecStart=/usr/bin/python3 /opt/aegis/aegis_forwarder.py
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable aegis-forwarder
sudo systemctl start aegis-forwarder
sudo journalctl -u aegis-forwarder -f
```

### 1.4 Install defense_agent.py

```bash
# Copy agent
cp scripts/src/defense_agent.py /opt/aegis/

# Run as systemd service
cat > /etc/systemd/system/aegis-agent.service << 'EOF'
[Unit]
Description=AEGIS Defense Agent
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/opt/aegis
EnvironmentFile=/opt/aegis/.env
ExecStart=/usr/bin/python3 /opt/aegis/defense_agent.py
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

# Add ADMIN_KEY to .env
echo "AEGIS_ADMIN_KEY=YOUR_ADMIN_KEY_HERE" >> /opt/aegis/.env

sudo systemctl daemon-reload
sudo systemctl enable aegis-agent
sudo systemctl start aegis-agent
sudo journalctl -u aegis-agent -f
```

---

## Step 2: pfSense Setup (Firewall)

### 2.1 Basic Configuration

```
System → General Setup:
  - Hostname: pfsense
  - DNS: 8.8.8.8, 8.8.4.4

Interfaces:
  - WAN: DHCP (internet)
  - LAN: 192.168.56.1/24 (lab network)

Firewall → Rules → LAN:
  - Default allow LAN to any
```

### 2.2 Install pfSense API for AEGIS Agent

```
System → Package Manager → Available Packages
Search: pfSense-pkg-API → Install

After install:
System → API → Settings:
  - Enable API: checked
  - Authentication: API Key
  - Generate API key → save for defense_agent.py
```

### 2.3 Configure AEGIS pfSense Agent

```bash
# On Ubuntu VM, update defense_agent.py config
PFSENSE_URL=https://192.168.56.1
PFSENSE_API_KEY=YOUR_PFSENSE_API_KEY
```

---

## Step 3: Kali Linux Setup (Red Team)

### 3.1 Install Attack Tools

```bash
# Update
sudo apt update && sudo apt upgrade -y

# Most tools are pre-installed on Kali. Check/install missing:
sudo apt install -y \
  nmap hydra medusa sqlmap nikto \
  hping3 slowloris \
  arpspoof dsniff ettercap-text-only \
  swaks smtp-user-enum \
  sslscan testssl.sh \
  xsser dotdotpwn \
  metasploit-framework \
  wpscan gobuster dirb

# Verify wordlists
ls /usr/share/wordlists/
# If rockyou.txt is compressed:
gunzip /usr/share/wordlists/rockyou.txt.gz
```

### 3.2 Set Target Variable

```bash
# Set target (Ubuntu VM IP)
export TARGET=192.168.56.100
export GATEWAY=192.168.56.1

# Verify connectivity
ping -c 3 $TARGET
nmap -sn 192.168.56.0/24
```

---

## Step 4: Verify AEGIS Integration

### 4.1 Test Ingest API Directly

```bash
# From Ubuntu VM — test forwarder connection
curl -X POST https://aegis-api-server-jp3b.onrender.com/api/ingest/event \
  -H "Content-Type: application/json" \
  -H "X-AEGIS-Key: YOUR_INGEST_KEY" \
  -d '{
    "type": "network_attack",
    "subtype": "port scan",
    "severity": "medium",
    "sourceIp": "192.168.56.101",
    "targetHost": "192.168.56.100",
    "description": "Test event from Ubuntu VM",
    "sensor": "manual_test"
  }'

# Expected: 201 Created + event appears in AEGIS dashboard
```

### 4.2 Verify System Status Updates

```bash
# Send system heartbeat (updates System Status page)
curl -X POST https://aegis-api-server-jp3b.onrender.com/api/ingest/event \
  -H "Content-Type: application/json" \
  -H "X-AEGIS-Key: YOUR_INGEST_KEY" \
  -d '{
    "type": "system_status",
    "subtype": "heartbeat",
    "severity": "low",
    "sourceIp": "192.168.56.100",
    "targetHost": "aegis-dashboard",
    "description": "Suricata online | Fail2ban active | Cowrie listening",
    "sensor": "aegis_forwarder",
    "component": "Suricata",
    "status": "online",
    "metrics": "alerts_today: 0 | rules_loaded: 24000"
  }'
```

### 4.3 Check Dashboard

Open: `https://aegis-soc-dashboard.vercel.app`

- **Command Center**: Total Events counter should increment
- **Security Events**: New event should appear in feed
- **System Status**: Suricata/Fail2ban/Cowrie cards appear (after heartbeat)
- **Defense Center**: Fail2ban/Suricata status updates to ACTIVE

---

## Step 5: Attack Testing Scenarios

### Scenario 1: Quick Smoke Test (5 minutes)

```bash
# From Kali:

# 1. Port scan (should trigger "Port Scan → Auto Block")
nmap -sS -T4 $TARGET

# Wait 10s, check AEGIS dashboard → Security Events
# Expect: new event, auto-block rule fires

# 2. Try SSH after block
ssh root@$TARGET
# Expect: connection refused (IP blocked)

# 3. Manually unblock in AEGIS Defense Center
# Then try SSH brute force:
hydra -l root -P /usr/share/wordlists/rockyou.txt ssh://$TARGET -t 4

# Wait for 5 failures → Fail2ban bans → AEGIS shows block
```

### Scenario 2: Web Attack Chain (15 minutes)

```bash
# From Kali:

# 1. Directory enumeration
gobuster dir -u http://$TARGET -w /usr/share/wordlists/dirb/common.txt

# 2. SQL Injection test
sqlmap -u "http://$TARGET/login.php?id=1" --batch --level=2

# 3. XSS test
curl "http://$TARGET/search.php?q=<script>alert(1)</script>"

# 4. LFI test
curl "http://$TARGET/page.php?file=../../../../etc/passwd"

# Each → ModSecurity blocks → forwarder sends → AEGIS auto-blocks IP
# Check: AEGIS Defense Center → Active Blocks
```

### Scenario 3: Honeypot Test (2 minutes)

```bash
# From Kali:

# Connect to Cowrie (instant block trigger)
ssh root@$TARGET
# Password: any (Cowrie accepts anything)

# Type some commands inside Cowrie:
ls
cat /etc/passwd
wget http://$TARGET/shell.sh

# Exit
exit

# AEGIS Dashboard: Defense Center shows instant block
# Priority 5 rule fired: "Honeypot Touch → Instant Block"
```

### Scenario 4: DDoS Simulation (3 minutes)

```bash
# From Kali:

# SYN Flood (requires sudo)
sudo hping3 -S --flood -p 80 $TARGET

# Let it run 30 seconds → 50+ events → "DDoS → Null Route" fires
# AEGIS: null_route command queued for Ubuntu agent
# Ubuntu agent executes: ip route add blackhole 192.168.56.101/32
# Stop attack: Ctrl+C

# Check ubuntu: ip route show | grep blackhole
```

### Scenario 5: Full Defense Pipeline Test (30 minutes)

```bash
# Phase 1: Reconnaissance
nmap -A -T4 $TARGET

# Phase 2: Brute Force
hydra -l root -P /usr/share/wordlists/rockyou.txt ssh://$TARGET

# Phase 3: Web Exploitation
sqlmap -u "http://$TARGET/app.php?id=1" --dbs --batch
curl "http://$TARGET/page.php?file=../../../../etc/passwd"

# Phase 4: Honeypot contact
ssh root@$TARGET

# Phase 5: DDoS
sudo hping3 -S --flood -p 443 $TARGET &
sleep 30; kill %1

# Check AEGIS throughout:
# - Security Events feed populating in real-time
# - Incidents auto-created
# - Defense actions logged
# - IPs blocked and unblocked
# - System Status shows sensors online
```

---

## Step 6: Monitor in AEGIS Dashboard

### Pages to Watch During Attacks

| Page | What to Look For |
|---|---|
| **Command Center** | Total Events, Critical Threats counters go up |
| **Security Events** | Real-time feed — new events with source IP, type, severity |
| **Active Alerts** | Auto-generated alerts for each rule that fires |
| **Incidents** | Aggregated attack incidents |
| **Defense Center** | Active Blocks list, Defense Action Log with QUEUED→SUCCESS |
| **System Status** | Suricata/Fail2ban/Cowrie showing ONLINE (after forwarder starts) |
| **Connections → SSH** | SSH session attempts logged |
| **Connections → TLS** | TLS anomalies (if running sslscan) |
| **Connections → HTTP Attacks** | SQLi/XSS/LFI details |

---

## Step 7: Verify Defense Commands Executed

```bash
# On Ubuntu VM — check iptables rules after attacks
sudo iptables -L INPUT -n --line-numbers

# Should see lines like:
# 1    DROP    all  --  192.168.56.101  0.0.0.0/0

# Check null routes
ip route show | grep blackhole

# Check Fail2ban bans
sudo fail2ban-client status sshd

# Check Cowrie logs
cat /opt/cowrie/var/log/cowrie/cowrie.json | python3 -m json.tool | tail -50

# Check AEGIS agent is polling and executing
sudo journalctl -u aegis-agent -f
# Expect: "Executed: iptables -I INPUT -s 192.168.56.101 -j DROP"
```

---

## Troubleshooting

### Events not appearing in AEGIS

```bash
# 1. Check forwarder is running
sudo systemctl status aegis-forwarder
sudo journalctl -u aegis-forwarder -n 50

# 2. Test API directly
curl -X GET https://aegis-api-server-jp3b.onrender.com/api/health

# 3. Check Suricata is writing alerts
sudo tail -f /var/log/suricata/eve.json

# 4. Check Fail2ban is running
sudo fail2ban-client status

# 5. Check ingest key matches
echo $AEGIS_INGEST_KEY
```

### Defense commands not executing

```bash
# 1. Check agent is running
sudo systemctl status aegis-agent

# 2. Poll manually
curl -X GET https://aegis-api-server-jp3b.onrender.com/api/defense/commands/pending \
  -H "X-AEGIS-Admin-Key: YOUR_ADMIN_KEY"

# 3. Check agent has sudo for iptables
sudo visudo
# Add: aegis-agent ALL=(ALL) NOPASSWD: /sbin/iptables, /sbin/ip
```

### Render API cold start (50s delay)

```bash
# Wake up Render before testing
curl https://aegis-api-server-jp3b.onrender.com/api/health
# Wait for response, then start tests
```

### Suricata not detecting attacks

```bash
# Check interface
sudo suricata --list-runmodes
ip a   # find interface with 192.168.56.100

# Restart with correct interface
sudo suricata -D -i enp0s8 -c /etc/suricata/suricata.yaml --pidfile /var/run/suricata.pid

# Update rules
sudo suricata-update
sudo systemctl restart suricata
```

---

## Quick Reference: Key Commands

```bash
# ──────────────── KALI (Attacker) ────────────────
nmap -sS -T4 $TARGET                          # Port scan
hydra -l root -P rockyou.txt ssh://$TARGET    # SSH brute
sqlmap -u "http://$TARGET/app.php?id=1"       # SQL injection
sudo hping3 -S --flood -p 80 $TARGET          # SYN flood
ssh root@$TARGET                              # Honeypot trigger
arpspoof -i eth0 -t $TARGET $GATEWAY          # ARP spoof

# ──────────────── UBUNTU (Defender) ────────────────
sudo iptables -L INPUT -n --line-numbers       # View blocks
sudo fail2ban-client status sshd               # Fail2ban bans
sudo tail -f /var/log/suricata/eve.json        # Suricata alerts
sudo journalctl -u aegis-forwarder -f          # Forwarder logs
sudo journalctl -u aegis-agent -f             # Agent logs

# ──────────────── AEGIS API ────────────────
curl aegis-api-server-jp3b.onrender.com/api/health           # Health check
curl aegis-api-server-jp3b.onrender.com/api/defense/status   # Defense status
curl aegis-api-server-jp3b.onrender.com/api/events           # All events
```
