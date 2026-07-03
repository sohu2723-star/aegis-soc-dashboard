# Ubuntu VM Setup — Bank Servers + AEGIS Forwarder
> **GNS3 nodes:** bank-web, bank-mail, teller-pc, customer-db, aegis-forwarder
> **Base OS:** Ubuntu Server 22.04 (ubuntu22.04.qcow2 clones)
> **Last updated:** 2026-07-04

---

## IP Plan

| VM | IP | Gateway | Role |
|---|---|---|---|
| bank-web | 10.10.10.10/24 | 10.10.10.1 | Apache2 + DVWA |
| bank-mail | 10.10.10.20/24 | 10.10.10.1 | Postfix + Dovecot |
| teller-pc | 10.20.20.10/24 | 10.20.20.1 | Internal workstation |
| customer-db | 10.20.20.20/24 | 10.20.20.1 | PostgreSQL |
| aegis-forwarder | 10.30.30.10/24 | 10.30.30.1 | Sensors + forwarder |

---

## Static IP Setup (all VMs — Ubuntu 22.04 netplan)

**File:** `/etc/netplan/00-installer-config.yaml`

**bank-web example:**
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

```bash
sudo netplan apply
ping -c 4 10.10.10.1    # gateway စစ်
ping -c 4 8.8.8.8       # internet (pfSense allow rule ရှိမှ)
```

> ⚠️ Interface name `ens3` မဟုတ်ဘဲ `eth0` ဖြစ်နိုင်တယ် — `ip a` နဲ့ ကြည့်ပြီး adjust လုပ်

---

## bank-web Setup

```bash
sudo apt update && sudo apt install -y apache2 php php-mysqli mariadb-server git

# DVWA install
cd /var/www/html
sudo git clone https://github.com/digininja/DVWA.git
sudo chown -R www-data:www-data DVWA/
sudo cp DVWA/config/config.inc.php.dist DVWA/config/config.inc.php

# MariaDB setup
sudo mysql -e "CREATE DATABASE dvwa; CREATE USER 'dvwa'@'localhost' IDENTIFIED BY 'p@ssw0rd'; GRANT ALL ON dvwa.* TO 'dvwa'@'localhost';"

# Apache config
sudo a2enmod rewrite
sudo systemctl restart apache2
```

**Access:** `http://10.10.10.10/DVWA/setup.php` → Create/Reset Database

---

## bank-mail Setup

```bash
sudo apt update
sudo apt install -y postfix dovecot-core dovecot-imapd

# Postfix: hostname set
sudo hostnamectl set-hostname bank-mail.securebank.local

# /etc/postfix/main.cf
myhostname = bank-mail.securebank.local
mydomain = securebank.local
inet_interfaces = all
mydestination = $myhostname, localhost.$mydomain, localhost, $mydomain

sudo systemctl restart postfix dovecot
```

---

## customer-db Setup

```bash
sudo apt update && sudo apt install -y postgresql

# Create bank DB + user
sudo -u postgres psql <<EOF
CREATE DATABASE bankdb;
CREATE USER bankuser WITH PASSWORD 'SecurePass123!';
GRANT ALL PRIVILEGES ON DATABASE bankdb TO bankuser;
EOF

# Allow remote connections (for attack demo)
echo "host bankdb bankuser 10.20.0.0/16 md5" | sudo tee -a /etc/postgresql/14/main/pg_hba.conf
sudo sed -i "s/#listen_addresses = 'localhost'/listen_addresses = '*'/" /etc/postgresql/14/main/postgresql.conf
sudo systemctl restart postgresql
```

---

## aegis-forwarder Setup

```bash
sudo apt update && sudo apt install -y python3-pip snort suricata fail2ban cowrie

pip3 install requests

# Clone repo (or copy scripts/)
git clone https://github.com/<your-repo>/aegis-soc-dashboard.git
cd aegis-soc-dashboard

# Environment
export AEGIS_URL="https://aegis-api-server-jp3b.onrender.com/api"
export AEGIS_KEY="<AEGIS_INGEST_KEY>"

# Run forwarder
python3 scripts/src/aegis_forwarder.py --mode all
```

### Systemd Service (auto-start)

```bash
sudo tee /etc/systemd/system/aegis-forwarder.service <<EOF
[Unit]
Description=AEGIS Event Forwarder
After=network.target

[Service]
ExecStart=/usr/bin/python3 /opt/aegis/scripts/src/aegis_forwarder.py --mode all
Environment=AEGIS_URL=https://aegis-api-server-jp3b.onrender.com/api
Environment=AEGIS_KEY=<AEGIS_INGEST_KEY>
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl enable aegis-forwarder
sudo systemctl start aegis-forwarder
sudo systemctl status aegis-forwarder
```

---

## ⚠️ VM Redo Note (2026-07-04)

ubuntu-base template ကနေ duplicate + rename လုပ်ရာ VM confusion ဖြစ်ခဲ့သည်။
Confused instances တွေ delete ပြီး ပြန် drag & drop လုပ်ရန် ဆုံးဖြတ်ခဲ့သည်။

**Fresh VM ဆွဲချပုံ:**
1. GNS3 Left panel → QEMU VMs → `ubuntu-base` → canvas ပေါ် drag × 5
2. Drop ချိန်မှာ name ချက်ချင်းပေး: `bank-web`, `bank-mail`, `teller-pc`, `customer-db`, `aegis-forwarder`
3. Cable ချိတ်ပြီး Start → console → netplan static IP set

## Status: 🔄 VM Redo In Progress (Topology rebuild pending)
