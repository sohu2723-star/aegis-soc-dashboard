# AEGIS-SecureCompany — Network Architecture Document

> **Last Updated:** 2026-07-20
> **Status:** ✅ Current (v4 Final — OVS switches, DNS-Server, LDAP-Server, company-customer-db=10.20.20.10)

---

## 1. Topology History

| Version | Date | Changes |
|---|---|---|
| v1 | 2026-07-10 | R1 + R2 + Switch1 + bank-mail + teller-pc |
| v2 | 2026-07-16 | R2 ဖြုတ်ပြီ, bank-mail ဖြုတ်ပြီ, teller-pc ဖြုတ်ပြီ |
| v3 | 2026-07-19 | Switch1 ဖြုတ်ပြီ, Kali ↔ Router ether2 တိုက်ရိုက်ချိတ်, Kali subnet ပြောင်း |
| v4 | 2026-07-20 | OVS switches x2 ထည့်, DNS-Server + LDAP-Server ထည့်, company-customer-db IP ပြောင်း (→10.20.20.10) |

---

## 2. Current Topology (v4 Final — 2026-07-20)

```
Internet (NAT cloud / virbr0)
        │
        │ direct cable
        │
   [Router — MikroTik CHR]
    ether1: 192.168.122.2/24  ← Internet (virbr0) side
    ether2: 192.168.10.1/24   ← Attacker (Kali) side — DHCP server
    ether3: 10.0.23.1/30      ← pfSense WAN link
        │
        │ direct cable
        │
   [pfSense 2.7.2]
    WAN  (e0): 10.0.23.2/30
    DMZ  (e1): 10.10.10.1/24  → [Public-Services OVS Switch]
                                    eth1 → company-web-server   (10.10.10.10)
                                    eth2 → DNS-Server (10.10.10.20)
    INT  (e2): 10.20.20.1/24  → [Internal-Services OVS Switch]
                                    eth1 → company-customer-db (10.20.20.10)
                                    eth2 → LDAP-Server (10.20.20.20)
    MGMT (e3): 10.30.30.1/24  → aegis-company-admin (10.30.30.10)

[Kali / Attacker]
    eth0 → Router ether2 (direct cable, no switch)
    IP: DHCP from Router (192.168.10.x)
    Internet: via Router ether1 → virbr0
    Lab reach: route 10.0.0.0/8 via 192.168.10.1
```

---

## 3. IP Address Plan (v4 Current)

| Device | Interface | IP | Network | Role |
|---|---|---|---|---|
| Router | ether1 | 192.168.122.2/24 | 192.168.122.0/24 | Internet gateway (virbr0) |
| Router | ether2 | 192.168.10.1/24 | 192.168.10.0/24 | Kali DHCP gateway |
| Router | ether3 | 10.0.23.1/30 | 10.0.23.0/30 | pfSense WAN link |
| Kali | eth0 | DHCP (192.168.10.2–100) | 192.168.10.0/24 | Attacker — dynamic |
| pfSense | e0 WAN | 10.0.23.2/30 | 10.0.23.0/30 | WAN, GW=10.0.23.1 |
| pfSense | e1 DMZ | 10.10.10.1/24 | 10.10.10.0/24 | DMZ gateway |
| pfSense | e2 INT | 10.20.20.1/24 | 10.20.20.0/24 | Internal gateway |
| pfSense | e3 MGMT | 10.30.30.1/24 | 10.30.30.0/24 | MGMT gateway |
| company-web-server | eth0 | **10.10.10.10**/24 | 10.10.10.0/24 | GW=10.10.10.1 |
| DNS-Server | eth0 | **10.10.10.20**/24 | 10.10.10.0/24 | GW=10.10.10.1 |
| company-customer-db | eth0 | **10.20.20.10**/24 | 10.20.20.0/24 | GW=10.20.20.1 |
| LDAP-Server | eth0 | **10.20.20.20**/24 | 10.20.20.0/24 | GW=10.20.20.1 |
| aegis-company-admin | eth0 | **10.30.30.10**/24 | 10.30.30.0/24 | GW=10.30.30.1 |

---

## 4. Network Segments

| Segment | Subnet | Devices |
|---|---|---|
| Internet (virbr0) | 192.168.122.0/24 | Router ether1 (192.168.122.2) |
| Attacker network | 192.168.10.0/24 | Router ether2 (192.168.10.1), Kali DHCP |
| Router ↔ pfSense WAN | 10.0.23.0/30 | Router (.1), pfSense (.2) |
| DMZ (Public Services) | 10.10.10.0/24 | pfSense (.1), company-web-server (.10), DNS-Server (.20) |
| Internal (Private) | 10.20.20.0/24 | pfSense (.1), company-customer-db (.10), LDAP-Server (.20) |
| Management | 10.30.30.0/24 | pfSense (.1), aegis-company-admin (.10) |

---

## 5. Attack Flow (Real-world simulation)

```
Kali (192.168.10.x)              ← "internet attacker"
    │ via Router ether2
    ▼
Router (192.168.10.1 → 10.0.23.1)
    │ forwards without masquerade → Kali real IP preserved
    ▼
pfSense WAN (10.0.23.2)          ← firewall boundary
    │ WAN rule: allow 192.168.10.0/24
    ▼
company-web-server (10.10.10.10) / company-customer-db (10.20.20.10)
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
| 10.10.10.0/24 | DMZ interface |
| 10.20.20.0/24 | INT interface |
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
| Router-2 (R2) | MikroTik CHR | 2026-07-16 | R1 ↔ pfSense direct |
| bank-mail | 10.10.10.20 DMZ | 2026-07-16 | internet မရ — DNS-Server အဖြစ် replace |
| teller-pc | 10.20.20.10 Internal | 2026-07-16 | internet မရ — company-customer-db .10 IP ယူ |
| Switch1 | Between NAT + Router + Kali | 2026-07-19 | ဆရာမ topology ပြောင်း |

---

## 8. Services Per VM

| VM | IP | Services | Purpose |
|---|---|---|---|
| company-web-server | 10.10.10.10 | Apache2, vsftpd, ModSecurity, Suricata, Fail2ban | Attack target (web/FTP) |
| DNS-Server | 10.10.10.20 | BIND9, Fail2ban | Lab DNS + attack target |
| company-customer-db | 10.20.20.10 | MySQL, Suricata, Fail2ban | Attack target (database) |
| LDAP-Server | 10.20.20.20 | OpenLDAP (slapd), Fail2ban | Directory service + attack target |
| aegis-company-admin | 10.30.30.10 | aegis_forwarder.py (hub) | Log collector → Render API |

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
| company-web-server reach မရ | pfSense static route မရှိ | System→Routing→Static: 192.168.10.0/24 via 10.0.23.1 |
| Kali route reboot ပျောက် | /etc/network/interfaces post-up ထည့်ထားပြီ | auto ပြန်ထည့်မယ် |
| Render API cold start ~50s | Free tier spin-down | 15min idle ကျရင် normal |
