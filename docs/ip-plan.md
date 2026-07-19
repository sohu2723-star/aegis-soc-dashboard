# AEGIS-SecureBank IP Address Plan

> **Last Updated:** 2026-07-19
> **Topology Version:** v3 (ဆရာမ ညွှန်ကြားချက်အတိုင်း — Switch1 ဖြုတ်ပြီ, Kali subnet ပြောင်းပြီ)

---

## Network Segments

| Segment | Subnet | Purpose |
|---|---|---|
| Internet (virbr0) | 192.168.122.0/24 | GNS3 NAT cloud — Router internet egress |
| Attacker network | 192.168.10.0/24 | Kali DHCP subnet (Router ether2 ↔ Kali direct) |
| Router ↔ pfSense WAN | 10.0.23.0/30 | Direct link (R2 ဖြုတ်ပြီ) |
| DMZ (BANK_WEB) | 10.10.10.0/24 | Public-facing services — bank-web |
| Internal (CUSTOMER_DB) | 10.20.20.0/24 | Internal systems — customer-db |
| MGMT | 10.30.30.0/24 | Monitoring segment — aegis-forwarder |

> ⚠️ **Kali IP က dynamic** (DHCP 192.168.10.2–100)။ Attack events မှာ any IP in 192.168.10.0/24 range က attacker ဖြစ်နိုင်တယ်။

---

## Node IP Assignments

### Router (MikroTik CHR — R1 only, R2 removed)

| Interface | IP | Connected To |
|---|---|---|
| ether1 | 192.168.122.2/24 | Internet/NAT cloud (virbr0) — direct cable |
| ether2 | 192.168.10.1/24 | Kali/Attacker e0 — direct cable, DHCP server here |
| ether3 | 10.0.23.1/30 | pfSense WAN — direct cable |

### Router DHCP Server (ether2 — Kali pool)

| Setting | Value |
|---|---|
| Pool name | kali-pool |
| Range | 192.168.10.2 – 192.168.10.100 |
| Gateway | 192.168.10.1 |
| DNS | 8.8.8.8 |
| Interface | ether2 |

### Kali / Attacker

| Setting | Value |
|---|---|
| Interface | eth0 |
| IP | Dynamic DHCP (192.168.10.x) |
| Gateway | 192.168.10.1 (Router ether2) |
| Internet | via Router → virbr0 |
| Lab route | 10.0.0.0/8 via 192.168.10.1 (post-up in /etc/network/interfaces) |

### pfSense 2.7.2 (Firewall / Gateway)

| Interface | GNS3 | IP | Role |
|---|---|---|---|
| e0 | em0/vtnet0 | 10.0.23.2/30 | WAN — GW=10.0.23.1 |
| e1 | em1/vtnet1 | 10.10.10.1/24 | BANK_WEB — DMZ gateway |
| e2 | em2/vtnet2 | 10.20.20.1/24 | CUSTOMER_DB — Internal gateway |
| e3 | em3/vtnet3 | 10.30.30.1/24 | MGMT — Management gateway |

### pfSense Static Route (required for Kali return path)

| Network | Gateway | Purpose |
|---|---|---|
| 192.168.10.0/24 | 10.0.23.1 | Return packets to Kali subnet |

### pfSense WAN Firewall Rule

| Field | Value |
|---|---|
| Action | Pass |
| Source | 192.168.10.0/24 |
| Destination | any |
| Description | Allow attacker subnet |

### Bank VMs (Ubuntu Server)

| VM | IP | Gateway | Zone | Services |
|---|---|---|---|---|
| bank-web | 10.10.10.10/24 | 10.10.10.1 | DMZ | Apache2, vsftpd, Suricata, Fail2ban, SSH |
| customer-db | 10.20.20.20/24 | 10.20.20.1 | Internal | PostgreSQL, Suricata, Fail2ban, SSH |
| aegis-forwarder | 10.30.30.10/24 | 10.30.30.1 | MGMT | aegis_forwarder.py hub agent |

---

## Default Gateway Summary

| Node | Default Gateway |
|---|---|
| Router | 192.168.122.1 (virbr0 host bridge) |
| Kali | 192.168.10.1 (Router ether2) |
| pfSense | 10.0.23.1 (WANGW — Router ether3) |
| bank-web | 10.10.10.1 (pfSense BANK_WEB) |
| customer-db | 10.20.20.1 (pfSense CUSTOMER_DB) |
| aegis-forwarder | 10.30.30.1 (pfSense MGMT) |

---

## Removed Nodes

| Node | Was | Reason |
|---|---|---|
| Switch1 | NAT+R1+Kali ကြား switch | 2026-07-19 ဖြုတ်ပြီ |
| Router-2 (R2) | MikroTik CHR, 10.0.12.x/10.0.23.1 | 2026-07-16 ဖြုတ်ပြီ |
| bank-mail | 10.10.10.20 DMZ | 2026-07-16 ဖြုတ်ပြီ |
| teller-pc | 10.20.20.10 Internal | 2026-07-16 ဖြုတ်ပြီ |
