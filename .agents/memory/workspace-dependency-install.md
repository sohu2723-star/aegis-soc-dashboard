---
name: Workspace dependency install
description: Monorepo dependency installation behavior in this Replit workspace
---

When validating the dashboard and API, install the runtime app filters rather than the entire workspace if the full install is blocked by the package firewall.

**Why:** The imported lockfile includes the API code-generation tool Orval, which can be denied by the Replit package firewall even though the running dashboard and API do not need it. A filtered install restores Vite, esbuild, and the runtime workspace packages without changing the project dependency graph.

**How to apply:** Prefer a frozen filtered install for the dashboard/API workspace packages. Treat a missing `SUPABASE_DB_URL` as an environment prerequisite after the API build succeeds, not as a code/build failure.