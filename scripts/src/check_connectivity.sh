#!/usr/bin/env bash
# ============================================================
# AEGIS Lab — Full Connectivity Checker
# Run on aegis-company-admin (10.30.30.10) as sithu
#
#   chmod +x check_connectivity.sh
#   ./check_connectivity.sh
#
# Checks all 6 hosts:
#   company-web-server  10.10.10.10
#   company-dns-server  10.10.10.20
#   company-customer-db 10.20.20.10
#   company-ldap-server 10.20.20.20
#   aegis-company-admin 10.30.30.10 (self)
#   pfSense             10.30.30.1
# ============================================================

set -euo pipefail

SSH_KEY="${HOME}/.ssh/aegis_id_rsa"
PF_KEY="${HOME}/.ssh/pfsense_key"
SSH_USER="sithu"
PF_USER="admin"

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

ok()   { echo -e "  ${GREEN}✅ $*${NC}"; }
fail() { echo -e "  ${RED}❌ $*${NC}"; }
warn() { echo -e "  ${YELLOW}⚠️  $*${NC}"; }
info() { echo -e "  ${CYAN}ℹ  $*${NC}"; }

hdr()  { echo -e "\n${BOLD}═══ $* ═══${NC}"; }
sub()  { echo -e "\n${BOLD}─── $* ───${NC}"; }

ssh_cmd() {
    local key="$1" user="$2" ip="$3"
    shift 3
    ssh -i "$key" -o BatchMode=yes -o StrictHostKeyChecking=no \
        -o ConnectTimeout=5 "${user}@${ip}" "$@" 2>/dev/null
}

ssh_ok() {
    local key="$1" user="$2" ip="$3" label="$4"
    if ssh_cmd "$key" "$user" "$ip" echo "ok" >/dev/null 2>&1; then
        ok "SSH $label ($user@$ip) — passwordless OK"
        return 0
    else
        fail "SSH $label ($user@$ip) — FAILED"
        return 1
    fi
}

ping_ok() {
    local ip="$1" label="$2"
    if ping -c 1 -W 2 "$ip" >/dev/null 2>&1; then
        ok "Ping $label ($ip)"
    else
        fail "Ping $label ($ip) — unreachable"
    fi
}

check_port() {
    local ip="$1" port="$2" label="$3"
    if nc -zw 3 "$ip" "$port" 2>/dev/null; then
        ok "Port $port open on $label ($ip)"
    else
        fail "Port $port CLOSED on $label ($ip)"
    fi
}

check_service() {
    local key="$1" user="$2" ip="$3" svc="$4" label="$5"
    local status
    status=$(ssh_cmd "$key" "$user" "$ip" "systemctl is-active $svc 2>/dev/null" || echo "error")
    case "$status" in
        active)   ok  "Service $svc — active ($label)" ;;
        inactive) warn "Service $svc — inactive ($label)" ;;
        *)        fail "Service $svc — $status ($label)" ;;
    esac
}

check_log_exists() {
    local key="$1" user="$2" ip="$3" path="$4" label="$5"
    local result
    result=$(ssh_cmd "$key" "$user" "$ip" "[ -f '$path' ] && echo exists || echo missing" || echo "ssh_error")
    case "$result" in
        exists)    ok  "Log exists: $path ($label)" ;;
        missing)   warn "Log MISSING: $path ($label) — may need service config" ;;
        ssh_error) fail "SSH error checking $path ($label)" ;;
    esac
}

check_iptables() {
    local key="$1" user="$2" ip="$3" label="$4"
    echo ""
    info "iptables INPUT rules on $label:"
    ssh_cmd "$key" "$user" "$ip" "sudo iptables -L INPUT -n --line-numbers 2>/dev/null | head -20" \
        | sed 's/^/    /' || warn "Could not read iptables (sudo may need NOPASSWD)"
}

check_fail2ban_status() {
    local key="$1" user="$2" ip="$3" label="$4"
    local bans
    bans=$(ssh_cmd "$key" "$user" "$ip" \
        "sudo fail2ban-client status 2>/dev/null | grep 'Jail list' || echo 'n/a'" || echo "error")
    if [[ "$bans" == "error" || "$bans" == "n/a" ]]; then
        warn "Fail2ban status unavailable ($label)"
    else
        ok "Fail2ban jails ($label): $bans"
    fi
}

# ──────────────────────────────────────────────────────────────
hdr "AEGIS Lab Connectivity Check — $(date '+%Y-%m-%d %H:%M:%S')"
# ──────────────────────────────────────────────────────────────


# ──────────────────────────────────────────────────────────────
sub "1. PING REACHABILITY (from aegis-company-admin)"
# ──────────────────────────────────────────────────────────────
ping_ok 10.10.10.10 "company-web-server"
ping_ok 10.10.10.20 "company-dns-server"
ping_ok 10.20.20.10 "company-customer-db"
ping_ok 10.20.20.20 "company-ldap-server"
ping_ok 10.30.30.1  "pfSense MGMT"
ping_ok 8.8.8.8     "Internet (Google DNS)"


# ──────────────────────────────────────────────────────────────
sub "2. SSH PASSWORDLESS AUTH (all 6 hosts)"
# ──────────────────────────────────────────────────────────────
ssh_ok "$SSH_KEY" "$SSH_USER" 10.10.10.10 "company-web-server"
ssh_ok "$SSH_KEY" "$SSH_USER" 10.10.10.20 "company-dns-server"
ssh_ok "$SSH_KEY" "$SSH_USER" 10.20.20.10 "company-customer-db"
ssh_ok "$SSH_KEY" "$SSH_USER" 10.20.20.20 "company-ldap-server"
ssh_ok "$PF_KEY"  "$PF_USER"  10.30.30.1  "pfSense"


# ──────────────────────────────────────────────────────────────
sub "3. PORT CHECK (key service ports)"
# ──────────────────────────────────────────────────────────────
# company-web-server
check_port 10.10.10.10 22  "company-web-server (SSH)"
check_port 10.10.10.10 80  "company-web-server (HTTP)"

# company-dns-server
check_port 10.10.10.20 22  "company-dns-server (SSH)"
check_port 10.10.10.20 53  "company-dns-server (DNS)"

# company-customer-db
check_port 10.20.20.10 22   "company-customer-db (SSH)"
check_port 10.20.20.10 3306 "company-customer-db (MySQL)"

# company-ldap-server
check_port 10.20.20.20 22  "company-ldap-server (SSH)"
check_port 10.20.20.20 389 "company-ldap-server (LDAP)"

# pfSense
check_port 10.30.30.1 22  "pfSense (SSH)"
check_port 10.30.30.1 443 "pfSense (WebGUI HTTPS)"


# ──────────────────────────────────────────────────────────────
sub "4. SERVICE STATUS (systemctl is-active)"
# ──────────────────────────────────────────────────────────────
# company-web-server
check_service "$SSH_KEY" "$SSH_USER" 10.10.10.10 apache2   "company-web-server"
check_service "$SSH_KEY" "$SSH_USER" 10.10.10.10 fail2ban  "company-web-server"
check_service "$SSH_KEY" "$SSH_USER" 10.10.10.10 ssh       "company-web-server"

# company-dns-server
check_service "$SSH_KEY" "$SSH_USER" 10.10.10.20 named     "company-dns-server"
check_service "$SSH_KEY" "$SSH_USER" 10.10.10.20 fail2ban  "company-dns-server"

# company-customer-db
check_service "$SSH_KEY" "$SSH_USER" 10.20.20.10 mysql     "company-customer-db"
check_service "$SSH_KEY" "$SSH_USER" 10.20.20.10 fail2ban  "company-customer-db"

# company-ldap-server
check_service "$SSH_KEY" "$SSH_USER" 10.20.20.20 slapd     "company-ldap-server"
check_service "$SSH_KEY" "$SSH_USER" 10.20.20.20 fail2ban  "company-ldap-server"


# ──────────────────────────────────────────────────────────────
sub "5. LOG PATH EXISTENCE (critical log files)"
# ──────────────────────────────────────────────────────────────
# company-web-server
check_log_exists "$SSH_KEY" "$SSH_USER" 10.10.10.10 "/var/log/auth.log"              "company-web-server"
check_log_exists "$SSH_KEY" "$SSH_USER" 10.10.10.10 "/var/log/fail2ban.log"           "company-web-server"
check_log_exists "$SSH_KEY" "$SSH_USER" 10.10.10.10 "/var/log/apache2/access.log"     "company-web-server"

# company-dns-server
check_log_exists "$SSH_KEY" "$SSH_USER" 10.10.10.20 "/var/log/auth.log"              "company-dns-server"
check_log_exists "$SSH_KEY" "$SSH_USER" 10.10.10.20 "/var/log/fail2ban.log"           "company-dns-server"
check_log_exists "$SSH_KEY" "$SSH_USER" 10.10.10.20 "/var/log/named/named.log"        "company-dns-server [BIND9 — needs logging config]"

# company-customer-db
check_log_exists "$SSH_KEY" "$SSH_USER" 10.20.20.10 "/var/log/auth.log"              "company-customer-db"
check_log_exists "$SSH_KEY" "$SSH_USER" 10.20.20.10 "/var/log/fail2ban.log"           "company-customer-db"
check_log_exists "$SSH_KEY" "$SSH_USER" 10.20.20.10 "/var/log/mysql/error.log"        "company-customer-db"

# company-ldap-server
check_log_exists "$SSH_KEY" "$SSH_USER" 10.20.20.20 "/var/log/auth.log"              "company-ldap-server"
check_log_exists "$SSH_KEY" "$SSH_USER" 10.20.20.20 "/var/log/fail2ban.log"           "company-ldap-server"
check_log_exists "$SSH_KEY" "$SSH_USER" 10.20.20.20 "/var/log/syslog"                "company-ldap-server [slapd]"

# pfSense (SSH via pf key)
echo ""
info "pfSense Suricata eve.json paths (SSH check):"
ssh_cmd "$PF_KEY" "$PF_USER" 10.30.30.1 \
    "ls /var/db/suricata/suricata_em110/eve.json /var/db/suricata/suricata_em220/eve.json 2>&1" \
    | sed 's/^/    /' || warn "Could not check pfSense Suricata paths"


# ──────────────────────────────────────────────────────────────
sub "6. IPTABLES RULES (current blocked IPs per VM)"
# ──────────────────────────────────────────────────────────────
check_iptables "$SSH_KEY" "$SSH_USER" 10.10.10.10 "company-web-server"
check_iptables "$SSH_KEY" "$SSH_USER" 10.10.10.20 "company-dns-server"
check_iptables "$SSH_KEY" "$SSH_USER" 10.20.20.10 "company-customer-db"
check_iptables "$SSH_KEY" "$SSH_USER" 10.20.20.20 "company-ldap-server"

echo ""
info "pfSense WAN blocked hosts (easyrule table):"
ssh_cmd "$PF_KEY" "$PF_USER" 10.30.30.1 \
    "pfctl -t EasyRuleBlockHosts -T show 2>/dev/null | head -20" \
    | sed 's/^/    /' || warn "pfctl table empty or not available"


# ──────────────────────────────────────────────────────────────
sub "7. FAIL2BAN STATUS (banned IPs per VM)"
# ──────────────────────────────────────────────────────────────
check_fail2ban_status "$SSH_KEY" "$SSH_USER" 10.10.10.10 "company-web-server"
check_fail2ban_status "$SSH_KEY" "$SSH_USER" 10.10.10.20 "company-dns-server"
check_fail2ban_status "$SSH_KEY" "$SSH_USER" 10.20.20.10 "company-customer-db"
check_fail2ban_status "$SSH_KEY" "$SSH_USER" 10.20.20.20 "company-ldap-server"


# ──────────────────────────────────────────────────────────────
sub "8. DNS RESOLUTION TEST"
# ──────────────────────────────────────────────────────────────
for domain in company-web-server.bank.local company-dns-server.bank.local \
              company-customer-db.bank.local company-ldap-server.bank.local; do
    result=$(dig +short @10.10.10.20 "$domain" 2>/dev/null || echo "")
    if [[ -n "$result" ]]; then
        ok "DNS $domain → $result"
    else
        warn "DNS $domain → no result (BIND9 zone may not be configured)"
    fi
done


# ──────────────────────────────────────────────────────────────
sub "9. AEGIS FORWARDER SERVICE (local)"
# ──────────────────────────────────────────────────────────────
status=$(systemctl is-active aegis-forwarder 2>/dev/null || echo "not-found")
case "$status" in
    active)    ok  "aegis-forwarder service — active" ;;
    inactive)  warn "aegis-forwarder service — inactive (run: sudo systemctl start aegis-forwarder)" ;;
    not-found) warn "aegis-forwarder.service not installed yet" ;;
    *)         fail "aegis-forwarder — $status" ;;
esac

# Show last 10 lines of forwarder log
echo ""
info "Last 10 lines of aegis-forwarder journal:"
journalctl -u aegis-forwarder -n 10 --no-pager 2>/dev/null | sed 's/^/    /' \
    || warn "journalctl not available or service not installed"


# ──────────────────────────────────────────────────────────────
sub "10. AEGIS API REACHABILITY"
# ──────────────────────────────────────────────────────────────
api_url="https://aegis-api-server-jp3b.onrender.com"
http_code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 "${api_url}/api/healthz" 2>/dev/null || echo "000")
if [[ "$http_code" == "200" ]]; then
    ok "AEGIS API healthz → HTTP $http_code"
elif [[ "$http_code" == "000" ]]; then
    warn "AEGIS API — timeout (Render cold start? wait 60s and retry)"
else
    warn "AEGIS API → HTTP $http_code (check Render env vars)"
fi


# ──────────────────────────────────────────────────────────────
echo -e "\n${BOLD}═══ Check complete ═══${NC}\n"
echo "  Legends:  ✅ OK    ❌ FAIL    ⚠️  WARNING"
echo "  If logs are MISSING → run BIND9 logging setup commands below."
echo ""
echo "  ── BIND9 named.log setup (run on company-dns-server) ──"
cat <<'BIND9_CMDS'
  sudo mkdir -p /var/log/named
  sudo chown bind:bind /var/log/named
  sudo tee -a /etc/bind/named.conf.local << 'EOF'
  logging {
      channel query_log {
          file "/var/log/named/named.log" versions 3 size 5m;
          severity dynamic;
      };
      category queries  { query_log; };
      category default  { query_log; };
  };
  EOF
  sudo systemctl restart named
  ls -lh /var/log/named/named.log
BIND9_CMDS
echo ""
