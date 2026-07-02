---
name: Render URL
description: The actual Render service URL for the AEGIS API server (has a random suffix, not just the service name)
---

# Render API Server URL

**Correct URL:** https://aegis-api-server-jp3b.onrender.com

**Why:** Render appends a random suffix (jp3b) to the service name. The base URL https://aegis-api-server.onrender.com belongs to a completely different service (Intentia-Mainnet blockchain API), NOT AEGIS. Using the wrong URL silently returns 404 for all API calls.

**Where this URL must appear:**
- Root `vercel.json` rewrite destination
- `artifacts/aegis-dashboard/vercel.json` rewrite destination
- All forwarder docs and scripts (setup.tsx, docs/API.md, docs/SETUP.md, scripts/src/aegis-fail2ban-action.conf)

**How to apply:** Never use `aegis-api-server.onrender.com` (no suffix). Always use the full `aegis-api-server-jp3b.onrender.com` URL.
