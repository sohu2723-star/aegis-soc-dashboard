---
name: Sensor topology final
description: Final confirmed sensor assignment per VM — which log watchers run where
---

## Final Topology (July 2026)

| VM | IP | Sensors (log watchers) | Health checks |
|---|---|---|---|
| company-web-server | 10.10.10.10 | fail2ban, ssh, http_access | fail2ban, ssh, apache2 |
| company-customer-db | 10.20.20.10 | fail2ban, ssh, mysql | fail2ban, ssh, mysql |
| company-dns-server | 10.10.10.20 | fail2ban, ssh, bind9 | fail2ban, ssh, named |
| company-ldap-server | 10.20.20.20 | fail2ban, ssh, slapd | fail2ban, ssh, slapd |
| pfSense | 10.30.30.1 | Suricata IDS (GLOBAL_COMPONENTS, dedicated thread) | pfsense_health_loop |
| aegis-forwarder | 10.30.30.10 | Hub Forwarder, local SSH Monitor, Fail2ban | hub_self_health |

## Removed services
- **FTP** — removed entirely (no vsftpd in lab)
- **VM-level Suricata/Snort** — removed; pfSense Suricata covers all zones
- **PostgreSQL Monitor** (company-customer-db) — replaced by MySQL Monitor
- **ATM API Monitor** (10.20.20.20) — replaced by LDAP Monitor (company-ldap-server/slapd)
- **Incidents page** — removed from dashboard (incidentsTable stays in DB for auto-defense writes)
- **Snort ingest route** (`POST /ingest/snort`) — removed

## REMOTE_HOSTS config vars
Set in `aegis_forwarder.local.conf`:
- `BANKWEB_IP`, `CUSTOMERDB_IP`, `DNSSERVER_IP`, `LDAPSERVER_IP`
- Any unset IP → that VM's host entry is skipped (no thread spawned)

**Why:** Modular — add a new VM just by setting its IP in local.conf; no forwarder code changes needed.
