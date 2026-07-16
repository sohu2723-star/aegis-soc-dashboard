---
name: Host label display
description: How IPs are resolved to device names in the dashboard, and where the HostLabel component lives.
---

## Component
`artifacts/aegis-dashboard/src/lib/host-utils.tsx` — exports `HostLabel` and `resolveHostLabel`.

## Resolution priority
1. Live `network_hosts` DB (via `useDeviceContext()`)
2. Static map for known lab IPs (see below)
3. Generic label passthrough ("ubuntu-server" etc.)
4. Raw IP fallback

## Static lab IP map (hardcoded in host-utils.tsx)
- 10.10.10.10 → bank-web (defender, green)
- 10.20.20.20 → customer-db (defender, green)
- 10.30.30.10 → aegis-forwarder (defender, green)
- 10.0.23.2 → pfSense (infra, purple)
- 10.0.23.1 → R1 MikroTik (infra, purple)
- 192.168.122.132 → Kali attacker (attacker, red)

## Pages using HostLabel
- events.tsx — sourceIp + targetHost columns + AI panel
- connections.tsx — Ip() helper replaced
- defense.tsx — blocked IPs list + defense action targetIp + block history

**Why:** `targetHost` in DB is a mix of real IPs and generic strings; static map ensures display is correct before network_hosts is populated. Extend STATIC_LABELS when topology changes.

**How to apply:** Add new VMs to STATIC_LABELS in host-utils.tsx when lab topology changes. Generic labels that have no IP (e.g. "ubuntu-server") will pass through unchanged until the forwarder registers the host in network_hosts.
