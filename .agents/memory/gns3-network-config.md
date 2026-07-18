---
name: GNS3 network config — AEGIS-SecureBank
description: Confirmed IP assignments, interface mappings, internet fix, and VM setup notes
---

# GNS3 Network Configuration — AEGIS-SecureBank

## Current Topology (2026-07-18 — Working)

```
Kali (192.168.122.132)
    │
Switch1
    │
R1  ├─ ether1: 192.168.122.2/24   (Switch1 / Kali network, internet via virbr0)
    └─ ether3: 10.0.23.1/30        (pfSense WAN direct link)
                    │
              pfSense WAN (em0): 10.0.23.2/30, GW=10.0.23.1
              ├─ LAN      (em1): 10.10.10.1/24  → bank-web     (10.10.10.10)
              ├─ BANK_WEB (em2): 10.20.20.1/24  → customer-db  (10.20.20.20)
              └─ CUSTOMER_DB (em3): 10.30.30.1/24 → aegis-forwarder (10.30.30.10)
```

## IP Plan

| Segment | Subnet | Devices |
|---|---|---|
| Attacker ↔ R1 | 192.168.122.0/24 | Kali:192.168.122.132, R1-ether1:192.168.122.2 |
| R1 ↔ pfSense WAN | 10.0.23.0/30 | R1-ether3:10.0.23.1, pfSense-WAN:10.0.23.2 |
| DMZ | 10.10.10.0/24 | pfSense:10.10.10.1, bank-web:10.10.10.10 |
| Internal | 10.20.20.0/24 | pfSense:10.20.20.1, customer-db:10.20.20.20 |
| Management | 10.30.30.0/24 | pfSense:10.30.30.1, aegis-forwarder:10.30.30.10 |

## Internet Connectivity Fix (2026-07-18 — Confirmed Working)

### Problem
VMs couldn't reach internet even though R1 could ping 8.8.8.8.

### Root Cause
MikroTik R1 was not forwarding packets from pfSense (ether3) to internet (ether1).

### Fix — R1 MikroTik
```routeros
# Masquerade outbound traffic
/ip firewall nat add chain=srcnat action=masquerade out-interface=ether1

# Allow forward chain (CRITICAL — without this, R1 drops forwarded packets)
/ip firewall filter add chain=forward action=accept place-before=0
```

### Fix — pfSense
- System > Routing > Gateways → Default gateway IPv4 = **WANGW** (10.0.23.1)
- Interfaces > WAN → uncheck "Block private networks" and "Block bogon networks"
- Firewall > Rules > WAN — Source: 192.168.122.0/24, Action: Pass

### pfSense Console Ping Note
**Option 7 (Ping) always shows "Permission denied"** — this is a pfSense FreeBSD limitation, NOT a network issue.
Use **Diagnostics > Ping** in the GUI to test connectivity instead.

### VM Gateway Setup (run after each reboot or add to netplan)
```bash
# bank-web
sudo ip route add default via 10.10.10.1
echo "nameserver 8.8.8.8" | sudo tee /etc/resolv.conf

# customer-db
sudo ip route add default via 10.20.20.1
echo "nameserver 8.8.8.8" | sudo tee /etc/resolv.conf

# aegis-forwarder
sudo ip route add default via 10.30.30.1
echo "nameserver 8.8.8.8" | sudo tee /etc/resolv.conf
```

## R1 MikroTik Full Config

```routeros
/ip address add address=192.168.122.2/24 interface=ether1
/ip address add address=10.0.23.1/30 interface=ether3
/ip firewall nat add chain=srcnat action=masquerade out-interface=ether1
/ip firewall filter add chain=forward action=accept place-before=0
/ip route add dst-address=10.0.0.0/8 gateway=10.0.23.2
```

## Kali Route (add after every reboot)

```bash
sudo ip route add 10.0.0.0/8 via 192.168.122.2
```

## VM Software Setup

### customer-db (10.20.20.20) — DONE ✅
- MySQL installed
- bankdb created with accounts + transactions tables
- 6 sample accounts (1001–1005, 9999/admin)
- Remote access enabled (bind 0.0.0.0)
- **⚠️ MySQL 8.0 bind-address quirk:** `sed` fails silently — file has no bind-address line by default.
  Must append: `echo "bind-address = 0.0.0.0" >> /etc/mysql/mysql.conf.d/mysqld.cnf`
  Also append: `echo "mysqlx-bind-address = 0.0.0.0" >> /etc/mysql/mysql.conf.d/mysqld.cnf`

### bank-web (10.10.10.10) — DONE ✅
- Apache + PHP + php-mysql installed
- All PHP files in /var/www/html (index, signup, dashboard, transfer, history, profile, logout, db, style)
- Apache running, accessible at http://10.10.10.10
- Login: 1001/1234

### bank-web (10.10.10.10) — IN PROGRESS
- Apache + PHP + php-mysql to install
- Files: db.php, index.php, signup.php, dashboard.php, transfer.php, history.php, profile.php, logout.php, style.css
- paste.rs URLs (valid as of 2026-07-18):
  - db.php        → https://paste.rs/3kh3i
  - index.php     → https://paste.rs/D1ESe
  - signup.php    → https://paste.rs/ChRQ9
  - dashboard.php → https://paste.rs/XPBoL
  - transfer.php  → https://paste.rs/yumVL
  - history.php   → https://paste.rs/XL7Z6
  - profile.php   → https://paste.rs/Osgsq
  - logout.php    → https://paste.rs/KX1qm
  - style.css     → https://paste.rs/YR5lT
- setup.sql       → https://paste.rs/IFRoJ

### aegis-forwarder (10.30.30.10) — PENDING
- Script at /opt/aegis/scripts/src/aegis_forwarder.py
- Config at /opt/aegis/scripts/src/aegis_forwarder.local.conf
- Restart: sudo systemctl restart aegis-forwarder

## Verify Commands

```routeros
# R1 — check interfaces and forward rule
/ip address print
/ip firewall filter print
/ip firewall nat print
```

```bash
# pfSense GUI → Diagnostics > Ping
# Test: 10.0.23.1 (R1)      → should work
# Test: 192.168.122.1 (host) → should work
# Test: 8.8.8.8 (internet)   → should work after fix
```

```bash
# customer-db verify
sudo mysql -e "USE bankdb; SELECT acc_no, full_name, balance FROM accounts;"
```

```bash
# bank-web verify
curl -I http://localhost   # Apache running
curl http://10.10.10.10    # from another VM
```
