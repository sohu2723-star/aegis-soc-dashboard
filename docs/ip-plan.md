# AEGIS-SecureBank IP Address Plan

## Network Segments

| Segment | Subnet | Purpose |
|---|---|---|
| Attacker/Internet | 192.168.122.0/24 | KVM virbr0 — Kali attack path |
| R1↔R2 Link | 10.0.12.0/30 | Router interconnect |
| R2↔pfSense Link | 10.10.0.0/30 | WAN link to firewall |
| DMZ (bank-web, bank-mail) | 10.10.10.0/24 | Public-facing bank services |
| Internal (teller, db) | 10.10.20.0/24 | Internal bank systems |
| MGMT (AEGIS) | 10.10.30.0/24 | Monitoring/AEGIS segment |

---

## Node IP Assignments

### Routers (MikroTik CHR)

| Node | Interface | IP | Connected To |
|---|---|---|---|
| R1 | ether1 (e0) | 192.168.122.2/24 | Cloud1 / virbr0 (Kali side) |
| R1 | ether2 (e1) | DHCP (auto) | NAT node |
| R1 | ether3 (e2) | 10.0.12.1/30 | R2 ether1 |
| R2 | ether1 (e0) | 10.0.12.2/30 | R1 ether3 |
| R2 | ether2 (e1) | 10.10.0.1/30 | pfSense WAN |

### pfSense (linux2024)

| Interface | IP | Purpose |
|---|---|---|
| vtnet0 / eth0 | 10.10.0.2/30 | WAN (upstream: R2 10.10.0.1) |
| vtnet1 / eth1 | 10.10.10.1/24 | LAN-DMZ (bank-web, bank-mail) |
| vtnet2 / eth2 | 10.10.20.1/24 | LAN-INT (teller-pc, customer-db) |
| vtnet3 / eth3 | 10.10.30.1/24 | MGMT (aegis-forwarder) |

### Bank VMs (Ubuntu)

| VM | IP | Gateway | Subnet |
|---|---|---|---|
| bank-web | 10.10.10.10/24 | 10.10.10.1 | DMZ |
| bank-mail | 10.10.10.20/24 | 10.10.10.1 | DMZ |
| teller-pc | 10.10.20.10/24 | 10.10.20.1 | Internal |
| customer-db | 10.10.20.20/24 | 10.10.20.1 | Internal |
| aegis-forwarder | 10.10.30.10/24 | 10.10.30.1 | MGMT |

### Attacker

| VM | IP | Network |
|---|---|---|
| Real Kali (virt-manager) | 192.168.122.184 | virbr0 |
| GNS3 Attacker VM | 192.168.122.132 (DHCP) | virbr0 via Cloud |

---

## Default Gateway Summary

| Node | Default Gateway |
|---|---|
| R1 | 192.168.122.1 (virbr0 host) |
| R2 | 10.0.12.1 (R1) |
| pfSense WAN | 10.10.0.1 (R2) |
| Bank VMs | pfSense LAN IP for their subnet |
| Kali | 192.168.122.1 (virbr0 host) |
