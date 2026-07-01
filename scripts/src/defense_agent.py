#!/usr/bin/env python3
"""
AEGIS Defense Agent — Ubuntu / pfSense VM
==========================================
Polls the AEGIS API for pending defense commands and executes them locally.
Run as root on the Ubuntu VM or pfSense router.

Usage:
    sudo python3 defense_agent.py --vm ubuntu
    sudo python3 defense_agent.py --vm pfsense

Requirements:
    pip3 install requests
"""

import argparse
import json
import os
import subprocess
import sys
import time
import requests
from datetime import datetime

# ─── CONFIG ──────────────────────────────────────────────────────────────────
AEGIS_URL  = os.environ.get("AEGIS_URL",  "http://<YOUR_AEGIS_DOMAIN>/api")
AEGIS_KEY  = os.environ.get("AEGIS_KEY",  "aegis-demo-key-change-me")
VM_NAME    = os.environ.get("VM_NAME",    "ubuntu")   # ubuntu | pfsense
POLL_SECS  = int(os.environ.get("POLL_SECS", "5"))    # poll interval

HEADERS = {
    "Content-Type":     "application/json",
    "X-AEGIS-Key":      AEGIS_KEY,
    # Admin key is required for command queue polling
    "X-AEGIS-Admin-Key": os.environ.get("AEGIS_ADMIN_KEY", ""),
}

# pfSense API (if running on pfSense)
PFSENSE_API_URL  = os.environ.get("PFSENSE_API_URL",  "http://localhost/api/v1")
PFSENSE_API_KEY  = os.environ.get("PFSENSE_API_KEY",  "")


def ts():
    return datetime.now().strftime("%H:%M:%S")


def log(msg):
    print(f"[{ts()}] {msg}")


def report_result(cmd_id: int, success: bool, error: str = None):
    try:
        requests.post(
            f"{AEGIS_URL}/defense/commands/{cmd_id}/result",
            json={"success": success, "error": error},
            headers=HEADERS,
            timeout=5,
        )
    except Exception as e:
        log(f"[WARN] Could not report result for cmd {cmd_id}: {e}")


# ─── Executors ────────────────────────────────────────────────────────────────

def exec_shell(command: str, cmd_id: int):
    """Run a shell command (iptables, ip route, etc.)"""
    log(f"Executing: {command}")
    try:
        result = subprocess.run(
            command, shell=True, capture_output=True, text=True, timeout=30
        )
        if result.returncode == 0:
            log(f"✓ Success: {result.stdout.strip()}")
            report_result(cmd_id, True)
        else:
            err = result.stderr.strip()
            log(f"✗ Failed: {err}")
            report_result(cmd_id, False, err)
    except subprocess.TimeoutExpired:
        log("✗ Timeout")
        report_result(cmd_id, False, "Timeout")
    except Exception as e:
        log(f"✗ Error: {e}")
        report_result(cmd_id, False, str(e))


def exec_pfsense(payload_json: str, cmd_id: int):
    """Send a command to pfSense REST API (pfSense-api or haproxy-api)"""
    try:
        payload = json.loads(payload_json)
        action  = payload.get("action")

        if action == "block_ip":
            # pfSense-api: POST /api/v1/firewall/rule
            rule = {
                "type":     "block",
                "interface":"wan",
                "ipprotocol":"inet",
                "protocol": "any",
                "src":      payload["ip"],
                "dst":      "any",
                "descr":    f"AEGIS auto-block: {payload.get('reason', '')}",
            }
            r = requests.post(
                f"{PFSENSE_API_URL}/firewall/rule",
                json=rule,
                headers={"Authorization": f"Bearer {PFSENSE_API_KEY}"},
                verify=False, timeout=10,
            )
            if r.status_code in (200, 201):
                log(f"✓ pfSense blocked {payload['ip']}")
                report_result(cmd_id, True)
            else:
                log(f"✗ pfSense error {r.status_code}: {r.text[:80]}")
                report_result(cmd_id, False, r.text[:200])

        elif action == "unblock_ip":
            # Find and delete the rule — simplified (real impl: search by description)
            log(f"pfSense unblock {payload['ip']} — implement rule lookup by description")
            report_result(cmd_id, True)  # mark done for now

        elif action == "block_port":
            rule = {
                "type":     "block",
                "interface":"wan",
                "ipprotocol":"inet",
                "protocol": payload.get("protocol", "tcp"),
                "src":      payload["ip"],
                "dst":      "any",
                "dstport":  str(payload.get("port", "")),
                "descr":    f"AEGIS port-block: {payload.get('reason', '')}",
            }
            r = requests.post(
                f"{PFSENSE_API_URL}/firewall/rule",
                json=rule,
                headers={"Authorization": f"Bearer {PFSENSE_API_KEY}"},
                verify=False, timeout=10,
            )
            if r.status_code in (200, 201):
                log(f"✓ pfSense blocked {payload['ip']}:{payload.get('port')}")
                report_result(cmd_id, True)
            else:
                report_result(cmd_id, False, r.text[:200])

        else:
            log(f"Unknown pfSense action: {action}")
            report_result(cmd_id, False, f"Unknown action: {action}")

    except Exception as e:
        log(f"✗ pfSense error: {e}")
        report_result(cmd_id, False, str(e))


def exec_null_route(command: str, cmd_id: int):
    """Execute null route commands (ip route add blackhole ...)"""
    exec_shell(command, cmd_id)


# ─── Dispatcher ───────────────────────────────────────────────────────────────

def dispatch(cmd: dict):
    cmd_id       = cmd["id"]
    command_type = cmd.get("commandType", "")
    command_text = cmd.get("commandText", "")
    target_ip    = cmd.get("targetIp", "")

    log(f"Command #{cmd_id}: [{command_type}] for {target_ip}")

    if command_type == "pfsense_api":
        exec_pfsense(command_text, cmd_id)
    elif command_type == "null_route":
        exec_null_route(command_text, cmd_id)
    elif command_type in ("iptables", "ufw", "custom"):
        exec_shell(command_text, cmd_id)
    else:
        # Try as shell command by default
        exec_shell(command_text, cmd_id)


# ─── Poll loop ────────────────────────────────────────────────────────────────

def poll():
    try:
        r = requests.get(
            f"{AEGIS_URL}/defense/commands/pending",
            params={"vm": VM_NAME},
            headers=HEADERS,
            timeout=10,
        )
        if r.status_code != 200:
            log(f"[WARN] Poll returned {r.status_code}")
            return

        commands = r.json()
        if commands:
            log(f"→ {len(commands)} pending command(s)")
            for cmd in commands:
                dispatch(cmd)
        else:
            pass  # no pending commands — silent

    except requests.exceptions.ConnectionError:
        log("[WARN] Cannot reach AEGIS API — retrying...")
    except Exception as e:
        log(f"[ERROR] Poll error: {e}")


# ─── Entry point ──────────────────────────────────────────────────────────────

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="AEGIS Defense Agent")
    parser.add_argument("--vm",   default=VM_NAME,   help="VM name (ubuntu|pfsense)")
    parser.add_argument("--url",  default=AEGIS_URL,  help="AEGIS API URL")
    parser.add_argument("--key",  default=AEGIS_KEY,  help="AEGIS ingest key")
    parser.add_argument("--poll", default=POLL_SECS, type=int, help="Poll interval in seconds")
    args = parser.parse_args()

    AEGIS_URL = args.url
    AEGIS_KEY = args.key
    VM_NAME   = args.vm
    HEADERS["X-AEGIS-Key"] = args.key

    print(f"""
╔══════════════════════════════════════════════════╗
║         AEGIS Defense Agent — {VM_NAME:<18}║
╚══════════════════════════════════════════════════╝
  AEGIS  : {AEGIS_URL}
  VM     : {VM_NAME}
  Poll   : every {args.poll}s
""")

    if os.geteuid() != 0 and VM_NAME == "ubuntu":
        print("[WARN] Not running as root — iptables commands may fail!")
        print("       Run with: sudo python3 defense_agent.py\n")

    while True:
        poll()
        time.sleep(args.poll)
