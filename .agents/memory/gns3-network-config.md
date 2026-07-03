---
name: GNS3 network config — AEGIS-SecureBank
description: Confirmed IP assignments, interface mappings, and NAT quirk for MikroTik CHR in GNS3
---

# GNS3 Network Configuration — AEGIS-SecureBank

## Confirmed IP Plan (2026-07-04)

| Segment | Subnet | Devices |
|---|---|---|
| Attacker ↔ Router-1 | 192.168.122.0/24 | Kali:192.168.122.132, R1-ether1:192.168.122.2 |
| NAT cloud (internet) | 192.168.122.0/24 | R1-ether2:DHCP(135), GW:192.168.122.1 |
| Router-1 ↔ Router-2 | 10.0.12.0/30 | R1-ether3:10.0.12.1, R2-ether1:10.0.12.2 |
| Router-2 ↔ pfSense | 10.0.23.0/30 | R2-ether2:10.0.23.1, pfSense-WAN:10.0.23.2 |
| DMZ | 10.10.10.0/24 | pfSense:10.10.10.1, bank-web:.10, bank-mail:.20 |
| Internal | 10.20.20.0/24 | pfSense:10.20.20.1, teller-pc:.10, customer-db:.20 |
| Management | 10.30.30.0/24 | pfSense:10.30.30.1, aegis-forwarder:.10 |

## MikroTik Interface Mapping (GNS3 → RouterOS)

GNS3 labels use `e0, e1, e2` → MikroTik OS uses `ether1, ether2, ether3`

## Critical: NAT Cloud in GNS3

**GNS3 NAT node (nat0) uses 192.168.122.0/24** — same subnet as Cloud1 (vicbr0).
Do NOT assign a static IP to the interface connected to NAT. Use DHCP:

```routeros
/ip dhcp-client add interface=ether2 disabled=no
```

**Why:** NAT cloud gateway is 192.168.122.1 (libvirt default). Static 10.0.99.x fails with "host unreachable".

## Router-1 Full Config

```routeros
/ip address add address=192.168.122.2/24 interface=ether1
/ip address add address=10.0.12.1/30 interface=ether3
/ip dhcp-client add interface=ether2 disabled=no
/ip firewall nat add chain=srcnat out-interface=ether2 action=masquerade
/ip route add dst-address=10.0.0.0/8 gateway=10.0.12.2
# Default route auto-added by DHCP client
```

## Router-2 Full Config

```routeros
/ip address add address=10.0.12.2/30 interface=ether1
/ip address add address=10.0.23.1/30 interface=ether2
/ip route add dst-address=0.0.0.0/0 gateway=10.0.12.1
/ip route add dst-address=10.10.10.0/24 gateway=10.0.23.2
/ip route add dst-address=10.20.20.0/24 gateway=10.0.23.2
/ip route add dst-address=10.30.30.0/24 gateway=10.0.23.2
```

## Verify Commands

```routeros
/ip address print
/ip route print
/ping 8.8.8.8 count=4        # internet test
/ping 10.0.12.2 count=4      # R1→R2 link test
```

## Next: pfSense

pfSense WAN = 10.0.23.2/30, GW = 10.0.23.1 (Router-2 ether2)
Configure via console menu → Option 2 → Set interface IPs
