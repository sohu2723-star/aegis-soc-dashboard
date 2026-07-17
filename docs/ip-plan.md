# AEGIS-SecureBank IP Address Plan (Current Topology)

> **Last Updated:** 2026-07-17  
> **Topology Version:** v3 (R2 ဖြုတ်ပြီ, bank-mail ဖြုတ်ပြီ, teller-pc ဖြုတ်ပြီ)

---

## Network Segments

| Segment | Subnet | Purpose |
|---|---|---|
| Attacker Path (virbr0) | 192.168.122.0/24 | GNS3 NAT cloud — test attacker VMs |
| R1 ↔ pfSense WAN | 10.0.23.0/30 | Direct link (R2 ဖြုတ်ပြီ) |
| DMZ | 10.10.10.0/24 | Public-facing services (bank-web) |
| Internal | 10.20.20.0/24 | Internal systems (customer-db) |
| MGMT | 10.30.30.0/24 | Monitoring segment (AEGIS VM) |

> ⚠️ **Note:** Attacker VMs တွင် 192.168.122.x IP ရှိနိုင်သလို မည်သည့် IP မဆို ရနိုင်သည်။ IP range ကို trust မလုပ်ပါနှင့်။

---

## Node IP Assignments

### Router (MikroTik CHR — R1 only, R2 removed)

| Interface | IP | Connected To |
|---|---|---|
| ether1 | 192.168.122.2/24 | Switch1 (attacker/GNS3 NAT cloud side) |
| ether2 | DHCP (~192.168.122.x) | NAT node (internet egress, masquerade) |
| ether3 | 10.0.23.1/30 | pfSense WAN (direct — R2 ဖြုတ်ပြီ) |

### pfSense 2.7.2 (Firewall / Gateway)

| Interface | FreeBSD | IP | Role |
|---|---|---|---|
| e0 / em0 | vtnet0 | 10.0.23.2/30 | WAN — upstream via R1 ether3 |
| e1 / em1 | vtnet1 | 10.10.10.1/24 | DMZ — gateway for bank-web |
| e2 / em2 | vtnet2 | 10.20.20.1/24 | Internal — gateway for customer-db |
| e3 / em3 | vtnet3 | 10.30.30.1/24 | MGMT — gateway for AEGIS VM |

### Bank VMs (Ubuntu 24.04)

| VM | IP | Gateway | Zone | Services |
|---|---|---|---|---|
| bank-web | 10.10.10.10/24 | 10.10.10.1 | DMZ | Apache2, vsftpd, Suricata, Fail2ban |
| customer-db | 10.20.20.20/24 | 10.20.20.1 | Internal | PostgreSQL, Suricata, Fail2ban |
| aegis-forwarder | 10.30.30.10/24 | 10.30.30.1 | MGMT | Hub agent (SSH → bank-web, customer-db) |

### Removed Nodes (historical reference)

| Node | Was | Reason |
|---|---|---|
| Router-2 (R2) | MikroTik CHR, 10.0.12.2/10.0.23.1 | ဖြုတ်ပြီ — R1 တိုက်ရိုက် pfSense နဲ့ ချိတ် |
| bank-mail | 10.10.10.20 DMZ | ဖြုတ်ပြီ — internet access မရ၍ |
| teller-pc | 10.20.20.10 Internal | ဖြုတ်ပြီ — internet access မရ၍ |

---

## Default Gateway Summary

| Node | Default Gateway |
|---|---|
| R1 | 192.168.122.1 (virbr0 host) |
| pfSense WAN | 10.0.23.1 (R1 ether3) |
| bank-web | 10.10.10.1 (pfSense DMZ) |
| customer-db | 10.20.20.1 (pfSense INT) |
| aegis-forwarder | 10.30.30.1 (pfSense MGMT) |

---

## Routing

### R1 Static Route
```routeros
/ip route add dst-address=10.0.0.0/8 gateway=10.0.23.2
/ip firewall nat add chain=srcnat out-interface=ether2 action=masquerade
```

### pfSense Routes (auto from connected interfaces)
- 10.0.23.0/30 → WAN (em0)
- 10.10.10.0/24 → DMZ (em1)
- 10.20.20.0/24 → INT (em2)
- 10.30.30.0/24 → MGMT (em3)
- 0.0.0.0/0 → 10.0.23.1 (R1)

### Attacker Route (add each session — any attacker VM)
```bash
# If attacker is on virbr0 side and needs to reach bank VMs:
sudo ip route add 10.0.0.0/8 via 192.168.122.2
# Note: Lost on reboot — re-add each time
```
