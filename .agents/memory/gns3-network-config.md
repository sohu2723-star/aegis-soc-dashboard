---
name: GNS3 network config — AEGIS-SecureCompany
description: Confirmed IP assignments, interface mappings, internet fix, and VM setup notes
---

# GNS3 Network Configuration — AEGIS-SecureCompany

## Current Topology (v3 — 2026-07-19, ဆရာမ ညွှန်ကြားချက်အတိုင်း)

```
Internet (NAT cloud / virbr0)
        │ direct cable
[Router — MikroTik CHR]
  ether1: 192.168.122.2/24  ← Internet/virbr0 side
  ether2: 192.168.10.1/24   ← Kali/Attacker side (DHCP server)
  ether3: 10.0.23.1/30      ← pfSense WAN link
        │ direct cable
[Kali]  → Router e1 (direct, no switch) — DHCP 192.168.10.x
[pfSense WAN] 10.0.23.2/30
  ├─ BANK_WEB   (e1): 10.10.10.1/24 → Public-Service Switch → company-web-server (10.10.10.10)
  ├─ CUSTOMER_DB (e2): 10.20.20.1/24 → Internal-Service Switch → company-customer-db (10.20.20.20)
  └─ MGMT       (e3): 10.30.30.1/24 → aegis-forwarder (10.30.30.10)
```

## IP Plan

| Segment | Subnet | Devices |
|---|---|---|
| Internet (virbr0) | 192.168.122.0/24 | Router ether1: 192.168.122.2 |
| Attacker network | 192.168.10.0/24 | Router ether2: 192.168.10.1, Kali: DHCP .2–.100 |
| Router ↔ pfSense WAN | 10.0.23.0/30 | Router ether3: 10.0.23.1, pfSense WAN: 10.0.23.2 |
| DMZ (BANK_WEB) | 10.10.10.0/24 | pfSense: 10.10.10.1, company-web-server: 10.10.10.10 |
| Internal (CUSTOMER_DB) | 10.20.20.0/24 | pfSense: 10.20.20.1, company-customer-db: 10.20.20.20 |
| Management | 10.30.30.0/24 | pfSense: 10.30.30.1, aegis-forwarder: 10.30.30.10 |

## Router MikroTik — Full Config

```routeros
/ip address add address=192.168.122.2/24 interface=ether1
/ip address add address=192.168.10.1/24  interface=ether2
/ip address add address=10.0.23.1/30     interface=ether3
/ip route add dst-address=0.0.0.0/0 gateway=192.168.122.1
/ip route add dst-address=10.0.0.0/8 gateway=10.0.23.2
/ip firewall nat add chain=srcnat action=masquerade out-interface=ether1
/ip firewall filter add chain=forward action=accept place-before=0
/ip pool add name=kali-pool ranges=192.168.10.2-192.168.10.100
/ip dhcp-server add name=kali-dhcp interface=ether2 address-pool=kali-pool disabled=no
/ip dhcp-server network add address=192.168.10.0/24 gateway=192.168.10.1 company-dns-server=8.8.8.8
```

## Kali — /etc/network/interfaces

```
auto eth0
iface eth0 inet dhcp
    post-up ip route add 10.0.0.0/8 via 192.168.10.1 || true
```

## pfSense — Required Settings

- Static route: `192.168.10.0/24` via `10.0.23.1` (return path to Kali)
- WAN firewall rule: allow source `192.168.10.0/24`
- Default gateway: WANGW (10.0.23.1)
- WAN interface: uncheck "Block private networks" and "Block bogon networks"

## DHCP Troubleshooting

If MikroTik DHCP shows `address-pool: static-only`:
```routeros
/ip dhcp-server set 0 address-pool=kali-pool disabled=no
```

If Kali has no `dhclient`:
```bash
sudo apt install isc-dhcp-client -y
sudo dhclient eth0
```

## Default Gateways

| Node | Default Gateway |
|---|---|
| Router | 192.168.122.1 (virbr0 host bridge) |
| Kali | 192.168.10.1 (Router ether2) |
| pfSense | 10.0.23.1 (WANGW) |
| company-web-server | 10.10.10.1 (pfSense BANK_WEB) |
| company-customer-db | 10.20.20.1 (pfSense CUSTOMER_DB) |
| aegis-forwarder | 10.30.30.1 (pfSense MGMT) |

## Removed Nodes

| Node | Removed | Reason |
|---|---|---|
| Switch1 (NAT+R1+Kali switch) | 2026-07-19 | ဆရာမ topology change |
| Router-2 (R2) | 2026-07-16 | R1 ↔ pfSense direct |
| bank-mail | 2026-07-16 | internet မရ |
| teller-pc | 2026-07-16 | internet မရ |
| Cowrie honeypot | 2026-07-19 | ဖြုတ်ပြီ |

## VM Software Setup

### company-web-server (10.10.10.10) — DONE ✅
- Apache2, vsftpd, Suricata, Fail2ban installed
- Web app deployed at http://10.10.10.10

### company-customer-db (10.20.20.20) — DONE ✅
- PostgreSQL installed, bankdb created
- Remote access enabled (bind 0.0.0.0)
- ⚠️ MySQL 8.0 bind-address quirk: must append to mysqld.cnf, not sed

### aegis-forwarder (10.30.30.10)
- Script: /opt/aegis/scripts/src/aegis_forwarder.py
- Config: /opt/aegis/scripts/src/aegis_forwarder.local.conf (gitignored)
- Update via: wget from GitHub raw URL (not git pull)
