#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# setup_remote_sudoers.sh
# Run this from the AEGIS VM (10.30.30.10) as root.
#
# Pushes a sudoers NOPASSWD rule for the 'sithu' user to every company VM
# so aegis_forwarder.py can run iptables / ss via SSH without a password prompt.
#
# Usage:
#   sudo bash /opt/aegis/scripts/setup_remote_sudoers.sh
# ─────────────────────────────────────────────────────────────────────────────
set -e

# ── Config ────────────────────────────────────────────────────────────────────
SSH_USER="${REMOTE_SSH_USER:-sithu}"

# This script is normally launched with sudo, but the SSH key belongs to the
# desktop user who invoked it.  Do not resolve "~" as /root in that case.
INVOKING_USER="${SUDO_USER:-${USER:-$(id -un)}}"
INVOKING_HOME="$(getent passwd "$INVOKING_USER" | cut -d: -f6)"
[ -n "$INVOKING_HOME" ] || INVOKING_HOME="$HOME"
SSH_KEY="${REMOTE_SSH_KEY:-${INVOKING_HOME}/.ssh/aegis_id_rsa}"
# Two lines: disable requiretty (so sudo works over BatchMode SSH without a TTY)
# and grant full NOPASSWD so no password prompt is ever needed.
SUDOERS_CONTENT="Defaults:${SSH_USER} !requiretty\n${SSH_USER} ALL=(ALL) NOPASSWD: ALL"
SUDOERS_LINE="${SSH_USER} ALL=(ALL) NOPASSWD: ALL"   # kept for display/error messages
SUDOERS_FILE="/etc/sudoers.d/${SSH_USER}-nopasswd"

# Load overrides from local.conf if it exists
LOCAL_CONF="$(dirname "$0")/src/aegis_forwarder.local.conf"
if [ -f "$LOCAL_CONF" ]; then
    _user=$(grep -E '^REMOTE_SSH_USER\s*=' "$LOCAL_CONF" | cut -d= -f2- | tr -d ' "')
    _key=$(grep  -E '^REMOTE_SSH_KEY\s*='  "$LOCAL_CONF" | cut -d= -f2- | tr -d ' "')
    [ -n "$_user" ] && SSH_USER="$_user" && SUDOERS_CONTENT="Defaults:${SSH_USER} !requiretty\n${SSH_USER} ALL=(ALL) NOPASSWD: ALL" && SUDOERS_LINE="${SSH_USER} ALL=(ALL) NOPASSWD: ALL" && SUDOERS_FILE="/etc/sudoers.d/${SSH_USER}-nopasswd"
    if [ -n "$_key" ]; then
        # A configured ~/ path also belongs to the invoking user, not root.
        case "$_key" in
            "~")  SSH_KEY="$INVOKING_HOME" ;;
            "~/"*) SSH_KEY="$INVOKING_HOME/${_key#\~/}" ;;
            *)    SSH_KEY="$_key" ;;
        esac
    fi
fi

# Read VM IPs from local.conf (fallback to known defaults)
get_cfg() {
    local key="$1" default="$2"
    if [ -f "$LOCAL_CONF" ]; then
        val=$(grep -E "^${key}\s*=" "$LOCAL_CONF" | cut -d= -f2- | tr -d ' "')
        [ -n "$val" ] && echo "$val" && return
    fi
    echo "$default"
}

COMPANYWEB_IP=$(get_cfg COMPANYWEB_IP "10.10.10.10")
CUSTOMERDB_IP=$(get_cfg CUSTOMERDB_IP "10.20.20.10")
DNSSERVER_IP=$(get_cfg  DNSSERVER_IP  "10.10.10.20")
LDAPSERVER_IP=$(get_cfg LDAPSERVER_IP "10.20.20.20")

REMOTE_VMS=(
    "company-web-server:${COMPANYWEB_IP}"
    "company-customer-db:${CUSTOMERDB_IP}"
    "company-dns-server:${DNSSERVER_IP}"
    "company-ldap-server:${LDAPSERVER_IP}"
)

SSH_OPTS=(-i "$SSH_KEY" -o StrictHostKeyChecking=no -o ConnectTimeout=10 -o BatchMode=yes -o IdentityAgent=none)

# ── Functions ─────────────────────────────────────────────────────────────────
push_sudoers() {
    local name="$1" ip="$2"

    echo ""
    echo "──────────────────────────────────────────"
    echo "  $name  ($ip)"
    echo "──────────────────────────────────────────"

    # Test connectivity first
    if ! ssh "${SSH_OPTS[@]}" "${SSH_USER}@${ip}" "true" 2>/dev/null; then
        echo "  ✗ SSH connection failed — skipping (check key auth)"
        return 1
    fi

    # Write sudoers file via tee (needs the user's sudo password once, or existing NOPASSWD)
    # We pipe through sudo tee to create a root-owned file
    echo "  [1] Writing sudoers rule..."
    if ssh "${SSH_OPTS[@]}" "${SSH_USER}@${ip}" \
        "printf '${SUDOERS_CONTENT}\\n' | sudo tee ${SUDOERS_FILE} > /dev/null && sudo chmod 440 ${SUDOERS_FILE} && sudo visudo -c -f ${SUDOERS_FILE}"; then
        echo "  ✓ Sudoers file written and validated"
    else
        echo "  ✗ Write failed — VM may require a password for sudo"
        echo "    SSH in manually and run:"
        echo "      printf '${SUDOERS_CONTENT}\\n' | sudo tee ${SUDOERS_FILE} && sudo chmod 440 ${SUDOERS_FILE}"
        return 1
    fi

    # Verify NOPASSWD is active
    echo "  [2] Verifying NOPASSWD works (sudo -n true)..."
    if ssh "${SSH_OPTS[@]}" "${SSH_USER}@${ip}" "sudo -n true 2>&1"; then
        echo "  ✓ sudo -n true → OK"
    else
        echo "  ✗ sudo -n still fails — sudoers.d may not be included"
        echo "    SSH in and check: grep includedir /etc/sudoers"
        return 1
    fi

    # Verify iptables works
    echo "  [3] Verifying iptables access (sudo -n iptables -L -n --line-numbers)..."
    if ssh "${SSH_OPTS[@]}" "${SSH_USER}@${ip}" "sudo -n iptables -L -n --line-numbers > /dev/null 2>&1"; then
        echo "  ✓ iptables OK"
    else
        echo "  ✗ iptables check failed"
        return 1
    fi

    echo "  ✓ $name is ready for auto-defense commands"
    return 0
}

# ── Main ──────────────────────────────────────────────────────────────────────
echo ""
echo "╔══════════════════════════════════════════════╗"
echo "║  AEGIS — Remote Sudoers Setup                ║"
echo "║  SSH user : ${SSH_USER}                           ║"
echo "║  SSH key  : ${SSH_KEY}  ║"
echo "╚══════════════════════════════════════════════╝"

PASS=0
FAIL=0

for entry in "${REMOTE_VMS[@]}"; do
    name="${entry%%:*}"
    ip="${entry##*:}"
    if push_sudoers "$name" "$ip"; then
        PASS=$((PASS + 1))
    else
        FAIL=$((FAIL + 1))
    fi
done

echo ""
echo "══════════════════════════════════════════════"
echo "  Done: ${PASS} OK   ${FAIL} failed"
echo "══════════════════════════════════════════════"

if [ "$FAIL" -gt 0 ]; then
    echo ""
    echo "For failed VMs, SSH in directly and run:"
    echo "  echo '${SUDOERS_LINE}' | sudo tee ${SUDOERS_FILE} && sudo chmod 440 ${SUDOERS_FILE}"
    exit 1
fi
