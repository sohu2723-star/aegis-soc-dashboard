#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# AEGIS Hub Setup — Run on AEGIS VM (10.30.30.10) as root.
#
# Starts aegis_forwarder.py in --mode hub:
#   • SSHes into bank-web (10.10.10.10) → tails Suricata/Snort/Fail2ban/SSH/HTTP/FTP
#   • SSHes into customer-db (10.20.20.20) → tails Suricata/Fail2ban/SSH/PostgreSQL
#   • Calls pfSense REST API for dashboard firewall commands
#   • Runs defense agent for ALL VMs from one place
# ─────────────────────────────────────────────────────────────────────────────
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/src"

echo "=== AEGIS Hub Setup (aegis_forwarder.py --mode hub) ==="
echo ""

# 1. Install requirements
pip3 install requests --quiet

# 2. SSH key check
echo "[*] Checking SSH key auth to bank VMs..."
for IP in 10.10.10.10 10.20.20.20; do
  if ssh -o BatchMode=yes -o ConnectTimeout=5 -o StrictHostKeyChecking=no "sithu@$IP" exit 2>/dev/null; then
    echo "  ✓ SSH OK → $IP"
  else
    echo "  ✗ SSH FAILED → $IP"
    echo "    Fix: ssh-copy-id sithu@$IP"
    echo "    Then re-run this script."
    exit 1
  fi
done
echo ""

# 3. Create local config if missing
CONF="$SCRIPT_DIR/aegis_forwarder.local.conf"
if [ ! -f "$CONF" ]; then
  cp "$SCRIPT_DIR/aegis_forwarder.local.conf.example" "$CONF"
  echo "[!] Created $CONF"
  echo "    Fill in AEGIS_KEY and AEGIS_ADMIN_KEY before running."
  echo ""
  echo "    nano $CONF"
  echo ""
  exit 1
fi

# 4. Check for empty keys
if grep -q "^AEGIS_KEY=$" "$CONF" || grep -q '^AEGIS_KEY=""' "$CONF"; then
  echo "[!] AEGIS_KEY is empty in $CONF — fill it in first."
  exit 1
fi

echo "[✓] Config found: $CONF"
echo ""

# 5. Start hub
echo "[+] Starting AEGIS hub (--mode hub, polling every 5s)..."
echo "    Covers: bank-web, customer-db, pfSense, AEGIS VM"
echo "    Press Ctrl+C to stop."
echo ""
sudo python3 "$SCRIPT_DIR/aegis_forwarder.py" --mode hub
