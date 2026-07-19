# AEGIS-SecureBank — Network Architecture Document

> **Last Updated:** 2026-07-19
> **Status:** ✅ Current (v3 Topology — ဆရာမ ညွှန်ကြားချက်အတိုင်း ပြောင်းလဲပြီး)

---

## 1. Topology History

| Version | Date | Changes |
|---|---|---|
| v1 | 2026-07-10 | R1 + R2 + Switch1 + bank-mail + teller-pc |
| v2 | 2026-07-16 | R2 ဖြုတ်ပြီ, bank-mail ဖြုတ်ပြီ, teller-pc ဖြုတ်ပြီ |
| v3 | 2026-07-19 | Switch1 ဖြုတ်ပြီ, Kali ↔ Router ether2 တိုက်ရိုက်ချိတ်, Kali subnet ပြောင်း |

---

## 2. Current Topology (v3 — 2026-07-19)

```
Internet (NAT cloud / virbr0)
        │
        │ direct cable
        │
   [Router — MikroTik CHR]
    ether1: 192.168.122.2/24  ← Internet (virbr0) side
    ether2: 192.168.10.1/24   ← Attacker (Kali) side
    ether3: 10.0.23.1/30      ← pfSense WAN link
        │
        │ direct cable
        │
   [pfSense 2.7.2]
    WAN  (e0): 10.0.23.2/30      GW=10.0.23.1
    BANK_WEB   (e1): 10.10.10.1/24  → [Public-Service Switch] → bank-web (10.10.10.10)
    CUSTOMER_DB (e2): 10.20.20.1/24 → [Internal-Service Switch] → customer-db (10.20.20.20)
    MGMT (e3): 10.30.30.1/24     → aegis-forwarder (10.30.30.10)

[Kali / Attacker]
    eth0 → Router ether2 (direct cable, no switch)
    IP: DHCP from Router (192.168.10.x)
    Internet: via Router ether1 → virbr0
    Lab reach: route 10.0.0.0/8 via 192.168.10.1
```

---

## 3. IP Address Plan (Current)

| Device | Interface | IP | Network | Role |
|---|---|---|---|---|
| Router | ether1 | 192.168.122.2/24 | 192.168.122.0/24 | Internet gateway (virbr0) |
| Router | ether2 | 192.168.10.1/24 | 192.168.10.0/24 | Kali DHCP gateway |
| Router | ether3 | 10.0.23.1/30 | 10.0.23.0/30 | pfSense WAN link |
| Kali | eth0 | DHCP (192.168.10.2–100) | 192.168.10.0/24 | Attacker — dynamic |
| pfSense | e0 WAN | 10.0.23.2/30 | 10.0.23.0/30 | WAN, GW=10.0.23.1 |
| pfSense | e1 BANK_WEB | 10.10.10.1/24 | 10.10.10.0/24 | DMZ gateway |
| pfSense | e2 CUSTOMER_DB | 10.20.20.1/24 | 10.20.20.0/24 | Internal gateway |
| pfSense | e3 MGMT | 10.30.30.1/24 | 10.30.30.0/24 | MGMT gateway |
| bank-web | eth0 | 10.10.10.10/24 | 10.10.10.0/24 | GW=10.10.10.1 |
| customer-db | eth0 | 10.20.20.20/24 | 10.20.20.0/24 | GW=10.20.20.1 |
| aegis-forwarder | eth0 | 10.30.30.10/24 | 10.30.30.0/24 | GW=10.30.30.1 |

---

## 4. Network Segments

| Segment | Subnet | Devices |
|---|---|---|
| Internet (virbr0) | 192.168.122.0/24 | Router ether1 (192.168.122.2) |
| Attacker network | 192.168.10.0/24 | Router ether2 (192.168.10.1), Kali DHCP |
| Router ↔ pfSense WAN | 10.0.23.0/30 | Router (.1), pfSense (.2) |
| DMZ (Public Services) | 10.10.10.0/24 | pfSense (.1), bank-web (.10) |
| Internal (Private) | 10.20.20.0/24 | pfSense (.1), customer-db (.20) |
| Management | 10.30.30.0/24 | pfSense (.1), aegis-forwarder (.10) |

---

## 5. Attack Flow (Real-world simulation)

```
Kali (192.168.10.x)        ← "internet attacker"
    │ via Router ether2
    ▼
Router (192.168.10.1 → 10.0.23.1)
    │ forwards without masquerade → Kali real IP preserved
    ▼
pfSense WAN (10.0.23.2)    ← firewall boundary
    │ WAN rule: allow 192.168.10.0/24
    ▼
bank-web (10.10.10.10) / customer-db (10.20.20.20)
    │ source IP = Kali real IP → Suricata/Fail2ban detect
    ▼
AEGIS auto-defense → block Kali IP ✅
```

---

## 6. Routing Tables

### Router (MikroTik CHR)
| Destination | Gateway | Interface |
|---|---|---|
| 0.0.0.0/0 | 192.168.122.1 | ether1 (internet) |
| 10.0.0.0/8 | 10.0.23.2 | ether3 (pfSense) |
| 192.168.122.0/24 | — | ether1 (connected) |
| 192.168.10.0/24 | — | ether2 (connected) |
| 10.0.23.0/30 | — | ether3 (connected) |

### pfSense
| Destination | Gateway |
|---|---|
| 0.0.0.0/0 | 10.0.23.1 (WANGW) |
| 192.168.10.0/24 | 10.0.23.1 (static route — return path to Kali) |
| 10.10.10.0/24 | BANK_WEB interface |
| 10.20.20.0/24 | CUSTOMER_DB interface |
| 10.30.30.0/24 | MGMT interface |

### Kali
| Destination | Gateway |
|---|---|
| 0.0.0.0/0 | 192.168.10.1 (Router ether2) |
| 10.0.0.0/8 | 192.168.10.1 (Router ether2) |

---

## 7. Removed Nodes (History)

| Node | Was | Removed | Reason |
|---|---|---|---|
| Switch1 | Between NAT + Router + Kali | 2026-07-19 | ဆရာမ topology ပြောင်း |
| Router-2 (R2) | MikroTik CHR | 2026-07-16 | R1 ↔ pfSense direct |
| bank-mail | 10.10.10.20 DMZ | 2026-07-16 | internet မရ |
| teller-pc | 10.20.20.10 Internal | 2026-07-16 | internet မရ |
| Cowrie honeypot | bank-web + customer-db | 2026-07-19 | ဖြုတ်ပြီ |

---

## 8. Services Per VM

| VM | IP | Services | Purpose |
|---|---|---|---|
| bank-web | 10.10.10.10 | Apache2, vsftpd, SSH, Suricata, Fail2ban | Attack target (web/FTP) |
| customer-db | 10.20.20.20 | PostgreSQL, SSH, Suricata, Fail2ban | Attack target (database) |
| aegis-forwarder | 10.30.30.10 | aegis_forwarder.py | Log collector → Render API |

---

## 9. External Services (Production)

| Service | URL | Purpose |
|---|---|---|
| API Server | https://aegis-api-server-jp3b.onrender.com | Express 5 backend |
| Frontend | https://aegis-soc-dashboard-aegis-dashboard.vercel.app | React dashboard |
| Database | Supabase PostgreSQL (pooler port 6543) | Event storage |

> ⚠️ Replit = code editing only. Replit URLs ကို source code ထဲ မသုံးရ။

---

## 10. Known Gotchas

| Issue | Cause | Fix |
|---|---|---|
| Kali DHCP မရ | Router ether2 DHCP server config | `/ip dhcp-server set 0 address-pool=kali-pool` |
| bank-web reach မရ | pfSense static route မရှိ | System→Routing→Static: 192.168.10.0/24 via 10.0.23.1 |
| Kali route reboot ပျောက် | /etc/network/interfaces post-up ထည့်ထားပြီ | auto ပြန်ထည့်မယ် |
| Render API cold start ~50s | Free tier spin-down | 15min idle ကျရင် normal |
