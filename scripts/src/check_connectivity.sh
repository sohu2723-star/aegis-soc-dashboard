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

# NOTE: set -e intentionally NOT used here — we want the full report even
# when individual checks fail.  Each helper function handles its own errors.
set -uo pipefail

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

ok()   { echo -e "  ${GREEN}✅ $*${NC}"; (( PASS_COUNT++ )) || true; }
fail() { echo -e "  ${RED}❌ $*${NC}";   (( FAIL_COUNT++ )) || true; }
warn() { echo -e "  ${YELLOW}⚠️  $*${NC}"; (( WARN_COUNT++ )) || true; }
info() { echo -e "  ${CYAN}ℹ  $*${NC}"; }

hdr()  { echo -e "\n${BOLD}═══ $* ═══${NC}"; }
sub()  { echo -e "\n${BOLD}─── $* ───${NC}"; }

PASS_COUNT=0
FAIL_COUNT=0
WARN_COUNT=0

# ── SSH helper ────────────────────────────────────────────────
# Always returns 0 — never aborts the script.
ssh_cmd() {
    local key="$1" user="$2" ip="$3"
    shift 3
    ssh -i "$key" \
        -o BatchMode=yes \
        -o StrictHostKeyChecking=no \
        -o ConnectTimeout=5 \
        "${user}@${ip}" "$@" 2>/dev/null
}

# Check passwordless SSH and print ✅/❌.
# Returns 0 either way so set -e (if ever re-enabled) does not abort the script.
ssh_ok() {
    local key="$1" user="$2" ip="$3" label="$4"
    if ssh_cmd "$key" "$user" "$ip" echo "ok" >/dev/null 2>&1; then
        ok "SSH $label ($user@$ip) — passwordless OK"
    else
        fail "SSH $label ($user@$ip) — FAILED"
        _ssh_auth_hint "$key" "$user" "$ip"
    fi
}

# Print actionable hints when SSH key auth fails.
_ssh_auth_hint() {
    local key="$1" user="$2" ip="$3"
    local pub="${key}.pub"

    # 1. Key file missing
    if [[ ! -f "$key" ]]; then
        warn "  Key file not found: $key"
        info "  → Generate key:  ssh-keygen -t ed25519 -f $key -N ''"
        info "  → Copy to VM:    ssh-copy-id -i ${pub} ${user}@${ip}"
        return
    fi

    # 2. Wrong permissions
    local perms
    perms=$(stat -c "%a" "$key" 2>/dev/null || stat -f "%Lp" "$key" 2>/dev/null || echo "?")
    if [[ "$perms" != "600" && "$perms" != "400" ]]; then
        warn "  Key permissions are $perms (need 600)"
        info "  → Fix:  chmod 600 $key"
    fi

    # 3. Port reachable?
    if ! nc -zw 3 "$ip" 22 2>/dev/null; then
        warn "  Port 22 unreachable on $ip — SSH service down or firewall blocking"
        info "  → On VM:  sudo systemctl start ssh && sudo ufw allow 22/tcp"
        return
    fi

    # 4. Auth specifically denied → suggest ssh-copy-id
    info "  Port 22 open but key auth rejected"
    if [[ -f "$pub" ]]; then
        info "  → Manually copy key (one-time, using VM password):"
        info "     ssh-copy-id -i $pub ${user}@${ip}"
        info "  → Or paste this into VM's ~/.ssh/authorized_keys:"
        info "     $(cat "$pub" 2>/dev/null || echo '<pub key not found>')"
    else
        warn "  Public key not found: $pub"
        info "  → Regenerate:  ssh-keygen -t ed25519 -f $key -N ''"
    fi

    # 5. Check if known_hosts entry is stale (host key changed after reinstall)
    if ssh-keygen -F "$ip" >/dev/null 2>&1; then
        local known_key
        known_key=$(ssh-keyscan -T 3 "$ip" 2>/dev/null | head -1 || true)
        if [[ -n "$known_key" ]]; then
            info "  If you reinstalled this VM, clear the stale known_hosts entry:"
            info "     ssh-keygen -R $ip"
        fi
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
    status=$(ssh_cmd "$key" "$user" "$ip" "systemctl is-active $svc 2>/dev/null" || echo "ssh_error")
    case "$status" in
        active)    ok   "Service $svc — active ($label)" ;;
        inactive)  warn "Service $svc — inactive ($label)" ;;
        ssh_error) warn "Service $svc — SSH unreachable ($label)" ;;
        *)         fail "Service $svc — $status ($label)" ;;
    esac
}

check_log_exists() {
    local key="$1" user="$2" ip="$3" path="$4" label="$5"
    local result
    result=$(ssh_cmd "$key" "$user" "$ip" "[ -f '$path' ] && echo exists || echo missing" || echo "ssh_error")
    case "$result" in
        exists)    ok   "Log exists: $path ($label)" ;;
        missing)   warn "Log MISSING: $path ($label) — may need service config" ;;
        ssh_error) warn "SSH unreachable — skipping log check ($label)" ;;
    esac
}

check_iptables() {
    local key="$1" user="$2" ip="$3" label="$4"
    echo ""
    info "iptables INPUT rules on $label:"
    ssh_cmd "$key" "$user" "$ip" "sudo iptables -L INPUT -n --line-numbers 2>/dev/null | head -20" \
        | sed 's/^/    /' \
        || warn "Could not read iptables on $label (SSH unreachable or sudo lacks NOPASSWD)"
}

check_fail2ban_status() {
    local key="$1" user="$2" ip="$3" label="$4"
    local bans
    bans=$(ssh_cmd "$key" "$user" "$ip" \
        "sudo fail2ban-client status 2>/dev/null | grep 'Jail list' || echo 'n/a'" \
        || echo "ssh_error")
    case "$bans" in
        ssh_error) warn "Fail2ban status — SSH unreachable ($label)" ;;
        n/a)       warn "Fail2ban status unavailable ($label) — service may not be running" ;;
        *)         ok   "Fail2ban jails ($label): $bans" ;;
    esac
}

# ──────────────────────────────────────────────────────────────
hdr "AEGIS Lab Connectivity Check — $(date '+%Y-%m-%d %H:%M:%S')"
# ──────────────────────────────────────────────────────────────


# ──────────────────────────────────────────────────────────────
sub "0. PRE-FLIGHT: SSH KEY FILES"
# ──────────────────────────────────────────────────────────────
echo ""
info "Checking SSH key files before running auth tests..."

if [[ -f "$SSH_KEY" ]]; then
    PERMS=$(stat -c "%a" "$SSH_KEY" 2>/dev/null || stat -f "%Lp" "$SSH_KEY" 2>/dev/null || echo "?")
    ok "Company VM key: $SSH_KEY (perms: $PERMS)"
    if [[ "$PERMS" != "600" && "$PERMS" != "400" ]]; then
        warn "Permissions should be 600 — fix: chmod 600 $SSH_KEY"
    fi
    info "  Fingerprint: $(ssh-keygen -l -f "$SSH_KEY" 2>/dev/null | awk '{print $2, $4}' || echo 'unreadable')"
else
    fail "Company VM key MISSING: $SSH_KEY"
    info "  → Generate: ssh-keygen -t ed25519 -f $SSH_KEY -N ''"
    info "  → Then copy to each VM:"
    info "       ssh-copy-id -i ${SSH_KEY}.pub ${SSH_USER}@10.10.10.10   # company-web-server"
    info "       ssh-copy-id -i ${SSH_KEY}.pub ${SSH_USER}@10.10.10.20   # company-dns-server"
    info "       ssh-copy-id -i ${SSH_KEY}.pub ${SSH_USER}@10.20.20.10   # company-customer-db"
    info "       ssh-copy-id -i ${SSH_KEY}.pub ${SSH_USER}@10.20.20.20   # company-ldap-server"
fi

if [[ -f "$PF_KEY" ]]; then
    PF_PERMS=$(stat -c "%a" "$PF_KEY" 2>/dev/null || stat -f "%Lp" "$PF_KEY" 2>/dev/null || echo "?")
    ok "pfSense key: $PF_KEY (perms: $PF_PERMS)"
    if [[ "$PF_PERMS" != "600" && "$PF_PERMS" != "400" ]]; then
        warn "Permissions should be 600 — fix: chmod 600 $PF_KEY"
    fi
else
    warn "pfSense key MISSING: $PF_KEY"
    info "  → Generate: ssh-keygen -t ed25519 -f $PF_KEY -N ''"
    info "  → Then: cat ${PF_KEY}.pub"
    info "  → Paste into pfSense: System → User Manager → admin → Authorized SSH Keys"
fi


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
sub "2. SSH PASSWORDLESS AUTH (all company VMs)"
# ──────────────────────────────────────────────────────────────
ssh_ok "$SSH_KEY" "$SSH_USER" 10.10.10.10 "company-web-server"
ssh_ok "$SSH_KEY" "$SSH_USER" 10.10.10.20 "company-dns-server"
ssh_ok "$SSH_KEY" "$SSH_USER" 10.20.20.10 "company-customer-db"
ssh_ok "$SSH_KEY" "$SSH_USER" 10.20.20.20 "company-ldap-server"

# pfSense forces interactive menu — cannot run echo "ok" via BatchMode.
# Check port 22 open instead (key auth already confirmed via ssh-copy-id).
if nc -zw 3 10.30.30.1 22 2>/dev/null; then
    ok "SSH pfSense (admin@10.30.30.1) — port 22 open, key installed ✓"
else
    fail "SSH pfSense (admin@10.30.30.1) — port 22 CLOSED"
    info "  → pfSense: System → Advanced → Admin Access → Enable Secure Shell ✓"
fi


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
check_service "$SSH_KEY" "$SSH_USER" 10.10.10.10 suricata  "company-web-server"
check_service "$SSH_KEY" "$SSH_USER" 10.10.10.10 fail2ban  "company-web-server"
check_service "$SSH_KEY" "$SSH_USER" 10.10.10.10 ssh       "company-web-server"

# company-dns-server
check_service "$SSH_KEY" "$SSH_USER" 10.10.10.20 named     "company-dns-server"
check_service "$SSH_KEY" "$SSH_USER" 10.10.10.20 suricata  "company-dns-server"
check_service "$SSH_KEY" "$SSH_USER" 10.10.10.20 fail2ban  "company-dns-server"

# company-customer-db
check_service "$SSH_KEY" "$SSH_USER" 10.20.20.10 mysql     "company-customer-db"
check_service "$SSH_KEY" "$SSH_USER" 10.20.20.10 suricata  "company-customer-db"
check_service "$SSH_KEY" "$SSH_USER" 10.20.20.10 fail2ban  "company-customer-db"

# company-ldap-server
check_service "$SSH_KEY" "$SSH_USER" 10.20.20.20 slapd     "company-ldap-server"
check_service "$SSH_KEY" "$SSH_USER" 10.20.20.20 suricata  "company-ldap-server"
check_service "$SSH_KEY" "$SSH_USER" 10.20.20.20 fail2ban  "company-ldap-server"


# ──────────────────────────────────────────────────────────────
sub "5. LOG PATH EXISTENCE (critical log files)"
# ──────────────────────────────────────────────────────────────
# company-web-server
check_log_exists "$SSH_KEY" "$SSH_USER" 10.10.10.10 "/var/log/auth.log"              "company-web-server"
check_log_exists "$SSH_KEY" "$SSH_USER" 10.10.10.10 "/var/log/fail2ban.log"          "company-web-server"
check_log_exists "$SSH_KEY" "$SSH_USER" 10.10.10.10 "/var/log/apache2/access.log"    "company-web-server"

# company-dns-server
check_log_exists "$SSH_KEY" "$SSH_USER" 10.10.10.20 "/var/log/auth.log"              "company-dns-server"
check_log_exists "$SSH_KEY" "$SSH_USER" 10.10.10.20 "/var/log/fail2ban.log"          "company-dns-server"
check_log_exists "$SSH_KEY" "$SSH_USER" 10.10.10.20 "/var/log/named/named.log"       "company-dns-server [BIND9 — needs logging config]"

# company-customer-db
check_log_exists "$SSH_KEY" "$SSH_USER" 10.20.20.10 "/var/log/auth.log"              "company-customer-db"
check_log_exists "$SSH_KEY" "$SSH_USER" 10.20.20.10 "/var/log/fail2ban.log"          "company-customer-db"
check_log_exists "$SSH_KEY" "$SSH_USER" 10.20.20.10 "/var/log/mysql/error.log"       "company-customer-db"

# company-ldap-server
check_log_exists "$SSH_KEY" "$SSH_USER" 10.20.20.20 "/var/log/auth.log"              "company-ldap-server"
check_log_exists "$SSH_KEY" "$SSH_USER" 10.20.20.20 "/var/log/fail2ban.log"          "company-ldap-server"
check_log_exists "$SSH_KEY" "$SSH_USER" 10.20.20.20 "/var/log/syslog"               "company-ldap-server [slapd]"

# pfSense Suricata eve.json
echo ""
info "pfSense Suricata eve.json (SSH probe):"
if [[ ! -f "$PF_KEY" ]]; then
    warn "pfSense SSH key not found: $PF_KEY"
    warn "  → Fix: ssh-keygen -t ed25519 -f ~/.ssh/pfsense_key -N ''"
    warn "  → Then add public key to pfSense: System → User Manager → admin → Authorized Keys"
elif ! nc -z -w5 10.30.30.1 22 2>/dev/null; then
    warn "pfSense port 22 unreachable (10.30.30.1) — check MGMT firewall rule"
else
    # Capture stderr separately to distinguish auth failure from pfSense shell quirks.
    pf_auth_stderr=$(ssh \
        -i "$PF_KEY" \
        -o BatchMode=yes \
        -o StrictHostKeyChecking=no \
        -o ConnectTimeout=5 \
        "${PF_USER}@10.30.30.1" exit \
        2>&1 1>/dev/null || true)

    if echo "$pf_auth_stderr" | grep -qiE \
            "Permission denied|Authentication failed|publickey|no mutual"; then
        fail "pfSense SSH auth — ~/.ssh/pfsense_key.pub does not match pfSense admin Authorized Keys"
        info "  → pfSense WebGUI: System → User Manager → admin → Authorized SSH Keys → paste:"
        info "     $(cat "${PF_KEY}.pub" 2>/dev/null || echo '<pub key missing>')"
        pf_auth_ok=0
    else
        pf_auth_ok=1
        # Root-level /var/log/suricata/eve.json may be a broken symlink.
        # Use find to locate real eve.json files in PID-based subdirectories
        # (e.g. suricata_em1.<PID>/eve.json) — these change on every Suricata restart.
        pf_suricata=$(ssh_cmd "$PF_KEY" "$PF_USER" 10.30.30.1 \
            "/bin/sh -c 'FOUND=\$(find /var/log/suricata/ -maxdepth 2 -name eve.json -type f 2>/dev/null | sort); if [ -n \"\$FOUND\" ]; then echo \"\$FOUND\" | while read p; do ls -lh \"\$p\"; done; else echo FILE_MISSING; fi'" \
            || echo "CMD_ERROR")

        if [[ "$pf_suricata" == *"FILE_MISSING"* ]] || [[ "$pf_suricata" == "CMD_ERROR" ]]; then
            warn "pfSense: No Suricata eve.json found in /var/log/suricata/ — Suricata not yet started"
            info "  → pfSense: Services → Suricata → Interfaces → enable em1.10 → Start"
            info "  → Note: /var/log/suricata/eve.json symlink may be broken — real logs in PID subdirs"
        else
            ok "pfSense Suricata eve.json found:"
            echo "$pf_suricata" | sed 's/^/    /'
        fi
    fi
fi


# ──────────────────────────────────────────────────────────────
sub "6. IPTABLES RULES (current blocked IPs per VM)"
# ──────────────────────────────────────────────────────────────
check_iptables "$SSH_KEY" "$SSH_USER" 10.10.10.10 "company-web-server"
check_iptables "$SSH_KEY" "$SSH_USER" 10.10.10.20 "company-dns-server"
check_iptables "$SSH_KEY" "$SSH_USER" 10.20.20.10 "company-customer-db"
check_iptables "$SSH_KEY" "$SSH_USER" 10.20.20.20 "company-ldap-server"

echo ""
info "pfSense WAN blocked hosts (easyrule table):"
if [[ ! -f "$PF_KEY" ]]; then
    warn "pfSense SSH key missing — skipping pfctl check"
elif ! nc -z -w5 10.30.30.1 22 2>/dev/null; then
    warn "pfSense port 22 unreachable — skipping pfctl check"
elif [[ "${pf_auth_ok:-0}" -eq 0 ]]; then
    warn "pfSense SSH auth failed — fix key first (see Section 5 above)"
else
    result=$(ssh_cmd "$PF_KEY" "$PF_USER" 10.30.30.1 \
        "/bin/sh -c 'pfctl -t EasyRuleBlockHosts -T show 2>/dev/null | head -20'" || true)
    if [[ -z "$result" ]]; then
        ok "pfSense EasyRuleBlockHosts — empty (no IPs blocked via easyrule yet)"
    else
        info "pfSense blocked IPs:"
        echo "$result" | sed 's/^/    /'
    fi
fi


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
echo ""
info "Testing bank.local zone (legacy):"
for domain in company-web-server.bank.local company-dns-server.bank.local \
              company-customer-db.bank.local company-ldap-server.bank.local; do
    result=$(dig +short @10.10.10.20 "$domain" 2>/dev/null || echo "")
    if [[ -n "$result" ]]; then
        ok "DNS $domain → $result"
    else
        warn "DNS $domain → no result (BIND9 bank.local zone may not be configured)"
    fi
done

echo ""
info "Testing goldenmyanmar.trading.com zone (new company):"
for query in "web.goldenmyanmar.trading.com:10.10.10.10" \
             "db.goldenmyanmar.trading.com:10.20.20.10" \
             "ldap.goldenmyanmar.trading.com:10.20.20.20"; do
    domain="${query%%:*}"
    expected="${query##*:}"
    result=$(dig +short @10.10.10.20 "$domain" 2>/dev/null || echo "")
    if [[ "$result" == "$expected" ]]; then
        ok "DNS $domain → $result"
    elif [[ -n "$result" ]]; then
        warn "DNS $domain → $result (expected $expected)"
    else
        warn "DNS $domain → no result (goldenmyanmar zone not yet deployed to DNS-Server)"
    fi
done


# ──────────────────────────────────────────────────────────────
sub "9. AEGIS FORWARDER SERVICE (local)"
# ──────────────────────────────────────────────────────────────
status=$(systemctl is-active aegis-forwarder 2>/dev/null || echo "not-found")
case "$status" in
    active)    ok  "aegis-forwarder service — active" ;;
    inactive)  warn "aegis-forwarder service — inactive"
               info "  → Start: sudo systemctl start aegis-forwarder" ;;
    not-found) warn "aegis-forwarder.service not installed yet"
               info "  → Install: see docs/AEGIS_VM_SETUP.md § Systemd Service" ;;
    *)         fail "aegis-forwarder — $status" ;;
esac

echo ""
info "Last 10 lines of aegis-forwarder journal:"
journalctl -u aegis-forwarder -n 10 --no-pager 2>/dev/null | sed 's/^/    /' \
    || warn "journalctl not available or service not installed"


# ──────────────────────────────────────────────────────────────
sub "10. AEGIS API REACHABILITY"
# ──────────────────────────────────────────────────────────────
api_url="https://aegis-api-server-jp3b.onrender.com"
http_code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 15 "${api_url}/api/healthz" 2>/dev/null || echo "000")
if [[ "$http_code" == "200" ]]; then
    ok "AEGIS API healthz → HTTP $http_code ✓"
elif [[ "$http_code" == "000" ]]; then
    warn "AEGIS API — timeout (Render cold start ~50s — wait and retry)"
else
    warn "AEGIS API → HTTP $http_code"
    info "  → Check Render dashboard: env vars SUPABASE_DB_URL, AEGIS_INGEST_KEY, AEGIS_ADMIN_KEY"
fi


# ──────────────────────────────────────────────────────────────
echo -e "\n${BOLD}═══ Check complete ═══${NC}"
echo ""
echo -e "  ${GREEN}✅ PASS: $PASS_COUNT${NC}   ${RED}❌ FAIL: $FAIL_COUNT${NC}   ${YELLOW}⚠️  WARN: $WARN_COUNT${NC}"
echo ""
echo "  Legends:  ✅ OK    ❌ FAIL    ⚠️  WARNING"
echo ""

# ── Conditional hints ─────────────────────────────────────────
if (( FAIL_COUNT > 0 )); then
    echo -e "${BOLD}  Quick fixes for common failures:${NC}"
    echo ""
    echo "  SSH key missing / auth fail:"
    echo "    ssh-keygen -t ed25519 -f ~/.ssh/aegis_id_rsa -N ''"
    echo "    ssh-copy-id -i ~/.ssh/aegis_id_rsa.pub sithu@10.10.10.10"
    echo "    ssh-copy-id -i ~/.ssh/aegis_id_rsa.pub sithu@10.10.10.20"
    echo "    ssh-copy-id -i ~/.ssh/aegis_id_rsa.pub sithu@10.20.20.10"
    echo "    ssh-copy-id -i ~/.ssh/aegis_id_rsa.pub sithu@10.20.20.20"
    echo ""
    echo "  Stale known_hosts (after VM reinstall):"
    echo "    ssh-keygen -R 10.10.10.10"
    echo "    ssh-keygen -R 10.10.10.20"
    echo "    ssh-keygen -R 10.20.20.10"
    echo "    ssh-keygen -R 10.20.20.20"
    echo ""
fi

# ── BIND9 named.log setup reminder ───────────────────────────
echo "  ── BIND9 named.log setup (run on company-dns-server if log MISSING) ──"
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
