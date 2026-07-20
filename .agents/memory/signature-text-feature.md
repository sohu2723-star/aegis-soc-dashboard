---
name: Signature Text Feature
description: Full matched rule text display on dashboard — DB column, API ingest changes, forwarder auto-lookup, UI display block.
---

# Signature Text Feature

## What it does
Every security event detail panel on the dashboard now shows the **full rule/filter text** that matched the attack — Suricata rule string or Fail2ban jail config.

## DB
- Column: `signature_text text` (nullable) in `security_events` table.
- Migration: `ALTER TABLE security_events ADD COLUMN IF NOT EXISTS signature_text text;`
- Already run against Supabase pooler (2026-07-21) using custom URL parser + postgres.js direct connection (drizzle-kit push still broken with pooler URL).

## API ingest changes (`artifacts/api-server/src/routes/ingest.ts`)
- `/ingest/suricata` — reads `alert.rule` from EVE JSON first; falls back to top-level `signature_text` field. Stored in `signatureText` column.
- `/ingest/fail2ban` — accepts `filter_regex`, `maxretry`, `findtime`, `bantime` fields. If `filter_regex` present → stores it directly. Otherwise auto-constructs `jail = <jail>\nmaxretry = ...\nfindtime = ...\nbantime = ...\naction = iptables-multiport`.
- `/ingest/event` — accepts optional `signature_text` field (generic events).

## Forwarder (`scripts/src/aegis_forwarder.py`)
Three helper functions added above `get_local_ip()`:

**`_local_fail2ban_signature(jail)`**
- Reads `/etc/fail2ban/filter.d/<jail>.conf` for failregex lines.
- Reads jail config files for maxretry/findtime/bantime.
- Cached per jail (reads once, not per-ban-event).
- Called from `watch_fail2ban()` (local mode).

**`_remote_fail2ban_signature(host_ip, jail)`**
- Single SSH call into bank VM: greps filter.d + jail.conf.
- Returns assembled signature text string.
- Cached per `host_ip:jail` pair.
- Called from `_watch_remote_fail2ban()` (hub mode).

**`_lookup_pfsense_rule(sid)`**
- SSH into pfSense with PFSENSE_SSH_KEY.
- `grep -rh 'sid:<N>;' /var/db/suricata/ /usr/local/etc/suricata/rules/ | head -1`
- Cached per SID (SSH once per unique SID, not per alert).
- Called from `_watch_pfsense_suricata()` — only when EVE JSON lacks `alert.rule`.

**Why:**
- `alert.rule` only appears in EVE JSON when Suricata rule logging is explicitly enabled (Suricata ≥7 + `rule-files` in suricata.yaml). Grep fallback covers older pfSense Suricata packages.
- Caching is critical: hub mode can receive hundreds of bans/alerts per minute; SSH on every event would saturate the management interface.

## Dashboard UI (`artifacts/aegis-dashboard/src/pages/events.tsx`)
- Block renamed: "Matched Suricata Rule" → "Matched Detection Rule" (covers both Suricata + Fail2ban).
- New "Full Rule Text" section appears below the metadata grid when `ev.signatureText` is non-null.
- Styled: `font-mono text-[11px] text-yellow-300/90 bg-black/30 rounded p-3 whitespace-pre-wrap`.
