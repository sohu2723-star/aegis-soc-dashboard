# AEGIS-SecureCompany — GNS3 Setup Guide
> Last updated: 2026-07-20
> Topology v4 (Final) — OVS Switch x2, DNS-Server (10.10.10.20) + LDAP-Server (10.20.20.20), company-customer-db IP = 10.20.20.10

---

## Prerequisites

| Requirement | Notes |
|---|---|
| GNS3 2.2.x | With KVM/QEMU backend |
| pfSense CE 2.7.x | Download ISO from pfsense.org |
| MikroTik CHR | RouterOS 7.x — chr-7.x.img |
| Ubuntu Server 22.04 | For all company VMs + aegis-company-admin |
| Kali Linux | Latest rolling release |
| Open vSwitch (OVS) | GNS3 appliance — Public-Services + Internal-Services switches |
| Python 3.10+ | On aegis-company-admin VM only |

---

## Quick IP Reference (v4 — Final)

| Node | IP | Network | Role |
|---|---|---|---|
| Internet (virbr0) | — | 192.168.122.0/24 | GNS3 NAT cloud |
| Router e0 (ether1) | 192.168.122.2/24 | Internet side | MikroTik CHR |
| Router e1 (ether2) | 192.168.10.1/24 | Attacker DHCP gateway | |
| Router e2 (ether3) | 10.0.23.1/30 | pfSense WAN link | |
| Kali / Attacker | DHCP 192.168.10.x | 192.168.10.0/24 | Red Team |
| pfSense WAN (e0) | 10.0.23.2/30 | Router↔pfSense | |
| pfSense DMZ (e1) | 10.10.10.1/24 | Public Services GW | |
| pfSense INT (e2) | 10.20.20.1/24 | Internal Services GW | |
| pfSense MGMT (e3) | 10.30.30.1/24 | Management GW | |
| Public-Services OVS | — | — | DMZ switch |
| company-web-server | 10.10.10.10/24 | DMZ | Apache2, vsftpd, Suricata, Fail2ban |
| DNS-Server | 10.10.10.20/24 | DMZ | BIND9 DNS |
| Internal-Services OVS | — | — | Internal switch |
| company-customer-db | 10.20.20.10/24 | Internal | MySQL, Suricata, Fail2ban |
| LDAP-Server | 10.20.20.20/24 | Internal | OpenLDAP |
| aegis-company-admin | 10.30.30.10/24 | Management | Hub agent (SSH → company VMs) |

**Removed from v3:** Router-2, Switch1, bank-mail (10.10.10.20 old), teller-pc (10.20.20.10 old)

---

## Step 1 — GNS3 Node Placement & Cabling

### Nodes to create (v4)

| Node | Template | Interfaces needed |
|---|---|---|
| Internet | Cloud node (virbr0) | virbr0 |
| Router | MikroTik CHR | e0 (ether1), e1 (ether2), e2 (ether3) |
| Attacker | Kali Linux | e0 |
| pfSense | pfSense CE VM | e0 (WAN), e1 (DMZ), e2 (INT), e3 (MGMT) |
| Public-Services | Open vSwitch | eth0, eth1, eth2 |
| Internal-Services | Open vSwitch | eth0, eth1, eth2 |
| company-web-server | Ubuntu Server 22.04 | e0 |
| DNS-Server | Ubuntu Server 22.04 | e0 |
| company-customer-db | Ubuntu Server 22.04 | e0 |
| LDAP-Server | Ubuntu Server 22.04 | e0 |
| aegis-company-admin | Ubuntu Server 22.04 | e0 |

### Cable connections (v4)

```
Internet/virbr0       → Router e0 (ether1: 192.168.122.2)       [direct]
Attacker/Kali e0      → Router e1 (ether2: DHCP gateway .1)     [direct]
Router e2 (ether3)    → pfSense e0 WAN (10.0.23.x /30)          [direct]

pfSense e1 (DMZ)      → Public-Services OVS eth0                [direct]
Public-Services eth1  → company-web-server e0 (10.10.10.10)               [direct]
Public-Services eth2  → DNS-Server e0 (10.10.10.20)             [direct]

pfSense e2 (INT)      → Internal-Services OVS eth0              [direct]
Internal-Services eth1 → company-customer-db e0 (10.20.20.10)           [direct]
Internal-Services eth2 → LDAP-Server e0 (10.20.20.20)           [direct]

pfSense e3 (MGMT)     → aegis-company-admin e0 (10.30.30.10)            [direct]
```

---

## Step 2 — Router (MikroTik CHR) Configuration

Router တစ်ခုတည်းသာ ရှိတယ် (R2 ဖြုတ်ပြီ)။ GNS3 Router console မှာ:

```routeros
# ── Interface IP Assignment ──────────────────────────────────────
# e0 (ether1) → Internet (virbr0 NAT cloud)
/ip address add address=192.168.122.2/24 interface=ether1
# ဘာကြောင့်: Host machine ရဲ့ virbr0 (192.168.122.1) network နဲ့ connect ဖို့

# e1 (ether2) → Attacker/Kali network — DHCP server ဖြစ်မည်
/ip address add address=192.168.10.1/24 interface=ether2
# ဘာကြောင့်: Kali VM ကို DHCP ပေးမဲ့ gateway

# e2 (ether3) → pfSense WAN (point-to-point /30)
/ip address add address=10.0.23.1/30 interface=ether3
# ဘာကြောင့်: Router နဲ့ pfSense ကြား direct link

# ── Default Route ───────────────────────────────────────────────
/ip route add dst-address=0.0.0.0/0 gateway=192.168.122.1
# ဘာကြောင့်: Internet traffic → host machine NAT ကတဆင့် ထွက်

# ── Internal Route ──────────────────────────────────────────────
/ip route add dst-address=10.0.0.0/8 gateway=10.0.23.2
# ဘာကြောင့်: 10.x.x.x network (bank services) → pfSense ကတဆင့် ရောက်

# ── NAT Masquerade ──────────────────────────────────────────────
/ip firewall nat add chain=srcnat action=masquerade out-interface=ether1
# ဘာကြောင့်: Lab traffic internet ထွက်ရင် router IP နဲ့ NAT

# ── Firewall: Allow Forward ──────────────────────────────────────
/ip firewall filter add chain=forward action=accept place-before=0
# ဘာကြောင့်: MikroTik default က forward traffic ပိတ်ထားတာကြောင့်

# ── DHCP Pool for Kali ──────────────────────────────────────────
/ip pool add name=kali-pool ranges=192.168.10.2-192.168.10.100
/ip dhcp-server add name=kali-dhcp interface=ether2 address-pool=kali-pool disabled=no
/ip dhcp-server network add address=192.168.10.0/24 gateway=192.168.10.1 company-dns-server=8.8.8.8
# ဘာကြောင့်: Kali VM ကို auto IP ပေးဖို့

# ── Verify ──────────────────────────────────────────────────────
/ip address print           # IP တွေ မှန်မမှန် စစ်
/ip route print             # Route table ကြည့်
/ip dhcp-server print       # DHCP server status
/ping 8.8.8.8 count=4      # Internet test
/ping 10.0.23.2 count=4    # pfSense WAN test
```

> ⚠️ **ether1 မှာ static IP (192.168.122.2) ထည့်ပါ — DHCP client မသုံးနဲ့**  
> GNS3 NAT cloud (virbr0) သည် 192.168.122.0/24 ဖြစ်ပြီး router ကနေ static ထည့်မှ route table မှန်ကန်တယ်။

---

## Step 3 — pfSense Initial Configuration

### 3a. Console Interface Assignment (Option 1)

pfSense boot ဖြစ်ရင် console မှာ **Option 1 — Assign Interfaces** ရွေး:

```
WAN  → vtnet0   (e0)   ← Router e2 မှ WAN traffic ဝင်
DMZ  → vtnet1   (e1)   ← Public Services (company-web-server, DNS-Server)
INT  → vtnet2   (e2)   ← Internal Services (company-customer-db, LDAP-Server)
MGMT → vtnet3   (e3)   ← Management (aegis-company-admin)
```

### 3b. Console IP Assignment (Option 2)

```
Interface  IP              Gateway    DHCP Range
─────────  ──────────────  ─────────  ─────────────────
WAN        10.0.23.2/30    10.0.23.1  (none)
DMZ        10.10.10.1/24   (none)     10.10.10.100–200
INT        10.20.20.1/24   (none)     10.20.20.100–200
MGMT       10.30.30.1/24   (none)     10.30.30.100–200
```

### 3c. WebGUI Firewall Rules

WebGUI: `http://10.30.30.1` (MGMT interface မှ access)  
Default login: `admin` / `pfsense`

**WAN — Attacker traffic ခွင့်ပြု:**
```
Action: Pass | Interface: WAN | Source: 192.168.10.0/24 | Destination: any
```
*ဘာကြောင့်: Kali (192.168.10.x) မှ lab network ထဲ ဝင်နိုင်ဖို့*

**DMZ — company-web-server, DNS outbound ခွင့်ပြု + Internal ပိတ်:**
```
Action: Pass  | Interface: DMZ | Source: DMZ net | Destination: any
Action: Block | Interface: DMZ | Source: DMZ net | Destination: 10.20.20.0/24
```
*ဘာကြောင့်: company-web-server က internet ရနိုင်သော်လည်း company-customer-db/LDAP ကို တိုက်ရိုက် မဝင်နိုင်ဖို့*

**INT — Internal outbound ခွင့်ပြု:**
```
Action: Pass | Interface: INT | Source: INT net | Destination: any
```

**MGMT — aegis-company-admin အတွက် အကုန် ခွင့်ပြု:**
```
Action: Pass | Interface: MGMT | Source: MGMT net | Destination: any
```
*ဘာကြောင့်: aegis-company-admin (10.30.30.10) က company-web-server, DNS, company-customer-db, LDAP ကို SSH ဝင်နိုင်ဖို့*

### 3d. pfSense Static Route (Kali return path)

WebGUI → **System → Routing → Static Routes → Add**:
```
Network:   192.168.10.0/24
Gateway:   10.0.23.1  (Router WAN)
```
*ဘာကြောင့်: Kali (192.168.10.x) ကို response packet ပြန်ပို့ဖို့*

### 3e. pfSense SSH Enable (aegis-company-admin access)

```
WebGUI → System → Advanced → Admin Access
→ Secure Shell Server → ☑ Enable Secure Shell
→ Save
```

### 3f. pfSense SSH Key (passwordless access)

```
WebGUI → System → User Manager → admin → Edit
→ Authorized SSH Keys → aegis-company-admin ရဲ့ public key paste
→ Save
```

*aegis-company-admin ကနေ key ကြည့်ဖို့:*
```bash
cat ~/.ssh/pfsense_key.pub
```

---

## Step 4 — OVS Switch Configuration (Open vSwitch)

GNS3 မှာ OVS switch console ဖွင့်ပြီး VLAN port configure လုပ်ရမယ်။

### ဘာကြောင့် OVS သုံးတာလဲ?
GNS3 built-in Ethernet switch = VLAN မပါ။ OVS = VLAN tagging, trunk/access port support → DMZ နဲ့ Internal segment ကို switch level မှာ ခွဲနိုင်တယ်။

### Public-Services Switch (company-web-server + DNS-Server)

```bash
# OVS console မှာ
ovs-vsctl show
# eth0 = pfSense e1 ချိတ် — trunk (tag မထည့် = all VLANs ဖြတ်)
# eth1 = company-web-server ချိတ် — access port VLAN 10
ovs-vsctl set port eth1 tag=10

# eth2 = DNS-Server ချိတ် — access port VLAN 10
ovs-vsctl set port eth2 tag=10

# Verify
ovs-vsctl show
```

### Internal-Services Switch (company-customer-db + LDAP-Server)

```bash
# eth0 = pfSense e2 ချိတ် — trunk
# eth1 = company-customer-db ချိတ် — access port VLAN 20
ovs-vsctl set port eth1 tag=20

# eth2 = LDAP-Server ချိတ် — access port VLAN 20
ovs-vsctl set port eth2 tag=20

# Verify
ovs-vsctl show
```

### VLAN Reference

| VLAN ID | Segment | VMs |
|---|---|---|
| 10 | DMZ (Public) | company-web-server (10.10.10.10), DNS-Server (10.10.10.20) |
| 20 | Internal | company-customer-db (10.20.20.10), LDAP-Server (10.20.20.20) |

---

## Step 5 — Static IPs on Ubuntu VMs (Netplan)

ဒီ template ကို ဘယ် VM မှာမဆို `/etc/netplan/00-installer-config.yaml` ထဲ ထည့်ပြီး IP ပြောင်းသုံးပါ:

### company-web-server (10.10.10.10 / DMZ)

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
        addresses: [10.10.10.20, 8.8.8.8]
```

### DNS-Server (10.10.10.20 / DMZ)

```yaml
network:
  version: 2
  ethernets:
    ens3:
      addresses: [10.10.10.20/24]
      routes:
        - to: default
          via: 10.10.10.1
      nameservers:
        addresses: [127.0.0.1, 8.8.8.8]
```

### company-customer-db (10.20.20.10 / Internal)

```yaml
network:
  version: 2
  ethernets:
    ens3:
      addresses: [10.20.20.10/24]
      routes:
        - to: default
          via: 10.20.20.1
      nameservers:
        addresses: [10.10.10.20, 8.8.8.8]
```

### LDAP-Server (10.20.20.20 / Internal)

```yaml
network:
  version: 2
  ethernets:
    ens3:
      addresses: [10.20.20.20/24]
      routes:
        - to: default
          via: 10.20.20.1
      nameservers:
        addresses: [10.10.10.20, 8.8.8.8]
```

### aegis-company-admin (10.30.30.10 / MGMT)

```yaml
network:
  version: 2
  ethernets:
    ens3:
      addresses: [10.30.30.10/24]
      routes:
        - to: default
          via: 10.30.30.1
      nameservers:
        addresses: [10.10.10.20, 8.8.8.8]
```

Apply on each VM:
```bash
sudo netplan apply
ip addr show ens3       # IP စစ်
ping -c 2 10.30.30.1   # pfSense GW စစ်
```

---

## Step 6 — Passwordless sudo on aegis-company-admin

aegis-company-admin သည် hub mode agent ဖြစ်ပြီး company VMs တွေကို SSH ဝင်ပြီး log တောင်းတယ်။  
Local nmap/tcpdump လည်း run လိုတာကြောင့် passwordless sudo လိုတယ်:

```bash
# aegis-company-admin VM မှာ သာ
echo "$USER ALL=(ALL) NOPASSWD: ALL" | sudo tee /etc/sudoers.d/aegis-admin
```

company-web-server, DNS-Server, company-customer-db, LDAP-Server တွေမှာ **မလိုဘူး** — aegis-company-admin ကနေ SSH ဝင်ပြုလုပ်တာ ဖြစ်တာကြောင့်။

---

## Step 7 — SSH Key Setup (aegis-company-admin → Company VMs)

aegis-company-admin hub agent ကနေ company VMs ကို SSH ဝင်ဖို့ key ပြင်ဆင်ရမယ်:

```bash
# aegis-company-admin VM မှာ
ssh-keygen -t ed25519 -f ~/.ssh/aegis_hub -N ""

# company-web-server ကို copy
ssh-copy-id -i ~/.ssh/aegis_hub.pub sithu@10.10.10.10

# DNS-Server ကို copy
ssh-copy-id -i ~/.ssh/aegis_hub.pub sithu@10.10.10.20

# company-customer-db ကို copy
ssh-copy-id -i ~/.ssh/aegis_hub.pub sithu@10.20.20.10

# LDAP-Server ကို copy (optional — sensors မသတ်မှတ်ရသေး)
ssh-copy-id -i ~/.ssh/aegis_hub.pub sithu@10.20.20.20

# pfSense ကို copy (defense commands အတွက်)
# → pfSense WebGUI → System → User Manager → admin → Authorized SSH Keys မှာ ထည့်ပြီးသား

# Test connections
ssh -i ~/.ssh/aegis_hub sithu@10.10.10.10 "hostname"
ssh -i ~/.ssh/aegis_hub sithu@10.20.20.10 "hostname"
```

---

## Step 8 — Install Security Tools on Company VMs

### company-web-server (10.10.10.10) — Apache + ModSecurity + Suricata + Fail2ban + vsftpd

```bash
# Apache + ModSecurity WAF
sudo apt update
sudo apt install -y apache2 libapache2-mod-security2 php libapache2-mod-php
sudo a2enmod security2
sudo cp /etc/modsecurity/modsecurity.conf-recommended /etc/modsecurity/modsecurity.conf
sudo sed -i 's/SecRuleEngine DetectionOnly/SecRuleEngine On/' /etc/modsecurity/modsecurity.conf
sudo systemctl restart apache2

# Create a simple vulnerable PHP page for attack testing
sudo tee /var/www/html/login.php > /dev/null << 'EOF'
<?php
$user = $_GET['user'] ?? '';
$pass = $_GET['pass'] ?? '';
echo "<form method='GET'><input name='user'/><input name='pass'/><button>Login</button></form>";
echo "User: $user";
EOF

# Suricata IDS
sudo add-apt-repository ppa:oisf/suricata-stable -y
sudo apt install -y suricata
sudo suricata-update
sudo suricata -c /etc/suricata/suricata.yaml -i ens3 -D
sudo tail -5 /var/log/suricata/eve.json

# Fail2ban
sudo apt install -y fail2ban
sudo systemctl enable --now fail2ban

# vsftpd FTP server
sudo apt install -y vsftpd
sudo sed -i 's/#write_enable=YES/write_enable=YES/' /etc/vsftpd.conf
sudo sed -i 's/#local_enable=YES/local_enable=YES/' /etc/vsftpd.conf
sudo systemctl enable --now vsftpd
```

### DNS-Server (10.10.10.20) — BIND9

```bash
sudo apt update
sudo apt install -y bind9 bind9utils bind9-doc fail2ban

# Basic BIND9 config — recursive resolver for lab
sudo tee /etc/bind/named.conf.options > /dev/null << 'EOF'
options {
    directory "/var/cache/bind";
    recursion yes;
    allow-recursion { 10.0.0.0/8; 192.168.10.0/24; };
    forwarders { 8.8.8.8; 1.1.1.1; };
    listen-on { any; };
    allow-query { any; };
};
EOF

sudo systemctl enable --now bind9
dig @10.10.10.20 google.com   # test recursion

# Fail2ban
sudo systemctl enable --now fail2ban
```

### company-customer-db (10.20.20.10) — MySQL + Suricata + Fail2ban

```bash
sudo apt update
sudo apt install -y mysql-server suricata fail2ban

# MySQL — allow remote connections (lab only)
sudo sed -i "s/127.0.0.1/0.0.0.0/" /etc/mysql/mysql.conf.d/mysqld.cnf
sudo systemctl restart mysql

# Create demo bank database
sudo mysql -e "CREATE DATABASE IF NOT EXISTS companydb;"
sudo mysql companydb -e "CREATE TABLE IF NOT EXISTS customers (id INT AUTO_INCREMENT PRIMARY KEY, name VARCHAR(100), account_no VARCHAR(20), balance DECIMAL(10,2));"
sudo mysql companydb -e "INSERT INTO customers (name,account_no,balance) VALUES ('Demo User','1234567890',5000.00);"
sudo mysql -e "CREATE USER IF NOT EXISTS 'companyuser'@'%' IDENTIFIED BY 'BankPass123!';"
sudo mysql -e "GRANT ALL ON companydb.* TO 'companyuser'@'%'; FLUSH PRIVILEGES;"

# Suricata
sudo add-apt-repository ppa:oisf/suricata-stable -y
sudo apt install -y suricata
sudo suricata-update
sudo suricata -c /etc/suricata/suricata.yaml -i ens3 -D

sudo systemctl enable --now fail2ban
```

### LDAP-Server (10.20.20.20) — OpenLDAP

```bash
sudo apt update
sudo DEBIAN_FRONTEND=noninteractive apt install -y slapd ldap-utils fail2ban

# Set admin password during dpkg-reconfigure
sudo dpkg-reconfigure slapd
# → Omit OpenLDAP server configuration? No
# → DNS domain name: bank.local
# → Organization name: SecureCompany
# → Admin password: (set strong password)
# → Database: MDB
# → Remove database when slapd is purged? No

sudo systemctl enable --now slapd

# Verify
ldapsearch -x -H ldap://localhost -b "dc=bank,dc=local"

sudo systemctl enable --now fail2ban
```

---

## Step 9 — Deploy aegis_forwarder.py on aegis-company-admin (Hub Mode)

Hub mode = aegis-company-admin တစ်ခုတည်း run ၊ company VMs တွေကို SSH ဝင်ပြီး log ဖတ်တယ်။  
Company VMs မှာ forwarder **မသွင်းရဘူး**။

### 9a. Install dependencies

```bash
# aegis-company-admin မှာ သာ
sudo apt update
sudo apt install -y python3-pip python3-requests openssh-client nmap
pip3 install requests
```

### 9b. Download script

```bash
sudo mkdir -p /opt/aegis/scripts/src
cd /opt/aegis/scripts/src

wget -O aegis_forwarder.py \
  https://raw.githubusercontent.com/sohu2723-star/aegis-soc-dashboard/main/scripts/src/aegis_forwarder.py
chmod +x aegis_forwarder.py
```

### 9c. Configure local.conf

```bash
# local.conf ကို create (gitignored — AEGIS_KEY ထည့်မယ်)
sudo tee /opt/aegis/scripts/src/aegis_forwarder.local.conf << 'EOF'
AEGIS_URL=https://aegis-api-server-jp3b.onrender.com/api
AEGIS_KEY=<AEGIS_INGEST_KEY value>
AEGIS_ADMIN_KEY=<AEGIS_ADMIN_KEY value>
COMPANY_WEB_IP=10.10.10.10
DNS_SERVER_IP=10.10.10.20
COMPANY_DB_IP=10.20.20.10
LDAP_SERVER_IP=10.20.20.20
COMPANY_WEB_SSH_USER=sithu
COMPANY_DB_SSH_USER=sithu
SSH_KEY_PATH=/home/sithu/.ssh/aegis_hub
PFSENSE_IP=10.30.30.1
PFSENSE_SSH_USER=admin
PFSENSE_SSH_KEY=/home/sithu/.ssh/pfsense_key
EOF
```

### 9d. Test manually

```bash
cd /opt/aegis/scripts/src
python3 aegis_forwarder.py --mode hub
# → heartbeat + SSH into company VMs + log tail lines ပြမယ်
```

### 9e. Run as systemd service

```bash
sudo tee /etc/systemd/system/aegis-forwarder.service << 'EOF'
[Unit]
Description=AEGIS Hub Forwarder
After=network.target

[Service]
Type=simple
User=sithu
WorkingDirectory=/opt/aegis/scripts/src
ExecStart=/usr/bin/python3 /opt/aegis/scripts/src/aegis_forwarder.py --mode hub
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now aegis-forwarder
sudo journalctl -u aegis-forwarder -f   # live output ကြည့်
```

### Script update (Important — git pull မအလုပ်လုပ်ဘူး)

```bash
cd /opt/aegis/scripts/src
wget -O aegis_forwarder.py \
  https://raw.githubusercontent.com/sohu2723-star/aegis-soc-dashboard/main/scripts/src/aegis_forwarder.py
sudo systemctl restart aegis-forwarder
```

---

## Step 10 — Kali Attacker Setup

```bash
# Kali — lab routes ထည့် (pfSense ကတဆင့် company VMs ရောက်ဖို့)
sudo ip route add 10.10.10.0/24 via 192.168.10.1
sudo ip route add 10.20.20.0/24 via 192.168.10.1
sudo ip route add 10.30.30.0/24 via 192.168.10.1

# Persistent routes (/etc/network/interfaces မှာ ထည့်)
# post-up ip route add 10.0.0.0/8 via 192.168.10.1

# Verify reachability
ping -c 2 10.10.10.10   # company-web-server
ping -c 2 10.10.10.20   # DNS-Server
ping -c 2 10.20.20.10   # company-customer-db
```

---

## Step 11 — End-to-End Tests

### Test 1: API health check (from aegis-company-admin)

```bash
curl -s https://aegis-api-server-jp3b.onrender.com/api/healthz
# Expected: {"status":"ok"}
```

### Test 2: Manual ingest event

```bash
source /opt/aegis/scripts/src/aegis_forwarder.local.conf
curl -s -X POST https://aegis-api-server-jp3b.onrender.com/api/ingest/ssh \
  -H "Content-Type: application/json" \
  -H "X-AEGIS-Key: $AEGIS_KEY" \
  -d '{"src_ip":"192.168.10.99","username":"root","status":"failed","failures":5}'
# Expected: {"ok":true}
```
→ Dashboard **Security Events** page မှာ SSH event ပေါ်မယ်

### Test 3: Kali → Suricata → Dashboard

```bash
# Kali မှာ
nmap -sS -p 1-1000 10.10.10.10

# company-web-server မှာ (aegis-company-admin SSH ဝင်ပြီး စစ်)
ssh sithu@10.10.10.10 "sudo tail -5 /var/log/suricata/eve.json | grep alert"
```
→ Dashboard **Security Events** မှာ 15s အတွင်း ET SCAN alert ပေါ်မယ်

### Test 4: SSH brute force → auto-defense

```bash
# Kali မှာ
hydra -l root -P /usr/share/wordlists/rockyou.txt ssh://10.10.10.10 -t 4

# Dashboard → Defense Center → auto-block ပေါ်မယ်
```

### Test 5: Web attack (SQLi)

```bash
# Kali မှာ
sqlmap -u "http://10.10.10.10/login.php?user=admin&pass=test" --batch --level=2
# → ModSecurity block + Suricata SQLi alert
```

### Test 6: DNS query (DNS-Server test)

```bash
# ဘယ် VM ကနေမဆို
dig @10.10.10.20 google.com
# → A record ရမယ် (recursive query အောင်မြင်)
```

---

## Troubleshooting

### DNS resolution failed ("Temporary failure in name resolution")?

```bash
# affected VM မှာ
ping -c 2 8.8.8.8          # raw routing test
ping -c 2 google.com       # DNS test
cat /etc/resolv.conf       # nameserver စစ်

# Fix — nameserver ထည့် (netplan)
# nameservers:
#   addresses: [10.10.10.20, 8.8.8.8]
sudo netplan apply
```

### OVS switch port တွေ VLAN tag ကျသွားတယ်?

```bash
# OVS console မှာ restart ဖြစ်ရင် tag ကျနိုင်တယ်
ovs-vsctl show   # tag values စစ်
ovs-vsctl set port eth1 tag=10   # ပြန်ထည့်
ovs-vsctl set port eth2 tag=10
```

### aegis-company-admin ကနေ company VM ကို SSH မဝင်ရဘူး?

```bash
# aegis-company-admin မှာ
ssh -i ~/.ssh/aegis_hub -v sithu@10.10.10.10
# → Permission denied ဆိုရင် company-web-server မှာ authorized_keys ပြန်စစ်
# cat ~/.ssh/authorized_keys on company-web-server

# pfSense MGMT rule — aegis-company-admin outbound pass ဖြစ်နေမဖြစ်နေ စစ်
```

### Kali ကနေ company VMs မရောက်ဘူး?

```bash
# Kali မှာ
ip route show | grep 10.10.10
# Route မရှိရင်:
sudo ip route add 10.10.10.0/24 via 192.168.10.1

# R1 route table စစ် (MikroTik console)
/ip route print
/ping 10.0.23.2 count=4   # R1 → pfSense test
```

### Events dashboard မှာ မပေါ်ဘူး?

```bash
# aegis-company-admin မှာ
sudo journalctl -u aegis-forwarder -f
# "POST /api/ingest/..." success ပြမမပြ စစ်

# API key test
curl -s -X POST https://aegis-api-server-jp3b.onrender.com/api/ingest/event \
  -H "X-AEGIS-Key: $AEGIS_KEY" \
  -H "Content-Type: application/json" \
  -d '{"source":"test","type":"network_scan","severity":"low","sourceIp":"1.2.3.4","description":"test"}'
```

### Defense agent blocks မကျဘူး?

```bash
# aegis-company-admin မှာ
sudo journalctl -u aegis-forwarder -f | grep defense
# "defense_agent_loop" polling ပြမမပြ စစ်

# company-web-server မှာ (SSH ဝင်စစ်)
ssh sithu@10.10.10.10 "sudo iptables -L INPUT -n | grep DROP"
```

---

## Quick Keys & URLs Reference

| Item | Value |
|---|---|
| API Base URL | `https://aegis-api-server-jp3b.onrender.com/api` |
| Dashboard URL | `https://aegis-soc-dashboard-aegis-dashboard.vercel.app` |
| Local conf | `/opt/aegis/scripts/src/aegis_forwarder.local.conf` (gitignored) |
| Script location | `/opt/aegis/scripts/src/aegis_forwarder.py` |
| Ingest header | `X-AEGIS-Key: <AEGIS_INGEST_KEY>` |
| Admin header | `X-AEGIS-Admin-Key: <AEGIS_ADMIN_KEY>` |
| pfSense WebGUI | `http://10.30.30.1` (from MGMT segment) |
| VLAN 10 | DMZ — company-web-server (10.10.10.10), DNS-Server (10.10.10.20) |
| VLAN 20 | Internal — company-customer-db (10.20.20.10), LDAP-Server (10.20.20.20) |
