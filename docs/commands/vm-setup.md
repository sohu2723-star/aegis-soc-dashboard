# Ubuntu VM Setup — Bank Servers + AEGIS Forwarder
> **GNS3 nodes:** bank-web, bank-mail, teller-pc, customer-db, aegis-forwarder
> **Base image:** ubuntu-base (Ubuntu Desktop, QEMU linked clone)
> **Last updated:** 2026-07-04

---

## ⚠️ Critical Notes (Session 2026-07-04)

| Issue | Fix |
|---|---|
| Console blank (telnet) | Console type → **VNC** (telnet = blank, VNC = Ubuntu GUI ပေါ်မည်) |
| Netplan `route:` error | `routes:` ဖြစ်ရမည် — **s** ပါရမည် |
| Netplan warning (systemd-networkd) | Ubuntu Desktop = NetworkManager — warning ignore လုပ်ရသည်၊ IP apply ဖြစ်ပြီ |
| Permission warning | `sudo chmod 600 /etc/netplan/*.yaml` |
| Internet မရ (pfSense block) | pfSense firewall rules ထည့်ရမည် — `easyrule pass opt2 any ...` |

---

## IP Plan

| VM | Subnet | IP | Gateway | Role |
|---|---|---|---|---|
| bank-web | DMZ (10.10.10.0/24) | 10.10.10.10/24 | 10.10.10.1 | Apache2 + DVWA |
| bank-mail | DMZ (10.10.10.0/24) | 10.10.10.20/24 | 10.10.10.1 | Postfix + Dovecot |
| teller-pc | Internal (10.20.20.0/24) | 10.20.20.10/24 | 10.20.20.1 | Internal workstation |
| customer-db | Internal (10.20.20.0/24) | 10.20.20.20/24 | 10.20.20.1 | PostgreSQL |
| aegis-forwarder | MGMT (10.30.30.0/24) | 10.30.30.10/24 | 10.30.30.1 | AEGIS agent + sensors |

---

## GNS3 VM Setup — Cable Map

| VM | VM port | Connected to | Switch port |
|---|---|---|---|
| bank-web | e0 | DMZ-Switch | e0 |
| bank-mail | e0 | DMZ-Switch | e1 |
| teller-pc | e0 | INT-Switch | e1 |
| customer-db | e0 | INT-Switch | e2 |
| aegis-forwarder | e0 | pfSense | e3 (em3/OPT2) |

---

## Step 0 — GNS3 VM Console Type (VNC)

ทุก VM ကို console type ပြောင်းရမည် —

```
VM icon → right-click → Configure
General Settings → Console type: telnet → vnc → OK
VM → right-click → Stop → Start
VM → double-click → VNC window ပွင့်မည်
```

Template မှာ တစ်ကြောင်းတည်း fix ဖို့ —
```
Edit → Preferences → QEMU VMs → ubuntu-base → Edit
Console type: vnc → OK
```

---

## Step 1 — Login

```
Username: sithu   (ubuntu-base image ရဲ့ user)
Password: sithu   (သို့မဟုတ် VM create တုန်းက set ခဲ့သော password)
```

Login ဝင်ပြီး Terminal ဖွင့် —
```
Activities → Terminal
```

---

## Step 2 — Interface Name စစ်

```bash
ip a
```

Interface name စစ်ပါ —
- `ens3` ဖြစ်ပါက → netplan မှာ `ens3` သုံးရမည်
- `eth0` ဖြစ်ပါက → `eth0` ပြောင်းရမည်

---

## Step 3 — Static IP Setup (Netplan)

Netplan file တည်နေရာစစ် —
```bash
ls /etc/netplan/
# → 01-network-manager-all.yaml (ubuntu-base မှာ ဒါပဲရှိမည်)
```

File edit —
```bash
sudo nano /etc/netplan/01-network-manager-all.yaml
```

---

### bank-web (10.10.10.10)

```yaml
network:
  version: 2
  ethernets:
    ens3:
      addresses:
        - 10.10.10.10/24
      routes:
        - to: default
          via: 10.10.10.1
      nameservers:
        addresses: [8.8.8.8, 1.1.1.1]
```

---

### bank-mail (10.10.10.20)

```yaml
network:
  version: 2
  ethernets:
    ens3:
      addresses:
        - 10.10.10.20/24
      routes:
        - to: default
          via: 10.10.10.1
      nameservers:
        addresses: [8.8.8.8, 1.1.1.1]
```

---

### teller-pc (10.20.20.10)

```yaml
network:
  version: 2
  ethernets:
    ens3:
      addresses:
        - 10.20.20.10/24
      routes:
        - to: default
          via: 10.20.20.1
      nameservers:
        addresses: [8.8.8.8, 1.1.1.1]
```

---

### customer-db (10.20.20.20)

```yaml
network:
  version: 2
  ethernets:
    ens3:
      addresses:
        - 10.20.20.20/24
      routes:
        - to: default
          via: 10.20.20.1
      nameservers:
        addresses: [8.8.8.8, 1.1.1.1]
```

---

### aegis-forwarder (10.30.30.10) ✅ DONE

```yaml
network:
  version: 2
  ethernets:
    ens3:
      addresses:
        - 10.30.30.10/24
      routes:
        - to: default
          via: 10.30.30.1
      nameservers:
        addresses: [8.8.8.8, 1.1.1.1]
```

---

## Step 4 — Apply + Verify (VM တစ်ခုချင်း)

```bash
# Permission fix (warning ရှောင်ဖို့)
sudo chmod 600 /etc/netplan/01-network-manager-all.yaml

# Apply
sudo netplan apply

# IP confirm
ip a show ens3

# Gateway ping
ping -c 3 <gateway>     # ဥပမာ: ping -c 3 10.10.10.1

# Internet test (pfSense rules ထည့်ပြီးမှ)
ping -c 3 8.8.8.8
```

> ⚠️ `sudo netplan apply` မှာ warning ပေါ်ရင် ignore — Ubuntu Desktop = NetworkManager, warning normal

---

## Step 5 — Hostname Set (VM တစ်ခုချင်း)

```bash
sudo hostnamectl set-hostname bank-web        # ကိုယ့် VM name အတိုင်း
sudo hostnamectl set-hostname bank-mail
sudo hostnamectl set-hostname teller-pc
sudo hostnamectl set-hostname customer-db
sudo hostnamectl set-hostname aegis-forwarder
```

Terminal ပြန်ဖွင့်မှ hostname ပြောင်းတာ မြင်ရမည်

---

## Step 6 — Internet မရရင် Troubleshoot

```bash
# Route စစ်
ip route show
# "default via <gateway>" ပါမပါ စစ်

# Route မပါရင် manually ထည့်
sudo ip route add default via 10.10.10.1   # gateway စစ်ပြောင်း

# pfSense firewall စစ်ဖို့
# → pfSense console Option 8 (Shell) ဖွင့်
pfctl -d          # firewall disable
# VM ကနေ ping ရရင် → pfSense rule ပြဿနာ
# easyrule ထည့်ပြီး pfctl -e
```

---

## Step 7 — pfSense Firewall Rules (Internet ရဖို့ prerequisite)

pfSense console Option 8 (Shell) —

```bash
# OPT2 (MGMT) — aegis-forwarder
easyrule pass opt2 any 10.30.30.0/24 any

# LAN (DMZ) — bank-web, bank-mail
easyrule pass lan any 10.10.10.0/24 any

# OPT1 (Internal) — teller-pc, customer-db
easyrule pass opt1 any 10.20.20.0/24 any

# Firewall ပြန် enable
pfctl -e
```

> ⚠️ Wrong syntax: `easyrule pass opt2 from 10.30.30.0/24 to any` (protocol arg မပါ)
> ✅ Correct: `easyrule pass opt2 any 10.30.30.0/24 any`

Permanent fix — pfSense WebGUI (`https://10.30.30.1`) —
```
Firewall → Rules → LAN  → Add: Pass / LAN subnet / any / Save
Firewall → Rules → OPT1 → Add: Pass / OPT1 subnet / any / Save
Firewall → Rules → OPT2 → Add: Pass / OPT2 subnet / any / Save
Apply Changes
```

---

## Status (2026-07-04)

| VM | IP Set | Gateway Ping | Internet | Services |
|---|---|---|---|---|
| aegis-forwarder | ✅ 10.30.30.10 | ✅ (pfctl -d 后) | ⏳ rule pending | ⏳ |
| bank-web | ⏳ | ⏳ | ⏳ | ⏳ |
| bank-mail | ⏳ | ⏳ | ⏳ | ⏳ |
| teller-pc | ⏳ | ⏳ | ⏳ | ⏳ |
| customer-db | ⏳ | ⏳ | ⏳ | ⏳ |

**Blocker:** pfSense firewall rules မထည့်ရသေးဘဲ VM တွေ internet reach မနိုင်ဘူး

---

## bank-web Full Service Setup

```bash
sudo apt update && sudo apt install -y apache2 php php-mysqli mariadb-server git

# DVWA
cd /var/www/html
sudo git clone https://github.com/digininja/DVWA.git
sudo chown -R www-data:www-data DVWA/
sudo cp DVWA/config/config.inc.php.dist DVWA/config/config.inc.php

# MariaDB
sudo mysql -e "CREATE DATABASE dvwa; \
  CREATE USER 'dvwa'@'localhost' IDENTIFIED BY 'p@ssw0rd'; \
  GRANT ALL ON dvwa.* TO 'dvwa'@'localhost';"

sudo a2enmod rewrite
sudo systemctl restart apache2
```

Access: `http://10.10.10.10/DVWA/setup.php` → Create/Reset Database

---

## bank-mail Full Service Setup

```bash
sudo apt update && sudo apt install -y postfix dovecot-core dovecot-imapd
sudo hostnamectl set-hostname bank-mail.securebank.local
```

`/etc/postfix/main.cf` —
```
myhostname = bank-mail.securebank.local
mydomain = securebank.local
inet_interfaces = all
mydestination = $myhostname, localhost.$mydomain, localhost, $mydomain
```

```bash
sudo systemctl restart postfix dovecot
```

---

## customer-db Full Service Setup

```bash
sudo apt update && sudo apt install -y postgresql

sudo -u postgres psql <<EOF
CREATE DATABASE bankdb;
CREATE USER bankuser WITH PASSWORD 'SecurePass123!';
GRANT ALL PRIVILEGES ON DATABASE bankdb TO bankuser;
EOF

echo "host bankdb bankuser 10.20.0.0/16 md5" | \
  sudo tee -a /etc/postgresql/14/main/pg_hba.conf

sudo sed -i "s/#listen_addresses = 'localhost'/listen_addresses = '*'/" \
  /etc/postgresql/14/main/postgresql.conf

sudo systemctl restart postgresql
```

---

## aegis-forwarder Full Service Setup

```bash
sudo apt update && sudo apt install -y python3-pip git

pip3 install requests

# Repo clone
git clone https://github.com/sohu2723-star/aegis-soc-dashboard.git
cd aegis-soc-dashboard

# Environment
export AEGIS_URL="https://aegis-api-server-jp3b.onrender.com/api"
export AEGIS_INGEST_KEY="<key-from-Render>"

# Run
python3 scripts/src/aegis_forwarder.py --mode all
```

### Systemd Service (auto-start on boot)

```bash
sudo tee /etc/systemd/system/aegis-forwarder.service <<EOF
[Unit]
Description=AEGIS Event Forwarder
After=network.target

[Service]
ExecStart=/usr/bin/python3 /home/sithu/aegis-soc-dashboard/scripts/src/aegis_forwarder.py --mode all
Environment=AEGIS_URL=https://aegis-api-server-jp3b.onrender.com/api
Environment=AEGIS_INGEST_KEY=<key>
Restart=always
RestartSec=5
User=sithu

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable aegis-forwarder
sudo systemctl start aegis-forwarder
sudo systemctl status aegis-forwarder
```
