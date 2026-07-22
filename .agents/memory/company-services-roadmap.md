---
name: Company services roadmap
description: Planned company VM services for AEGIS final internship project — goldenmyanmar.trading.com future infrastructure, attack scenarios, and migration from bank theme.
---

# Company SOC Services Roadmap

## Context
Final internship project — graded on realism and completeness.
Company name: **Golden Myanmar Trading Co., Ltd.**
Internal domain: `goldenmyanmar.trading.com` (lab-internal, resolved by company-dns-server 10.10.10.20 only)
Goal: simulate a real company network so HTTP, DNS, DB, LDAP, DDoS attack demos are meaningful and visible on AEGIS dashboard.

**Why**: `10.10.10.10` ကို browser ထဲ ထည့်ရင် → company website ကျ, web → DB → LDAP chain တကယ်အလုပ်လုပ် → attack → detect → defend cycle real world နဲ့ ကိုက်ညီ.

---

## Current Services (done ✅)

| Service | VM | IP | Status |
|---|---|---|---|
| Web Server (Apache2 + PHP) | company-web-server | 10.10.10.10 | ✅ Running |
| DNS Server (BIND9) | company-dns-server | 10.10.10.20 | ✅ Running |
| Database (MySQL) | company-customer-db | 10.20.20.10 | ✅ Running |
| LDAP (OpenLDAP) | company-ldap-server | 10.20.20.20 | ✅ Running |
| Fail2ban | all 4 VMs | — | ✅ Running |

---

## Future Phase: goldenmyanmar.trading.com

### Migration from bank → company (Future, not current)

| Item | Old (bank) | New (goldenmyanmar) |
|---|---|---|
| Domain | `bank.local` | `goldenmyanmar.trading.com` |
| DB name | `companydb` | `goldenmyanmardb` |
| DB user | `companyuser` | `gmuser` |
| Web content | Bank login/dashboard | Golden Myanmar Trading site |
| LDAP base DN | `dc=bank,dc=local` | `dc=goldenmyanmar,dc=com` |

### DNS Zone Records Plan

```
zone "goldenmyanmar.trading.com"
  @     → 10.10.10.20  (zone apex = DNS server itself)
  web   → 10.10.10.10  (company-web-server)
  db    → 10.20.20.10  (company-customer-db)
  ldap  → 10.20.20.20  (company-ldap-server)
  aegis → 10.30.30.10
```

### New DB Schema (goldenmyanmardb)

```sql
-- Rename: companydb → goldenmyanmardb
-- Rename: companyuser → gmuser
-- Tables: customers, accounts, transactions, products
```

### New Web App

- Company: Golden Myanmar Trading Co., Ltd.
- Pages: company home, staff login (LDAP auth), product catalog, trading dashboard
- PHP DB: connect via `db.goldenmyanmar.trading.com` (DNS name, not IP)
- PHP LDAP: authenticate via `ldap.goldenmyanmar.trading.com`

---

## Attack Scenarios (goldenmyanmar.trading.com)

| Attack | Tool | Target | AEGIS alert |
|---|---|---|---|
| HTTP SQLi | sqlmap | login form | `web_attack (sqli)` |
| HTTP brute | hydra/burp | staff login | `web_brute` |
| DDoS → site down | hping3 | port 80 | `ddos` → null-route |
| DNS flood | hping3 --udp | port 53 | `ddos` |
| DNS zone transfer | dig AXFR | BIND9 | `dns_zone_transfer` |
| MySQL brute | hydra | port 3306 | fail2ban → auto-block |
| SQLi → DB dump | sqlmap | web form | customers/accounts dump |
| LDAP brute | hydra | port 389 | fail2ban → auto-block |
| LDAP anon dump | ldapsearch -x | all users | alert |

### Website Down Full Chain Attack

```
DNS flood → DNS down → hostname resolve fail
+ DDoS web → Apache 503
+ DB brute → MySQL conn maxed → PHP fail
Result: goldenmyanmar.trading.com completely unreachable
AEGIS: burst of alerts + Telegram + auto-defense
```

---

## Priority 2 — Extended Services (after core done)

| Service | VM | Purpose | Attack |
|---|---|---|---|
| Email (Postfix) | company-web-server | company email | phishing, SMTP brute |
| CCTV sim (ffmpeg RTSP) | new VM 10.40.40.10 | IoT device | RTSP brute, DoS on cam |
| VoIP (Asterisk) | new VM 10.50.50.10 | company phone | SIP flood, toll fraud |

## Priority 3 — Advanced

| Service | Notes |
|---|---|
| ATM sim (Flask API) | Transaction replay, MITM |
| Active Directory (Samba4) | Pass-the-hash, Kerberos brute |

---

## Adding Any New Service — Checklist

```
□ GNS3: new Ubuntu VM node ထည့်
□ GNS3: pfSense မှာ new VLAN interface ဖောက်
□ GNS3: OVS switch port assign
□ VM: service install + config
□ VM: log path မှတ်ထား
□ Forwarder: watch_<service>() function ထည့်
□ Forwarder: REMOTE_HOSTS list update
□ API: ingest route (ရှိပြီးဆိုရင် သုံး)
□ Dashboard: service status card
□ Auto-defense: new rule seed
```

---

## Network Plan

```
pfSense
├── em1.10  VLAN 10  DMZ      → company-web-server (10.10.10.10) ✅
│                              → company-dns-server (10.10.10.20) ✅
├── em2.20  VLAN 20  Internal → company-customer-db (10.20.20.10) ✅
│                              → company-ldap-server (10.20.20.20) ✅
├── em3     MGMT              → aegis-company-admin (10.30.30.10) ✅
├── em4     VLAN 40  IoT      → cctv-server (10.40.40.10)         📋 planned
└── em5     VLAN 50  VoIP     → voip-server (10.50.50.10)         📋 planned
```
