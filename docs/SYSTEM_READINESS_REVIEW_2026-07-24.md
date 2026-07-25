# AEGIS System Readiness Review — 2026-07-24

## Test boundary

The repository was tested without destructive requests. Credential presence was
checked without printing values, but `SUPABASE_DB_URL`, ingest/admin/session keys,
and optional provider keys were not present in this process. The execution
environment's HTTPS proxy also rejected the tunnel to the Render hostname with
HTTP 403, while a direct connection was unavailable. Therefore no claim in this
review represents a successful live Supabase, Render, VM, or pfSense test.

This is important: secrets said to be configured in a Replit secret store are not
automatically available in this checkout's shell. “Configured in Replit” and
“present in the process running the audit” are separate conditions.

## Confirmed code-level errors

1. **Encrypted connection logging is intentionally removed.** The stale forwarder
   TLS POST and current documentation references have now been removed; TLS is not
   part of the four-server monitoring scope.
2. **Defense rules are not self-provisioning.** Startup intentionally does not
   seed defaults. The engine can only act if active rows already exist in
   `defense_rules`. The Project Book's “Default Rules” table is a desired/current
   database configuration, not proof those rows exist in production.
3. **Command claiming can duplicate or misroute execution.** A poll changes rows
   to `sent`, then selects generic `sent` rows rather than only rows claimed by
   that request. `targetVm=all` is claimed once instead of being expanded per VM.
4. **Duplicate defense/firewall implementations have different security.** The
   legacy routes and `/ui/*` routes overlap but do not share one authorization and
   validation boundary. The unprotected legacy firewall route can queue commands.
5. **The forwarder previously accepted unusable/insecure defaults.** It could
   start with a placeholder API hostname, a known demo ingest key, or no admin key
   for command polling. This review changes startup to fail closed and reports
   only missing variable names, never values.
6. **Database connectivity helper exposed metadata.** It printed host, port,
   username and database name. It now reports only presence and `SELECT 1`
   success, so operational identifiers are not disclosed.
7. **Firewall/pfSense execution needs redesign.** `pfctl -f -` can replace a
   ruleset, an `easyrule pass` is not a reliable inverse of a block, and generic
   database command text ultimately reaches privileged shell execution.
8. **Coverage claims exceed implementation.** SMTP/phishing and TLS storage/view
   flows are missing. Snort has no dedicated parser/endpoint in the current
   forwarder. Cowrie was intentionally removed, despite older documents still
   describing it. These must not be marked operational until implemented and
   tested with real sensor records.
9. **Documentation drift exists.** The SOC database is Supabase PostgreSQL, while
   the monitored customer database is currently described and watched as MySQL.
   Several older journal passages call the customer database PostgreSQL or show
   outdated default-rule and firewall-export behavior.

## Follow-up corrections in this change

- Remote log paths now have explicit config keys. The checked-in values are
  Ubuntu defaults, not universal truths; deployments using journald, Debian 12
  `journalctl`, custom BIND logging, or different package paths must override
  them in `aegis_forwarder.local.conf`.
- LDAP parsing now stores the DN from the separate `BIND conn/op` line and joins
  it to the later `RESULT conn/op` line. Previously, result events usually had
  `dn=null` even though slapd had logged the attempted DN.
- MySQL, LDAP and FTP events now normalize to `db_attack`, `ldap_brute` /
  `ldap_enum`, and `ftp_brute` rather than being accidentally treated as
  `ssh_brute` merely because their outer event type was `network_attack`.
- Suricata HTTP/web signatures are now also persisted to `http_attacks`, so the
  Connections HTTP view is not dependent on a remote ModSecurity watcher that
  hub mode does not start.
- The threat-map labels now show the Kali subnet, R1 attacker-facing interface,
  and pfSense/Suricata role rather than implying that pfSense itself is an OVS.

The screenshot's P0/P1/P2 assessment is substantially correct. This patch fixes
the log configurability, classification, LDAP correlation, Suricata HTTP storage,
and topology-label items. Authentication of every mutation, queue leasing/fan-out,
typed command execution, TLS storage, default-rule provisioning policy, MySQL
audit depth, DNS telemetry and full integration tests remain open and must not be
reported as solved.

## Push/deploy readiness check

The workspace installs from the lockfile, typechecks, and builds both deployable
artifacts successfully. A local production-bundle smoke test starts the API and
returns HTTP 200 for `/api/ping`, 401 for an unauthenticated defense-rules request,
and 401 for an ingest request with a wrong key. The removed TLS endpoint is no longer called by the forwarder.

The Suricata-to-`http_attacks` write is secondary indexing. It is now isolated so
an unapplied connection-log migration logs a server-side warning but does not
drop the canonical security event or prevent auto-defense. Production must still
have migration `0004_add_connection_log_tables.sql` before relying on the HTTP
Connections tab.

Pushing the commit should not create a TypeScript/build/startup failure. Deployment
is nevertheless conditional on Render retaining `SUPABASE_DB_URL`,
`AEGIS_INGEST_KEY`, and `AEGIS_ADMIN_KEY`. `SESSION_SECRET` is now declared as a
manually supplied Render secret; a strong value must be present before calling
the deployment production-safe. The hub
forwarder is not auto-deployed by a Git push and will not change until the documented
`wget` plus service restart is performed.

## Server requirements and current readiness

### Company web server — 10.10.10.10

Required: routable DMZ interface, OpenSSH key auth from the hub, Apache, Fail2ban,
vsftpd if FTP monitoring is required, readable `/var/log/auth.log`,
`/var/log/fail2ban.log`, `/var/log/apache2/access.log`, and `/var/log/vsftpd.log`.
Suricata on pfSense must see the traffic. ModSecurity collection exists as local
mode code but hub sensor configuration currently relies on Suricata plus Apache
access logs and does not start the remote ModSecurity watcher.

### DNS server — 10.10.10.20

Required: BIND9/named active, TCP and UDP port 53 permitted, query/security logging
written to `/var/log/named/named.log`, log permissions readable through the hub
SSH account, recursion/transfer ACLs, and Fail2ban/SSH logs. Zone transfer testing
must be read-only and expected to fail for unauthorized clients. If BIND logging
is not explicitly configured, the forwarder thread connects but produces no DNS
events.

### Customer database server — 10.20.20.10

Required: MySQL service and port 3306 policy, error logging at
`/var/log/mysql/error.log`, Fail2ban jail/filter, SSH log access, least-privilege DB
accounts and no direct attacker-subnet access through pfSense. The MySQL error log
does not provide complete SQL audit coverage; a proper MySQL audit plugin/general
log policy is required for reliable query/exfiltration classification.

### LDAP server — 10.20.20.20

Required: slapd on 389 and preferably LDAPS/StartTLS, anonymous-bind policy,
password/lockout policy, syslog/journald forwarding that actually places slapd
records in `/var/log/syslog`, Fail2ban, and hub SSH read access. The parser depends
on expected slapd text patterns; journald-only deployments need an adapter.

### pfSense — 10.30.30.1

Required: correct VLAN interfaces and routing, SSH enabled only on MGMT, a dedicated
key and least-privilege command wrapper, Suricata enabled on both relevant traffic
interfaces, EVE JSON output, and an actual non-broken log file under
`/var/log/suricata/`. Automatic firewall changes should use a persistent pf table
and anchor rather than loading an ad-hoc full ruleset.

### AEGIS hub — 10.30.30.10

Required: all four host IPs in `aegis_forwarder.local.conf`, separate company/pfSense
SSH identities with mode 0600, non-interactive access, Python `requests`, exact
Render API base ending in `/api`, matching ingest/admin keys, systemd supervision,
and tightly scoped sudoers commands. The checked-in config example documents these
items but cannot prove the deployed machine has them.

## Are the rules really working?

**Not proven from this environment.** Static flow is present:

`sensor log → forwarder POST → authenticated ingest → security_events insert →
evaluateEvent → active defense_rules match → defense_commands row → hub poll →
VM/pfSense executor → result update`.

For a real pass, production must show all of the following for one controlled lab
event without deleting data:

1. a sensor log line and HTTP 201 ingest response;
2. one corresponding `security_events` row;
3. the intended active rule, trigger type, severity and threshold;
4. exactly one command per intended target with an unambiguous claim owner;
5. an executed/failed result tied to that command;
6. the expected iptables/pf table state read back from the target;
7. SSE delivery and dashboard rendering of the same event/command identifiers;
8. an undo test performed only in the isolated lab and verified by read-back.

Until those observations are collected, the correct status is **code path exists,
live rule execution unverified**. TLS, SMTP/phishing and Snort-specific paths are
currently **not operational end to end**.

## Safe next test commands

Run these on the AEGIS hub, where the SSH keys and local config actually exist:

```bash
# Read-only topology/service/log/port checks. This does not insert test events.
bash /opt/aegis/scripts/src/check_connectivity.sh

# Syntax and fail-closed config tests on the downloaded repository copy.
python3 -m unittest scripts.tests.test_forwarder_config

# Database reachability only; does SELECT 1 and redacts all connection metadata.
pnpm --filter @workspace/db run check-db
```

Do not use the data-clearing script, `drizzle push --force`, firewall flush/export,
or an attack generator against production while performing readiness checks.
