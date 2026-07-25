# AEGIS SOC — Source-Aligned Code and Data Flows

> Current four-server runtime only. Mail, Cowrie, Incident page, encrypted-connection page and Snort are not active flows.

## 1. Process map

```text
Vercel Browser --REST + EventSource--> Render Express API
                                      | routes/*.ts
                                      | auto-defense.ts / broadcaster.ts
                                      +--Drizzle/SSL--> Supabase PostgreSQL
                                             ^
AEGIS Hub forwarder --HTTPS ingest/admin queue--+
  |--SSH tail Web/DNS/DB/LDAP logs
  |--SSH tail pfSense Suricata EVE
  +--SSH execute and verify defense commands
```

## 2. API composition flow

1. `artifacts/api-server/src/index.ts` starts the HTTP process.
2. `src/app.ts` attaches middleware, auth and `/api` router.
3. `src/routes/index.ts` mounts the active route modules.
4. Each route performs its own authentication/validation and Drizzle/service calls.
5. `lib/db/src/schema/` is the database contract source of truth.

## 3. Ingest flow

```text
log/EVE line -> forwarder parser
 -> POST /api/ingest/<source> + X-AEGIS-Key
 -> auth -> request/source validation
 -> security_events INSERT
 -> optional specialized INSERT
 -> alert dedup/create -> evaluateEvent(...)
 -> SSE security_event/stats_update -> HTTP response
```

Active four-server evidence includes Suricata, Fail2ban, SSH, HTTP, DDoS, DNS, MySQL and LDAP. Generic event/traffic/pfSense/mitm routes support shared network telemetry. FTP is optional Web VM service compatibility, not another server.

| Evidence | Detail table |
|---|---|
| SSH | `ssh_sessions` |
| Web | `http_attacks` |
| Customer DB | `db_attacks` |
| DNS | `dns_attacks` |
| LDAP | `ldap_attacks` |

## 4. Auto-defense flow

```text
evaluateEvent -> normalize family -> active rules by priority
 -> type/severity match -> threshold/window
 -> validate source/action -> defense_actions
 -> expand target=all -> defense_commands per concrete target
 -> broadcast defense_action
```

Only the first eligible priority rule fires. Suggested rules create an operator-facing action; automatic rules create executable queue rows. Unknown targets must never fall back to Hub local shell execution.

## 5. Queue and execution flow

```text
Hub GET /api/defense/commands/pending (admin key)
 -> transaction + FOR UPDATE SKIP LOCKED
 -> mark executing/claimed with lease metadata
 -> agent validates allowlist/type
 -> SSH execute on VM/pfSense -> target verification
 -> POST /api/defense/commands/:id/result
 -> update command/action/block state
 -> broadcast defense_result
```

`targetVm=all` is expanded at creation time, so every target has an independent command and result. Unblock follows the same queue using the inverse action.

## 6. SSE flow

```text
Browser GET /api/events/stream
 -> broadcaster.addClient -> connected event/keepalive
 -> producer broadcasts named event
 -> use-sse.ts listener -> query invalidation/refetch -> render
```

Produced events include `security_event`, `stats_update`, `alert`, `defense_action`, `defense_result`, `host_status_change` and `service_status_change`. Threat Map first hydrates `/api/events`; therefore browser changes do not depend on in-memory SSE history.

## 7. Frontend flow

`artifacts/aegis-dashboard/src/App.tsx` protects and mounts Command Center, Events, Alerts, System, Network, Defense, Reports, Connections, Defense Rules, Settings and Attack Flow. Incident and encrypted-connection routes are absent.

```text
page -> query hook -> /api through Vercel rewrite
 -> loading/error/success state
 -> SSE invalidation on live change -> render
```

## 8. Error semantics

- `2xx`: accepted/completed according to endpoint semantics.
- `400`: invalid request or action.
- `401/403`: missing/wrong authorization.
- `404`: resource/route not found.
- `409`: conflicting state where applicable.
- `5xx`: server/dependency failure without credential disclosure.
- Forwarder treats non-2xx as failure and retries only bounded/transient cases.

## 9. Verification/source order

1. `replit.md` — project constraints.
2. API `routes/index.ts` and route files — live paths.
3. `lib/db/src/schema/` — DB contract.
4. `scripts/src/aegis_forwarder.py` — collection/execution.
5. Dashboard `App.tsx` — active pages.
6. `docs/PROJECT_BOOK.md` — final architecture narrative.
