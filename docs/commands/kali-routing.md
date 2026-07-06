# Kali Attacker → Ubuntu VMs Routing Setup

## Network Map

```
Kali (192.168.122.132)
    ↓ via Cloud1 (NAT 192.168.122.0/24)
Router-1 ether1 (192.168.122.2)
    ↓ ether3
Router-2 ether1 (10.0.12.2)
    ↓ ether2
pfSense WAN (10.0.23.2/30)
    ↓
pfSense LAN/OPT1/OPT2
    ↓
Ubuntu VMs (10.10.10.x / 10.20.20.x / 10.30.30.x)
```

---

## STEP 1 — Kali မှာ Route ထည့်

```bash
# Route ထည့် (Router-1 ether1 IP = 192.168.122.2)
sudo ip route add 10.0.0.0/8 via 192.168.122.2

# စစ်ကြည့်
ip route show | grep 10.0
# Output: 10.0.0.0/8 via 192.168.122.2 dev eth0
```

**Reboot ပြီးလည်း route ကျန်ချင်ရင် (persistent):**
```bash
# /etc/network/interfaces သို့မဟုတ် netplan မှာ ထည့်
# သို့မဟုတ် rc.local မှာ ထည့်
echo "sudo ip route add 10.0.0.0/8 via 192.168.122.2" >> ~/.bashrc
```

---

## STEP 2 — Router-1 Route စစ် (MikroTik)

```routeros
/ip route print
```

ရှိရမည်:
```
10.0.0.0/8    gateway=10.0.12.2   ✅
0.0.0.0/0     (DHCP auto)         ✅
```

မရှိရင်:
```routeros
/ip route add dst-address=10.0.0.0/8 gateway=10.0.12.2
```

---

## STEP 3 — Router-2 Route စစ် (MikroTik)

```routeros
/ip route print
```

ရှိရမည်:
```
0.0.0.0/0        gateway=10.0.12.1   ✅ (Kali ဆီ return path)
10.10.10.0/24    gateway=10.0.23.2   ✅
10.20.20.0/24    gateway=10.0.23.2   ✅
10.30.30.0/24    gateway=10.0.23.2   ✅
```

မရှိရင်:
```routeros
/ip route add dst-address=0.0.0.0/0 gateway=10.0.12.1
/ip route add dst-address=10.10.10.0/24 gateway=10.0.23.2
/ip route add dst-address=10.20.20.0/24 gateway=10.0.23.2
/ip route add dst-address=10.30.30.0/24 gateway=10.0.23.2
```

---

## STEP 4 — pfSense WebGUI မှာ WAN Firewall Rule

pfSense default = WAN incoming traffic block all
Kali packets Router-2 ကနေ WAN interface ဖြင့် ဝင်လာသောကြောင့် rule ထည့်ရမည်

**bank-web Firefox → `http://10.10.10.1` → Firewall → Rules → WAN → Add (↑)**

| Field | Value |
|---|---|
| Action | Pass |
| Interface | WAN |
| Protocol | Any |
| Source | Network → `192.168.122.0/24` |
| Destination | Any |
| Description | Allow Kali attacker |

**Save → Apply Changes**

---

## STEP 5 — pfSense Static Route (Return Path)

**System → Routing → Static Routes → Add**

| Field | Value |
|---|---|
| Network | `192.168.122.0/24` |
| Gateway | `10.0.23.1` (Router-2) |
| Description | Route back to Kali |

**Save → Apply Changes**

---

## STEP 6 — Test (Kali Terminal)

```bash
# Hop by hop test
ping -c 2 192.168.122.2    # Router-1 ✅
ping -c 2 10.0.12.2        # Router-2 ✅
ping -c 2 10.0.23.2        # pfSense WAN ✅
ping -c 2 10.10.10.1       # pfSense LAN ✅
ping -c 2 10.10.10.10      # bank-web ✅
ping -c 2 10.20.20.10      # teller-pc ✅
ping -c 2 10.30.30.10      # aegis-forwarder ✅
```

**ဘယ် hop မှာ drop ဖြစ်လဲ သိဖို့:**
```bash
traceroute 10.10.10.10
```

```
1  192.168.122.2   ← Router-1
2  10.0.12.2       ← Router-2
3  10.0.23.2       ← pfSense WAN
4  10.10.10.10     ← bank-web ✅
```

`* * *` ပြတဲ့ hop = block ဖြစ်နေတဲ့နေရာ

---

## Troubleshoot Quick Reference

| Symptom | Cause | Fix |
|---|---|---|
| Router-1 မရ | Kali route မထည့်ရသေး | `ip route add 10.0.0.0/8 via 192.168.122.2` |
| Router-2 မရ | R1 route ပြဿနာ | R1: `ip route print` စစ် |
| pfSense WAN မရ | R2 route ပြဿနာ | R2: `ip route print` စစ် |
| VM မရ | pfSense WAN rule မထည့်ရသေး | WebGUI → Firewall → WAN → Add pass rule |
| Ping သွားပြီး return မလာ | pfSense static route မရှိ | System → Routing → Static Routes ထည့် |
