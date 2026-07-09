# AEGIS-SecureBank — GNS3 Setup Guide
> Last updated: 2026-07-10
> For VirtualBox setup see legacy `docs/SETUP.md`

---

## Prerequisites

| Requirement | Version |
|---|---|
| GNS3 | 2.2.x |
| KVM / libvirt | (host machine) |
| pfSense CE image | 2.7.x |
| MikroTik CHR | 7.x |
| Ubuntu Server | 22.04 LTS |
| Python | 3.10+ (on VMs) |

---

## Network Segments (Quick Reference)

| Segment | Subnet | Gateway |
|---|---|---|
| Attacker / Internet | 192.168.122.0/24 | 192.168.122.1 (virbr0 host) |
| R1 ↔ R2 link | 10.0.12.0/30 | — |
| R2 ↔ pfSense WAN | 10.10.0.0/30 | — |
| DMZ | 10.10.10.0/24 | 10.10.10.1 (pfSense) |
| Internal | 10.10.20.0/24 | 10.10.20.1 (pfSense) |
| Management | 10.10.30.0/24 | 10.10.30.1 (pfSense) |

---

## Step 1 — GNS3 Node Placement

Create these nodes in GNS3:

| Node | Template | Interfaces Needed |
|---|---|---|
| Switch1 | Ethernet switch | e0, e1, b2 |
| Router-1 | MikroTik CHR | ether1(e0), ether2(e1/NAT), ether3(e2) |
| Router-2 | MikroTik CHR | ether1(e0), ether2(e1) |
| NAT | NAT node (built-in) | natD |
| pfSense | pfSense CE VM | vtnet0(e0), vtnet1(e1), vtnet2(e2), vtnet3(e3) |
| DMZ-Switch | Ethernet switch | e0, e1, e2, e3 |
| INT-Switch | Ethernet switch | e0, e1, e2, e3 |
| bank-web | Ubuntu 22.04 | e0 |
| bank-mail | Ubuntu 22.04 | e0 |
| teller-pc | Ubuntu 22.04 | e0 |
| customer-db | Ubuntu 22.04 | e0 |
| aegis-forwarder | Ubuntu 22.04 | e0 |
| Attacker | Kali Linux | e0 |
| Internet | Cloud (virbr0) | b2 |

### Cable Connections

```
Attacker (e0)      ──→ Switch1 (e0)
Internet/virbr0    ──→ Switch1 (b2)
Switch1 (e1)       ──→ Router-1 (e0 / ether1)
Router-1 (e2/nat)  ──→ NAT cloud (natD)
Router-1 (e1)      ──→ Router-2 (e0 / ether1)   ← check GNS3 labels
Router-2 (e1)      ──→ pfSense (e0 / vtnet0) WAN
pfSense (e1)       ──→ DMZ-Switch (e0)
pfSense (e2)       ──→ INT-Switch (e0)
DMZ-Switch (e1)    ──→ bank-web (e0)
DMZ-Switch (e2)    ──→ bank-mail (e0)
DMZ-Switch (e3)    ──→ teller-pc (e0)
INT-Switch (e1)    ──→ customer-db (e0)
INT-Switch (e2)    ──→ aegis-forwarder (e0)
```

> ⚠️ pfSense e3 (vtnet3/MGMT) — if used as separate switch, cable it to INT-Switch or dedicate a MGMT-Switch.
> Current lab: aegis-forwarder is on INT-Switch, pfSense routes to MGMT via vtnet3.

---

## Step 2 — Router-1 Configuration (MikroTik CHR)

Connect to R1 console in GNS3, then:

```routeros
# --- ether1: toward Kali/Switch1 (static) ---
/ip address add address=192.168.122.2/24 interface=ether1

# --- ether2: toward NAT cloud (DHCP — must be dynamic, not static) ---
/ip dhcp-client add interface=ether2 disabled=no

# --- ether3: toward Router-2 ---
/ip address add address=10.0.12.1/30 interface=ether3

# --- NAT masquerade for internet ---
/ip firewall nat add chain=srcnat out-interface=ether2 action=masquerade

# --- Route: internal traffic toward R2 ---
/ip route add dst-address=10.0.0.0/8 gateway=10.0.12.2

# Verify
/ip address print
/ip route print
/ping 8.8.8.8 count=4
```

> ⚠️ NAT cloud uses 192.168.122.0/24 (libvirt virbr0). Do NOT set a static IP on ether2. DHCP only.

---

## Step 3 — Router-2 Configuration (MikroTik CHR)

```routeros
# --- ether1: toward Router-1 ---
/ip address add address=10.0.12.2/30 interface=ether1

# --- ether2: toward pfSense WAN ---
/ip address add address=10.10.0.1/30 interface=ether2

# --- Routes ---
/ip route add dst-address=0.0.0.0/0 gateway=10.0.12.1
/ip route add dst-address=10.10.10.0/24 gateway=10.10.0.2
/ip route add dst-address=10.10.20.0/24 gateway=10.10.0.2
/ip route add dst-address=10.10.30.0/24 gateway=10.10.0.2

# Verify
/ip address print
/ping 10.0.12.1 count=4     # R2 → R1
/ping 10.10.0.2 count=4     # R2 → pfSense WAN
```

---

## Step 4 — pfSense Initial Configuration

Boot pfSense, use console (Option 1) to assign interfaces:

```
WAN  → vtnet0 (e0)
LAN  → vtnet1 (e1)   ← will rename to DMZ
OPT1 → vtnet2 (e2)   ← will rename to INT
OPT2 → vtnet3 (e3)   ← will rename to MGMT
```

Then use console Option 2 to set IPs:

```
WAN  : 10.10.0.2/30   GW: 10.10.0.1   (no DHCP server)
DMZ  : 10.10.10.1/24  (enable DHCP: 10.10.10.100–200)
INT  : 10.10.20.1/24  (enable DHCP: 10.10.20.100–200)
MGMT : 10.10.30.1/24  (enable DHCP: 10.10.30.100–200)
```

### pfSense Firewall Rules (WebGUI or SSH)

After setting IPs, access WebGUI at `http://10.10.10.1` from bank-web (or via SSH).

**WAN rules — allow from Kali lab:**
```
Action: Pass | Interface: WAN | Source: 192.168.122.0/24 | Destination: DMZ net
Action: Pass | Interface: WAN | Source: 192.168.122.0/24 | Destination: INT net
```

**DMZ rules — allow outbound, restrict inter-zone:**
```
Action: Pass | Interface: DMZ | Source: DMZ net | Destination: any   # outbound
Action: Block| Interface: DMZ | Source: DMZ net | Destination: INT net  # no DMZ→INT
```

**INT rules:**
```
Action: Pass | Interface: INT | Source: INT net | Destination: any
```

**MGMT rules:**
```
Action: Pass | Interface: MGMT | Source: MGMT net | Destination: any  # forwarder needs outbound HTTPS
```

---

## Step 5 — Static IPs on Ubuntu VMs

For each Ubuntu VM, set static IP via `/etc/netplan/00-installer-config.yaml`:

### bank-web (10.10.10.10)
```yaml
network:
  version: 2
  ethernets:
    ens3:
      addresses: [10.10.10.10/24]
      routes:
        - to: default
          via: 10.10.10.1
      nameservers:
        addresses: [8.8.8.8]
```
```bash
sudo netplan apply
```

### bank-mail (10.10.10.20)
Same template, address: `10.10.10.20/24`, via: `10.10.10.1`

### teller-pc (10.10.10.30)
Same template, address: `10.10.10.30/24`, via: `10.10.10.1`

### customer-db (10.10.20.20)
Same template, address: `10.10.20.20/24`, via: `10.10.20.1`

### aegis-forwarder (10.10.30.10)
Same template, address: `10.10.30.10/24`, via: `10.10.30.1`

---

## Step 6 — Install Security Tools

### bank-web — Apache + ModSecurity + Suricata

```bash
# Apache + ModSecurity WAF
sudo apt update
sudo apt install apache2 libapache2-mod-security2 -y
sudo a2enmod security2
sudo cp /etc/modsecurity/modsecurity.conf-recommended /etc/modsecurity/modsecurity.conf
sudo sed -i 's/SecRuleEngine DetectionOnly/SecRuleEngine On/' /etc/modsecurity/modsecurity.conf
sudo systemctl restart apache2

# Suricata IDS
sudo add-apt-repository ppa:oisf/suricata-stable -y
sudo apt install suricata -y
sudo suricata-update
# Start on DMZ interface (usually ens3 in GNS3)
sudo suricata -c /etc/suricata/suricata.yaml -i ens3 -D
sudo tail -f /var/log/suricata/eve.json  # verify running
```

### bank-mail — Postfix + Fail2ban

```bash
sudo apt install postfix fail2ban -y
sudo systemctl enable fail2ban
sudo systemctl start fail2ban
# Verify
sudo fail2ban-client status
```

### teller-pc — Cowrie Honeypot + Fail2ban

```bash
# Move real SSH to port 22, Cowrie will listen on 2222
sudo apt install git python3-virtualenv libssl-dev libffi-dev build-essential fail2ban -y

# Install Cowrie
cd /opt
sudo git clone https://github.com/cowrie/cowrie.git
cd cowrie
sudo virtualenv cowrie-env
source cowrie-env/bin/activate
pip install -r requirements.txt
cp etc/cowrie.cfg.dist etc/cowrie.cfg

# Configure Cowrie to listen on 2222
sudo sed -i 's/listen_port = 2222/listen_port = 2222/' etc/cowrie.cfg

# Redirect port 22 to Cowrie 2222 (catch attackers trying real SSH)
sudo iptables -t nat -A PREROUTING -p tcp --dport 22 -j REDIRECT --to-port 2222

# Start
bin/cowrie start
tail -f var/log/cowrie/cowrie.json  # verify
```

---

## Step 7 — Deploy Forwarder Hub (aegis-forwarder VM)

The **aegis-forwarder** (10.10.30.10) collects logs from all VMs via SSH and pushes to the API.

```bash
# Install dependencies
sudo apt update
sudo apt install python3-pip nmap tcpdump sshpass -y
pip3 install paramiko requests

# Get the script
sudo wget -O /opt/aegis_forwarder_hub.py \
  https://raw.githubusercontent.com/sohu2723-star/aegis-soc-dashboard/main/scripts/src/aegis_forwarder_hub.py
sudo chmod +x /opt/aegis_forwarder_hub.py
```

### Configure environment

```bash
sudo nano /etc/environment
```

Add these lines:
```
AEGIS_URL=https://aegis-api-server-jp3b.onrender.com/api
AEGIS_KEY=<your-aegis-ingest-key-from-replit-secrets>
SSH_USER=ubuntu
SSH_PASS=<common-ssh-password-for-all-vms>
```

```bash
source /etc/environment
```

### aegis_forwarder_hub.py — VM list to verify/edit

Open `/opt/aegis_forwarder_hub.py` and confirm the `REMOTE_VMS` list matches your IPs:

```python
REMOTE_VMS = [
    {"host": "10.10.10.10", "name": "bank-web",   "logs": ["/var/log/suricata/eve.json", "/var/log/apache2/modsec_audit.log"]},
    {"host": "10.10.10.20", "name": "bank-mail",  "logs": ["/var/log/fail2ban.log", "/var/log/mail.log"]},
    {"host": "10.10.10.30", "name": "teller-pc",  "logs": ["/var/log/cowrie/cowrie.json", "/var/log/auth.log", "/var/log/fail2ban.log"]},
    {"host": "10.10.20.20", "name": "customer-db","logs": ["/var/log/auth.log"]},
]

SCAN_SUBNETS = ["10.10.10.0/24", "10.10.20.0/24"]
```

### Run as systemd service

```bash
sudo nano /etc/systemd/system/aegis-hub.service
```

```ini
[Unit]
Description=AEGIS Forwarder Hub
After=network.target

[Service]
Type=simple
User=root
EnvironmentFile=/etc/environment
ExecStart=/usr/bin/python3 /opt/aegis_forwarder_hub.py
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable aegis-hub
sudo systemctl start aegis-hub
sudo systemctl status aegis-hub
```

---

## Step 8 — Deploy Defense Agent (bank-web / teller-pc)

The defense agent polls the AEGIS API for pending block commands and executes them.

```bash
# On bank-web and/or teller-pc
sudo wget -O /opt/defense_agent.py \
  https://raw.githubusercontent.com/sohu2723-star/aegis-soc-dashboard/main/scripts/src/defense_agent.py

sudo nano /etc/systemd/system/aegis-defense.service
```

```ini
[Unit]
Description=AEGIS Defense Agent
After=network.target

[Service]
Type=simple
User=root
Environment=AEGIS_URL=https://aegis-api-server-jp3b.onrender.com/api
Environment=AEGIS_KEY=<ingest-key>
Environment=AEGIS_ADMIN_KEY=<admin-key>
ExecStart=/usr/bin/python3 /opt/defense_agent.py --vm ubuntu
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable aegis-defense
sudo systemctl start aegis-defense
```

---

## Step 9 — Kali Attacker Setup

Kali connects through Switch1 → Router-1 → Router-2 → pfSense → targets.

```bash
# Verify Kali can reach DMZ
ping 10.10.10.10   # bank-web

# If no reply, check route:
ip route add 10.10.10.0/24 via 192.168.122.2   # via R1
ip route add 10.10.20.0/24 via 192.168.122.2
```

---

## Step 10 — End-to-End Test

### Test 1: API connectivity (from aegis-forwarder VM)

```bash
curl -s -X POST https://aegis-api-server-jp3b.onrender.com/api/ingest/ssh \
  -H "Content-Type: application/json" \
  -H "X-AEGIS-Key: $AEGIS_KEY" \
  -d '{"src_ip":"10.10.10.30","username":"root","status":"failed","failures":5}'
# Expected: {"ok":true}
```

→ Check **Security Events** page on dashboard. SSH brute-force event should appear.

### Test 2: Network host discovery

```bash
# From aegis-forwarder
nmap -sn 10.10.10.0/24 -oG - | \
  grep "Up" | awk '{print $2}' | while read ip; do
    curl -s -X POST https://aegis-api-server-jp3b.onrender.com/api/network/hosts \
      -H "X-AEGIS-Key: $AEGIS_KEY" \
      -H "Content-Type: application/json" \
      -d "{\"ip\":\"$ip\",\"hostname\":\"unknown\",\"status\":\"online\"}"
  done
```

→ Check **Network Monitor** page. Hosts should appear.

### Test 3: Kali attack → Suricata → Dashboard

```bash
# On Kali — port scan bank-web
nmap -sV -p 22,80,443,3306 10.10.10.10

# On bank-web — verify Suricata caught it
sudo tail -f /var/log/suricata/eve.json | grep "alert"
```

→ Within 15s, event should appear on AEGIS Security Events page.

### Test 4: Auto-defense trigger

```bash
# On Kali — SSH brute-force teller-pc (Cowrie will catch)
hydra -l root -P /usr/share/wordlists/rockyou.txt ssh://10.10.10.30 -t 4

# Watch dashboard Defense Center — auto-block should appear after threshold hits
```

---

## Troubleshooting

### Hub forwarder not connecting to VMs?
```bash
# From aegis-forwarder
ssh ubuntu@10.10.10.10 "tail -5 /var/log/suricata/eve.json"
# If timeout: check pfSense MGMT→DMZ firewall rule allows SSH
```

### Events not appearing on dashboard?
```bash
# Check hub logs
sudo journalctl -u aegis-hub -f

# Check API server health
curl https://aegis-api-server-jp3b.onrender.com/api/health
```

### pfSense blocking forwarder?
```bash
# Add rule: MGMT net → any → pass (in pfSense WebGUI)
# Or via SSH on pfSense:
pfSsh.php playback enableallowallwan
```

### Kali can't reach DMZ VMs?
```bash
# On Kali — add route through R1
sudo ip route add 10.10.0.0/8 via 192.168.122.2 dev eth0

# On R1 — verify masquerade is on
/ip firewall nat print
```

### Defense agent not executing blocks?
```bash
# Check agent is running with sudo
sudo systemctl status aegis-defense

# Manual test
sudo iptables -L INPUT -n | grep DROP   # see if blocks are there
```

---

## Quick-Reference: All Keys & URLs

| Item | Value |
|---|---|
| API Server | `https://aegis-api-server-jp3b.onrender.com/api` |
| Dashboard | `https://aegis-soc-dashboard.vercel.app` |
| Ingest key env var | `AEGIS_KEY` (value in Replit Secrets: AEGIS_INGEST_KEY) |
| Admin key env var | `AEGIS_ADMIN_KEY` (value in Replit Secrets: AEGIS_ADMIN_KEY) |
| Ingest header | `X-AEGIS-Key: <AEGIS_INGEST_KEY>` |
| Admin header | `X-AEGIS-Admin-Key: <AEGIS_ADMIN_KEY>` |
