#!/bin/sh
# ─────────────────────────────────────────────────────────────────────────────
# AEGIS pfSense API Key Setup
#
# pfSense မှာ တစ်ကြိမ်သာ run ရမယ် — REST API package ထည့်ပြီး
# API key generate လုပ်ဖို့ instructions ပေးတယ်။
#
# pfSense defense commands တွေကို AEGIS VM (aegis_forwarder.py --mode hub)
# ကနေ REST API ခေါ်ပြီး handle တယ် — pfSense မှာ script run မနေရ။
#
# Requires: pfSense-api package (System > Package Manager)
# ─────────────────────────────────────────────────────────────────────────────

echo "=== AEGIS pfSense REST API Setup ==="
echo ""
echo "pfSense မှာ တစ်ကြိမ်သာ setup လုပ်ရမည်:"
echo ""
echo "  1. pfSense Web UI → System → Package Manager"
echo "     Search: 'pfSense-api'  →  Install"
echo ""
echo "  2. System → REST API → Settings"
echo "     Enable REST API: ✓"
echo "     Authentication Mode: API Token"
echo "     Save"
echo ""
echo "  3. System → REST API → Keys → Add"
echo "     Copy the generated token"
echo ""
echo "  4. AEGIS VM (10.30.30.10) မှာ:"
echo "     nano scripts/src/aegis_forwarder.local.conf"
echo "     PFSENSE_IP=10.30.30.1"
echo "     PFSENSE_API_URL=http://10.30.30.1/api/v1"
echo "     PFSENSE_API_KEY=<generated token>"
echo ""
echo "  5. Hub script restart:"
echo "     sudo python3 scripts/src/aegis_forwarder.py --mode hub"
echo ""
echo "pfSense မှာ ဘာ script မှ run မနေရ — hub script က API ခေါ်တာ AEGIS VM ကနေသာ။"
echo ""

# Connectivity test if running from pfSense shell
CONF_FILE="$(dirname "$0")/src/aegis_forwarder.local.conf"
if [ -f "$CONF_FILE" ]; then
  AEGIS_URL=$(grep "^AEGIS_URL=" "$CONF_FILE" | cut -d= -f2-)
  if [ -n "$AEGIS_URL" ]; then
    echo "[*] Testing AEGIS API: $AEGIS_URL/healthz"
    curl -sf "$AEGIS_URL/healthz" && echo "  ✓ API reachable" || echo "  WARN: API unreachable (cold start?)"
  fi
fi
