# Router-1 — MikroTik CHR 7.15.3
> **GNS3 node:** Router | **Console:** telnet (double-click in GNS3)
> **Last updated:** 2026-07-20 (v4 — R2 removed, Kali direct on ether2)

---

## Interface Map (v4)

| GNS3 | MikroTik | Connected to | IP |
|---|---|---|---|
| e0 | ether1 | Internet / virbr0 NAT cloud | 192.168.122.2/24 (static) |
| e1 | ether2 | Attacker (Kali) — direct cable | 192.168.10.1/24 (DHCP server) |
| e2 | ether3 | pfSense WAN — direct cable | 10.0.23.1/30 (static) |

---

## Full Configuration Commands (v4 — အစမှ အဆုံး)

### Step 1 — IP Addresses

```routeros
# e0 → Internet (virbr0 NAT cloud)
/ip address add address=192.168.122.2/24 interface=ether1

# e1 → Kali/Attacker (DHCP server ဖြစ်မည်)
/ip address add address=192.168.10.1/24 interface=ether2

# e2 → pfSense WAN (point-to-point /30)
/ip address add address=10.0.23.1/30 interface=ether3
```

### Step 2 — Default + Internal Routes

```routeros
# Default route → virbr0 host (internet ထွက်ဖို့)
/ip route add dst-address=0.0.0.0/0 gateway=192.168.122.1

# Internal route → pfSense (bank VMs ရောက်ဖို့)
/ip route add dst-address=10.0.0.0/8 gateway=10.0.23.2
```

### Step 3 — NAT Masquerade

```routeros
/ip firewall nat add chain=srcnat out-interface=ether1 action=masquerade
```

### Step 4 — Allow Forward

```routeros
/ip firewall filter add chain=forward action=accept place-before=0
```

### Step 5 — DHCP Server for Kali

```routeros
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
/ping 8.8.8.8 count=4          # Internet test
/ping 10.0.23.2 count=4        # pfSense WAN test
/ping 192.168.10.2 count=4     # Kali (ရင် DHCP ရပြီ)
```

**Expected results:**
- `ping 8.8.8.8` → 0% packet-loss ✅
- `ping 10.0.23.2` → reply ရမည် (pfSense WAN configured ပြီးမှ)
- `ping 192.168.10.x` → reply ရမည် (Kali DHCP ရပြီးမှ)

---

## Troubleshooting

| ပြဿနာ | အဖြေ |
|---|---|
| `8.8.8.8 timeout` | ether1 IP 192.168.122.2 မှန်မမှန် စစ်ပါ |
| Kali IP မရဘူး | `/ip dhcp-server print` စစ်ပြီး interface=ether2 ဖြစ်မဖြစ် စစ် |
| pfSense WAN မ ping မရဘူး | pfSense e0 မှာ 10.0.23.2 configure ပြီးမပြီး စစ် |

---

## Status: ✅ v4 Complete (2026-07-20)
