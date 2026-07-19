---
name: Project intent and constraints
description: Core purpose, VM topology, attack/defense scope, and what Replit is used for
---

# AEGIS Project Intent & Constraints

## ⭐ Project Context
**Final Internship Project** — Real production-quality SOC (Security Operations Center) lab.
This is NOT a demo or simulation. Every component must work with real traffic on real VMs.
Graded/evaluated — completeness, realism, and dashboard control quality all matter.

---

## Rule
Replit is a **code editor only**. Never run, deploy, or test against the live app from Replit. The actual system runs on real physical/virtual machines.

**Why:** The user explicitly stated this. Replit = code editing only.

**How to apply:** Do not use `restart_workflow`, `screenshot`, or deployment tools to test features. Describe what to run on the VM instead.

---

## Web dashboard role
The dashboard is **monitoring + control**. It receives real events forwarded from Ubuntu VMs and displays them. It also controls defense (block/unblock IPs via pfSense SSH + VM iptables).
The "Simulate Attack" button must be disabled — only real data from real VMs.

---

## Real lab topology (GNS3)

| Machine | IP | Role | Tools |
|---|---|---|---|
| Kali Linux | 192.168.10.x (DHCP) | Red Team (attacker) | nmap, hydra, sqlmap, hping3, metasploit |
| bank-web | 10.10.10.10 | Public web server | Apache2, vsftpd, Suricata, Fail2ban, ModSecurity |
| customer-db | 10.20.20.20 | Internal DB server | PostgreSQL, Suricata, Fail2ban |
| aegis-forwarder | 10.30.30.10 | AEGIS hub agent | aegis_forwarder.py --mode hub |
| pfSense | 10.30.30.1 / 10.0.23.2 | Firewall/router | easyrule, pfctl, VLAN routing |
| Router (MikroTik) | 192.168.10.1 / 10.0.23.1 | WAN router | NAT, DHCP for Kali |
| AEGIS Dashboard | Render + Vercel | Monitoring + Control UI | React, Express, Supabase |

---

## Planned Bank Services (future GNS3 nodes)

Services to add to make the lab realistic as a bank SOC:

| Service | VM | VLAN | Priority | Attack to Demo |
|---|---|---|---|---|
| **Email Server** | Ubuntu + Postfix/Dovecot | VLAN 30 | 🔴 High | Phishing relay, SMTP flood |
| **DNS Server** | Ubuntu + BIND9 | VLAN 10 (DMZ) | 🔴 High | DNS amplification, tunneling |
| **CCTV / IP Camera** | Ubuntu + RTSP (vlc/ffmpeg) | VLAN 40 | 🟡 Medium | Stream hijack, brute force |
| **VoIP (SIP)** | Ubuntu + Asterisk | VLAN 50 | 🟡 Medium | SIP flood, toll fraud |
| **ATM Network** | Ubuntu + custom app | VLAN 60 | 🟡 Medium | Transaction anomaly, MITM |
| **Active Directory** | Ubuntu + Samba4 | VLAN 20 (Internal) | 🟠 Later | Pass-the-hash, Kerberos attack |

### Adding a new service — steps every time:
1. GNS3 မှာ Ubuntu VM node ထည့်
2. pfSense မှာ new VLAN + sub-interface ဖောက်
3. OVS switch (or new switch) မှာ port assign
4. VM ထဲ service install + log path မှတ်
5. `aegis_forwarder.py` မှာ log watcher function ထည့် (hub mode = auto-poll)
6. API server မှာ ingest route ထည့် (မလိုရင် existing `/ingest/suricata` သုံး)
7. Dashboard မှာ service card + alert display ထည့်

---

## Attack types that must be supported

- **Network**: port scan, DDoS, SYN flood, ARP spoofing, ICMP flood, UDP flood
- **Web**: SQLi, XSS, LFI, RFI, directory traversal, brute force, CSRF, command injection
- **Auth**: SSH brute force, FTP brute force, credential stuffing
- **Mail/Phishing**: SMTP relay abuse, phishing email detection
- **Encrypted traffic**: TLS anomalies, weak ciphers (SSLv3/TLS1.0), self-signed/expired certs
- **Honeypot**: Cowrie SSH/Telnet honeypot (any connection = alert)
- **DNS**: DNS amplification, tunneling
- **VoIP**: SIP flood, registration hijack (when VoIP server added)
- **CCTV**: RTSP brute force, unauthorized stream access (when CCTV added)
- **Any** event Snort/Suricata/Fail2ban/ModSecurity can detect

---

## Defense model (in priority order)

1. **Auto-defense** (preferred): defense rule matches attack type/severity/threshold → auto-generates iptables/ufw command → queued in `defense_commands` → Ubuntu/pfSense agent executes it
2. **Manual rule writing**: admin writes a firewall rule or defense rule from the dashboard → same command queue → agent executes
3. **Alert-only**: if action_type = "suggest", create an incident for manual review instead of acting

**Key tables**: `defense_rules` (trigger conditions + action), `defense_commands` (polling queue for agents), `blocked_ips`, `firewall_rules`

---

## Required secrets (all must be set or server won't start)

- `SUPABASE_DB_URL` — Supabase PostgreSQL pooler connection string (port 6543, session mode)
- `AEGIS_INGEST_KEY` — VMs authenticate ingest POST requests via `X-AEGIS-Key` header
- `AEGIS_ADMIN_KEY` — Dashboard admin actions via `X-AEGIS-Admin-Key` header

---

## pfSense Control Method
SSH remote only — no pfSense REST API package needed.
`aegis_forwarder.py` SSHes into pfSense (10.30.30.1) and runs `easyrule block/unblock WAN <ip>`.
Config: PFSENSE_SSH_KEY + PFSENSE_SSH_USER in aegis_forwarder.local.conf.
