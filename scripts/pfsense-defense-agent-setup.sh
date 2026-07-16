#!/bin/sh
# ─────────────────────────────────────────────────────────────────────────────
# AEGIS pfSense Defense Agent — Quick Setup
# Run this ON the pfSense box (shell via Diagnostics > Command Prompt or SSH).
# Requires: pfSense-api package installed (System > Package Manager > pfSense-api)
# ─────────────────────────────────────────────────────────────────────────────

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "=== AEGIS pfSense Defense Agent Setup ==="
echo ""

# 1. Install requests (pfSense ships python3 + pip via package manager)
pip3 install requests --quiet 2>/dev/null || pkg install -y py311-requests 2>/dev/null || true

# 2. Create local config if missing
CONF="$SCRIPT_DIR/defense_agent.local.conf"
if [ ! -f "$CONF" ]; then
  cp "$SCRIPT_DIR/defense_agent.local.conf.example" "$CONF"
  # Switch to pfsense mode in the copy
  sed -i '' 's/^VM_NAME=ubuntu/VM_NAME=pfsense/' "$CONF"
  echo "[!] Created $CONF — fill in all keys (AEGIS_KEY, AEGIS_ADMIN_KEY, PFSENSE_API_KEY)."
  echo ""
  echo "    vi $CONF"
  echo ""
  exit 1
fi

echo "[✓] Config: $CONF"

# 3. Quick connectivity test
AEGIS_URL=$(grep "^AEGIS_URL=" "$CONF" | cut -d= -f2-)
echo "[+] Testing AEGIS API connectivity: $AEGIS_URL/healthz"
curl -sf "$AEGIS_URL/healthz" && echo " OK" || echo " WARN: API unreachable (cold start?)"
echo ""

echo "[+] Starting pfSense defense agent..."
echo "    Press Ctrl+C to stop."
echo ""
python3 "$SCRIPT_DIR/defense_agent.py" --vm pfsense
