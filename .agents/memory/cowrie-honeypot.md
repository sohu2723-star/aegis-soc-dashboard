---
name: Cowrie honeypot placement & integration
description: Which VMs run Cowrie, which files need updating together, and the dashboard stale count bug.
---

## Rule
Cowrie honeypot runs ONLY on company-web-server (10.10.10.10) and company-customer-db (10.20.20.10).
Never on Aegis VM (10.30.30.10) or LDAP/DNS servers — they are not attacker-reachable honeypot targets.
If Aegis VM is compromised the forwarder stops → monitoring goes blind.

**Why:** Honeypot only makes sense on attacker-reachable targets. Aegis VM is in the management zone.

**How to apply:** Any future honeypot sensor config must skip Aegis VM and add only company-web-server + company-customer-db.

## Files that must be updated together
When adding/removing Cowrie, touch all four:
1. `artifacts/api-server/src/lib/auto-defense.ts` — defense rules (triggerAttackType: "honeypot")
2. `artifacts/api-server/src/routes/system.ts` — PER_HOST_SENSORS (for System Status page)
3. `scripts/src/aegis_forwarder.py` — health_services for company-web-server + company-customer-db
4. VM: `sudo apt install cowrie -y && sudo systemctl enable cowrie --now`

## Dashboard stale count mismatch fix (System Status "1" vs Command Center "2/14")
**Root cause:** `dashboard.ts` only applied stale check to rows with `hostIp`. Global rows (AEGIS API Server, no hostIp) stayed "online" even when stale → inflated online count.

**Fix:** Both `system.ts` and `dashboard.ts` now use identical logic:
- VM sensors (hostIp set) → stale after 3 min → offline
- Global components (no hostIp) → stale after 2 min → offline

## Defense rule spec for honeypot
- triggerAttackType: "honeypot", threshold: 1, windowSecs: 60, priority: 5 (highest)
- actionType: "auto", defenseType: "block_ip"
- One rule per target VM (company-web-server, company-customer-db) so targetVm routing works correctly

## iptables-persistent in lab
Do NOT install in lab — reboot clears iptables which gives clean slate for repeated attack/defense tests.
Only install for production-grade persistent blocking.
