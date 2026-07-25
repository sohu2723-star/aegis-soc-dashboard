# AEGIS Function Effectiveness Audit — 2026-07-25

## Verdict

Static code paths now build and the highest-confidence correctness defects found
in the parallel audit were repaired. This does **not** prove that every live lab
function is effective: pfSense rules, VM iptables, Fail2ban jails, active
Suricata rules/logs, Render secrets, Supabase rows and packet reachability require
evidence from the private lab.

## Function matrix

| Function | Static status | Live proof needed |
|---|---|---|
| pfSense Suricata alert ingest | Ready with caveats | Active interfaces/rules, current EVE path, controlled alert |
| Nmap classification | Ready when Suricata emits an alert | EVE `event_type=alert` containing scan/Nmap signature |
| Web payload detection | Depends on Suricata HTTP rules | Controlled HTTP attack; HTTPS payload is opaque without termination |
| Web login breach | Fixed: requires at least 3 prior 401/403 records | Real application authentication outcome |
| SSH/Fail2ban | Jail-aware classification and observed block inventory | Active jail, ban record and `fail2ban-client status` |
| DNS | Partial: AXFR/IXFR plus refused/error threshold | Real BIND log format/config; tunneling/amplification not implemented |
| MySQL | Auth failures only are credible from error log | MySQL logging config; SQL query audit source for deeper coverage |
| LDAP | IPv4 ACCEPT/BIND/RESULT correlation implemented | slapd loglevel/rsyslog and real sample records |
| Auto-defense matching | Code path exists; active rules required | Production rule metadata and controlled threshold test |
| VM host block | Queued iptables action | Per-target command result and `iptables -C` read-back |
| pfSense WAN block | Uses EasyRule + table membership read-back | `EasyRuleBlockHosts` membership and packet test |
| Unblock | Queued; effective state changes after confirmed result | Table/iptables/Fail2ban absence read-back |
| Fail2ban on/off | Allowlisted per four company servers | `systemctl is-active fail2ban` after command result |
| SSE alerts | Event stream builds and connects | Production reconnect/restart test; replay cursor still absent |
| Threat Map | DB event hydration plus execution-result events | Cross-browser defense/Telegram history remains incomplete |

## Repairs made during this audit

1. Forwarder ingest now retries transient failures three times, accepts all 2xx
   responses, and does not print response bodies that may contain sensitive data.
   A durable disk spool is still recommended for long outages.
2. Remote and pfSense tails use `tail -n 0 -F`, preventing the default ten-line
   replay on reconnect. pfSense fallback chooses the most recently modified EVE
   instance instead of a lexicographic PID path.
3. Dynamic attackers are accepted outside only the known defender/NAT ranges;
   unrelated `10/8` sources are no longer blanket-dropped.
4. Clean web login responses no longer become breach events unless the same IP
   has at least three prior authentication failures.
5. Fail2ban jails map to SSH, web, DB, LDAP or FTP attack categories. Observed
   bans are represented in the active block inventory with their jail identity.
6. Fail2ban unblocks use `fail2ban-client set <jail> unbanip <ip>` on the original
   target. pfSense unblocks delete from `EasyRuleBlockHosts`; they no longer add a
   broad pass rule.
7. pfSense blocks verify table membership after EasyRule execution. The unsafe
   partial `pfctl -f -` port-block implementation is disabled.
8. Unblock and auto-defense-setting mutations now require a valid admin JWT.
   Unblock returns queued status and DB effective state changes only after a
   successful agent result.
9. Command results reject stale/non-sent updates and broadcast explicit
   `defense_result` events. Threat Map distinguishes queued, executed and failed
   commands instead of drawing a queued command as a successful block.
10. `targetVm=all` auto-defense is expanded to per-target command rows. Unknown
    forwarder targets fail closed instead of executing locally as root.
11. Service control uses a strict four-server target allowlist and validates
    service-to-server compatibility.
12. Network inventory online/offline changes no longer queue hidden firewall
    blocks; blocking is restricted to Fail2ban and active auto-defense rules.
13. The unauthenticated legacy `POST /events` bypass was removed. Dashboard speed
    testing was reduced from every 10 seconds to every 60 seconds.

## Remaining blockers to a full effectiveness claim

- The executor still accepts command text and uses shell/sudo. Replace it with
  typed actions, executor-side argv allowlists and restricted sudoers.
- A claimed command has no lease/attempt/dead-letter mechanism. Agent death can
  leave it in `sent` permanently.
- Auto-defense threshold counters are process-local and reset on Render restart.
- `blocked_ips` can describe desired state before every multi-target block has
  completed. A parent action plus per-target execution table is the correct model.
- The SSE broadcaster is process-local and has no event ID/Last-Event-ID replay.
- Long API outages can still exceed the three forwarder retries; a durable spool
  and ingest idempotency key are required for lossless delivery.
- DNS tunneling/amplification, MySQL query auditing, LDAP IPv6/journald formats
  and HTTPS payload inspection are not complete.
- Existing active rules are data, not source code. No rule works if production
  `defense_rules` contains no appropriate active rows.

## Required controlled live evidence (no secret values)

For one disposable attacker IP, capture only status/IDs and redacted log lines:

1. Suricata EVE alert and active EVE file path.
2. Forwarder accepted POST status.
3. `security_events` ID and matching active rule metadata.
4. Per-target command IDs and `pending → sent → executed/failed` transitions.
5. VM `iptables -C` and pfSense `EasyRuleBlockHosts` membership after block.
6. Packet reachability failure after block.
7. Unblock command result, rule/table absence and restored reachability.
8. Fail2ban start/stop command result plus `systemctl is-active` read-back.
