---
name: Cowrie honeypot placement & integration
description: Cowrie REMOVED from topology — Suricata (pfSense) + Fail2ban only.
---

## ⚠️ Cowrie is REMOVED from the lab topology

Current sensor stack: **Suricata (pfSense only) + Fail2ban (per VM)**. No Cowrie.

**Why:** User decision — simplify to Suricata + Fail2ban only. Cowrie adds complexity without need given pfSense Suricata already covers all network zones.

**How to apply:**
- Do NOT add Cowrie sensor entries to system.ts PER_HOST_SENSORS
- Do NOT add cowrie to forwarder REMOTE_HOSTS sensors lists
- Do NOT add honeypot defense rules to auto-defense.ts
- Keep "Cowrie Honeypot" in system.ts GLOBAL_OBSOLETE_COMPONENTS so any stale DB rows get cleaned up
- The `/ingest/cowrie` API route can stay (harmless), but no forwarder sends to it
