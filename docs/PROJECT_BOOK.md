# AEGIS-SecureCompany SOC — Final Project Book

> **Final Computer Technology Project** · Presentation-ready edition · 2026-07-25
>
> **Runtime:** Web, DNS, Customer DB, LDAP, pfSense/Suricata, MikroTik R1, AEGIS Hub
>
> **Cloud:** Vercel frontend, Render API, Supabase PostgreSQL
> ဤစာတမ်းတွင် secret value နှင့် production-destructive command မပါဝင်ပါ။

## Abstract

AEGIS-SecureCompany သည် GNS3 company network အတွင်း Web, DNS, Customer Database နှင့် LDAP server များ၏ security logs ကို AEGIS Hub မှ စုစည်းပြီး cloud API သို့ပို့ကာ SOC dashboard တွင် real-time ပြသသည့် defensive monitoring system ဖြစ်သည်။ pfSense Suricata က network IDS၊ server တစ်လုံးချင်းရှိ Fail2ban နှင့် native logs က host evidence အဖြစ်လုပ်ဆောင်သည်။ Event များကို Supabase PostgreSQL တွင်သိမ်းပြီး Server-Sent Events (SSE) ဖြင့် browser သို့ live push လုပ်သည်။ Rule ကိုက်ညီလျှင် target-specific command queue မှတဆင့် **detect → validate → persist → evaluate → queue → claim → execute → verify → report** flow ဖြင့် block/unblock လုပ်သည်။

## 1. Objectives and Boundaries

### Objectives

1. Distributed security logs ကို centralized dashboard တွင်ကြည့်ရန်။
2. Suricata network evidence နှင့် server logs/Fail2ban action ကို correlation လုပ်ရန်။
3. Dynamic attacker IP ကို hard-code မလုပ်ဘဲ valid untrusted source အဖြစ်လက်ခံရန်။
4. Event, alert, connection detail နှင့် defense result ကို persistent audit trail ထားရန်။
5. Authenticated, reversible block/unblock နှင့် Fail2ban service control ပေးရန်။
6. API/SSH/browser disconnect နှင့် log rotation ကို resilient ဖြစ်စေရန်။

### Active scope

| Area | Component |
|---|---|
| Routing | MikroTik R1 |
| Firewall/network IDS | pfSense + Suricata |
| Public services | Company Web, DNS |
| Internal services | Customer DB (MySQL), LDAP (slapd) |
| Collection/execution | AEGIS Hub forwarder/agent |
| Host defense | Fail2ban on four company servers |
| Cloud | Vercel + Render + Supabase PostgreSQL |

### Out of scope

- Mail server, Cowrie honeypot, Incident page နှင့် encrypted-connection-log page မသုံးပါ။
- Replit ကို runtime/deployment အဖြစ်မသုံးပါ; code editing အတွက်သာဖြစ်သည်။
- Dashboard က packet capture appliance မဟုတ်ပါ; real sensor/log evidence လိုသည်။

## 2. System Architecture

```text
Dynamic Kali Attacker
        |
   MikroTik R1
        |
 pfSense + Suricata
   |        |           |
   |        |           +-- MGMT 10.30.30.0/24
   |        |                AEGIS Hub 10.30.30.10
   |        +-- INTERNAL 10.20.20.0/24
   |             Customer DB 10.20.20.10
   |             LDAP        10.20.20.20
   +-- DMZ 10.10.10.0/24
         Web 10.10.10.10
         DNS 10.10.10.20

Hub --HTTPS/keys--> Render API <--SSL SQL--> Supabase
Browser/Vercel --REST + SSE--> Render API
Hub <--admin command queue--> Render API
Hub --SSH collect/execute--> servers and pfSense
```

| Node | Address | Purpose |
|---|---:|---|
| pfSense WAN | `10.0.23.2` | R1-facing firewall interface |
| Web | `10.10.10.10` | Apache/PHP and web evidence |
| DNS | `10.10.10.20` | BIND9 lab DNS |
| Customer DB | `10.20.20.10` | MySQL service |
| LDAP | `10.20.20.20` | OpenLDAP/slapd |
| pfSense MGMT | `10.30.30.1` | firewall execution target |
| AEGIS Hub | `10.30.30.10` | collector/executor |

Attacker address ကို fixed subnet မသတ်မှတ်ပါ။ API သည် malformed, loopback, unspecified နှင့် defender-owned source များကိုစစ်ပြီး ကျန် valid source ကို event အဖြစ်ကိုင်တွယ်သည်။ Reachability ကို R1/pfSense routing rules ကဆုံးဖြတ်သည်။

## 3. Why These Technologies

- **MikroTik R1:** attacker network နှင့် pfSense WAN ကြား routing/NAT။
- **pfSense:** segmentation, policy enforcement နှင့် WAN block point။
- **Suricata:** packet/signature/flow-level IDS telemetry။
- **Fail2ban:** service/auth log pattern မှ local jail/action။
- **AEGIS Hub:** SSH remote tail, heartbeat, health နှင့် defense execution။
- **Express/TypeScript:** ingest/query/defense/auth/SSE boundary။
- **PostgreSQL/Drizzle:** relational, transactional audit history။
- **SSE:** server-to-browser updates အတွက် HTTP-native reconnect ရှိပြီး WebSocket ထက်ရှင်းလင်းသည်။

## 4. Sensors and Log Paths

| Target | Evidence | Default path |
|---|---|---|
| pfSense | Suricata EVE JSON | auto-discovered under `/var/log/suricata/` |
| Web | SSH / Apache / Fail2ban | `/var/log/auth.log`, `/var/log/apache2/access.log`, `/var/log/fail2ban.log` |
| DNS | BIND9 / SSH / Fail2ban | `/var/log/named/named.log` plus Ubuntu defaults |
| Customer DB | MySQL / SSH / Fail2ban | `/var/log/mysql/error.log` plus Ubuntu defaults |
| LDAP | slapd / SSH / Fail2ban | `/var/log/syslog` plus Ubuntu defaults |

`REMOTE_*` configuration ဖြင့် deployment အလိုက် path override လုပ်နိုင်သည်။ File ရှိရုံဖြင့် detection မအာမခံပါ; service logging, permissions, rotation နှင့် real traffic လိုသည်။ Remote tail သည် `tail -n 0 -F` သုံး၍ startup မတိုင်မီ history မပို့ဘဲ rotation/recreate ကို follow လုပ်သည်။

| Detection | Primary evidence | Secondary evidence |
|---|---|---|
| Nmap/scan | pfSense Suricata | target access logs |
| Web exploit | Suricata/Apache | Fail2ban jail if configured |
| DNS AXFR | BIND9 | Suricata DNS telemetry |
| MySQL auth attack | MySQL log | Fail2ban |
| LDAP invalid bind/enum | correlated slapd log | Fail2ban |
| SSH brute force | auth.log | Fail2ban ban |
| Block/unblock | agent result | target verification |

Suricata တစ်ခုတည်းက packet-visible alerts ပေးနိုင်သော်လည်း encrypted payload, application outcome, LDAP bind result သို့မဟုတ် Fail2ban action ကိုမသိနိုင်သဖြင့် network + host evidence နှစ်မျိုးလုံးလိုသည်။

## 5. Repository and Code Architecture

```text
artifacts/aegis-dashboard/       React/Vite UI and SSE client
artifacts/api-server/
  src/app.ts                    middleware and /api mount
  src/routes/index.ts           route composition
  src/routes/ingest.ts          sensor ingestion
  src/routes/stream.ts          SSE endpoint
  src/routes/defense*.ts        blocks and agent queue
  src/routes/ui-rules.ts        rules/service operations
  src/lib/auto-defense.ts       rule engine
  src/lib/broadcaster.ts        SSE client registry
lib/db/src/schema/              Drizzle schema source of truth
scripts/src/aegis_forwarder.py  collection and execution agent
scripts/src/check_connectivity.sh non-destructive lab diagnostics
```

### API startup and route flow

```text
Node start -> validate configuration -> Express middleware
 -> auth + /api router -> route auth/validation
 -> Drizzle/service logic -> optional SSE -> status/JSON response
```

Required credential များကို presence/validity သာစစ်ပြီး value မ log ရ။ Ingest key က sensor POST အတွက်၊ admin key က agent claim/result အတွက်၊ browser mutation က authenticated admin context အတွက်ဖြစ်သည်။

| Group | Active examples | Purpose |
|---|---|---|
| Liveness | `/api/ping`, `/api/healthz` | process/DB health |
| Read model | `/api/dashboard/summary`, `/api/events`, `/api/alerts` | UI hydration |
| Ingest | `POST /api/ingest/*` | forwarder input |
| SSE | `GET /api/events/stream` | live connection |
| Details | `/api/connections/{ssh,http-attacks,db-attacks,dns-attacks,ldap-attacks}` | categorized evidence |
| Defense | `/api/defense/*` | blocks/actions/settings/unblock |
| Rules | `/api/ui/defense/rules` | policy CRUD |
| Service control | `/api/ui/system/service-control` | queued Fail2ban control |
| Agent | `/api/defense/commands/pending`, `.../:id/result` | claim/report |

Active SSE path သည် `/api/events/stream` ဖြစ်သည်။ Old `/api/stream` wording ကို deployment/presentation တွင်မသုံးရ။

## 6. Ingest and Classification Flow

```text
Real activity -> service/EVE log -> Hub parser
 -> authenticated POST /api/ingest/<source>
 -> validate and classify source
 -> INSERT security_events
 -> optional specialized table + alert dedup/create
 -> evaluate auto-defense
 -> SSE security_event + stats_update
 -> non-2xx-aware response/retry
```

Reliability features:

- bounded retry/backoff for transient HTTP failures;
- non-2xx is never treated as success;
- alert/event deduplication reduces duplicate toasts;
- SSH tail reconnect loops and log rotation following;
- fail-closed URL/key/runtime validation.

Normalized rule families include `port_scan`, `ddos`, `web_attack`, `ssh_brute`, `db_attack`, `dns_attack`, `ldap_brute`, `ldap_enum`, `mitm`, and `any`. Classification သည် detection မဟုတ်ပါ; sensor evidence ထွက်ပြီးမှ category ပေးသည်။ Nmap event မပေါ်လျှင် **EVE alert → forwarder POST → DB row → SSE/UI** hop တစ်ခုချင်းစစ်ရမည်။

## 7. SSE Real-Time Flow

```text
Page opens -> REST loads recent DB rows
 -> EventSource connects /api/events/stream
 -> broadcaster registers client
 -> producer broadcasts named event
 -> use-sse listener invalidates/refetches query
 -> UI renders authoritative state
```

Named events: `security_event`, `stats_update`, `alert`, `defense_action`, `defense_result`, `host_status_change`, `service_status_change`။ Threat Map/Attack Flow သည် `/api/events` history ကို hydrate ပြီး SSE ကို merge လုပ်သဖြင့် browser ပြောင်း/reconnect လုပ်လည်း persisted rows ပြန်ရရမည်။ မရလျှင် DB insert, query filters/time range, API proxy နှင့် EventSource ကိုအစဉ်လိုက်စစ်ရမည်။

## 8. Auto-Defense, Block and Unblock

```text
event -> normalize category -> active rules by priority
 -> type/severity match -> threshold/window
 -> validate IP/action -> defense_action
 -> expand target=all into per-target defense_commands
 -> agent atomic claim -> allowlist/type validation
 -> SSH execute -> target verify -> result POST
 -> DB status + defense_result SSE
```

Pending claim သည် transaction + `FOR UPDATE SKIP LOCKED` + lease semantics ဖြင့် concurrent double-claim ကိုကာကွယ်သည်။ Unknown target ကို Hub local shell ပေါ် fallback execute မလုပ်ရ။ Command သည် server-generated sanitized action ဖြစ်ရမည်။

- **Fail2ban block:** VM jail/action အမှန်တကယ် configured ဖြစ်ရမည်။
- **pfSense WAN block:** source ကို pfSense block table/rule ထည့်ပြီး target state/counter နှင့် traffic retest စစ်ရမည်။ DB status တစ်ခုတည်းမလုံလောက်ပါ။
- **Unblock:** undo command queue → execution → target verification → result update ပြီးမှ effective ဖြစ်သည်။
- **Fail2ban on/off:** allowed VM သို့ start/stop/restart queue လုပ်ပြီး systemd result နှင့် heartbeat ကိုတိုက်စစ်သည်။

### Manual firewall backup path

Auto-defense rule မကိုက်ခြင်း သို့မဟုတ် suggested/manual response လိုအပ်ခြင်းအတွက် admin သည် Defense Rules → Firewall Rules မှ sanitized iptables rule ကို add/remove လုပ်နိုင်သည်။ `firewall.ts` ကို ဖျက်ခဲ့ခြင်းသည် feature ကိုဖျက်ခြင်းမဟုတ်ပါ။ ယခင် `/api/firewall/*` route သည် တူညီသော implementation ကို duplicate ထားပြီး browser-auth boundary မတူနိုင်သောကြောင့် consolidated `/api/ui/firewall/rules` route တစ်ခုတည်းထားခြင်းဖြစ်သည်။ Add/remove တစ်ကြိမ်လျှင် company server လေးလုံးအတွက် target-specific queue row လေးခုဖန်တီးပြီး command history တွင် execution result တစ်လုံးချင်းစစ်နိုင်သည်။ Export file သည် additive ဖြစ်ပြီး existing firewall policy ကို `flush` မလုပ်ပါ။

Detection rule နှင့် defense rule သည် သီးခြားဖြစ်သည်။ Event detail တွင် attack name/subtype, Suricata SID/revision/category/action, `signatureText` သို့မဟုတ် Fail2ban/native matched text ကို available ဖြစ်သလောက်ပြသည်။ ထို event ကြောင့် defense rule fire ဖြစ်ပါက Defense Actions panel တွင် defense rule name, target VM, block command, undo command, queue/execution status နှင့် error ကိုဆက်စပ်ပြသည်။ Sensor/EVE payload တွင် full rule text မပါလျှင် dashboard က မရှိသော text ကိုတီထွင်မပြဘဲ signature name/SID/category သာပြနိုင်သည်။

False-positive safeguards: defender/invalid IP guard, type/severity match, threshold/window, rule priority, suggest/manual mode, reversible action နှင့် operator audit။

## 9. Database Model

| Table | Purpose |
|---|---|
| `security_events` | normalized event feed |
| `alerts` | operator alerts/acknowledgement |
| `ssh_sessions`, `http_attacks`, `db_attacks`, `dns_attacks`, `ldap_attacks` | specialized evidence |
| `blocked_ips` | known block state |
| `defense_rules` | policy |
| `defense_actions` | decision audit |
| `defense_commands` | per-target queue/results |
| `attack_counters` | threshold window |
| `system_status`, `network_hosts` | health/inventory |
| `firewall_rules` | dashboard-managed structured rules |

Legacy schema objects may remain for migration compatibility, but removed UI features are not active scope. Production schema change ကို reviewed migration ဖြင့်သာလုပ်ပြီး destructive ad-hoc SQL မသုံးရ။

## 10. Dashboard Pages

| Page | Purpose |
|---|---|
| Command Center | totals, charts, recent threats |
| Security Events / Alerts | event feed and priority workflow |
| System / Network | sensor health and host inventory |
| Defense / Defense Rules | blocks, actions, service control, policy |
| Connections | SSH/Web/DB/DNS/LDAP evidence |
| Reports | persistent audit summaries |
| Attack Flow | recent history + live source-to-target view |
| Settings | operational integrations |

Incident and encrypted-connection routes/pages are intentionally absent.

## 11. Security and Reliability Controls

- `.env`/local key files must not be committed; audit prints only SET/MISSING.
- Ingest/admin/session/DB/integration credentials have separate privilege boundaries.
- Browser mutations, agent queue and ingest routes use appropriate auth.
- IP/action parameters and targets are validated before command construction.
- API retry, SSH reconnect, `tail -F`, DB hydration and stale-sensor detection cover common failures.
- Long API outage can still lose events without a durable local spool; this is future work.
- “command executed” and “traffic blocked” are separate acceptance criteria.

## 12. Non-Destructive Verification Plan

```bash
pnpm run typecheck
pnpm run build
python3 -m unittest discover -s scripts/tests -p 'test_*.py'
python3 -m py_compile scripts/src/aegis_forwarder.py
bash -n scripts/src/check_connectivity.sh
git diff --check
```

| Live test | Acceptance evidence |
|---|---|
| Nmap | EVE alert, ingest 2xx, DB event, UI feed |
| Web | Suricata/Apache evidence and `http_attacks` |
| DNS AXFR | BIND evidence and `dns_attacks` |
| MySQL invalid login | MySQL/Fail2ban and `db_attacks` |
| LDAP invalid bind | DN/result and `ldap_attacks` |
| Auto block | rule, claimed/executed command, target verify |
| Unblock | inverse action and restored traffic |
| Browser change | DB history rehydrates |
| API restart | ping recovers and retries clear |

Lab-designated targets only သုံးရမည်။ Production/third-party address ကို destructive test မလုပ်ရ။

## 13. Demonstration Story

1. Attacker → R1 → pfSense → segmented services topology ကိုရှင်းပြပါ။
2. System Status တွင် active sensors/health ပြပါ။
3. Approved Nmap/test event တစ်ခု generate လုပ်ပါ။
4. Log, event classification, DB-backed feed ကိုပြပါ။
5. Rule match, target queue နှင့် result ကိုပြပါ။
6. pfSense/Fail2ban state + traffic retest ဖြင့် block verify လုပ်ပါ။
7. Authenticated unblock နှင့် restoration ကိုပြပါ။
8. Browser refresh/change ပြီး Threat Map history ပြန်တက်ကြောင်းပြပါ။

## 14. Common Viva Answers

**Suricata vs Fail2ban?** Suricata က network packet/flow IDS; Fail2ban က host log ကိုဖတ်၍ local firewall action လုပ်သည်။

**Why SSE?** Server-to-browser update အဓိကဖြစ်လို့ HTTP-native reconnect ပါသော SSE လုံလောက်ပြီး bidirectional mutations ကို REST နဲ့လုပ်သည်။

**Attacker IP changes?** Fixed Kali IP မသုံးပါ။ Runtime valid untrusted source ကိုယူပြီး defender/invalid source ကို guard လုပ်သည်။

**How prove block?** Queue result + target table/jail state + connection retest သုံးခုလိုသည်။

**API down?** Bounded retry ရှိသော်လည်း long outage အတွက် durable disk spool သည် future improvement ဖြစ်သည်။

**Browser change?** Supabase DB က history source; REST hydrate ပြီး SSE live updates ဆက်ယူသည်။

**False positives?** source guard, type/severity, threshold/window, priority, suggest mode and rollback သုံးသည်။

**100% secure?** မဟုတ်ပါ။ Coverage သည် rules, visibility, credentials, sensor uptime နှင့် operator response အပေါ်မူတည်သည်။

## 15. Future Work and Conclusion

Future work: durable forwarder spool/replay ID, Suricata tuning tests, queue dead-letter metrics, end-to-end integration tests, RBAC/key rotation, TLS monitoring နှင့် API/SSE/sensor observability။

AEGIS-SecureCompany သည် four-server segmented lab ကို network IDS, host evidence, cloud persistence, real-time visualization နှင့် reversible defense queue ဖြင့်ပေါင်းထားသည့် Computer Technology final project ဖြစ်သည်။ တန်ဖိုးသည် chart များထက် evidence ကို reliable flow ဖြင့်စုခြင်း၊ privileges ခွဲခြင်း၊ block/unblock result ကို audit လုပ်ခြင်းနှင့် limitation များကိုတိကျစွာရှင်းပြနိုင်ခြင်းတွင်ရှိသည်။ Presentation script ကို `docs/PRESENTATION_GUIDE.md` နှင့် developer flow ကို `docs/code-flow.md` တွင်ဆက်ဖတ်နိုင်သည်။

Four-server installation, pfSense local alert rules, Web/DNS troubleshooting, sensor-to-block matrix နှင့် bounded classroom attack commands များအတွက် `lab/SYSTEM_SETUP_AND_DEMO_GUIDE.md` ကို authoritative lab runbook အဖြစ်သုံးပါ။

## Appendix A — Four-Server Installation, Paths and Git Links

ဤ appendix သည် လက်ရှိ active scope ဖြစ်သော Web, DNS, Customer DB နှင့် LDAP server လေးလုံးအတွက် copy-and-run setup reference ဖြစ်သည်။ FTP နှင့် Cowrie မပါဝင်ပါ။

### A.1 Repository and runtime paths

- Repository: `https://github.com/sohu2723-star/aegis-soc-dashboard`
- Raw file base: `https://raw.githubusercontent.com/sohu2723-star/aegis-soc-dashboard/main`
- Complete lab runbook: `lab/SYSTEM_SETUP_AND_DEMO_GUIDE.md`
- Web source: `lab/company-web-server/`
- DNS source: `lab/dns-server/`
- LDAP source: `lab/ldap-server/`
- Forwarder source: `scripts/src/aegis_forwarder.py`
- Hub runtime: `/opt/aegis/scripts/src/`
- Apache document root: `/var/www/html/`
- BIND configuration: `/etc/bind/named.conf.local`
- BIND zone: `/etc/bind/db.goldenmyanmar.trading.com`
- Common MySQL configuration: `/etc/mysql/mysql.conf.d/mysqld.cnf`
- Restricted sudo rule: `/etc/sudoers.d/aegis-defense`

Server VM များတွင် repository အပြည့် clone ရန်မလိုပါ။ လိုအပ်သော raw files များကိုသာ `wget` ဖြင့်ယူပါ။ Machine-specific secrets ပါသော `/opt/aegis/scripts/src/aegis_forwarder.local.conf` ကို download ဖြင့် overwrite မလုပ်ရ။

### A.2 Address and service plan

| Server | IP | Service | Required connectivity |
|---|---:|---|---|
| Web | `10.10.10.10` | Apache/PHP TCP 80 | DNS 53; Customer DB 3306 |
| DNS | `10.10.10.20` | BIND9 UDP/TCP 53 | All trusted lab clients → DNS |
| Customer DB | `10.20.20.10` | MySQL TCP 3306 | Web `10.10.10.10` → DB only |
| LDAP | `10.20.20.20` | slapd TCP 389 | Trusted lab clients → LDAP |
| AEGIS Hub | `10.30.30.10` | Forwarder/SSH | Hub → four VMs TCP 22; Render TCP 443 |

VM တိုင်းတွင် address နှင့် pfSense route ကိုအရင်စစ်ပါ။

```bash
hostname
ip -br address
ip route
```

### A.3 Common host preparation

Server လေးလုံးစလုံးတွင်:

```bash
sudo apt update
sudo apt install -y openssh-server fail2ban curl wget dnsutils netcat-openbsd
sudo systemctl enable --now ssh fail2ban
sudo systemctl is-active ssh fail2ban
```

Dashboard မှ Fail2ban start/stop/restart အတွက် unrestricted `NOPASSWD:ALL` မသုံးဘဲ exact commands များကိုသာ allow လုပ်ပါ။

```bash
printf '%s\n' \
 'sithu ALL=(root) NOPASSWD: /usr/bin/systemctl start fail2ban, /usr/bin/systemctl stop fail2ban, /usr/bin/systemctl restart fail2ban, /usr/bin/systemctl is-active fail2ban' \
 | sudo tee /tmp/aegis-defense >/dev/null
sudo visudo -cf /tmp/aegis-defense
sudo install -o root -g root -m 0440 /tmp/aegis-defense /etc/sudoers.d/aegis-defense
sudo visudo -c
sudo -n /usr/bin/systemctl is-active fail2ban
```

### A.4 DNS Server setup (`10.10.10.20`)

```bash
sudo apt update
sudo apt install -y bind9 bind9utils dnsutils fail2ban
sudo systemctl enable --now bind9
cd /tmp
wget -O named.conf.local https://raw.githubusercontent.com/sohu2723-star/aegis-soc-dashboard/main/lab/dns-server/named.conf.local
wget -O db.goldenmyanmar.trading.com https://raw.githubusercontent.com/sohu2723-star/aegis-soc-dashboard/main/lab/dns-server/db.goldenmyanmar.trading.com
test -s named.conf.local && test -s db.goldenmyanmar.trading.com
sudo cp -a /etc/bind/named.conf.local /etc/bind/named.conf.local.backup
sudo install -o root -g bind -m 0644 named.conf.local /etc/bind/named.conf.local
sudo install -o root -g bind -m 0644 db.goldenmyanmar.trading.com /etc/bind/db.goldenmyanmar.trading.com
sudo named-checkconf
sudo named-checkzone goldenmyanmar.trading.com /etc/bind/db.goldenmyanmar.trading.com
sudo systemctl restart bind9
sudo systemctl is-active bind9
```

```bash
dig @127.0.0.1 goldenmyanmar.trading.com A +short
dig @127.0.0.1 web.goldenmyanmar.trading.com A +short
dig @127.0.0.1 db.goldenmyanmar.trading.com A +short
dig @127.0.0.1 ldap.goldenmyanmar.trading.com A +short
```

Expected addresses အစဉ်လိုက်မှာ `10.10.10.10`, `10.10.10.10`, `10.20.20.10`, `10.20.20.20` ဖြစ်သည်။ `allow-transfer { none; };` ကို shared lab တွင် မပိတ်ရ။

### A.5 Customer DB setup (`10.20.20.10`)

```bash
sudo apt update
sudo apt install -y mysql-server fail2ban wget
sudo systemctl enable --now mysql
cd /tmp
wget -O setup.sql https://raw.githubusercontent.com/sohu2723-star/aegis-soc-dashboard/main/lab/company-web-server/setup.sql
test -s setup.sql
sudo mysqldump --all-databases > "$HOME/mysql-before-aegis-$(date +%F-%H%M).sql"
sudo mysql < /tmp/setup.sql
sudo mysql -e 'SHOW DATABASES;'
```

Active MySQL configuration (အများအားဖြင့် `/etc/mysql/mysql.conf.d/mysqld.cnf`) တွင် `bind-address = 10.20.20.10` ထားပြီး:

```bash
sudo mysqld --validate-config
sudo systemctl restart mysql
sudo systemctl is-active mysql
sudo ss -lntp | grep ':3306'
```

pfSense/host firewall တွင် TCP 3306 ကို Web Server `10.10.10.10` မှသာ allow လုပ်ပါ။ Web VM မှ reachability စစ်ရန်:

```bash
nc -vz 10.20.20.10 3306
```

Passwords များကို command line, screenshot သို့မဟုတ် documentation ထဲ မထည့်ရ။

### A.6 LDAP setup (`10.20.20.20`)

```bash
sudo apt update
sudo apt install -y slapd ldap-utils fail2ban
sudo systemctl enable --now slapd
sudo systemctl is-active slapd
sudo slapcat -n 0 | grep olcSuffix
sudo ss -lntp | grep ':389'
ldapsearch -x -H ldap://127.0.0.1 \
 -b 'dc=goldenmyanmar,dc=trading,dc=com' -s base dn
```

Authoritative suffix သည် `dc=goldenmyanmar,dc=trading,dc=com` ဖြစ်ပြီး search result သည် `result: 0 Success` ဖြစ်ရမည်။ Suffix မှားလျှင် backup မရှိဘဲ populated LDAP ကို reconfigure မလုပ်ရ။

### A.7 Web Server setup (`10.10.10.10`)

```bash
sudo apt update
sudo apt install -y apache2 php php-mysqli libapache2-mod-php wget
sudo systemctl enable --now apache2
mkdir -p /tmp/gmportal
cd /tmp/gmportal
for f in index.php db.php nav.php dashboard.php customers.php accounts.php orders.php products.php transactions.php logout.php style.css; do
  wget -q "https://raw.githubusercontent.com/sohu2723-star/aegis-soc-dashboard/main/lab/company-web-server/$f" -O "$f"
  test -s "$f" || { echo "download failed: $f"; exit 1; }
done
```

Existing Web root ကို backup လုပ်ပြီး deploy ပါ:

```bash
sudo tar -C /var/www -czf "$HOME/web-root-before-aegis-$(date +%F-%H%M).tgz" html
sudo rm -f /var/www/html/index.html
sudo install -o www-data -g www-data -m 0644 /tmp/gmportal/* /var/www/html/
sudo find /var/www/html -type d -exec chmod 0755 {} \;
sudo apache2ctl configtest
sudo systemctl restart apache2
curl -I http://127.0.0.1/
```

Portal URL သည် `/` သို့မဟုတ် `/index.php` ဖြစ်ပြီး `/login.php` မရှိပါ။ Web VM ကို internal DNS သုံးခိုင်းရန်:

```bash
IFACE=$(ip route | awk '/default/{print $5; exit}')
sudo resolvectl dns "$IFACE" 10.10.10.20
sudo resolvectl domain "$IFACE" '~goldenmyanmar.trading.com'
sudo resolvectl flush-caches
getent hosts goldenmyanmar.trading.com db.goldenmyanmar.trading.com
nc -vz 10.20.20.10 3306
curl -I http://goldenmyanmar.trading.com/
```

DNS ကို persistent လုပ်ရန် existing `/etc/netplan/*.yaml` ထဲရှိ active interface အောက်တွင် `nameservers: addresses: [10.10.10.20]` ထည့်ပါ။ Existing static address/routes နှင့် YAML indentation ကိုထိန်းပြီး `sudo netplan try` အရင် run ကာ `sudo netplan apply` ဆက်လုပ်ပါ။

### A.8 AEGIS Hub update and acceptance

Hub paths:

```text
/opt/aegis/scripts/src/aegis_forwarder.py
/opt/aegis/scripts/src/aegis_forwarder.local.conf
/opt/aegis/scripts/src/aegis_forwarder.local.conf.example
/opt/aegis/scripts/src/check_connectivity.sh
```

Forwarder code ကိုသာ update လုပ်ပါ:

```bash
sudo wget -O /opt/aegis/scripts/src/aegis_forwarder.py https://raw.githubusercontent.com/sohu2723-star/aegis-soc-dashboard/main/scripts/src/aegis_forwarder.py
sudo python3 -m py_compile /opt/aegis/scripts/src/aegis_forwarder.py
sudo systemctl restart aegis-forwarder
sudo systemctl --no-pager --full status aegis-forwarder
```

Final acceptance:

```bash
dig @10.10.10.20 goldenmyanmar.trading.com A +short
curl -I http://10.10.10.10/
curl -I http://goldenmyanmar.trading.com/
nc -vz 10.20.20.10 3306
nc -vz 10.20.20.20 389
sudo systemctl is-active fail2ban
sudo visudo -c
sudo systemctl is-active aegis-forwarder
sudo journalctl -u aegis-forwarder -n 50 --no-pager
```

Acceptance သည် DNS/HTTP/TCP reachability တင်မဟုတ်ဘဲ application login, sensor log, authenticated ingest, dashboard event, command queue result နှင့် target-side defense state အထိ verify လုပ်မှ ပြည့်စုံသည်။
