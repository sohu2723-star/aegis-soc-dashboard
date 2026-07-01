---
name: Auto-defense engine
description: AEGIS auto-defense system — how attack events become iptables/pfSense commands on VMs.
---

## Architecture
```
Ingest event (POST /api/ingest/*)
    ↓ evaluateEvent() [auto-defense.ts]
    ↓ toTriggerType() normalises event type
    ↓ recordAttack() checks threshold in rolling window [attack-tracker.ts]
    ↓ Rule matches? → buildCommand() with sanitised values [defense-sanitize.ts]
    ↓ INSERT into defense_commands (status=pending)
    ↓ defense_agent.py on VM polls GET /api/defense/commands/pending
    ↓ Executes iptables/pfSense API call
    ↓ POST /api/defense/commands/:id/result
```

## Security rules
- All IPs, ports, protocols in shell commands go through `defense-sanitize.ts` helpers before use.
- `sanitizeIp()` validates IPv4 with CIDR; throws on anything else.
- `sanitizePort()` enforces integer 1–65535.
- `sanitizeProtocol()` allows only: tcp, udp, icmp, all.
- `defense_agent.py` MUST run the sanitised command text verbatim — never re-interpolate.

## Auth
- `AEGIS_INGEST_KEY` — required env var, no fallback. VMs send via `X-AEGIS-Key` header.
- `AEGIS_ADMIN_KEY` — required env var, no fallback. Dashboard UI + defense agent use `X-AEGIS-Admin-Key` header.
- Both are enforced at module load time (server refuses to start if missing).

## Attack counter keying
- Key: `${sourceIp}::${actualTriggerType}` where `actualTriggerType` is the resolved type (never "any").
- This prevents cross-attack-type aggregation when a rule has `triggerAttackType = "any"`.

## Default rules seeded on first startup
ssh_brute→block_ip, honeypot→block_ip, ddos→null_route, web_attack(high)→block_ip,
port_scan→block_ip, ftp_brute→block_ip, mail→block_ip, critical→pfsense_block, mitm→suggest

## Command queue race condition fix
Polling uses atomic SQL `UPDATE … LIMIT 20 WHERE status='pending'` before selecting,
so two concurrent pollers cannot claim the same command.
