# AEGIS Four-Server Lab — Setup, Sensors, Rules and Safe Demo

> Authorized GNS3 lab only. Commands are bounded/non-destructive. Keep all credentials local and out of screenshots/Git.

## 1. Topology and sensor ownership

| Node | IP | Service | Evidence |
|---|---:|---|---|
| Web | `10.10.10.10` | Apache/PHP | Suricata, Apache log, Fail2ban |
| DNS | `10.10.10.20` | BIND9 | Suricata, named log, Fail2ban |
| Customer DB | `10.20.20.10` | MySQL | Suricata, MySQL log, Fail2ban |
| LDAP | `10.20.20.20` | slapd | Suricata, syslog/slapd, Fail2ban |
| pfSense | `10.30.30.1` MGMT | firewall/IDS | Suricata EVE JSON |
| AEGIS Hub | `10.30.30.10` | collector/executor | forwarder + SSH |

## 2. pfSense Suricata installation and alerts

1. WebGUI → **System → Package Manager → Available Packages → Suricata → Install**.
2. **Services → Suricata → Global Settings**: enable ET Open and update rules.
3. Add the interface that actually sees attacker-to-server traffic (confirm with interface counters).
4. Enable EVE output and its `alert` event type.
5. Paste/enable `lab/pfsense-suricata/local.rules` as interface custom rules and restart only that Suricata interface.

pfSense is FreeBSD: do not run Ubuntu `apt` commands on it. Read-only verification:

```sh
find /var/log/suricata -type f -name eve.json -maxdepth 4 2>/dev/null
tail -n 5 /path/from/find/eve.json
pfctl -t EasyRuleBlockHosts -T show
```

Rule notes:

- `msg`: signature name shown by AEGIS.
- `flags:S,12`: SYN set while ACK/RST/FIN are unset.
- `flow:to_server,established`: inspect established client-to-server traffic.
- `http.uri`: normalized HTTP URI buffer; `pcre` is the attack-text pattern.
- `threshold ... count N,seconds S`: alert after N matching events within S seconds.
- `track by_src`: independent counter per source IP.
- `sid`: unique local rule ID; increment `rev` after editing.

Keep ET Open enabled. Local rules make the classroom examples deterministic, while ET Open supplies broader signatures. A connection burst is suspicious evidence—not proof of a successful password attack; the host log supplies that outcome.

## 3. VM install and host sensors

Run only the matching Ubuntu block:

```bash
# Web
sudo apt update && sudo apt install -y apache2 php libapache2-mod-php php-mysql fail2ban openssh-server rsync netcat-openbsd
# DNS
sudo apt update && sudo apt install -y bind9 bind9-utils dnsutils fail2ban openssh-server
# Customer DB
sudo apt update && sudo apt install -y mysql-server fail2ban openssh-server
# LDAP (then configure interactively)
sudo apt update && sudo apt install -y slapd ldap-utils fail2ban openssh-server
```

All four VMs:

```bash
sudo systemctl enable --now ssh fail2ban
sudo fail2ban-client status
```

Use Ubuntu's packaged `[sshd]` filter. Web login failures now write a structured marker to Apache error log. Configure its jail:

```bash
sudo tee /etc/fail2ban/filter.d/aegis-web-auth.conf >/dev/null <<'FILTER'
[Definition]
failregex = ^.*AEGIS_WEB_AUTH_FAIL src=<HOST> user=.*$
ignoreregex =
FILTER
sudo tee /etc/fail2ban/jail.d/aegis-web-auth.local >/dev/null <<'JAIL'
[aegis-web-auth]
enabled = true
port = http,https
filter = aegis-web-auth
logpath = /var/log/apache2/error.log
maxretry = 5
findtime = 60
bantime = 600
JAIL
sudo fail2ban-regex /var/log/apache2/error.log /etc/fail2ban/filter.d/aegis-web-auth.conf
sudo systemctl restart fail2ban
sudo fail2ban-client status aegis-web-auth
```

MySQL/slapd log formats vary by package version. Native AEGIS watchers still detect them. Do not enable a copied Fail2ban filter until `fail2ban-regex` proves it matches the real log and captures `<HOST>`; use the auto-defense/pfSense path as boundary enforcement.

## 4. Fix the Web white page

All repository PHP files pass syntax lint. A VM white page usually means incomplete deployment, missing PHP MySQL module, DNS/DB failure, permissions, or a hidden runtime error.

```bash
# Web VM
sudo apache2ctl configtest
sudo systemctl restart apache2
curl -i http://127.0.0.1/
sudo tail -n 50 /var/log/apache2/error.log   # keep this out of public screenshots
find /var/www/html -maxdepth 1 -type f -printf '%f\n' | sort
php -m | grep -Ei 'mysqli|pdo_mysql'
getent hosts db.goldenmyanmar.trading.com
nc -vz 10.20.20.10 3306
```

Deploy the current complete directory, not the stale old file list:

```bash
sudo rsync -a --delete ./lab/company-web-server/ /var/www/html/
sudo chown -R www-data:www-data /var/www/html
sudo find /var/www/html -type d -exec chmod 755 {} \;
sudo find /var/www/html -type f -exec chmod 644 {} \;
sudo tee /etc/apache2/conf-available/aegis-servername.conf >/dev/null <<'EOF2'
ServerName goldenmyanmar.trading.com
EOF2
sudo a2enconf aegis-servername
sudo systemctl reload apache2
```

Updated `db.php` returns a visible, non-secret HTTP 503 diagnostic instead of a blank response and puts only an error code in Apache's server log. Set DB values locally through server configuration; never commit them.

## 5. Fix `goldenmyanmar.trading.com` DNS

The old apex record incorrectly pointed the website name to DNS (`10.10.10.20`). The corrected zone points the apex to Web (`10.10.10.10`) while the named-server host stays on `.20`.

```bash
# DNS VM
sudo install -m 0644 lab/dns-server/db.goldenmyanmar.trading.com /etc/bind/db.goldenmyanmar.trading.com
sudo install -m 0644 lab/dns-server/named.conf.local /etc/bind/named.conf.local
sudo named-checkconf
sudo named-checkzone goldenmyanmar.trading.com /etc/bind/db.goldenmyanmar.trading.com
sudo systemctl restart bind9
sudo systemctl --no-pager --full status bind9

dig @10.10.10.20 goldenmyanmar.trading.com A +short
dig @10.10.10.20 web.goldenmyanmar.trading.com A +short
dig @10.10.10.20 db.goldenmyanmar.trading.com A +short
```

Expected apex/Web: `10.10.10.10`; DB: `10.20.20.10`. If direct `dig` works but the browser does not, set the client DNS to `10.10.10.20` or isolate name resolution with:

```bash
curl --resolve goldenmyanmar.trading.com:80:10.10.10.10 http://goldenmyanmar.trading.com/
```

pfSense must allow client → DNS UDP/TCP 53 and client → Web TCP 80. Do not disable the firewall as a fix.

## 6. DB and LDAP verification

```bash
# DB VM
sudo systemctl --no-pager status mysql
sudo ss -lntp | grep ':3306'
sudo mysql -e 'SHOW DATABASES;'
# Web VM; use an interactive prompt, never a password in a screenshot
mysql -h db.goldenmyanmar.trading.com -u gmuser -p -e 'SELECT 1'

# LDAP VM: correct three-component base DN
sudo systemctl --no-pager status slapd
sudo ss -lntp | grep ':389'
ldapsearch -x -H ldap://localhost -b 'dc=goldenmyanmar,dc=trading,dc=com' -s base dn
```

If slapd was installed with a different base, compare `slapcat -n 0` locally and back up the lab VM before reconfiguration. Do not blindly import an LDIF with a mismatched suffix.

## 7. Attack → sensor → block note

| Controlled demo | What detects it | Dashboard reason | What blocks it |
|---|---|---|---|
| Nmap SYN/service scan | Suricata ET/local SID | signature/SID/category/rule text if EVE supplies it | matching auto-defense → pfSense and/or VM queue |
| Web SQLi/XSS/traversal | Suricata HTTP + Apache access | URI signature and HTTP detail | matching auto-defense; Fail2ban is only for configured auth jail |
| Web login failures | Apache error marker + Fail2ban | jail/filter summary | Fail2ban local ban; AEGIS syncs observed block |
| DNS AXFR/recon | BIND named log + Suricata DNS | query/type/matched text | matching auto-defense pfSense rule |
| MySQL failure/burst | MySQL error + Suricata burst | username/source/matched evidence | validated jail or auto-defense pfSense/VM rule |
| LDAP invalid bind/enum | correlated slapd + Suricata | DN/error/matched evidence | validated jail or auto-defense pfSense/VM rule |
| SSH failures | auth.log + Fail2ban + Suricata | raw auth/jail evidence | Fail2ban; optional boundary rule |
| ICMP/SYN burst | Suricata threshold | SID/category/count behavior | explicit rate-limit/block rule only |

Detection does not itself imply blocking. An active dashboard defense rule must match type, severity and threshold. Prove a block using command result + target table/jail state + connection retest.

## 8. Kali demo tools and flag notes

Install only on the authorized Kali VM:

```bash
sudo apt update
sudo apt install -y nmap curl dnsutils hydra sqlmap nikto gobuster hping3 ldap-utils default-mysql-client
```

Use small, lab-created wordlists—not an uncontrolled password corpus.

### Nmap

```bash
nmap -sS -sV -T3 -p 22,53,80,389,3306 10.10.10.10 10.10.10.20 10.20.20.10 10.20.20.20
```

`-sS` SYN scan; `-sV` service/version probe; `-T3` conservative timing; `-p` only listed ports.

### Web

```bash
nikto -h http://10.10.10.10
gobuster dir -u http://10.10.10.10 -w ./demo-paths.txt -t 2
sqlmap -u 'http://10.10.10.10/customers.php?search=demo' --batch --level=1 --risk=1
```

Nikto `-h` selects host. Gobuster `dir` selects directory mode, `-u` URL, `-w` wordlist, `-t 2` two workers. SQLmap `-u` selects URL, `--batch` disables prompts, `--level=1` minimal tests, `--risk=1` low-impact payloads. Do not use `--dump` in the presentation.

### Bounded login failures

```bash
hydra -l demo-user -P ./demo-passwords.txt -t 1 -f ssh://10.10.10.10
```

`-l` one lab username; `-P` small local list; `-t 1` one parallel task; `-f` stop on a valid credential.

### DNS and LDAP

```bash
dig @10.10.10.20 goldenmyanmar.trading.com A
dig @10.10.10.20 goldenmyanmar.trading.com AXFR
ldapsearch -x -H ldap://10.20.20.20 -b 'dc=goldenmyanmar,dc=trading,dc=com' -s base dn
```

Dig `@server` queries it directly, `A` asks IPv4, and `AXFR` requests a zone transfer (expected refusal). LDAP `-x` is simple auth, `-H` URI, `-b` base, `-s base` only the base object.

### Bounded packet-rate demonstration

```bash
sudo hping3 -S -p 80 -c 30 -i u100000 10.10.10.10
```

`-S` SYN, `-p 80` destination port, `-c 30` stop after 30 packets, and `-i u100000` waits 0.1 s. Never use `--flood` in a classroom/shared environment.

## 9. End-to-end acceptance

1. Source log/EVE gets a new record.
2. Forwarder reports ingest 2xx.
3. Canonical event/detail table contains it.
4. Event Detail shows available sensor evidence.
5. Active rule name and per-target commands appear.
6. Agent result becomes `executed` or `failed`—never assumed.
7. Read-only target state confirms the block.
8. Connection fails while blocked and succeeds after authenticated unblock.
