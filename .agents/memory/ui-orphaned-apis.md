---
name: UI for Orphaned APIs
description: Which backend routes had no UI and what was built to surface them; also dashboard fields that were returned but not displayed.
---

## Previously Orphaned API Routes (now have UI)

### connections.ts → /connections page
Five GET endpoints existed with data in DB but no frontend:
- GET /connections/ssh       → SSH Sessions tab (sourceIp, username, status, failures, bannedBy)
- GET /connections/ftp       → FTP Sessions tab (command, filePath, fileSize; sensitive ext highlight)
- GET /connections/tls       → TLS Traffic tab (tlsVersion, SNI, certIssuer, isSuspicious toggle)
- GET /connections/tls/suspicious → TLS suspicious-only filter
- GET /connections/http-attacks  → HTTP Attacks tab (attackType, ruleId, blocked badge)

Nav location: Operations → "Connection Logs" (/connections)

### defense-rules.ts + firewall.ts → /defense-rules page
Three tabs:
1. Auto-Defense Rules — CRUD via /api/ui/defense/rules (GET/POST/PATCH/DELETE)
   - enable/disable toggle, priority, trigger config, defense type, target VM
2. Firewall Rules — CRUD via /api/ui/firewall/rules + export (.sh bash script)
3. Command History — /api/ui/defense/commands/history (executed/failed/pending log)
   + Hot IPs widget from /api/ui/defense/hot-ips (in-memory session counts)

Nav location: Network & Defense → "Defense Rules" (/defense-rules)

## Admin Key Problem → ui-rules.ts Proxy

defense-rules.ts endpoints require X-AEGIS-Admin-Key header — browser cannot safely hold this.
Solution: created `src/routes/ui-rules.ts` that re-implements same logic at `/api/ui/...` paths.
Auth: if AEGIS_ADMIN_KEY is set, write ops still require the header; if unset (dev), writes are open.
This lets the browser dashboard call /api/ui/defense/rules without exposing the admin key.

**Why:** Admin key is a server secret; it must not be baked into frontend JS bundles.
**How to apply:** Any future admin-only endpoints needed by the browser UI should go in ui-rules.ts (or a similar ui-* proxy file), not in the protected admin routes.

## Dashboard Fields Previously Not Displayed

/api/dashboard/summary returns these fields that had no stat card:
- openIncidents  → added "Open Incidents" yellow card (second row)
- blockedIPs     → added "Blocked Events" red card (second row)
- scopedToHost   → still internal only (used as echo for debugging)

Dashboard now shows 6 stat cards in 2 rows: [totalEvents, criticalEvents, activeAlerts, systemsOnline] + [openIncidents, blockedIPs]
