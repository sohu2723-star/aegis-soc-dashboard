#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# AEGIS Hub Setup — Run on AEGIS VM (10.30.30.10) with sudo.
#
# Starts aegis_forwarder.py in --mode hub:
#   • SSHes into bank-web (10.10.10.10) → tails Suricata/Snort/Fail2ban/SSH/HTTP/FTP
#   • SSHes into customer-db (10.20.20.20) → tails Suricata/Fail2ban/SSH/PostgreSQL
#   • Calls pfSense REST API for dashboard firewall commands
#   • Runs defense agent for ALL VMs from one place
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/src"
SERVICE_FILE="/etc/systemd/system/aegis-forwarder.service"

if [ "${EUID}" -ne 0 ]; then
  echo "[!] Run this installer as root: sudo $0"
  exit 1
fi

echo "=== AEGIS Hub Setup (aegis_forwarder.py --mode hub) ==="
echo ""

# 1. Install requirements
if ! python3 -c 'import requests' 2>/dev/null; then
  apt-get update
  apt-get install -y python3-requests openssh-client
fi

# 2. Create local config if missing
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

# 3. Check for empty keys
if grep -Eq '^AEGIS_KEY=(|"")$' "$CONF" || grep -Eq '^AEGIS_ADMIN_KEY=(|"")$' "$CONF"; then
  echo "[!] AEGIS_KEY or AEGIS_ADMIN_KEY is empty in $CONF — fill both in first."
  exit 1
fi

echo "[✓] Config found: $CONF"
echo ""

# 4. Install a boot-persistent, self-healing systemd service.  network-online
# avoids a failed first request during boot; Restart=always recovers from both
# unexpected errors and clean exits.
cat > "$SERVICE_FILE" <<EOF
[Unit]
Description=AEGIS Hub Forwarder
Wants=network-online.target
After=network-online.target
StartLimitIntervalSec=0

[Service]
Type=simple
User=root
WorkingDirectory=$SCRIPT_DIR
Environment=PYTHONUNBUFFERED=1
ExecStart=/usr/bin/python3 $SCRIPT_DIR/aegis_forwarder.py --mode hub
Restart=always
RestartSec=5
TimeoutStopSec=20

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable aegis-forwarder.service
systemctl restart aegis-forwarder.service

echo "[✓] aegis-forwarder is installed, enabled at boot, and started."
echo "    Status:  systemctl status aegis-forwarder --no-pager"
echo "    Logs:    journalctl -u aegis-forwarder -f"
