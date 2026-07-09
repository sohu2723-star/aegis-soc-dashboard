---
name: Ingest targetHost identity
description: Why targetHost values in the API server's ingest pipeline are inconsistent, and what that means for any feature that filters/groups by "which device" was attacked.
---

`targetHost` (on `security_events`, and now `blocked_ips`/`defense_actions`) is populated
per ingest route in `artifacts/api-server/src/routes/ingest.ts`. It is **not** a single
consistent identity type:

- Several routes set it to a real destination IP (`dest_ip`, `target_ip`, `victim_ip`).
- Several routes hardcode a generic label instead ("mail-server", "ftp-server",
  "ubuntu-server", "cowrie-honeypot", "internal-network") when no concrete IP is known
  for that sensor/log source.

**Why this matters:** any per-device filtering feature (e.g. the dashboard's device
selector scoping Defense Center's blocks/actions) must match `targetHost` against
`network_hosts.ip`, not hostname — IP is the identity that actually overlaps between
the two data sets. Events whose `targetHost` is a generic label will never match a
specific device and will only show up under "All Devices". This is a real data gap,
not a bug — don't paper over it with fuzzy string matching.

**How to apply:** if extending per-device filtering, prefer normalizing ingest to
always pass a real IP where the source can determine one, rather than adding more
string-matching heuristics on the read side.
