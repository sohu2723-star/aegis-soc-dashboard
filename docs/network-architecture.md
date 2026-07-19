# AEGIS-SecureBank — Network Architecture Document

> **Last Updated:** 2026-07-16  
> **Status:** ✅ Current (Simplified Topology — R2, bank-mail, teller-pc ဖြုတ်ပြီ)

---

## 1. Topology Evolution

### ► v1 — Original Topology (until 2026-07-16)

```
[Kali Linux]
192.168.122.153/24
      │
 [Switch1]────────[Internet Cloud (virbr0)]
      │
 [Router-1 / R1 — MikroTik CHR]
   ether1: 192.168.122.2/24   ← Kali side
   ether2: DHCP (NAT nat0)    ← Internet out
   ether3: 10.0.12.1/30       ← Link to R2
      │
 [Router-2 / R2 — MikroTik CHR]
   ether1: 10.0.12.2/30       ← Link from R1
   ether2: 10.0.23.1/30       ← Link to pfSense WAN
      │
 [pfSense 2.7.2]
   em0 WAN:  10.0.23.2/30     ← from R2
   em1 LAN:  10.10.10.1/24    → DMZ-Switch
   em2 OPT1: 10.20.20.1/24   → INT-Switch
   em3 OPT2: 10.30.30.1/24   → Mgmt
      │
 ┌────┴───────────────────────────────────┐
[DMZ-Switch]                       [INT-Switch]      [Mgmt]
  │           │                     │         │        │
[bank-web] [bank-mail]        [teller-pc] [customer-db] [aegis-forwarder]
10.10.10.10 10.10.10.20       10.20.20.10  10.20.20.20   10.30.30.10
```

**Nodes:** R1, R2, pfSense, Switch1, DMZ-Switch, INT-Switch  
**VMs:** Kali, bank-web, bank-mail, teller-pc, customer-db, aegis-forwarder  

---

### ► v2 — Current Topology (2026-07-16 onwards)

> R2 ဖြုတ်ပြီ → R1 ကနေ pfSense ကို တိုက်ရိုက်ချိတ်  
> bank-mail ဖြုတ်ပြီ (internet မရ၍)  
> teller-pc ဖြုတ်ပြီ (internet မရ၍)

```
[Kali Linux]
192.168.122.153/24
      │
 [Switch1]────────[Internet Cloud (virbr0)]
      │
 [Router-1 / R1 — MikroTik CHR]
   ether1: 192.168.122.2/24   ← Kali / Switch1 side
   ether2: DHCP (NAT nat0)    ← Internet out (masquerade)
   ether3: 10.0.23.1/30       ← pfSense WAN (direct, ပြောင်းလဲ)
      │
      │  (R2 ဖြုတ်ပြီ — ဤနေရာတွင် R1 ↔ pfSense တိုက်ရိုက်)
      │
 [pfSense 2.7.2]
   em0 WAN:  10.0.23.2/30     ← from R1 ether3
   em1 LAN:  10.10.10.1/24    → DMZ-Switch
   em2 OPT1: 10.20.20.1/24   → INT-Switch
   em3 OPT2: 10.30.30.1/24   → Mgmt
      │
 ┌────┴───────────────────────────┐             │
[DMZ-Switch]                 [INT-Switch]      [Mgmt]
      │                       │         │        │
 [bank-web]              [customer-db] [aegis-forwarder]
 10.10.10.10              10.20.20.20   10.30.30.10
```

**Nodes:** R1, pfSense, Switch1, DMZ-Switch, INT-Switch  
**VMs:** Kali, bank-web, customer-db, aegis-forwarder  

---

## 2. IP Address Plan (Current)

| Device | Interface | IP Address | Network | Role |
|---|---|---|---|---|
| Kali Linux | eth0 | 192.168.122.153/24 | 192.168.122.0/24 | Attacker |
| R1 | ether1 | 192.168.122.2/24 | 192.168.122.0/24 | Kali-side gateway |
| R1 | ether2 | DHCP (~192.168.122.x) | 192.168.122.0/24 | NAT internet out |
| R1 | ether3 | 10.0.23.1/30 | 10.0.23.0/30 | pfSense WAN link |
| pfSense | em0 (WAN) | 10.0.23.2/30 | 10.0.23.0/30 | WAN, GW=10.0.23.1 |
| pfSense | em1 (LAN) | 10.10.10.1/24 | 10.10.10.0/24 | DMZ gateway |
| pfSense | em2 (OPT1) | 10.20.20.1/24 | 10.20.20.0/24 | Internal gateway |
| pfSense | em3 (OPT2) | 10.30.30.1/24 | 10.30.30.0/24 | Mgmt gateway |
| bank-web | eth0 | 10.10.10.10/24 | 10.10.10.0/24 | GW=10.10.10.1 |
| customer-db | eth0 | 10.20.20.20/24 | 10.20.20.0/24 | GW=10.20.20.1 |
| aegis-forwarder | eth0 | 10.30.30.10/24 | 10.30.30.0/24 | GW=10.30.30.1 |

---

## 3. Network Segments

| Segment | Subnet | CIDR | Devices |
|---|---|---|---|
| Attacker / Internet | 192.168.122.0/24 | /24 | Kali, R1-ether1, R1-ether2 (NAT) |
| R1 ↔ pfSense WAN | 10.0.23.0/30 | /30 | R1-ether3 (.1), pfSense-WAN (.2) |
| DMZ (Public Services) | 10.10.10.0/24 | /24 | pfSense (.1), bank-web (.10) |
| Internal (Private) | 10.20.20.0/24 | /24 | pfSense (.1), customer-db (.20) |
| Management | 10.30.30.0/24 | /24 | pfSense (.1), aegis-forwarder (.10) |

---

## 4. Routing Tables

### R1 — MikroTik Routing Table

| Destination | Gateway | Interface | Type |
|---|---|---|---|
| 0.0.0.0/0 | 192.168.122.1 | ether2 | Dynamic (DHCP) |
| 192.168.122.0/24 | — | ether1 | Connected |
| 10.0.23.0/30 | — | ether3 | Connected |
| 10.0.0.0/8 | 10.0.23.2 | ether3 | Static |

**NAT rule:** `srcnat` masquerade on `ether2` (internet outbound)

```routeros
# R1 Full Config
/ip address add address=192.168.122.2/24 interface=ether1
/ip address add address=10.0.23.1/30 interface=ether3
/ip dhcp-client add interface=ether2 disabled=no
/ip firewall nat add chain=srcnat out-interface=ether2 action=masquerade
/ip route add dst-address=10.0.0.0/8 gateway=10.0.23.2
```

### pfSense — Routing Table

| Destination | Gateway | Interface |
|---|---|---|
| 0.0.0.0/0 | 10.0.23.1 | WAN (em0) |
| 10.0.23.0/30 | — | WAN (em0) connected |
| 10.10.10.0/24 | — | LAN (em1) connected |
| 10.20.20.0/24 | — | OPT1 (em2) connected |
| 10.30.30.0/24 | — | OPT2 (em3) connected |

### Kali — Route Table

| Destination | Gateway | Note |
|---|---|---|
| 0.0.0.0/0 | 192.168.122.1 | Default (virbr0 internet) |
| 192.168.122.0/24 | — | Connected |
| 10.0.0.0/8 | 192.168.122.2 | **Manual add (ပျောက်နိုင်)** |

> ⚠️ Kali route ကို reboot တိုင်း ထည့်ရမည်:
> ```bash
> sudo ip route add 10.0.0.0/8 via 192.168.122.2
> ```

### bank-web / customer-db / aegis-forwarder

| Destination | Gateway |
|---|---|
| 0.0.0.0/0 | pfSense (respective interface .1) |

---

## 5. GNS3 Interface Mapping

### MikroTik CHR (R1)

| GNS3 Port | RouterOS Interface | Connected To |
|---|---|---|
| e0 | ether1 | Switch1 (e1) |
| e1 | ether2 | NAT cloud (nat0) |
| e2 | ether3 | pfSense (e0 / em0) |

### pfSense 2.7.2

| GNS3 Port | FreeBSD Interface | pfSense Role | Connected To |
|---|---|---|---|
| e0 | em0 | WAN | R1 (e2 / ether3) |
| e1 | em1 | LAN | DMZ-Switch (e0) |
| e2 | em2 | OPT1 | INT-Switch (e0) |
| e3 | em3 | OPT2 | aegis-forwarder (e0) |

---

## 6. Traffic Flow (Attack Path)

```
Kali → bank-web (HTTP/SSH attack)
─────────────────────────────────────────────────────────
Kali (192.168.122.153)
  → R1 ether1 (192.168.122.2)          [L3 routing]
  → R1 ether3 (10.0.23.1)             [route: 10.0.0.0/8 via 10.0.23.2]
  → pfSense WAN (10.0.23.2)           [firewall: WAN rule pass 192.168.122.0/24]
  → pfSense LAN (10.10.10.1)          [route: 10.10.10.0/24 connected]
  → bank-web (10.10.10.10)            ✅
```

```
pfSense / internal → Internet
─────────────────────────────────────────────────────────
pfSense (any interface)
  → pfSense WAN default GW 10.0.23.1
  → R1 ether3 (10.0.23.1)
  → R1 ether2 (DHCP)                  [masquerade NAT]
  → nat0 → host → internet            ✅
```

```
Kali → Internet
─────────────────────────────────────────────────────────
Kali → Switch1 → virbr0 (Cloud1) → host libvirt → internet  ✅
```

---

## 7. Services Per VM

| VM | IP | Services | Purpose |
|---|---|---|---|
| bank-web | 10.10.10.10 | Apache/Nginx, DVWA, SSH, Suricata, Fail2ban | Attack target (web) |
| customer-db | 10.20.20.20 | PostgreSQL, SSH | Attack target (database) |
| aegis-forwarder | 10.30.30.10 | aegis_forwarder.py, Suricata | Sensor → Render API |

---

## 8. External Services (Production)

| Service | URL | Purpose |
|---|---|---|
| API Server | https://aegis-api-server-jp3b.onrender.com | Express 5 backend |
| Frontend | https://aegis-soc-dashboard.vercel.app | React dashboard |
| Database | Supabase PostgreSQL (pooler port 6543) | Event storage |

> ⚠️ Replit = code editing only. Replit URLs ကို source code ထဲ မသုံးရ။

---

## 9. Known Issues / Gotchas

| Issue | Cause | Fix |
|---|---|---|
| R1 ping to pfSense WAN timeout | pfSense blocks inbound WAN ICMP (default) | Test from pfSense side (Option 7) |
| Kali route lost after reboot | `ip route add` is not persistent | Re-run: `sudo ip route add 10.0.0.0/8 via 192.168.122.2` |
| pfSense cold start slow | GNS3 VM boot time | Wait ~60s after topology start |
| Render API cold start ~50s | Render free tier spin-down | First request after 15min idle = slow |
