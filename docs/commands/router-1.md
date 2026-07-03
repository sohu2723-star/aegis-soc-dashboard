# Router-1 — MikroTik CHR 7.15.3
> **GNS3 node:** Router-1 | **Console:** telnet (double-click in GNS3)
> **Last updated:** 2026-07-04

---

## Interface Map

| GNS3 | MikroTik | Connected to | IP |
|---|---|---|---|
| e0 | ether1 | Cloud1 (vicbr0) → Attacker | 192.168.122.2/24 |
| e1 | ether2 | NAT cloud (nat0) → Internet | DHCP → 192.168.122.135/24 |
| e2 | ether3 | Router-2 ether1 | 10.0.12.1/30 |

---

## Full Configuration Commands (အစမှ အဆုံး)

### Step 1 — IP Addresses

```routeros
/ip address add address=192.168.122.2/24 interface=ether1
/ip address add address=10.0.12.1/30 interface=ether3
```

### Step 2 — NAT Internet (DHCP — static မသုံးနဲ့)

```routeros
/ip dhcp-client add interface=ether2 disabled=no
```

> ⚠️ NAT cloud က 192.168.122.0/24 ပေးတယ် (static 10.0.99.x မအောင်မြင်)
> DHCP bound ဖြစ်ဖို့ 5 seconds စောင့်

### Step 3 — NAT Masquerade (VM တွေ internet ရဖို့)

```routeros
/ip firewall nat add chain=srcnat out-interface=ether2 action=masquerade
```

### Step 4 — Static Routes

```routeros
# Internal network → Router-2 ကိုဖြတ်
/ip route add dst-address=10.0.0.0/8 gateway=10.0.12.2
# Default route → DHCP က auto add လုပ်ပြီး (ထပ်မထည့်ရ)
```

---

## Verify Commands

```routeros
/ip address print
/ip route print
/ip dhcp-client print
/ping 192.168.122.132 count=4   # Attacker ရောက်မရောက်
/ping 10.0.12.2 count=4         # Router-2 link
/ping 8.8.8.8 count=4           # Internet
```

**Expected results:**
- `ping 8.8.8.8` → 0% packet-loss, TTL=115, ~30ms ✅
- `ping 10.0.12.2` → reply ရမည် (Router-2 IP configured ပြီးမှ)

---

## Troubleshooting

| ပြဿနာ | အဖြေ |
|---|---|
| `8.8.8.8 timeout` | ether2 static IP ဖျက်ပြီး DHCP သုံးပါ |
| ether1 DHCP searching | `/ip dhcp-client remove numbers=0` |
| `invalid value for argument address` | `10.0.00.1` မဟုတ်ဘဲ `10.0.99.1` ရေးပါ |

---

## Status: ✅ Complete (2026-07-04 02:28)
