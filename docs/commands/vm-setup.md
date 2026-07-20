# Ubuntu VM Setup — Bank Servers + AEGIS-ADMIN
> **GNS3 nodes:** company-web-server, DNS-Server, company-customer-db, LDAP-Server, aegis-company-admin
> **Base image:** ubuntu-base (Ubuntu Server 22.04, QEMU linked clone)
> **Last updated:** 2026-07-20 (v4 Final — OVS switches, DNS-Server, LDAP-Server, company-customer-db=10.20.20.10)

---

## ⚠️ Critical Notes

| Issue | Fix |
|---|---|
| Console blank (telnet) | Console type → **VNC** (telnet = blank, VNC = Ubuntu GUI ပေါ်မည်) |
| Netplan `route:` error | `routes:` ဖြစ်ရမည် — **s** ပါရမည် |
| Netplan warning (systemd-networkd) | Ubuntu Server → netplan apply OK, warning ignore |
| Permission warning | `sudo chmod 600 /etc/netplan/*.yaml` |
| Internet မရ (pfSense block) | pfSense firewall rules ထည့်ရမည် — `easyrule pass opt2 any ...` |

---

## IP Plan (v4 Final)

| VM | Subnet | IP | Gateway | Role |
|---|---|---|---|---|
| company-web-server | DMZ (10.10.10.0/24) | **10.10.10.10/24** | 10.10.10.1 | Apache2, vsftpd, Suricata, Fail2ban |
| DNS-Server | DMZ (10.10.10.0/24) | **10.10.10.20/24** | 10.10.10.1 | BIND9 DNS, Fail2ban |
| company-customer-db | Internal (10.20.20.0/24) | **10.20.20.10/24** | 10.20.20.1 | MySQL, Suricata, Fail2ban |
| LDAP-Server | Internal (10.20.20.0/24) | **10.20.20.20/24** | 10.20.20.1 | OpenLDAP (slapd), Fail2ban |
| aegis-company-admin | MGMT (10.30.30.0/24) | **10.30.30.10/24** | 10.30.30.1 | aegis_forwarder.py hub agent |

**Removed from v3:** bank-mail (10.10.10.20), teller-pc (10.20.20.10)

---

## GNS3 VM Cable Map (v4)

| VM | VM port | Connected to | Switch port |
|---|---|---|---|
| company-web-server | e0 | Public-Services OVS Switch | eth1 |
| DNS-Server | e0 | Public-Services OVS Switch | eth2 |
| company-customer-db | e0 | Internal-Services OVS Switch | eth1 |
| LDAP-Server | e0 | Internal-Services OVS Switch | eth2 |
| aegis-company-admin | e0 | pfSense e3 (em3/MGMT) | direct |

---

## Step 0 — GNS3 VM Console Type (VNC)

```
VM icon → right-click → Configure
General Settings → Console type: telnet → vnc → OK
VM → right-click → Stop → Start
VM → double-click → VNC window ပွင့်မည်
```

---

## Step 1 — Login

```
Username: sithu
Password: sithu
```

Login ဝင်ပြီး Terminal ဖွင့် —
```
Activities → Terminal
```

---

## Step 2 — Interface Name စစ်

```bash
ip a
# ens3 ဖြစ်ပါက → netplan မှာ ens3 သုံး
# eth0 ဖြစ်ပါက → eth0 သုံး
```

---

## Step 3 — Static IP Setup (Netplan)

```bash
sudo nano /etc/netplan/01-network-manager-all.yaml
# (or 00-installer-config.yaml — ls /etc/netplan/ စစ်)
```

---

### company-web-server (10.10.10.10)

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

---

### DNS-Server (10.10.10.20)

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

---

### company-customer-db (10.20.20.10)

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

---

### LDAP-Server (10.20.20.20)

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

---

### aegis-company-admin (10.30.30.10)

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

---

## Step 4 — Apply + Verify

```bash
sudo chmod 600 /etc/netplan/*.yaml
sudo netplan apply

ip a show ens3
ping -c 3 <gateway>
ping -c 3 8.8.8.8
```

---

## Step 5 — Hostname Set

```bash
sudo hostnamectl set-hostname company-web-server
sudo hostnamectl set-hostname company-dns-server
sudo hostnamectl set-hostname company-customer-db
sudo hostnamectl set-hostname company-ldap-server
sudo hostnamectl set-hostname aegis-admin
```

---

## Step 6 — pfSense Firewall Rules (Internet ရဖို့)

pfSense console Option 8 (Shell) —

```bash
# DMZ — company-web-server, DNS-Server
easyrule pass lan any 10.10.10.0/24 any

# Internal — company-customer-db, LDAP-Server
easyrule pass opt1 any 10.20.20.0/24 any

# MGMT — aegis-company-admin
easyrule pass opt2 any 10.30.30.0/24 any

pfctl -e
```

> ✅ Correct: `easyrule pass opt2 any 10.30.30.0/24 any`
> ⚠️ Wrong: `easyrule pass opt2 from 10.30.30.0/24 to any` (protocol arg မပါ)

---

## Status (v4 — 2026-07-20)

| VM | IP | Gateway Ping | Internet | Services |
|---|---|---|---|---|
| company-web-server | ✅ 10.10.10.10 | ✅ | ✅ | Apache2, vsftpd, Suricata, Fail2ban |
| DNS-Server | ✅ 10.10.10.20 | ✅ | ✅ | BIND9 ⏳ configure |
| company-customer-db | ✅ 10.20.20.10 | ✅ | ✅ | MySQL, Suricata, Fail2ban |
| LDAP-Server | ✅ 10.20.20.20 | ✅ | ✅ | OpenLDAP ⏳ configure |
| aegis-company-admin | ✅ 10.30.30.10 | ✅ | ✅ | hub mode ✅ |

---

## company-web-server Full Service Setup

```bash
sudo apt update && sudo apt install -y apache2 php libapache2-mod-php php-mysql \
    vsftpd suricata fail2ban openssh-server

# ModSecurity WAF
sudo apt install -y libapache2-mod-security2
sudo cp /etc/modsecurity/modsecurity.conf-recommended /etc/modsecurity/modsecurity.conf
sudo sed -i 's/SecRuleEngine DetectionOnly/SecRuleEngine On/' /etc/modsecurity/modsecurity.conf
sudo systemctl restart apache2
```

---

## DNS-Server Full Service Setup

```bash
sudo apt update && sudo apt install -y bind9 bind9utils fail2ban openssh-server

# Basic named.conf.options
sudo tee /etc/bind/named.conf.options <<EOF
options {
    directory "/var/cache/bind";
    forwarders { 8.8.8.8; 8.8.4.4; };
    dnssec-validation auto;
    listen-on { any; };
    allow-query { any; };
};
EOF

sudo systemctl restart bind9
sudo systemctl enable bind9
```

---

## company-customer-db Full Service Setup

```bash
sudo apt update && sudo apt install -y mysql-server suricata fail2ban openssh-server

sudo mysql -e "CREATE DATABASE companydb;
  CREATE USER 'companyuser'@'%' IDENTIFIED BY 'SecurePass123!';
  GRANT ALL ON companydb.* TO 'companyuser'@'%';"

sudo sed -i "s/bind-address.*/bind-address = 0.0.0.0/" /etc/mysql/mysql.conf.d/mysqld.cnf
sudo systemctl restart mysql
```

---

## LDAP-Server Full Service Setup

```bash
sudo apt update && sudo apt install -y slapd ldap-utils fail2ban openssh-server

# Reconfigure slapd
sudo dpkg-reconfigure slapd
# DNS domain name: securebank.local
# Organization: SecureCompany
# Admin password: <set strong password>

sudo systemctl restart slapd
sudo systemctl enable slapd
```

---

## aegis-company-admin Full Service Setup

```bash
sudo apt update && sudo apt install -y python3-pip openssh-client

# ဆွဲ latest script
wget -O /tmp/aegis_forwarder.py \
  https://raw.githubusercontent.com/sohu2723-star/aegis-soc-dashboard/main/scripts/src/aegis_forwarder.py

sudo mkdir -p /opt/aegis/scripts/src
sudo cp /tmp/aegis_forwarder.py /opt/aegis/scripts/src/
sudo chown -R sithu:sithu /opt/aegis
```

### Systemd Service (auto-start on boot)

```bash
sudo tee /etc/systemd/system/aegis-forwarder.service <<EOF
[Unit]
Description=AEGIS Event Forwarder (Hub Mode)
After=network.target

[Service]
ExecStart=/usr/bin/python3 /opt/aegis/scripts/src/aegis_forwarder.py --mode hub
EnvironmentFile=/opt/aegis/scripts/src/local.conf
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
