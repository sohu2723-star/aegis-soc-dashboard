---
name: Project intent and constraints
description: Core purpose, VM topology, attack/defense scope, and what Replit is used for
---

# AEGIS Project Intent & Constraints

## Rule
Replit is a **code editor only**. Never run, deploy, or test against the live app from Replit. The actual system runs on real physical/virtual machines.

**Why:** The user explicitly stated this. Replit = code editing only.

**How to apply:** Do not use `restart_workflow`, `screenshot`, or deployment tools to test features. Describe what to run on the VM instead.

---

## Web dashboard role
The dashboard is **monitoring-only**. It receives real events forwarded from Ubuntu VMs and displays them. It does NOT simulate attacks. The "Simulate Attack" button in the UI should be disabled or removed if the user asks — they only want real data.

---

## Real lab topology

| Machine | Role | Tools |
|---|---|---|
| Kali Linux | Red Team (attacker) | nmap, hydra, sqlmap, hping3, metasploit, etc. |
| Ubuntu VM | Blue Team (defender) | Snort, Suricata, Fail2ban, Cowrie, ModSecurity, vsftpd, nginx |
| pfSense | Firewall/router | iptables, ufw, port blocking, null routing |
| AEGIS Dashboard | Monitoring UI | Web app (Replit-hosted code, run externally) |

---

## Attack types that must be supported

- **Network**: port scan, DDoS, SYN flood, ARP spoofing, ICMP flood, UDP flood
- **Web**: SQLi, XSS, LFI, RFI, directory traversal, brute force, CSRF, command injection
- **Auth**: SSH brute force, FTP brute force, credential stuffing
- **Mail/Phishing**: SMTP relay abuse, phishing email detection
- **Encrypted traffic**: TLS anomalies, weak ciphers (SSLv3/TLS1.0), self-signed/expired certs
- **Honeypot**: Cowrie SSH/Telnet honeypot (any connection = alert)
- **DNS**: DNS amplification, tunneling
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
