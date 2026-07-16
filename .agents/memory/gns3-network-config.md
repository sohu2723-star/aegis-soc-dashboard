---
name: GNS3 network config — AEGIS-SecureBank
description: Confirmed IP assignments, interface mappings, and NAT quirk for MikroTik CHR in GNS3
---

# GNS3 Network Configuration — AEGIS-SecureBank

## Current Topology (2026-07-16 — Simplified)

R2, bank-mail, teller-pc ဖြုတ်ပြီ။ R1 က pfSense ကို တိုက်ရိုက်ချိတ်ထားတယ်။

```
Kali (192.168.122.132)
    │
Switch1
    │
R1  ├─ ether1: 192.168.122.2/24   (Switch1 / Kali network)
    ├─ ether2: DHCP 192.168.122.x  (NAT nat0 → internet, masquerade here)
    └─ ether3: 10.0.23.1/30        (pfSense WAN direct link)
                    │
              pfSense WAN (em0): 10.0.23.2/30, GW=10.0.23.1
              ├─ LAN  (em1): 10.10.10.1/24  → DMZ-Switch → bank-web (10.10.10.10)
              ├─ OPT1 (em2): 10.20.20.1/24  → INT-Switch → customer-db (10.20.20.20)
              └─ OPT2 (em3): 10.30.30.1/24  → aegis-forwarder (10.30.30.10)
```

## IP Plan (Current)

| Segment | Subnet | Devices |
|---|---|---|
| Attacker ↔ R1 | 192.168.122.0/24 | Kali:192.168.122.132, R1-ether1:192.168.122.2 |
| NAT cloud (internet) | 192.168.122.0/24 | R1-ether2:DHCP, GW:192.168.122.1 |
| R1 ↔ pfSense WAN | 10.0.23.0/30 | R1-ether3:10.0.23.1, pfSense-WAN:10.0.23.2 |
| DMZ | 10.10.10.0/24 | pfSense:10.10.10.1, bank-web:.10 |
| Internal | 10.20.20.0/24 | pfSense:10.20.20.1, customer-db:.20 |
| Management | 10.30.30.0/24 | pfSense:10.30.30.1, aegis-forwarder:.10 |

## R1 (MikroTik) Full Config

```routeros
/ip address add address=192.168.122.2/24 interface=ether1
/ip address add address=10.0.23.1/30 interface=ether3
/ip dhcp-client add interface=ether2 disabled=no
/ip firewall nat add chain=srcnat out-interface=ether2 action=masquerade
/ip route add dst-address=10.0.0.0/8 gateway=10.0.23.2
# Default route auto-added by DHCP client
```

## Kali Route (add after every reboot)

```bash
sudo ip route add 10.0.0.0/8 via 192.168.122.2
```

## MikroTik Interface Mapping (GNS3 → RouterOS)

GNS3 labels use `e0, e1, e2` → MikroTik OS uses `ether1, ether2, ether3`

## Critical: NAT Cloud in GNS3

**GNS3 NAT node (nat0) uses 192.168.122.0/24** — same subnet as Cloud1 (virbr0).
Do NOT assign a static IP to the interface connected to NAT. Use DHCP:

```routeros
/ip dhcp-client add interface=ether2 disabled=no
```

**Why:** NAT cloud gateway is 192.168.122.1 (libvirt default). Static IPs fail with "host unreachable".

## Verify Commands

```routeros
# R1
/ip address print
/ip route print
/ping 10.0.23.2 count=4      # R1→pfSense WAN (note: pfSense blocks inbound ping by default → timeout is normal)
```

```bash
# pfSense console → Option 7
# ping 10.0.23.1   → R1 (should work)
# ping 8.8.8.8     → internet (should work)
```

```bash
# Kali
ping -c 3 10.10.10.10   # bank-web
ping -c 3 10.20.20.20   # customer-db
ping -c 3 10.30.30.10   # aegis-forwarder
```

## Important Notes

- **pfSense blocks inbound ping on WAN by default** — R1 pinging pfSense WAN IP will always timeout. Test from pfSense side instead.
- **Kali route is not persistent** — `ip route add` clears on reboot. Add to `/etc/network/interfaces` or run after each reboot.
- **pfSense WAN firewall** — need Pass rule for `192.168.122.0/24` source to allow Kali attacks to reach internal hosts.
