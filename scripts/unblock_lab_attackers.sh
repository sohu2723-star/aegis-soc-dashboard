#!/usr/bin/env bash
# Remove AEGIS demo attacker blocks from pfSense and every Linux lab VM.
# Run on the AEGIS Admin VM after a block/unblock demonstration.
# Use the dashboard Unblock button first so blocked_ips audit state is updated;
# this script is the enforcement cleanup/verification fallback.

set -uo pipefail

CONFIG_FILE="${AEGIS_FORWARDER_CONFIG:-/opt/aegis/scripts/src/aegis_forwarder.local.conf}"
if [[ -f "$CONFIG_FILE" ]]; then
  # This is the administrator-owned forwarder configuration installed by AEGIS.
  # shellcheck disable=SC1090
  source "$CONFIG_FILE"
fi

PFSENSE_IP="${PFSENSE_IP:-10.30.30.1}"
PFSENSE_SSH_USER="${PFSENSE_SSH_USER:-admin}"
PFSENSE_SSH_KEY="${PFSENSE_SSH_KEY:-$HOME/.ssh/pfsense_key}"
REMOTE_SSH_USER="${REMOTE_SSH_USER:-aegis}"
REMOTE_SSH_KEY="${REMOTE_SSH_KEY:-$HOME/.ssh/aegis_id_rsa}"

LINUX_TARGETS=(
  "${COMPANYWEB_IP:-10.10.10.10}"
  "${DNSSERVER_IP:-10.10.10.20}"
  "${CUSTOMERDB_IP:-10.20.20.10}"
  "${LDAPSERVER_IP:-10.20.20.20}"
)

if (( $# == 0 )); then
  echo "Usage: sudo $0 <attacker-ip> [attacker-ip ...]" >&2
  echo "Example: sudo $0 192.168.10.100 192.168.10.99" >&2
  exit 2
fi

SSH_OPTS=(-o BatchMode=yes -o ConnectTimeout=10 -o StrictHostKeyChecking=no)
failed=0

valid_ip() {
  python3 - "$1" <<'PY'
import ipaddress, sys
try:
    ipaddress.ip_address(sys.argv[1])
except ValueError:
    raise SystemExit(1)
PY
}

remove_linux_drop() {
  local ip="$1"
  printf -v cleanup \
    'while iptables -C INPUT -s %q -j DROP 2>/dev/null; do iptables -D INPUT -s %q -j DROP || exit 1; done; ! iptables -C INPUT -s %q -j DROP 2>/dev/null' \
    "$ip" "$ip" "$ip"

  echo "[Linux/local] removing every DROP for $ip"
  if ! sudo -n bash -c "$cleanup"; then
    echo "  ERROR: local cleanup failed" >&2
    failed=1
  fi

  for host in "${LINUX_TARGETS[@]}"; do
    echo "[Linux/$host] removing every DROP for $ip"
    if ! ssh "${SSH_OPTS[@]}" -i "$REMOTE_SSH_KEY" \
      "$REMOTE_SSH_USER@$host" "sudo -n bash -c $(printf %q "$cleanup")"; then
      echo "  ERROR: cleanup failed on $host" >&2
      failed=1
    fi
  done
}

remove_pfsense_block() {
  local ip="$1"
  local command
  printf -v command \
    'easyrule unblock wan %q >/dev/null; ! easyrule showblock wan | grep -Fqx -e %q -e %q/32 -e %q/128' \
    "$ip" "$ip" "$ip" "$ip"

  echo "[pfSense/$PFSENSE_IP] removing EasyRule entry for $ip"
  if ! ssh "${SSH_OPTS[@]}" -i "$PFSENSE_SSH_KEY" \
    "$PFSENSE_SSH_USER@$PFSENSE_IP" "$command"; then
    echo "  ERROR: $ip is still present in pfSense EasyRule blocks" >&2
    failed=1
  fi
}

for ip in "$@"; do
  if ! valid_ip "$ip"; then
    echo "ERROR: invalid IP address: $ip" >&2
    failed=1
    continue
  fi
  echo "=== Unblocking $ip ==="
  remove_pfsense_block "$ip"
  remove_linux_drop "$ip"
done

if (( failed )); then
  echo "Cleanup completed with errors. Review the messages above." >&2
  exit 1
fi

echo "All requested attacker IPs are absent from pfSense and Linux DROP rules."
echo "The empty EasyRuleBlockHostsWAN rule may remain in the pfSense UI; do not delete it."
echo "If these IPs still appear active in AEGIS, click Unblock in Defense Center to update audit state."
