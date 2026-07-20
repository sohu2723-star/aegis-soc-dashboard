# AEGIS-SecureCompany IP Address Plan

> **Last Updated:** 2026-07-20
> **Topology Version:** v4 (Final — OVS switches, DNS-Server, LDAP-Server, company-customer-db IP ပြောင်း)

---

## Network Segments

| Segment | Subnet | Purpose |
|---|---|---|
| Internet (virbr0) | 192.168.122.0/24 | GNS3 NAT cloud — Router internet egress |
| Attacker network | 192.168.10.0/24 | Kali DHCP subnet (Router ether2 ↔ Kali direct) |
| Router ↔ pfSense WAN | 10.0.23.0/30 | Direct link (R2 ဖြုတ်ပြီ) |
| DMZ (Public Services) | 10.10.10.0/24 | company-web-server, DNS-Server |
| Internal (Internal Services) | 10.20.20.0/24 | company-customer-db, LDAP-Server |
| MGMT | 10.30.30.0/24 | Monitoring segment — aegis-company-admin |

> ⚠️ **Kali IP က dynamic** (DHCP 192.168.10.2–100)။ Attack events မှာ any IP in 192.168.10.0/24 range က attacker ဖြစ်နိုင်တယ်။

---

## Node IP Assignments

### Router (MikroTik CHR — R1 only, R2 removed)

| Interface | IP | Connected To |
|---|---|---|
| ether1 (e0) | 192.168.122.2/24 | Internet/NAT cloud (virbr0) — direct cable |
| ether2 (e1) | 192.168.10.1/24 | Kali/Attacker — direct cable, DHCP server here |
| ether3 (e2) | 10.0.23.1/30 | pfSense WAN — direct cable |

### Router DHCP Server (ether2 — Kali pool)

| Setting | Value |
|---|---|
| Pool name | kali-pool |
| Range | 192.168.10.2 – 192.168.10.100 |
| Gateway | 192.168.10.1 |
| DNS | 10.10.10.20 (lab DNS), 8.8.8.8 (fallback) |
| Interface | ether2 |

### Kali / Attacker

| Setting | Value |
|---|---|
| Interface | eth0 |
| IP | Dynamic DHCP (192.168.10.x) |
| Gateway | 192.168.10.1 (Router ether2) |
| Internet | via Router → virbr0 |
| Lab route | 10.0.0.0/8 via 192.168.10.1 |

### pfSense 2.7.2 (Firewall / Gateway)

| Interface | GNS3 | IP | Role |
|---|---|---|---|
| e0 | vtnet0 | 10.0.23.2/30 | WAN — GW=10.0.23.1 |
| e1 | vtnet1 | 10.10.10.1/24 | DMZ — Public Services gateway |
| e2 | vtnet2 | 10.20.20.1/24 | INT — Internal Services gateway |
| e3 | vtnet3 | 10.30.30.1/24 | MGMT — Management gateway |

### pfSense Static Route (required for Kali return path)

| Network | Gateway | Purpose |
|---|---|---|
| 192.168.10.0/24 | 10.0.23.1 | Return packets to Kali/Attacker subnet |

### pfSense WAN Firewall Rule

| Field | Value |
|---|---|
| Action | Pass |
| Source | 192.168.10.0/24 |
| Destination | any |
| Description | Allow attacker subnet |

### OVS Switches

| Switch | Connected to pfSense | VMs |
|---|---|---|
| Public-Services (OVS) | e1 (DMZ 10.10.10.1) | company-web-server, DNS-Server |
| Internal-Services (OVS) | e2 (INT 10.20.20.1) | company-customer-db, LDAP-Server |

### Company VMs (Ubuntu Server 22.04)

| VM | IP | Gateway | Zone | Services |
|---|---|---|---|---|
| company-web-server | 10.10.10.10/24 | 10.10.10.1 | DMZ | Apache2, ModSecurity, vsftpd, Suricata, Fail2ban, SSH |
| DNS-Server | 10.10.10.20/24 | 10.10.10.1 | DMZ | BIND9 DNS, Fail2ban, SSH |
| company-customer-db | 10.20.20.10/24 | 10.20.20.1 | Internal | MySQL, Suricata, Fail2ban, SSH |
| LDAP-Server | 10.20.20.20/24 | 10.20.20.1 | Internal | OpenLDAP (slapd), Fail2ban, SSH |
| aegis-company-admin | 10.30.30.10/24 | 10.30.30.1 | MGMT | aegis_forwarder.py (hub mode), SSH |

---

## Default Gateway Summary

| Node | Default Gateway |
|---|---|
| Router | 192.168.122.1 (virbr0 host bridge) |
| Kali | 192.168.10.1 (Router ether2) |
| pfSense | 10.0.23.1 (WANGW — Router ether3) |
| company-web-server | 10.10.10.1 (pfSense DMZ) |
| DNS-Server | 10.10.10.1 (pfSense DMZ) |
| company-customer-db | 10.20.20.1 (pfSense INT) |
| LDAP-Server | 10.20.20.1 (pfSense INT) |
| aegis-company-admin | 10.30.30.1 (pfSense MGMT) |

---

## VLAN Assignment (OVS Switches)

| VLAN ID | Segment | Switch | VMs |
|---|---|---|---|
| 10 | DMZ | Public-Services | company-web-server (eth1), DNS-Server (eth2) |
| 20 | Internal | Internal-Services | company-customer-db (eth1), LDAP-Server (eth2) |

---

## Removed Nodes

| Node | Was | Reason |
|---|---|---|
| Router-2 (R2) | MikroTik CHR, 10.0.12.x/10.0.23.1 | 2026-07-16 ဖြုတ်ပြီ |
| Switch1 | NAT+R1+Kali ကြား switch | 2026-07-19 ဖြုတ်ပြီ |
| bank-mail | 10.10.10.20 DMZ (v3) | 2026-07-16 ဖြုတ်ပြီ — DNS-Server အဖြစ် replace |
| teller-pc | 10.20.20.10 Internal (v3) | 2026-07-16 ဖြုတ်ပြီ — company-customer-db .10 IP ယူ |
