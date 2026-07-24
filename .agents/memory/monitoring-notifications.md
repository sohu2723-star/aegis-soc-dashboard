---
name: Monitoring notifications
description: Alert visibility, persistent live feed, Telegram confirmation, and Myanmar-time report scheduling
---

Critical/high/medium security events should create one linked dashboard alert per event. Critical/high notifications are sent to Telegram only after the server confirms delivery; the client must treat the SSE delivery flag as authoritative for Telegram animation/badges.

**Why:** Endpoint-specific ingest handlers and auto-defense can both touch the same event, so alert creation and notification need idempotent event-based handling to avoid duplicate rows, sounds, and Telegram packets.

**How to apply:** Keep browser sound unlocked from a user gesture and mount SSE/sound listeners above page routing. Store the live feed in browser storage with timestamp-based 24-hour pruning, and anchor 12-hour/24-hour reports to Myanmar midnight/noon rather than interval drift.