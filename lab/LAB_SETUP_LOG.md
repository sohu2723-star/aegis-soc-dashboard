# AEGIS Lab Setup Log

## Date: 2026-07-18

---

## Network Topology

```
Internet (virbr0: 192.168.122.1)
    │
R1 MikroTik
    ├─ ether1: 192.168.122.2/24  (internet + Kali network)
    └─ ether3: 10.0.23.1/30      (pfSense WAN link)
                    │
              pfSense (10.0.23.2)
              ├─ LAN       10.10.10.1/24 → company-web-server     (10.10.10.10)
              ├─ COMPANY_WEB  10.20.20.1/24 → company-customer-db  (10.20.20.20)
              └─ COMPANY_DB 10.30.30.1/24 → aegis      (10.30.30.10)
```

---

## Internet Connectivity Fix

### MikroTik R1
```routeros
/ip firewall nat add chain=srcnat action=masquerade out-interface=ether1
/ip firewall filter add chain=forward action=accept place-before=0
```

### pfSense
- System > Routing > Gateways → Default gateway IPv4 = WANGW (10.0.23.1)
- Interfaces > WAN → uncheck Block private networks + Block bogon networks

### VM Gateway (each VM needs this after reboot)
```bash
sudo ip route add default via <pfSense_interface_IP>
echo "nameserver 8.8.8.8" | sudo tee /etc/resolv.conf
```

---

## company-customer-db VM (10.20.20.20) — ✅ COMPLETE

```bash
sudo apt update && sudo apt install -y mysql-server
wget -O setup.sql https://paste.rs/IFRoJ
sudo mysql < setup.sql

# bind-address fix (MySQL 8.0 — sed မအလုပ်လုပ်ဘူး၊ append နည်း သုံး)
sudo bash -c 'echo "bind-address = 0.0.0.0" >> /etc/mysql/mysql.conf.d/mysqld.cnf'
sudo bash -c 'echo "mysqlx-bind-address = 0.0.0.0" >> /etc/mysql/mysql.conf.d/mysqld.cnf'
sudo systemctl restart mysql
```

**⚠️ MySQL 8.0 bind-address note:**
`sed -i 's/127.0.0.1/0.0.0.0/'` does NOT work on MySQL 8.0 — file has no bind-address line by default.
Must **append** both lines to mysqld.cnf instead. Verify with `ss -tlnp | grep 3306` → should show `0.0.0.0:3306`.

**Verify:**
```bash
sudo mysql -e "USE companydb; SELECT acc_no, full_name, balance FROM accounts;"
ss -tlnp | grep 3306   # should show 0.0.0.0:3306
```

**Sample accounts:** 1001/1234, 1002/5678, 1003/9999, 1004/4321, 1005/0000, 9999/admin

---

## company-web-server VM (10.10.10.10) — ✅ COMPLETE

```bash
sudo apt update && sudo apt install -y apache2 php libapache2-mod-php php-mysql
cd /var/www/html && sudo rm -f index.html

sudo wget -O db.php        https://paste.rs/3kh3i
sudo wget -O index.php     https://paste.rs/D1ESe
sudo wget -O signup.php    https://paste.rs/ChRQ9
sudo wget -O dashboard.php https://paste.rs/XPBoL
sudo wget -O transfer.php  https://paste.rs/yumVL
sudo wget -O history.php   https://paste.rs/XL7Z6
sudo wget -O profile.php   https://paste.rs/Osgsq
sudo wget -O logout.php    https://paste.rs/KX1qm
sudo wget -O style.css     https://paste.rs/YR5lT

sudo systemctl enable apache2 && sudo systemctl restart apache2
```

**Verify:** http://10.10.10.10 → SecureCompany login

---

## aegis-forwarder VM (10.30.30.10) — ⏳ PENDING

```bash
cd /opt/aegis/scripts/src
# Update config
nano aegis_forwarder.local.conf
# COMPANYWEB_IP=10.10.10.10
# CUSTOMERDB_IP=10.20.20.10

sudo systemctl restart aegis-forwarder
sudo systemctl status aegis-forwarder
```

---

## Attack Scenario (After All VMs Setup)

1. Kali → SQLi attack on http://10.10.10.10
2. aegis-forwarder detects → sends event to Render API
3. AEGIS dashboard shows incident
4. Auto-defense triggers → pfSense blocks Kali IP
