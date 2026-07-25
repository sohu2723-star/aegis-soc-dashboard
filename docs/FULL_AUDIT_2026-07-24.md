# AEGIS Full Project Audit — 2026-07-24

## Scope and safety

This was a static, non-destructive audit of commit `9228c9a6ff43`. No production
database mutation, VM command execution, deployment, or secret-value output was
performed. Credential checks reported presence only: the audit environment had
no `.env*` files and no relevant credential variables in its process environment.
Consequently, live Supabase contents and deployed Render/Vercel/VM behavior were
not tested.

GitHub's public commits API reported `9228c9a6ff43` as the repository's latest
commit, with subject `Update sound alert logic and attack flow page implementation`.
The checked-out `HEAD` resolved to that same commit and `git fsck` found no object
integrity error. This checkout has no configured Git remote, so verification used
the public API rather than `git fetch`.

## Executive result

**Risk: Critical. Do not treat the current API as production-safe.** The core
ingest → PostgreSQL → SSE → dashboard path is coherent, and the defense command
builders validate most interpolated network values. However, several public API
mutations can create events, alter settings, queue privileged firewall commands,
or remove rules without authentication. The forwarder then executes database
command text with root-equivalent shell/SSH privileges. Dependency audit also
reports 23 known production dependency vulnerabilities.

## Findings

### AEGIS-01 — Critical — privileged mutation routes are unauthenticated

The API installs routers globally without a session-auth boundary. In particular,
`POST /api/firewall/rules`, `DELETE /api/firewall/rules/:id`, manual block/unblock,
the auto-defense toggle, settings changes, report/incident/event creation, alert
acknowledgement, host mutations, and multiple AI actions do not consistently use
`requireAuth`, `requireAdmin`, or `maybeAdmin`. A remote caller can therefore queue
iptables commands for `targetVm: "all"`, turn auto-defense off, fabricate SOC data,
and modify operational state.

**Fix:** require a valid admin JWT for browser mutations and a separate,
least-privilege agent credential for queue polling/results. Retire duplicate
unprotected route families (`firewall.ts`, `defense.ts`) or place the same auth
middleware on them. Add route-level authorization tests that enumerate every
mutation endpoint and expect 401/403 without credentials.

### AEGIS-02 — Critical — command queue becomes remote root command execution

The forwarder reads `commandText` from the database and invokes it through
`subprocess.run(..., shell=True)` locally or prefixes it with `sudo` over SSH.
Although current TypeScript builders sanitize IPs, ports, protocols, chains and
interfaces, the executor itself does not enforce a command grammar or signed
command type. Combined with AEGIS-01, a public API caller can cause privileged
network changes. Any future database write path can also become an RCE path.

**Fix:** remove `shell=True`; translate a versioned typed action payload into a
fixed argv allowlist on the agent. Pin allowed target VMs, programs, chains and
actions locally. Sign commands, bind them to an agent identity, enforce expiry
and nonce/idempotency, and run a narrowly scoped sudoers wrapper rather than the
whole forwarder as unrestricted root.

### AEGIS-03 — High — queue claim is not safely scoped to one poller

The pending endpoint updates matching rows from `pending` to `sent`, then selects
up to 20 rows with status `sent` globally. It does not identify which rows were
claimed by the current request, and the selection occurs outside a transaction.
Old or concurrently claimed rows may be returned again or to the wrong agent.
The `targetVm: "all"` model also lets the first poller move a command to `sent`,
preventing the other intended VMs from claiming it reliably.

**Fix:** use a transaction with `FOR UPDATE SKIP LOCKED` and `UPDATE ... RETURNING`,
record `claimed_by`, `claim_token`, and `lease_until`, and return only rows from
that statement. Expand broadcasts into one row per target agent. Make completion
conditional on the claim token and add retry/dead-letter semantics.

### AEGIS-04 — High — browser authentication does not protect most API data

The dashboard has a login/JWT mechanism, but most read routes and SSE are public.
The SSE broadcaster explicitly permits every origin and broadcasts source IPs,
victim hosts, event descriptions, signatures and defense activity. Express CORS
also uses its permissive default. This exposes SOC topology and live operational
telemetry and permits cross-origin reading from arbitrary sites.

**Fix:** enforce `requireAuth` on SOC reads and SSE; use a fetch-stream or a
short-lived, HttpOnly same-site session because native `EventSource` cannot set
an Authorization header. Restrict CORS to the exact Vercel production origin and
approved localhost development origins. Add `Vary: Origin`, proxy buffering
controls, per-IP connection limits and authentication expiry handling.

### AEGIS-05 — High — production JWT has a known fallback secret

`SESSION_SECRET` falls back to a repository-known string. The API startup enforces
ingest and admin keys but not the session secret. A missing production variable
therefore permits forged admin JWTs, including access to `maybeAdmin` routes.

**Fix:** fail startup when `SESSION_SECRET` is absent or too short, remove the
fallback, validate JWT issuer/audience/algorithm, and rotate the deployed secret.
Also rate-limit both login endpoints and compare admin keys using constant-time
byte comparison.

### AEGIS-06 — High — vulnerable production dependency chain

`pnpm audit --prod --audit-level low` reports **23 vulnerabilities: 10 high,
12 moderate, and 1 low**. They are in the old Axios version pulled transitively by
`google-tts-api`, including SSRF, credential leakage, prototype pollution, header
injection and denial-of-service advisories.

**Fix:** replace `google-tts-api` with a maintained implementation/provider or
upgrade/override only after compatibility testing so Axios resolves to a patched
release. Add production audit/SCA to CI and fail on high or critical findings.

### AEGIS-07 — High — no request-size, abuse, or centralized error controls

The server uses default JSON/form limits, has no rate limiter, and async routes
largely rely on framework-default error behavior. Expensive database and Groq/TTS
routes can be abused. Zod `.parse()` failures can surface as generic server errors,
and the global unhandled-rejection handler deliberately keeps the process alive,
which may leave unknown state after programming failures.

**Fix:** add strict body limits, request timeouts, rate limits (especially auth,
AI, TTS, reports and ingest), a consistent async error handler, safe client error
messages, and graceful termination/restart for truly unhandled failures.

### AEGIS-08 — Medium — ingest validation and event authenticity are incomplete

Ingest uses one static key for every sensor and many handlers destructure an
untyped body rather than validate a complete Zod schema. The key proves possession
only; it does not identify the source VM, prevent replay, or bind a body to a
timestamp. Generic events can supply arbitrary types, targets and descriptions.

**Fix:** provision per-sensor credentials, require sensor ID/timestamp/nonce/body
HMAC, reject clock-skew and replay, validate every endpoint with strict schemas,
cap every string/array, normalize IPs, and store authentication provenance.

### AEGIS-09 — Medium — auto-defense classification can misclassify attacks

Classification is substring based. Any `network_attack` subtype containing
`brute` becomes `ssh_brute`, while unknown values fall back to `any`. The
in-memory threshold tracker is lost on restart and is not shared across Render
instances. Multiple rules intentionally fire for one event, which can enqueue
conflicting or duplicate blocks.

**Fix:** introduce a canonical attack taxonomy at ingest, map sensor signature IDs
to it, persist counters in PostgreSQL/Redis with atomic time windows, and define
rule conflict/deduplication policy. Add fixtures for Snort, Suricata, Fail2ban,
Cowrie, SSH, HTTP, DNS, DB, LDAP, FTP, TLS, DDoS and MITM classifications.

### AEGIS-10 — Medium — topology filters reduce general detection coverage

Suricata ingest accepts hostile events only when the source is in the fixed Kali
`192.168.10.0/24` subnet and drops public sources as presumed response traffic.
This matches the current isolated lab concept but would hide attacks after NAT,
from another red-team subnet, from a compromised internal VM, or from the public
Internet. The threat map similarly labels an arbitrary source as flowing through
the fixed R1/pfSense path.

**Fix:** make trusted/attacker networks and sensor interfaces deployment config,
classify direction from sensor/interface and HOME_NET/EXTERNAL_NET, retain filtered
event metrics, and display an “unknown route” rather than asserting a false path.

### AEGIS-11 — Medium — pfSense execution semantics can damage the ruleset

The generated pfSense port-block command pipes a single rule into `pfctl -f -`.
Loading a ruleset from stdin can replace the active ruleset rather than safely add
one managed rule. `easyrule pass` is not a dependable inverse of an earlier block.
The configured interface name (`WAN`/`em0`) is also inconsistent with the project
book's VLAN/interface topology.

**Fix:** manage a dedicated persistent pf table/anchor through a hardened pfSense
wrapper, never reload the full ruleset from an ad-hoc command, and verify actual
interface mapping on the appliance before enabling automatic execution.

### AEGIS-12 — Medium — duplicate APIs and generated/source duplication drift

Defense/firewall functionality is implemented in both legacy routes and `/ui/*`
routes with different authentication rules and response contracts. The React API
client contains tracked `.ts` and `.js` variants, increasing the chance imports
resolve to stale generated logic. Documentation also alternates between MySQL and
PostgreSQL for the lab customer database, while Supabase is correctly PostgreSQL
for the SOC database.

**Fix:** choose one canonical route family in OpenAPI, delete/deprecate the other,
regenerate clients, stop tracking generated JS when TypeScript is the source, and
state explicitly that the SOC database and monitored company database are separate.

### AEGIS-13 — Medium — raw logs can leak sensitive data

The forwarder sends raw `auth.log`, Apache URLs, ModSecurity fragments, LDAP DNs,
database error text and usernames as signature/details. Query strings, credentials,
session IDs, personal data or exploit payloads may therefore enter Supabase,
Telegram, SSE, reports and browser local storage. Retention and deletion controls
are not evident in the audited flow.

**Fix:** redact at the forwarder, remove query strings and authorization material,
classify sensitive fields, encrypt data at rest, limit report/Telegram content,
define retention/partition cleanup, and audit access. Never log request headers or
command secrets.

### AEGIS-14 — Low — SSE reliability is best-effort only

SSE has useful heartbeat and reconnect behavior but no event IDs, replay cursor,
bounded per-client backpressure, or explicit retry directive. Events during a
disconnect are recovered only indirectly through query invalidation/refetch.

**Fix:** emit monotonic IDs, support `Last-Event-ID`, cap buffered writes, terminate
slow clients, and expose connection/replay metrics. Keep database polling as the
authoritative recovery path.

### AEGIS-15 — Low — build and test coverage gaps

TypeScript typecheck, production build, Python byte-compilation and shell syntax
checks pass. The frontend build warns about sourcemap resolution and a 1.16 MB
minified JavaScript chunk. There is no automated unit/integration/security test
suite in package scripts, and Python is not covered by the workspace typecheck.

**Fix:** add Vitest/API integration tests, Python unit tests and linting, queue
concurrency tests, auth matrix tests, migration tests against disposable Postgres,
and browser SSE/threat-map tests. Code-split heavy frontend pages.

## Component audit matrix

| Area | Result |
|---|---|
| API server | Functional structure; critical authorization gaps and missing abuse controls |
| Supabase DB | PostgreSQL driver/SSL/schema path coherent; live connectivity/data not tested because credentials were absent |
| Security events | Rich sources and persistence/SSE flow; validation, authenticity, privacy and unauthenticated fabrication issues |
| Connection logs | SSH/HTTP/DB/DNS/LDAP/FTP/TLS tables/routes exist; public data exposure and retention/redaction risks |
| Log paths | Ubuntu defaults are plausible; remote glob/tail behavior and permissions require VM verification; pfSense path auto-discovery handles PID directories |
| Forwarder | Broad real-sensor coverage and reconnect loops; privileged generic shell execution is the dominant risk |
| SSE real-time | Singleton broadcast, heartbeat and reconnect exist; public feed, wildcard origin, no replay/backpressure |
| Threat map | Uses persisted live feed and topology-aware paths; fixed-path assumptions can misrepresent traffic |
| Attack classification | Central severity resolver and trigger normalization exist; substring taxonomy and ephemeral counters need hardening |
| Defense rules | Sanitizers are a strong baseline; rule conflicts, DNS shell quoting, pfSense semantics and auth need work |
| Auto-defense queue | End-to-end polling/result flow exists; claim race, `all` fan-out and executor trust are unsafe |
| VM/pfSense flow | SSH routing matches project concept; least privilege, durable identity, idempotency and pf anchor management are missing |
| Duplicate code | Legacy/UI route families and TS/JS client copies are drift risks |
| Errors | Build passes; route error consistency, validation handling and fatal process policy are incomplete |
| Vulnerabilities | 2 critical, 5 high, 6 medium and 2 low design findings; dependency scan separately reports 23 advisories |

## Remediation order

1. Immediately restrict Render/Vercel exposure or disable command polling until
   AEGIS-01 and AEGIS-02 are fixed.
2. Enforce startup secrets and authenticate all API/SSE routes; rotate relevant
   production keys after deployment.
3. Replace the queue claim/fan-out protocol and the shell executor.
4. Replace the vulnerable TTS dependency and add automated dependency scanning.
5. Add strict ingest schemas, sensor identities, replay protection and privacy
   redaction/retention.
6. Consolidate routes/contracts, harden pfSense actions, then add comprehensive
   automated tests and observability.
