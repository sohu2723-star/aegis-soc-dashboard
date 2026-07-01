# AEGIS Setup Guide — VirtualBox Lab

Complete step-by-step guide to connect your Kali Linux and Ubuntu VMs to the AEGIS dashboard.

---

## Lab Requirements

| VM | OS | Role | IP (Host-Only) |
|---|---|---|---|
| VM1 | Kali Linux | Red Team (Attacker) | 192.168.56.101 |
| VM2 | Ubuntu 22.04 | Blue Team (Defender) | 192.168.56.102 |
| VM3 (optional) | Ubuntu 22.04 | Honeypot | 192.168.56.103 |

---

## Step 1 — VirtualBox Network Setup

Each VM needs **2 network adapters**:

**Adapter 1 — NAT** (for internet access)
- Settings → Network → Adapter 1 → Attached to: NAT

**Adapter 2 — Host-Only** (for VM-to-VM communication)
- Settings → Network → Adapter 2 → Attached to: Host-Only Adapter
- Name: VirtualBox Host-Only Ethernet Adapter

Verify in Ubuntu VM:
```bash
ip addr show
# Should see: 192.168.56.x on eth1 or enp0s8
```

---

## Step 2 — Ubuntu VM: Install Defense Tools

### Suricata IDS
```bash
sudo apt update
sudo add-apt-repository ppa:oisf/suricata-stable -y
sudo apt install suricata -y

# Update rules
sudo suricata-update

# Start Suricata on your network interface
sudo suricata -c /etc/suricata/suricata.yaml -i enp0s8 -D

# Verify running
sudo tail -f /var/log/suricata/eve.json
```

### Fail2ban
```bash
sudo apt install fail2ban -y
sudo systemctl enable fail2ban
sudo systemctl start fail2ban

# Check status
sudo fail2ban-client status
```

### Cowrie Honeypot (optional)
```bash
sudo apt install git python3-virtualenv libssl-dev libffi-dev build-essential -y
cd /home
sudo git clone https://github.com/cowrie/cowrie.git
cd cowrie
sudo virtualenv cowrie-env
source cowrie-env/bin/activate
pip install -r requirements.txt
cp etc/cowrie.cfg.dist etc/cowrie.cfg

# Change SSH port to 2222, move real SSH to 22
sudo nano /etc/ssh/sshd_config   # Change Port to 22
sudo nano etc/cowrie.cfg         # listen_port = 2222

bin/cowrie start
```

### Snort (optional)
```bash
sudo apt install snort -y
# Configure interface in /etc/snort/snort.conf
sudo snort -A console -q -c /etc/snort/snort.conf -i enp0s8
```

---

## Step 3 — Install AEGIS Forwarder on Ubuntu

```bash
# Install Python dependencies
sudo apt install python3-pip -y
pip3 install requests

# Copy forwarder script (from this repo)
sudo cp scripts/aegis_forwarder.py /opt/aegis_forwarder.py
sudo chmod +x /opt/aegis_forwarder.py
```

---

## Step 4 — Configure Forwarder

Edit `/opt/aegis_forwarder.py` and set your AEGIS URL:

```python
AEGIS_URL = "https://YOUR-APP.replit.app/api"   # Your deployed AEGIS URL
AEGIS_KEY = "aegis-demo-key-change-me"           # Change this in production
```

**Or use environment variables:**
```bash
export AEGIS_URL="https://YOUR-APP.replit.app/api"
export AEGIS_KEY="aegis-demo-key-change-me"
```

---

## Step 5 — Run Forwarder

```bash
# Run in background (watches all log sources)
python3 /opt/aegis_forwarder.py &

# Or run specific mode
python3 /opt/aegis_forwarder.py --mode suricata
python3 /opt/aegis_forwarder.py --mode fail2ban
python3 /opt/aegis_forwarder.py --mode cowrie

# Run as systemd service (auto-start on boot)
sudo nano /etc/systemd/system/aegis-forwarder.service
```

**systemd service file:**
```ini
[Unit]
Description=AEGIS Security Forwarder
After=network.target

[Service]
Type=simple
User=root
Environment=AEGIS_URL=https://YOUR-APP.replit.app/api
Environment=AEGIS_KEY=aegis-demo-key-change-me
ExecStart=/usr/bin/python3 /opt/aegis_forwarder.py
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable aegis-forwarder
sudo systemctl start aegis-forwarder
sudo systemctl status aegis-forwarder
```

---

## Step 6 — Test Connection

```bash
# Quick connectivity test from Ubuntu VM
curl -s -X POST "$AEGIS_URL/ingest/event" \
  -H "Content-Type: application/json" \
  -H "X-AEGIS-Key: $AEGIS_KEY" \
  -d '{
    "source": "ubuntu",
    "type": "web_attack",
    "subtype": "Connection Test",
    "severity": "low",
    "sourceIp": "192.168.56.102",
    "description": "Ubuntu VM connected to AEGIS successfully"
  }'

# Expected response:
# {"id": 1, "status": "ok"}
```

If you see an event appear on the AEGIS dashboard — **you are connected!**

---

## Step 7 — Kali Linux Attack Commands

From your Kali VM, attack Ubuntu (192.168.56.102):

### Port Scan (nmap)
```bash
nmap -sV -A -p- 192.168.56.102
```

### SSH Brute Force (hydra) — triggers Fail2ban auto-block
```bash
hydra -l root -P /usr/share/wordlists/rockyou.txt ssh://192.168.56.102
```

### Web Vulnerability Scan (nikto)
```bash
nikto -h http://192.168.56.102
```

### SQL Injection (sqlmap)
```bash
sqlmap -u "http://192.168.56.102/login.php?id=1" --batch --level=3
```

### Directory Brute Force (gobuster)
```bash
gobuster dir -u http://192.168.56.102 -w /usr/share/wordlists/dirb/common.txt
```

---

## Step 8 — Watch Dashboard React Live

1. Open AEGIS Dashboard in browser
2. Navigate to **Command Center** — watch Total Events counter increase
3. Navigate to **Security Events** — see each attack appear in real-time
4. Navigate to **Defense Center** — see Fail2ban auto-blocks appear
5. Navigate to **Network Monitor** — see Kali host appear in Connected Hosts

---

## Troubleshooting

### Events not appearing?
```bash
# Check forwarder is running
systemctl status aegis-forwarder

# Test API manually
curl -v -X POST "$AEGIS_URL/ingest/event" \
  -H "X-AEGIS-Key: $AEGIS_KEY" \
  -H "Content-Type: application/json" \
  -d '{"source":"test","type":"network_scan","subtype":"Test","severity":"low","sourceIp":"1.2.3.4","description":"test"}'
```

### Suricata not detecting?
```bash
# Check Suricata is watching correct interface
ip link show   # find your interface name (eth0, enp0s8, etc.)
sudo suricata -c /etc/suricata/suricata.yaml -i YOUR_INTERFACE -D

# Verify EVE JSON is being written
sudo tail -f /var/log/suricata/eve.json
```

### Fail2ban not blocking?
```bash
sudo fail2ban-client status sshd
sudo tail -f /var/log/fail2ban.log
```
