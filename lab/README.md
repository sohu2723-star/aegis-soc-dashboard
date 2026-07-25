# AEGIS Four-Server Lab

The authoritative installation, troubleshooting, sensor/rule and classroom-demo instructions are in [`SYSTEM_SETUP_AND_DEMO_GUIDE.md`](SYSTEM_SETUP_AND_DEMO_GUIDE.md).

Active lab scope:

- Company Web — `10.10.10.10`
- Company DNS — `10.10.10.20`
- Customer DB — `10.20.20.10`
- LDAP — `10.20.20.20`
- pfSense Suricata and the AEGIS Hub

Do not use old download lists or external paste links: deploy the tracked directory for each component. Do not commit credentials or run destructive tests against any non-lab host.

| Component | Source |
|---|---|
| Web application and DB seed | `company-web-server/` |
| BIND zone/config | `dns-server/` |
| LDAP LDIF | `ldap-server/` |
| Local Suricata rules | `pfsense-suricata/local.rules` |
