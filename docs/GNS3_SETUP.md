# AEGIS-SecureBank — GNS3 Setup Guide
> Last updated: 2026-07-10
> IP plan matches: per-VM scripts/src/aegis_forwarder.py deployments (canonical source of truth)

---

## Prerequisites

| Requirement | Notes |
|---|---|
| GNS3 2.2.x | With KVM/QEMU backend |
| pfSense CE 2.7.x | Download ISO from pfsense.org |
| MikroTik CHR | RouterOS 7.x — chr-7.x.img |
| Ubuntu Server 22.04 | For all bank VMs + aegis-forwarder |
| Kali Linux | Latest rolling release |
| Python 3.10+ | On aegis-forwarder VM |

---

## Quick IP Reference

| Node | IP | Subnet |
|---|---|---|
| Kali Linux | 192.168.122.132 (DHCP) | virbr0 |
| Router-1 ether1 | 192.168.122.2/24 | virbr0 |
| Router-1 ether3 | 10.0.12.1/30 | R1↔R2 |
| Router-2 ether1 | 10.0.12.2/30 | R1↔R2 |
| Router-2 ether2 | 10.0.23.1/30 | R2↔pfSense |
| pfSense WAN | 10.0.23.2/30 | R2↔pfSense |
| pfSense DMZ | 10.10.10.1/24 | DMZ |
| pfSense INT | 10.20.20.1/24 | Internal |
| pfSense MGMT | 10.30.30.1/24 | Management |
| bank-web | 10.10.10.10/24 | DMZ |
| bank-mail | 10.10.10.20/24 | DMZ |
| teller-pc | 10.20.20.10/24 | Internal |
| customer-db | 10.20.20.20/24 | Internal |
| aegis-forwarder | 10.30.30.10/24 | Management |

---

## Step 1 — GNS3 Node Placement & Cabling

### Nodes to create

| Node | Template | Interfaces |
|---|---|---|
| Switch1 | Ethernet switch | e0, e1, b2 |
| Router-1 | MikroTik CHR | ether1(e0), ether2(e1), ether3(e2) |
| Router-2 | MikroTik CHR | ether1(e0), ether2(e1) |
| NAT | Built-in NAT node | natD |
| pfSense | pfSense CE VM | vtnet0(e0), vtnet1(e1), vtnet2(e2), vtnet3(e3) |
| DMZ-Switch | Ethernet switch | e0–e3 |
| INT-Switch | Ethernet switch | e0–e4 |
| bank-web | Ubuntu 22.04 | e0 |
| bank-mail | Ubuntu 22.04 | e0 |
| teller-pc | Ubuntu 22.04 | e0 |
| customer-db | Ubuntu 22.04 | e0 |
| aegis-forwarder | Ubuntu 22.04 | e0 |
| Attacker | Kali Linux | e0 |
| Internet | Cloud node (virbr0) | b2 |

### Cable connections

```
Attacker (e0)          → Switch1 (e0)
Internet/virbr0 (b2)   → Switch1 (b2)
Switch1 (e1)           → Router-1 (e0 / ether1)
Router-1 (e1 / ether2) → NAT cloud (natD)
Router-1 (e2 / ether3) → Router-2 (e0 / ether1)
Router-2 (e1 / ether2) → pfSense (e0 / vtnet0)  ← WAN
pfSense (e1 / vtnet1)  → DMZ-Switch (e0)
pfSense (e2 / vtnet2)  → INT-Switch (e0)
pfSense (e3 / vtnet3)  → INT-Switch (e1)          ← MGMT port on same switch
DMZ-Switch (e1)        → bank-web (e0)
DMZ-Switch (e2)        → bank-mail (e0)
INT-Switch (e2)        → teller-pc (e0)
INT-Switch (e3)        → customer-db (e0)
INT-Switch (e4)        → aegis-forwarder (e0)
```

> **MGMT path:** pfSense vtnet3 (10.30.30.1) plugs into INT-Switch. aegis-forwarder plugs into
> the same INT-Switch. pfSense routes 10.30.30.0/24 out vtnet3 — aegis-forwarder gets its
> MGMT IP that way without needing a separate physical switch.

---

## Step 2 — Router-1 Configuration (MikroTik CHR)

Connect to R1 console in GNS3:

```routeros
# ether1 → Switch1 / Kali side (static)
/ip address add address=192.168.122.2/24 interface=ether1

# ether2 → NAT cloud (MUST be DHCP — NAT cloud is 192.168.122.0/24 libvirt)
/ip dhcp-client add interface=ether2 disabled=no

# ether3 → Router-2
/ip address add address=10.0.12.1/30 interface=ether3

# NAT masquerade — all traffic out ether2 gets NAT
/ip firewall nat add chain=srcnat out-interface=ether2 action=masquerade

# Route: all internal traffic goes toward R2
/ip route add dst-address=10.0.0.0/8 gateway=10.0.12.2

# Verify
/ip address print
/ip route print
/ping 8.8.8.8 count=4        # internet test via NAT
/ping 10.0.12.2 count=4      # R1 → R2 link test
```

> ⚠️ **Do NOT set a static IP on ether2.** The GNS3 NAT cloud uses 192.168.122.0/24
> (libvirt virbr0 DHCP). A static 10.x.x.x on ether2 will not route.

---

## Step 3 — Router-2 Configuration (MikroTik CHR)

```routeros
# ether1 → Router-1
/ip address add address=10.0.12.2/30 interface=ether1

# ether2 → pfSense WAN
/ip address add address=10.0.23.1/30 interface=ether2

# Default route toward internet via R1
/ip route add dst-address=0.0.0.0/0 gateway=10.0.12.1

# Routes toward pfSense segments
/ip route add dst-address=10.10.10.0/24 gateway=10.0.23.2
/ip route add dst-address=10.20.20.0/24 gateway=10.0.23.2
/ip route add dst-address=10.30.30.0/24 gateway=10.0.23.2

# Verify
/ip address print
/ping 10.0.12.1 count=4      # R2 → R1
/ping 10.0.23.2 count=4      # R2 → pfSense WAN
```

---

## Step 4 — pfSense Initial Configuration

### 4a. Console interface assignment (Option 1)

Boot pfSense, at console choose **Option 1 — Assign Interfaces**:

```
WAN  → vtnet0   (e0)
LAN  → vtnet1   (e1)   rename to DMZ after
OPT1 → vtnet2   (e2)   rename to INT
OPT2 → vtnet3   (e3)   rename to MGMT
```

### 4b. Console IP assignment (Option 2)

```
Interface  IP              DHCP server range
─────────  ──────────────  ────────────────────────────
WAN        10.0.23.2/30    none (upstream: 10.0.23.1)
DMZ        10.10.10.1/24   10.10.10.100–200
INT        10.20.20.1/24   10.20.20.100–200
MGMT       10.30.30.1/24   10.30.30.100–200
```

### 4c. WebGUI firewall rules

Access WebGUI via pfSense console → browser on any connected VM.

**WAN — allow Kali lab to reach DMZ and Internal:**
```
Action: Pass | IF: WAN | Src: 192.168.122.0/24 | Dst: 10.10.10.0/24
Action: Pass | IF: WAN | Src: 192.168.122.0/24 | Dst: 10.20.20.0/24
```

**DMZ — outbound yes, no DMZ→Internal:**
```
Action: Pass  | IF: DMZ | Src: DMZ net    | Dst: any
Action: Block | IF: DMZ | Src: DMZ net    | Dst: 10.20.20.0/24
```

**INT — outbound yes:**
```
Action: Pass | IF: INT  | Src: INT net    | Dst: any
```

**MGMT — aegis-forwarder needs outbound HTTPS to Render:**
```
Action: Pass | IF: MGMT | Src: MGMT net  | Dst: any
```

---

## Step 5 — Static IPs on Ubuntu VMs

For each VM, edit `/etc/netplan/00-installer-config.yaml`:

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

### bank-mail (10.10.10.20)
Same template — address: `10.10.10.20/24`, via: `10.10.10.1`

### teller-pc (10.20.20.10)
Same template — address: `10.20.20.10/24`, via: `10.20.20.1`

### customer-db (10.20.20.20)
Same template — address: `10.20.20.20/24`, via: `10.20.20.1`

### aegis-forwarder (10.30.30.10)
Same template — address: `10.30.30.10/24`, via: `10.30.30.1`

Apply on each VM:
```bash
sudo netplan apply
ip addr show ens3   # verify IP
ping 10.0.23.2      # ping pfSense WAN to confirm routing
```

---

## Step 6 — Passwordless sudo on aegis-forwarder (Required for nmap + tcpdump)

There is no central SSH hub — each VM runs its own local `aegis_forwarder.py` (Step 8) and
reads only its own log files, so no cross-VM SSH access or shared user is required.

The **aegis-forwarder** VM still needs passwordless sudo locally, because its own
`aegis_forwarder.py --mode all` process also runs the nmap network scanner and tcpdump
traffic capture for itself:

```bash
# On aegis-forwarder only
echo "$USER ALL=(ALL) NOPASSWD: ALL" | sudo tee /etc/sudoers.d/aegis-forwarder
```

---

## Step 7 — Install Security Tools on VMs

### bank-web (10.10.10.10) — Apache + ModSecurity + Suricata

```bash
# Apache + ModSecurity WAF
sudo apt update
sudo apt install apache2 libapache2-mod-security2 -y
sudo a2enmod security2
sudo cp /etc/modsecurity/modsecurity.conf-recommended /etc/modsecurity/modsecurity.conf
sudo sed -i 's/SecRuleEngine DetectionOnly/SecRuleEngine On/' /etc/modsecurity/modsecurity.conf
sudo systemctl restart apache2

# Verify WAF is blocking
curl -v "http://localhost/?id=1'%20OR%20'1'='1" 2>&1 | grep "403\|forbidden"

# Suricata IDS
sudo add-apt-repository ppa:oisf/suricata-stable -y
sudo apt install suricata -y
sudo suricata-update
sudo suricata -c /etc/suricata/suricata.yaml -i ens3 -D
sudo tail -5 /var/log/suricata/eve.json   # verify running
```

### bank-mail (10.10.10.20) — Postfix + Fail2ban

```bash
sudo apt install postfix fail2ban -y
sudo systemctl enable --now fail2ban
sudo fail2ban-client status   # verify
```

### teller-pc (10.20.20.10) — Cowrie Honeypot + Fail2ban

```bash
sudo apt install git python3-virtualenv libssl-dev libffi-dev build-essential fail2ban -y

# Install Cowrie
cd /home
sudo useradd -r -s /bin/false cowrie
sudo mkdir /home/cowrie && sudo chown cowrie:cowrie /home/cowrie
sudo -u cowrie git clone https://github.com/cowrie/cowrie.git /home/cowrie/cowrie
cd /home/cowrie/cowrie
sudo -u cowrie virtualenv cowrie-env
sudo -u cowrie bash -c "source cowrie-env/bin/activate && pip install -r requirements.txt"
sudo -u cowrie cp etc/cowrie.cfg.dist etc/cowrie.cfg

# Configure Cowrie to listen on port 2222
sudo -u cowrie sed -i 's/^#\?\s*listen_port\s*=.*/listen_port = 2222/' etc/cowrie.cfg

# Redirect real SSH attempts on port 22 to Cowrie on 2222
sudo iptables -t nat -A PREROUTING -p tcp --dport 22 -j REDIRECT --to-port 2222
# Persist iptables rule
sudo apt install iptables-persistent -y
sudo netfilter-persistent save

# Start Cowrie
sudo -u cowrie bash -c "cd /home/cowrie/cowrie && source cowrie-env/bin/activate && bin/cowrie start"
tail -f /home/cowrie/cowrie/var/log/cowrie/cowrie.json   # verify running

# Fail2ban
sudo systemctl enable --now fail2ban
```

---

## Step 8 — Deploy aegis_forwarder.py on EVERY VM (agent mode — no central hub)

Each VM (bank-web, bank-mail, teller-pc, customer-db, aegis-forwarder) runs its **own**
local copy of `aegis_forwarder.py`, tailing only its own log files. There is no SSH between
VMs and no shared user — just repeat these steps on each of the five VMs.

### 8a. Install dependencies (on each VM)

```bash
sudo apt update
sudo apt install python3-pip -y
pip3 install requests

# aegis-forwarder VM only (runs the network scanner + traffic capture for itself):
sudo apt install nmap tcpdump -y
```

### 8b. Download script (on each VM)

```bash
sudo wget -O /opt/aegis_forwarder.py \
  https://raw.githubusercontent.com/sohu2723-star/aegis-soc-dashboard/main/scripts/src/aegis_forwarder.py
sudo chmod +x /opt/aegis_forwarder.py
```

### 8c. Configure environment (on each VM)

```bash
sudo tee /etc/environment.aegis << 'EOF'
AEGIS_URL=https://aegis-api-server-jp3b.onrender.com/api
AEGIS_KEY=<value of AEGIS_INGEST_KEY from Replit Secrets>
EOF

# Test manually first
source /etc/environment.aegis
python3 /opt/aegis_forwarder.py --mode all
# Should print heartbeat + sensor watch lines for THIS VM's own logs
```

### 8d. Run as systemd service (on each VM)

```bash
sudo tee /etc/systemd/system/aegis-forwarder.service << 'EOF'
[Unit]
Description=AEGIS Forwarder (local agent)
After=network.target

[Service]
Type=simple
User=root
EnvironmentFile=/etc/environment.aegis
ExecStart=/usr/bin/python3 /opt/aegis_forwarder.py --mode all
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now aegis-forwarder
sudo systemctl status aegis-forwarder
sudo journalctl -u aegis-forwarder -f   # watch live output
```

---

## Step 9 — Deploy defense_agent.py (bank-web + teller-pc)

```bash
# On bank-web and teller-pc
sudo wget -O /opt/defense_agent.py \
  https://raw.githubusercontent.com/sohu2723-star/aegis-soc-dashboard/main/scripts/src/defense_agent.py

sudo tee /etc/systemd/system/aegis-defense.service << 'EOF'
[Unit]
Description=AEGIS Defense Agent
After=network.target

[Service]
Type=simple
User=root
Environment=AEGIS_URL=https://aegis-api-server-jp3b.onrender.com/api
Environment=AEGIS_KEY=<AEGIS_INGEST_KEY value>
Environment=AEGIS_ADMIN_KEY=<AEGIS_ADMIN_KEY value>
ExecStart=/usr/bin/python3 /opt/defense_agent.py --vm ubuntu
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now aegis-defense
```

---

## Step 10 — Kali Attacker Routes

Kali needs routes to reach DMZ (10.10.10.0/24) and Internal (10.20.20.0/24) via Router-1:

```bash
# On Kali — add persistent routes
sudo ip route add 10.10.10.0/24 via 192.168.122.2
sudo ip route add 10.20.20.0/24 via 192.168.122.2
sudo ip route add 10.30.30.0/24 via 192.168.122.2

# Verify reachability
ping -c 2 10.10.10.10   # bank-web
ping -c 2 10.20.20.10   # teller-pc
```

---

## Step 11 — End-to-End Tests

### Test 1: API health check (from aegis-forwarder)
```bash
curl -s https://aegis-api-server-jp3b.onrender.com/api/health
# Expected: {"status":"ok"}
```

### Test 2: Manual ingest event
```bash
curl -s -X POST https://aegis-api-server-jp3b.onrender.com/api/ingest/ssh \
  -H "Content-Type: application/json" \
  -H "X-AEGIS-Key: $AEGIS_KEY" \
  -d '{"src_ip":"192.168.122.132","username":"root","status":"failed","failures":5}'
# Expected: {"ok":true}
```
→ Open dashboard → **Security Events** — SSH brute-force event appears.

### Test 3: Verify each VM's forwarder is running
```bash
# On each VM (bank-web, bank-mail, teller-pc, customer-db, aegis-forwarder)
sudo journalctl -u aegis-forwarder --since "1 min ago"
# Should show sensor watch lines for that VM's own logs, e.g.:
#   [TAIL] /var/log/suricata/eve.json
#   [HEARTBEAT] My IP = 10.10.10.10
```

### Test 4: Kali → Suricata → Dashboard
```bash
# On Kali
nmap -sV -p 22,80,443 10.10.10.10

# On bank-web — verify detection
sudo tail -f /var/log/suricata/eve.json | grep '"event_type":"alert"'
```
→ Within 15s, alert appears on dashboard **Security Events** page.

### Test 5: Auto-defense trigger
```bash
# On Kali — SSH brute force teller-pc (Cowrie catches it)
hydra -l root -P /usr/share/wordlists/rockyou.txt ssh://10.20.20.10 -t 4

# Dashboard → Defense Center → auto-block should appear after threshold
```

### Test 6: Network discovery (check Network Monitor page)
```bash
# From aegis-forwarder — manual nmap to populate hosts
sudo nmap -sn 10.10.10.0/24 -oG - | grep Up | awk '{print $2}'
```
→ Dashboard **Network Monitor** — hosts populate.

---

## Troubleshooting

### Forwarder not reading its own log files?
```bash
# On the affected VM — the forwarder runs as root via systemd, so it should
# already have read access. If a log lives under a non-root owner (e.g. Cowrie):
sudo chmod o+r /var/log/suricata/eve.json 2>/dev/null
sudo chmod o+r /home/cowrie/cowrie/var/log/cowrie/cowrie.json 2>/dev/null
sudo systemctl restart aegis-forwarder
```

### Events not appearing on dashboard?
```bash
# 1. Check forwarder logs on the specific VM
sudo journalctl -u aegis-forwarder -f

# 2. Test API key manually
curl -s -X POST $AEGIS_URL/ingest/event \
  -H "X-AEGIS-Key: $AEGIS_KEY" \
  -H "Content-Type: application/json" \
  -d '{"source":"test","type":"network_scan","subtype":"Test","severity":"low","sourceIp":"1.2.3.4","description":"test"}'

# 3. Check API server is up
curl https://aegis-api-server-jp3b.onrender.com/api/health
```

### tcpdump / nmap not working (Traffic shows 0)?
```bash
# aegis-forwarder VM needs passwordless sudo (it's the only VM running the scanner)
sudo -n true && echo "sudo OK" || echo "NEEDS PASSWORD"
# Fix:
echo "$USER ALL=(ALL) NOPASSWD: ALL" | sudo tee /etc/sudoers.d/aegis-forwarder
```

### Kali can't reach DMZ?
```bash
# Verify route on Kali
ip route show | grep 10.10.10
# If missing:
sudo ip route add 10.10.10.0/24 via 192.168.122.2

# Verify R1 is routing (MikroTik console)
/ip route print
/ping 10.0.23.2 count=4   # R1 → pfSense WAN via R2
```

### Defense agent not executing blocks?
```bash
sudo systemctl status aegis-defense
sudo journalctl -u aegis-defense -f
sudo iptables -L INPUT -n | grep DROP   # see active blocks
```

---

## Quick Keys & URLs Reference

| Item | Value |
|---|---|
| API Base URL | `https://aegis-api-server-jp3b.onrender.com/api` |
| Dashboard URL | `https://aegis-soc-dashboard.vercel.app` |
| Ingest env var | `AEGIS_KEY` (value = AEGIS_INGEST_KEY from Replit Secrets) |
| Admin env var | `AEGIS_ADMIN_KEY` (value = AEGIS_ADMIN_KEY from Replit Secrets) |
| Ingest request header | `X-AEGIS-Key: <value>` |
| Admin request header | `X-AEGIS-Admin-Key: <value>` |
| Forwarder script location | `/opt/aegis_forwarder.py` on every VM |
| Defense agent | `/opt/defense_agent.py` on bank-web / teller-pc |
