---
name: Bank services roadmap
description: Planned bank VM services for AEGIS final internship project — what to add, how, and which attacks they enable
---

# Bank SOC Services Roadmap

## Context
Final internship project — graded on realism and completeness.
Each new service = new GNS3 VM + new VLAN + new attack surface + new dashboard monitoring.

---

## Current Services (done ✅)

| Service | VM | IP | Status |
|---|---|---|---|
| Web Server (Apache2) | bank-web | 10.10.10.10 | ✅ Running |
| FTP Server (vsftpd) | bank-web | 10.10.10.10 | ✅ Running |
| Database (PostgreSQL) | customer-db | 10.20.20.20 | ✅ Running |
| IDS (Suricata) | bank-web + customer-db | both | ✅ Running |
| Fail2ban | bank-web + customer-db | both | ✅ Running |

---

## Planned Services — Priority Order

### 🔴 Level 1 — ထည့်ရလွယ်ပြီး Demo impact ကြီး

#### 1. Email Server (Postfix + Dovecot)
- **VM:** Ubuntu (new node in GNS3)
- **VLAN:** 30, IP: `10.30.30.20` (Management segment မှာ သို့မဟုတ် VLAN 30)
- **Attacks:** Phishing relay, SMTP brute force, spam flood
- **Log:** `/var/log/mail.log` → forwarder watch_mail() function
- **Dashboard:** Mail alert card, SMTP auth fail incidents
- **Install:**
  ```bash
  apt install postfix dovecot-core dovecot-imapd -y
  ```

#### 2. DNS Server (BIND9)
- **VM:** Ubuntu (bank-web မှာ ပေါင်းထည့်လည်း ရ)
- **VLAN:** 10 (DMZ — public-facing)
- **Attacks:** DNS amplification, zone transfer, DNS tunneling
- **Log:** `/var/log/named/queries.log` → watch_dns() function
- **Dashboard:** DNS query flood alert, suspicious domain detection
- **Install:**
  ```bash
  apt install bind9 bind9utils -y
  ```

---

### 🟡 Level 2 — Visual Impact ကြီး (Demo impressive)

#### 3. CCTV / IP Camera Server (RTSP)
- **VM:** Ubuntu + vlc/ffmpeg streaming
- **VLAN:** 40, IP: `10.40.40.10`
- **Attacks:** RTSP brute force, unauthorized stream access, DoS on camera
- **Log:** Custom access log → watch_cctv() function
- **Dashboard:** Camera status card, unauthorized access alert
- **Simulate:**
  ```bash
  ffmpeg -re -i /dev/video0 -f rtsp rtsp://0.0.0.0:8554/cctv
  # or with test video:
  ffmpeg -re -i test.mp4 -f rtsp rtsp://0.0.0.0:8554/cctv
  ```

#### 4. VoIP Server (Asterisk SIP)
- **VM:** Ubuntu + Asterisk
- **VLAN:** 50, IP: `10.50.50.10`
- **Attacks:** SIP flood, registration hijack, toll fraud, eavesdropping
- **Log:** `/var/log/asterisk/messages` → watch_voip() function
- **Dashboard:** SIP anomaly alert, call volume spike
- **Install:**
  ```bash
  apt install asterisk -y
  ```

---

### 🟠 Level 3 — Advanced (internship extension or future)

#### 5. ATM Network Simulator
- **VM:** Ubuntu + Python Flask (custom ATM API)
- **VLAN:** 60, IP: `10.60.60.10`
- **Attacks:** Transaction replay, MITM, skimming simulation
- **Dashboard:** Transaction anomaly, abnormal withdrawal pattern

#### 6. Active Directory (Samba4)
- **VM:** Ubuntu + Samba4
- **VLAN:** 20 (Internal, alongside customer-db)
- **Attacks:** Pass-the-hash, Kerberos brute force, LDAP enumeration
- **Log:** `/var/log/samba/` → watch_ad() function
- **Dashboard:** Auth failure flood, privilege escalation alert

---

## Adding Any New Service — Checklist

```
□ GNS3: new Ubuntu VM node ထည့်
□ GNS3: pfSense မှာ new VLAN interface ဖောက်
□ GNS3: OVS switch (or new switch) port assign
□ VM: service install + config
□ VM: log path မှတ်ထား
□ Forwarder: watch_<service>() function ထည့် → aegis_forwarder.py
□ Forwarder: REMOTE_HOSTS list မှာ new VM + sensors ထည့်
□ API: ingest route ရှိပြီးဆိုရင် သုံး၊ မရှိရင် ထည့်
□ Dashboard: service status card ထည့်
□ Dashboard: alert type ထည့် (if new attack type)
□ Auto-defense: new rule seed ထည့် (if new attack type)
```

---

## Network Plan (Full Bank Topology)

```
pfSense
├── em1.10  VLAN 10  → OVS-Public    → bank-web (10.10.10.10)     ✅
│                                     → DNS server (10.10.10.20)   📋 planned
├── em2.20  VLAN 20  → OVS-Internal  → customer-db (10.20.20.20)  ✅
│                                     → AD/Samba (10.20.20.30)     📋 planned
├── em3     MGMT     10.30.30.0/24   → aegis (10.30.30.10)        ✅
│                                     → mail (10.30.30.20)         📋 planned
├── em4     VLAN 40  → CCTV switch   → cctv-server (10.40.40.10)  📋 planned
└── em5     VLAN 50  → VoIP switch   → voip-server (10.50.50.10)  📋 planned
```
