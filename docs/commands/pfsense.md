# pfSense — Firewall / IPS / WAF
> **GNS3 node:** pfSense 2.7.2-RELEASE (amd64) | **Console:** VNC (double-click in GNS3)
> **Last updated:** 2026-07-04

---

## ⚠️ Critical Finding — NIC Type is e1000, NOT VirtIO

pfSense boot မှာ `vtnet0` မျှော်လင့်ထားသော်လည်း GNS3 QEMU NIC type = **Intel e1000 (82540EM)**
ကြောင့် interface name တွေ `em0`–`em7` ဖြစ်နေသည်။

```bash
# Shell (Option 8) မှာ verify လုပ်ပုံ
ifconfig -l
# Output: em0 em1 em2 em3 em4 em5 em6 em7 enc0 lo0 pflog0 pfsync0

ifconfig -a | grep "flags\|inet "
# em0–em3: LOWER_UP (cable ချိတ်ပြီး link active)
# em4–em7: link DOWN (cable မချိတ်)
```

**Rule:** pfSense QEMU template မှာ NIC type = `Intel Gigabit Ethernet (82540EM)` → interface name `em0, em1...`

---

## Interface Map (Confirmed Working ✅)

| GNS3 port | pfSense iface | Role | Connected to | IP |
|---|---|---|---|---|
| e0 | em0 | WAN | Router ether3 (direct) | 10.0.23.2/30, GW=10.0.23.1 |
| e1 | em1 | DMZ | Public-Services OVS Switch | 10.10.10.1/24 |
| e2 | em2 | INT | Internal-Services OVS Switch | 10.20.20.1/24 |
| e3 | em3 | MGMT | aegis-ADMIN | 10.30.30.1/24 |

---

## Step 1 — Console Menu: Interface Assignment (Option 1)

pfSense menu → **Option 1: Assign Interfaces**

```
Should VLANs be set up now? → n

Enter the WAN interface name or 'a' for auto-detection
(em0 em1 em2 em3 em4 em5 em6 em7 or a): em0

Enter the LAN interface name or 'a' for auto-detection
(em1 em2 em3 em4 em5 em6 em7 a or nothing if finished): em1

Enter the Optional 1 interface name:
(em2 em3 em4 em5 em6 em7 a or nothing if finished): em2

Enter the Optional 2 interface name:
(em3 em4 em5 em6 em7 a or nothing if finished): em3

Enter the Optional 3 interface name:
(em4 em5 em6 em7 a or nothing if finished): (blank — Enter)

Do you want to proceed? [y|n] → y
```

**ပြီးရင် menu မှာ ဒါပြမည် (Confirmed ✅):**
```
WAN  (wan)  → em0  → v4: 10.0.23.2/30
LAN  (lan)  → em1  → v4: 10.10.10.1/24
OPT1 (opt1) → em2  → v4: 10.20.20.1/24
OPT2 (opt2) → em3  → v4: 10.30.30.1/24
```

---

## Step 2 — Console Menu: Set IPs (Option 2)

### WAN (em0)

```
Enter an option: 2
Select interface: 1 (WAN)

Configure IPv4 via DHCP? → n
New WAN IPv4 address: 10.0.23.2
Subnet bit count: 30
Upstream gateway for WAN: 10.0.23.1
Should this gateway be set as default? → y        ← IMPORTANT: y ဖြေရမည်
Configure IPv6 via DHCP6? → n
Enter WAN IPv6 address: (blank — Enter)
Do you want to revert to HTTP? → n
(Press ENTER to continue)
```

### LAN / DMZ (em1)

```
Select interface: 2 (LAN)

Configure IPv4 via DHCP? → n
IPv4 address: 10.10.10.1
Subnet bit count: 24
Gateway: (blank — Enter)
Configure IPv6? → n
Do you want to enable DHCP server on LAN? → y
Start DHCP range: 10.10.10.100
End DHCP range: 10.10.10.200
Revert to HTTP? → n
```

### OPT1 / Internal (em2)

```
Select interface: 3 (OPT1)

Configure IPv4 via DHCP? → n
IPv4 address: 10.20.20.1
Subnet bit count: 24
Gateway: (blank — Enter)
Configure IPv6? → n
Enable DHCP? → y
Start: 10.20.20.100
End:   10.20.20.200
```

### OPT2 / MGMT (em3)

```
Select interface: 4 (OPT2)

Configure IPv4 via DHCP? → n
IPv4 address: 10.30.30.1
Subnet bit count: 24
Gateway: (blank — Enter)
Configure IPv6? → n
Enable DHCP? → y
Start: 10.30.30.100
End:   10.30.30.200
```

---

## Step 3 — Connectivity Verification (Confirmed ✅)

pfSense console **Option 7: Ping host**

```
ping 10.0.23.1   → ✅ 0% loss  (Router WAN link)
ping 10.0.12.1   → ✅ 0% loss, ttl=63  (Router-1 — full routing chain)
ping 8.8.8.8     → (test pending)
```

pfSense **Option 8: Shell** — routing table verify

```bash
netstat -rn          # default route 10.0.23.1 ပါမပါ စစ်
ifconfig em0         # WAN IP စစ်
ifconfig em1         # LAN IP စစ်

# WAN default route manually add လိုအပ်ရင် (WAN gateway 'n' ဖြေမိခဲ့ရင်):
route add default 10.0.23.1
```

---

## Step 4 — WebGUI Access

pfSense WebGUI ကို Internal subnet မှ access:

```
URL:  https://10.20.20.1   (OPT1/Internal side)
      သို့မဟုတ်
      https://10.0.23.2    (WAN side — Router မှ)
User: admin
Pass: pfsense  ← ချက်ချင်း ပြောင်းပါ
```

> ⚠️ OPT1/OPT2 interfaces ကို WebGUI မှာ **Enable** လုပ်ရမည် (default = disabled)

---

## Step 5 — WebGUI: Enable OPT Interfaces

```
Interfaces → OPT1 → Enable ✅ → Description: DMZ_INTERNAL → Save → Apply
Interfaces → OPT2 → Enable ✅ → Description: MGMT → Save → Apply
```

---

## Step 6 — WebGUI: Firewall Rules

### WAN Rules
| Action | Source | Destination | Port | Purpose |
|---|---|---|---|---|
| Block | any | any | any | Default deny (pfSense default) |

### LAN/DMZ Rules (em1)
| Action | Source | Destination | Port | Purpose |
|---|---|---|---|---|
| Allow | DMZ net | any | 80,443 | HTTP/HTTPS outbound |
| Block | DMZ net | OPT1 net | any | DMZ→Internal isolated |

### OPT1/Internal Rules (em2)
| Action | Source | Destination | Port | Purpose |
|---|---|---|---|---|
| Allow | OPT1 net | LAN net | 80,443 | Internal→DMZ web |
| Allow | OPT1 net | any | 80,443 | Internet access |

### OPT2/MGMT Rules (em3)
| Action | Source | Destination | Port | Purpose |
|---|---|---|---|---|
| Allow | OPT2 net | any | any | MGMT full access |

---

## Step 7 — Suricata IPS Install

```
System → Package Manager → Available Packages → search "suricata" → Install

Services → Suricata → Interfaces → Add → WAN (em0)
  - Enable IPS mode: ✅
  - Block Offenders: ✅
  - ET Open rules: ✅
Services → Suricata → Start
```

---

## Step 8 — Syslog to aegis-forwarder

```
Status → System Logs → Settings
  Remote log server: 10.30.30.10
  Remote Syslog Port: 514
  Remote log contents: ✅ Firewall Events
```

---

## Troubleshooting

### OPT interface — ping 100% loss (gateway reach မရ)

**Cause:** OPT1/OPT2 interfaces မှာ firewall rule မရှိ → default block all
**Diagnose:**
```bash
# pfSense Shell (Option 8)
pfctl -d    # firewall ယာယီ disable
# VM ကနေ gateway ping ရရင် → rule ပြဿနာ confirmed
```

**Fix — easyrule (Shell):**
```bash
easyrule pass opt2 any 10.30.30.0/24 any
easyrule pass opt1 any 10.20.20.0/24 any
easyrule pass lan  any 10.10.10.0/24 any
pfctl -e    # ပြန် enable
```

> ⚠️ Wrong: `easyrule pass opt2 from 10.30.30.0/24 to any`  
> ✅ Correct: `easyrule pass opt2 any 10.30.30.0/24 any` (protocol = `any` ပါရမည်)

**Fix — WebGUI (Permanent):**
```
Firewall → Rules → OPT2 → Add
  Action: Pass | Interface: OPT2 | Source: OPT2 subnet | Destination: any
```

---

### vtnet0 does not exist
```
ifconfig: interface vtnet0 does not exist
```
**Cause:** GNS3 QEMU NIC type = e1000, not VirtIO  
**Fix:** `ifconfig -l` → interface name = `em0, em1...` — Option 1 မှာ reassign

### Default gateway မပါ
```
# routing table မှာ default route မပါရင်
route add default 10.0.23.1
# permanent fix: Option 2 → WAN → "default gateway? → y"
```

---

## Status: ✅ Interface Assignment Done | ✅ Routing Verified | ⏳ WebGUI Pending
