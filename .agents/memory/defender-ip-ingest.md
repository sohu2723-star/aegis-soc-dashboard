---
name: Defender IP ingest filter
description: isDefenderIp() must be applied in all ingest handlers or hub SSH connections create false attack events in the dashboard.
---

# Defender IP Ingest Filter

## Rule
`isDefenderIp()` must be called at the TOP of `/ingest/ssh`, `/ingest/fail2ban`, and `/ingest/event` handlers. If `src_ip` (or `ip` for fail2ban) is a defender subnet, return HTTP 200 `{ ok: true, skipped: "defender_ip" }` immediately — do not insert events or sessions.

**Why:** Hub (aegis-company-admin, 10.30.30.10) SSHes into all company VMs every ~15s to tail logs. Those legitimate connections are recorded in each VM's `auth.log`. The forwarder reads auth.log and forwards entries to the ingest API with `src_ip=10.30.30.10`. Without the guard, the dashboard fills with false "SSH Brute", "LDAP Brute", "MySQL Brute" events from the defender's own hub.

**How to apply:** Any new ingest endpoint that accepts a `src_ip` / `ip` field must add this check before any DB insert:
```typescript
if (isDefenderIp(src_ip)) {
  res.status(200).json({ ok: true, skipped: "defender_ip" });
  return;
}
```

## Subnet whitelist (isDefenderIp)
- `10.10.10.x` — company-web-server + company-dns-server
- `10.20.20.x` — company-customer-db + company-ldap-server
- `10.30.30.x` — aegis-company-admin + pfSense
- `127.x`      — loopback
- **NOT whitelisted:** `192.168.122.x` — GNS3 NAT cloud / Kali attacker range
