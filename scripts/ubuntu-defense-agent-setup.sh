#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# AEGIS Ubuntu Defense Agent — Quick Setup
# Run this on the Ubuntu VM (bank-web 10.10.10.10) as root.
# ─────────────────────────────────────────────────────────────────────────────
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "=== AEGIS Ubuntu Defense Agent Setup ==="
echo ""

# 1. Install requirements
pip3 install requests --quiet

# 2. Create local config if missing
CONF="$SCRIPT_DIR/defense_agent.local.conf"
if [ ! -f "$CONF" ]; then
  cp "$SCRIPT_DIR/defense_agent.local.conf.example" "$CONF"
  echo "[!] Created $CONF — fill in AEGIS_KEY and AEGIS_ADMIN_KEY before running the agent."
  echo ""
  echo "    nano $CONF"
  echo ""
  exit 1
fi

# 3. Check for empty keys
if grep -q "AEGIS_KEY=$" "$CONF" || grep -q 'AEGIS_KEY=""' "$CONF"; then
  echo "[!] AEGIS_KEY is empty in $CONF — fill it in first."
  exit 1
fi

echo "[✓] Config found: $CONF"
echo ""

# 4. Run the agent as ubuntu VM
echo "[+] Starting defense agent (ubuntu mode, polling every 5s)..."
echo "    Press Ctrl+C to stop."
echo ""
sudo python3 "$SCRIPT_DIR/defense_agent.py" --vm ubuntu
