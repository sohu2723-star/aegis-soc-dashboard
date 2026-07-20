---
name: pfSense Suricata IDS setup
description: How pfSense Suricata IDS is integrated — SSH log tail, config, sensor placement
---

## Rule
pfSense is the ONLY place Suricata runs — not on individual company VMs. All network-level IDS alerts come through pfSense EVE JSON.

**Why:** GNS3 lab has pfSense as the single gateway (10.30.30.1). All inter-zone traffic passes through it, making pfSense the ideal (and only needed) IDS point. Running Suricata on VMs was redundant and caused DB noise.

## How it works
- `_watch_pfsense_suricata()` in `aegis_forwarder.py` — spawned as a dedicated daemon thread in hub mode
- Uses `PFSENSE_SSH_KEY` + `PFSENSE_SSH_USER` (same as defense commands, not REMOTE_SSH_USER)
- Tails `PFSENSE_SURICATA_LOG` (default: `/var/log/suricata/suricata_em0/eve.json`; em0 = WAN)
- Forwards `event_type=alert` → POST `/api/ingest/suricata`; stamps `targetHost="pfsense"`
- Auto-reconnects every 15s on disconnect

## system.ts placement
- In `GLOBAL_COMPONENTS` (no hostIp) — always seeded, not per-VM
- `ALWAYS_DELETE_COMPONENTS` includes `"Suricata IDS"` to purge old per-VM entries from DB

## How to apply
- If pfSense WAN interface is not em0, set `PFSENSE_SURICATA_LOG` in `aegis_forwarder.local.conf`
- pfSense must have Suricata package + logging enabled, EVE JSON output to that path
- The thread starts automatically in hub mode; no extra config beyond PFSENSE_SSH_KEY
