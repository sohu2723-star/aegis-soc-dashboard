---
name: Threat Map topology
description: SVG node layout, Telegram node, SSE packet animation, keep-alive pattern
---

## Node positions (VW=960, VH=520)
- attacker: x:75, y:260
- r1: x:245, y:260
- pfsense: x:440, y:260
- bankweb: x:660, y:120
- forwarder: x:660, y:260
- customerdb: x:660, y:400
- aegis: x:820, y:260
- telegram: x:930, y:420  ← added 2026-07-18

## Telegram node
- Color: #29b6f6 (Telegram blue)
- Connected via NOTIFY_EDGES (separate array, blue dashed line + "NOTIFY" label)
- Icon: paper plane SVG in NodeIcon switch case "telegram"
- Packet: isTg=true flag → rendered blue regardless of severity

## SSE event → animation mapping
| SSE event | Packet path | Node pulse |
|---|---|---|
| security_event | attacker→r1→pfsense→target | attacker |
| defense_action | (blocks in-flight packets) | pfsense (red flash) |
| alert | aegis→telegram | telegram (1.2s) |

## Keep-alive
- useKeepAlive hook pings /api/healthz every 4 min
- Prevents Render free tier from sleeping (~15 min idle threshold)
- Already wired into ProtectedRouter in App.tsx

## Architecture page
- Removed from sidebar nav (layout.tsx reportItems) and App.tsx routes/imports on 2026-07-18
- File artifacts/aegis-dashboard/src/pages/architecture.tsx still exists but is unreachable

## React Query performance settings
- staleTime: 0 (always background-refetch)
- gcTime: 60_000 (1 min cache retention)
- retry: 2, retryDelay: 2000

**Why:** staleTime:5000 caused stale data to show for 5s before refresh; 0 ensures background refresh on every mount.
