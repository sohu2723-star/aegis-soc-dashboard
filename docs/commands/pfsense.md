# pfSense — Firewall / IPS / WAF
> **GNS3 node:** pfSense | **Console:** VNC (double-click in GNS3)
> **Last updated:** 2026-07-04

---

## Interface Map

| GNS3 | pfSense | Connected to | IP |
|---|---|---|---|
| e0 | em0 / WAN | Router-2 ether2 | 10.0.23.2/30, GW=10.0.23.1 |
| e1 | em1 / OPT1 (DMZ) | DMZ-Switch | 10.10.10.1/24 |
| e2 | em2 / LAN (INT) | INT-Switch | 10.20.20.1/24 |
| e3 | em3 / OPT2 (MGMT) | aegis-forwarder | 10.30.30.1/24 |

---

## Step 1 — Console Menu: Interface Assignment

pfSense boot ပြီးရင် menu ပေါ်မည်:

```
1) Assign Interfaces
2) Set interface(s) IP address
...
```

**Option 1** ရွေး → interfaces assign:
```
WAN  → em0
LAN  → em2
OPT1 → em1   (DMZ)
OPT2 → em3   (MGMT)
```

---

## Step 2 — Console Menu: Set IPs (Option 2)

### WAN (em0)

```
Select interface: 1 (WAN)
Configure IPv4 via DHCP? → n
IPv4 address: 10.0.23.2
Subnet bit count: 30
Upstream gateway: 10.0.23.1
Configure IPv6? → n
Revert to HTTP? → n
```

### OPT1 / DMZ (em1)

```
Select interface: 3 (OPT1)
Configure IPv4 via DHCP? → n
IPv4 address: 10.10.10.1
Subnet bit count: 24
Gateway: (blank — LAN side)
```

### LAN / Internal (em2)

```
Select interface: 2 (LAN)
Configure IPv4 via DHCP? → n
IPv4 address: 10.20.20.1
Subnet bit count: 24
Gateway: (blank)
```

### OPT2 / MGMT (em3)

```
Select interface: 4 (OPT2)
Configure IPv4 via DHCP? → n
IPv4 address: 10.30.30.1
Subnet bit count: 24
Gateway: (blank)
```

---

## Step 3 — WebGUI Access

pfSense WebGUI ကို LAN (Internal) subnet မှ access လုပ်ရမည်:

```
URL: https://10.20.20.1
User: admin
Pass: pfsense (default)
```

teller-pc (10.20.20.10) မှ browser ဖြင့် ဝင်ပါ

---

## Step 4 — WebGUI: Firewall Rules

### DMZ Rules (em1)
| Action | Source | Destination | Port | Purpose |
|---|---|---|---|---|
| Allow | DMZ net | any | 80,443 | HTTP/HTTPS out |
| Block | DMZ net | INT net | any | DMZ→Internal block |

### Internal Rules (em2)
| Action | Source | Destination | Port | Purpose |
|---|---|---|---|---|
| Allow | INT net | DMZ net | 80,443 | Internal→DMZ web |
| Allow | INT net | any | 80,443 | Internet access |
| Block | any | INT net | any | Block unsolicited inbound |

---

## Step 5 — Suricata IPS Install

```
System → Package Manager → Available Packages → search "suricata" → Install
Services → Suricata → Interfaces → Add → WAN (em0)
  - Enable IPS mode: ✅
  - Block Offenders: ✅
  - ET Open rules: ✅
Services → Suricata → Start
```

---

## Step 6 — Syslog to aegis-forwarder

```
Status → System Logs → Settings
  Remote log server: 10.30.30.10
  Remote Syslog Port: 514
  Remote log contents: ✅ Firewall Events
```

---

## Verify Commands (pfSense console — Option 8: Shell)

```bash
ping -c 4 10.0.23.1       # Router-2 link
ping -c 4 8.8.8.8         # Internet
ping -c 4 10.10.10.10     # bank-web (VM ကို IP ထည့်ပြီးမှ)
pfctl -s info             # Firewall stats
```

---

## Status: ⏳ Not Started
