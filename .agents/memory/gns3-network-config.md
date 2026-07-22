---
name: GNS3 network config — AEGIS-SecureCompany
description: Confirmed IP assignments, interface mappings, and VM setup notes for v4 Final topology
---

# GNS3 Network Configuration — AEGIS-SecureCompany v4 (Final)

## Current Topology (v4 Final — 2026-07-20)

```
Internet (NAT cloud / virbr0)  192.168.122.0/24
        │ direct cable
[Router — MikroTik CHR]
  e0: 192.168.122.2/24  ← Internet/virbr0 side
  e1: 192.168.10.1/24   ← Kali/Attacker side (DHCP server)
  e2: 10.0.23.1/30      ← pfSense WAN link

[Kali] → Router e1 (DHCP from pool 192.168.10.2–100)

[pfSense]
  e0 (WAN):  10.0.23.2/30
  e1 (DMZ):  10.10.10.1/24  → Public-Services OVS Switch
  e2 (INT):  10.20.20.1/24  → Internal-Services OVS Switch
  e3 (MGMT): 10.30.30.1/24  → aegis-company-admin

Public-Services OVS Switch:
  → company-web-server  10.10.10.10
  → company-dns-server  10.10.10.20

Internal-Services OVS Switch:
  → company-customer-db 10.20.20.10
  → company-ldap-server 10.20.20.20
```

## IP Plan (v4 Final)

| Node | IP | Role | Services |
|---|---|---|---|
| Internet (virbr0) | 192.168.122.1 | NAT Gateway | Host bridge |
| Router (e0) | 192.168.122.2 | Internet uplink | MikroTik CHR |
| Router (e1) | 192.168.10.1 | Attacker gateway | DHCP pool .2–.100 |
| Router (e2) | 10.0.23.1 | pfSense WAN link | — |
| Kali | 192.168.10.x (DHCP) | Red Team | Attacker |
| pfSense WAN | 10.0.23.2 | Firewall/router | — |
| pfSense DMZ gw | 10.10.10.1 | DMZ gateway | Suricata IDS |
| pfSense INT gw | 10.20.20.1 | Internal gateway | — |
| pfSense MGMT gw | 10.30.30.1 | Management gateway | — |
| company-web-server | 10.10.10.10 | Web server | Apache2, PHP, Fail2ban |
| company-dns-server | 10.10.10.20 | DNS | BIND9, Fail2ban |
| company-customer-db | 10.20.20.10 | Database | MySQL, Fail2ban |
| company-ldap-server | 10.20.20.20 | Auth | OpenLDAP, Fail2ban |
| aegis-company-admin | 10.30.30.10 | Hub agent | aegis_forwarder.py (hub mode) |

**⚠️ Critical:** company-customer-db = 10.20.20.10 (NOT .20). company-ldap-server = 10.20.20.20.

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
/ip dhcp-server network add address=192.168.10.0/24 gateway=192.168.10.1 dns-server=8.8.8.8
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
- Suricata package installed; EVE JSON FILE output enabled; logs at `/var/log/suricata/suricata_em<N>.<PID>/eve.json`

## Default Gateways per VM

| Node | Default Gateway |
|---|---|
| Router | 192.168.122.1 (virbr0 host bridge) |
| Kali | 192.168.10.1 (Router ether1) |
| pfSense | 10.0.23.1 (WANGW) |
| company-web-server | 10.10.10.1 (pfSense DMZ) |
| company-dns-server | 10.10.10.1 (pfSense DMZ) |
| company-customer-db | 10.20.20.1 (pfSense INT) |
| company-ldap-server | 10.20.20.1 (pfSense INT) |
| aegis-company-admin | 10.30.30.1 (pfSense MGMT) |

## GNS3 NAT Cloud

- Uses virbr0 bridge: `192.168.122.0/24`
- DHCP only — GNS3 NAT cloud cannot assign static IPs
- Router ether1 gets `192.168.122.2` via DHCP (or set static in GNS3 node config)

## Removed Nodes (since v1)

| Node | Removed | Reason |
|---|---|---|
| Switch1 (NAT+R1+Kali switch) | 2026-07-19 | Supervisor topology change |
| Router-2 (R2) | 2026-07-16 | R1 ↔ pfSense direct |
| bank-mail | 2026-07-16 | No internet access |
| teller-pc | 2026-07-16 | No internet access |
| Cowrie honeypot | 2026-07-19 | Removed — Suricata+Fail2ban only |

## VM Script Location (aegis-company-admin)

- Script: `/opt/aegis/scripts/src/aegis_forwarder.py`
- Config: `/opt/aegis/scripts/src/aegis_forwarder.local.conf` (gitignored, machine-specific)
- Update: `wget -O /opt/aegis/scripts/src/aegis_forwarder.py https://raw.githubusercontent.com/sohu2723-star/aegis-soc-dashboard/main/scripts/src/aegis_forwarder.py`
- **Never use git pull** — VMs cannot reach GitHub directly; use wget from GitHub raw URL.
