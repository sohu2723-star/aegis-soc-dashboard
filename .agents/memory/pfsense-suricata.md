---
name: pfSense Suricata IDS setup
description: How pfSense Suricata IDS is integrated — actual log path, SSH log tail, config, sensor placement
---

## Rule
pfSense is the ONLY place Suricata runs — not on individual company VMs. All network-level IDS alerts come through pfSense EVE JSON.

**Why:** GNS3 lab has pfSense as the single gateway (10.30.30.1). All inter-zone traffic passes through it, making pfSense the ideal (and only needed) IDS point.

## Actual eve.json Path (CONFIRMED 2026-07-22)

**CORRECT:** `/var/log/suricata/eve.json`
**WRONG (old assumption):** `/var/db/suricata/suricata_em110/eve.json`

Key findings from pfSense diagnostics:
- `/var/db/suricata/` = **rules only** (not logs). suricata_em110/ and suricata_em220/ subdirs contain only a `rules/` folder.
- Actual logs → `/var/log/suricata/`
- pfSense Suricata process uses config from `/usr/local/etc/suricata/suricata_<PID>_em1.10/suricata.yaml`
- `default-log-dir` in YAML = `/var/log/suricata/suricata_em1.<PID>/` — instance subdirs use **dynamic PID numbers** that change on every Suricata restart
- Root-level `/var/log/suricata/eve.json` is the stable combined log path

## How it works
- `_watch_pfsense_suricata()` in `aegis_forwarder.py` — spawned as one daemon thread in hub mode
- Uses `PFSENSE_SSH_KEY` + `PFSENSE_SSH_USER`
- Tails `/var/log/suricata/eve.json` (default; overridable via `PFSENSE_SURICATA_LOG` in local.conf)
- FreeBSD tail fix: remote command wraps tail in sh wait-loop (`while [ ! -f $path ]; do sleep 5; done; tail -F $path`)
- Forwards `event_type=alert` → POST `/api/ingest/suricata`; stamps `targetHost="pfsense"`
- One thread only (not two) — root-level log aggregates all interfaces; monitoring twice = duplicate events

## system.ts placement
- In `GLOBAL_COMPONENTS` (no hostIp) — always seeded, not per-VM
- `ALWAYS_DELETE_COMPONENTS` includes `"Suricata IDS"` to purge old per-VM entries from DB

## pfctl check in check_connectivity.sh
- `pfctl -t EasyRuleBlockHosts -T show` runs via SSH on pfSense — correct
- "pfctl table empty or not available" = **normal** when no IPs are blocked yet (not an error)

## How to apply
- Default path is `/var/log/suricata/eve.json` — no config needed unless path differs
- To override: set `PFSENSE_SURICATA_LOG=/var/log/suricata/eve.json` in `aegis_forwarder.local.conf`
- pfSense must have Suricata package + EVE JSON FILE output enabled
- The thread starts automatically in hub mode
