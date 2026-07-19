# Router Configuration — MikroTik CHR (R1 only)

> **Last Updated:** 2026-07-19
> **Note:** R2 ဖြုတ်ပြီ။ R1 တစ်ခုပဲ ကျန်တော့တယ်။

---

## R1 Interface Layout (v3 Topology)

| Interface | IP | Connected To |
|---|---|---|
| ether1 | 192.168.122.2/24 | Internet/NAT cloud (virbr0) — direct |
| ether2 | 192.168.10.1/24 | Kali/Attacker e0 — direct, DHCP server |
| ether3 | 10.0.23.1/30 | pfSense WAN — direct |

---

## Full MikroTik Configuration Commands

```routeros
# === IP Addresses ===
/ip address add address=192.168.122.2/24 interface=ether1 comment="Internet virbr0"
/ip address add address=192.168.10.1/24  interface=ether2 comment="Kali attacker network"
/ip address add address=10.0.23.1/30     interface=ether3 comment="pfSense WAN link"

# === Default Route (internet via virbr0) ===
/ip route add dst-address=0.0.0.0/0 gateway=192.168.122.1 comment="Internet"

# === Internal Route (pfSense handles 10.x.x.x) ===
/ip route add dst-address=10.0.0.0/8 gateway=10.0.23.2 comment="Bank VMs via pfSense"

# === NAT masquerade (internet out via ether1) ===
/ip firewall nat add chain=srcnat action=masquerade out-interface=ether1

# === Forward filter (allow forwarded packets) ===
/ip firewall filter add chain=forward action=accept place-before=0

# === DHCP server for Kali (ether2) ===
/ip pool add name=kali-pool ranges=192.168.10.2-192.168.10.100
/ip dhcp-server add name=kali-dhcp interface=ether2 address-pool=kali-pool disabled=no
/ip dhcp-server network add address=192.168.10.0/24 gateway=192.168.10.1 dns-server=8.8.8.8
```

---

## Verify Commands

```routeros
/ip address print
/ip route print
/ip dhcp-server print
/ip dhcp-server lease print
/ip firewall nat print
/ip firewall filter print

# Connectivity tests
/ping 192.168.122.1    # virbr0 host (internet gateway)
/ping 8.8.8.8          # internet
/ping 10.0.23.2        # pfSense WAN
/ping 192.168.10.1     # ether2 self (Kali side)
```

---

## Kali (/etc/network/interfaces)

```
auto eth0
iface eth0 inet dhcp
    post-up ip route add 10.0.0.0/8 via 192.168.10.1 || true
```

---

## pfSense — Required Settings

### Static Route (for return path to Kali)
```
System → Routing → Static Routes → Add
  Network:  192.168.10.0/24
  Gateway:  10.0.23.1
  Description: Return path to Kali attacker network
```

### WAN Firewall Rule
```
Firewall → Rules → WAN
  Action: Pass
  Source: 192.168.10.0/24
  Destination: any
  Description: Allow attacker subnet
```

### Default Gateway
```
System → Routing → Gateways → Default IPv4: WANGW (10.0.23.1)
Interfaces → WAN → uncheck "Block private networks" and "Block bogon networks"
```

---

## Troubleshooting

| Problem | Check | Fix |
|---|---|---|
| Kali DHCP မရ | `/ip dhcp-server print` — address-pool = static-only? | `/ip dhcp-server set 0 address-pool=kali-pool disabled=no` |
| Kali ping 10.10.10.10 မရ | pfSense static route 192.168.10.0/24 | System→Routing→Static Routes မှာ ထည့် |
| Kali internet မရ | Router default route + masquerade | `/ip route print` နဲ့ `/ip firewall nat print` စစ် |
| pfSense ping မရ | pfSense WAN block private | Interfaces→WAN uncheck block private |
