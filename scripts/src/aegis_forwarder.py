#!/usr/bin/env python3
"""
AEGIS Forwarder — Ubuntu Blue Team Script
==========================================
Run this on your Ubuntu defense server to forward real Snort / Suricata /
Fail2ban / Cowrie events to the AEGIS dashboard in real-time.

Usage:
    python3 aegis_forwarder.py --mode suricata
    python3 aegis_forwarder.py --mode snort
    python3 aegis_forwarder.py --mode cowrie

Requirements:
    pip3 install requests watchdog
"""

import argparse
import json
import os
import re
import sys
import time
import threading
import requests
from pathlib import Path
from datetime import datetime

# ─── CONFIG ──────────────────────────────────────────────────────────────────
AEGIS_URL  = os.environ.get("AEGIS_URL",  "http://<YOUR_REPLIT_DOMAIN>/api")
AEGIS_KEY  = os.environ.get("AEGIS_KEY",  "aegis-demo-key-change-me")

HEADERS = {
    "Content-Type": "application/json",
    "X-AEGIS-Key": AEGIS_KEY,
}

# ─── HELPERS ─────────────────────────────────────────────────────────────────
def post(endpoint: str, data: dict):
    try:
        r = requests.post(f"{AEGIS_URL}/ingest/{endpoint}", json=data,
                          headers=HEADERS, timeout=5)
        if r.status_code == 201:
            print(f"[{datetime.now().strftime('%H:%M:%S')}] ✓ Sent to AEGIS: {endpoint}")
        else:
            print(f"[WARN] AEGIS returned {r.status_code}: {r.text[:100]}")
    except Exception as e:
        print(f"[ERROR] Could not reach AEGIS: {e}")


def tail_file(path: str):
    """Generator that yields new lines appended to a file (like tail -f)."""
    with open(path, "r") as f:
        f.seek(0, 2)          # Seek to end
        while True:
            line = f.readline()
            if line:
                yield line.strip()
            else:
                time.sleep(0.5)


# ─── SURICATA (eve.json) ─────────────────────────────────────────────────────
SURICATA_LOG = "/var/log/suricata/eve.json"

def watch_suricata():
    print(f"[SURICATA] Watching {SURICATA_LOG} ...")
    for line in tail_file(SURICATA_LOG):
        try:
            evt = json.loads(line)
            if evt.get("event_type") != "alert":
                continue
            post("suricata", evt)
        except json.JSONDecodeError:
            pass


# ─── SNORT (alert_fast.txt) ──────────────────────────────────────────────────
SNORT_LOG = "/var/log/snort/alert"

# Example line:
# [**] [1:1000001:1] SQL Injection Attempt [**] [Priority: 1] {TCP} 192.168.1.5:54321 -> 10.0.0.5:80
SNORT_RE = re.compile(
    r"\[Priority: (\d+)\]\s+.*?\]\s+(.*?)\s+\[.*?\]\s+\{(\w+)\}\s+([\d.]+):\d+\s+->\s+([\d.]+)"
)

def watch_snort():
    print(f"[SNORT] Watching {SNORT_LOG} ...")
    for line in tail_file(SNORT_LOG):
        # Parse the [**] signature line
        if "[**]" not in line:
            continue
        # Pull signature name between second pair of [**]
        sig_match = re.findall(r"\[\*\*\] \[\S+\] (.*?) \[\*\*\]", line)
        prio_match = re.search(r"\[Priority: (\d+)\]", line)
        net_match  = re.search(r"\{(\w+)\}\s+([\d.]+):\d+\s+->\s+([\d.]+)", line)

        if not sig_match or not net_match:
            continue

        post("snort", {
            "msg":      sig_match[0],
            "priority": prio_match.group(1) if prio_match else "3",
            "proto":    net_match.group(1),
            "src":      net_match.group(2),
            "dst":      net_match.group(3),
        })


# ─── FAIL2BAN ────────────────────────────────────────────────────────────────
FAIL2BAN_LOG = "/var/log/fail2ban.log"

# Example: 2026-06-30 07:12:34,567 fail2ban.actions [1234]: NOTICE  [sshd] Ban 192.168.1.88
FAIL2BAN_RE = re.compile(r"NOTICE\s+\[(\S+)\] Ban ([\d.]+)")

def watch_fail2ban():
    print(f"[FAIL2BAN] Watching {FAIL2BAN_LOG} ...")
    for line in tail_file(FAIL2BAN_LOG):
        m = FAIL2BAN_RE.search(line)
        if not m:
            continue
        post("fail2ban", {
            "jail":     m.group(1),
            "ip":       m.group(2),
            "failures": 5,
        })


# ─── COWRIE ──────────────────────────────────────────────────────────────────
COWRIE_LOG = "/home/cowrie/cowrie/var/log/cowrie/cowrie.json"
COWRIE_EVENTS = {
    "cowrie.login.failed",
    "cowrie.login.success",
    "cowrie.command.input",
    "cowrie.session.connect",
}

def watch_cowrie():
    print(f"[COWRIE] Watching {COWRIE_LOG} ...")
    for line in tail_file(COWRIE_LOG):
        try:
            evt = json.loads(line)
            if evt.get("eventid") not in COWRIE_EVENTS:
                continue
            post("cowrie", evt)
        except json.JSONDecodeError:
            pass


# ─── MAIN ────────────────────────────────────────────────────────────────────
MODES = {
    "suricata": watch_suricata,
    "snort":    watch_snort,
    "fail2ban": watch_fail2ban,
    "cowrie":   watch_cowrie,
}

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="AEGIS Forwarder")
    parser.add_argument("--mode", choices=list(MODES.keys()) + ["all"],
                        default="all", help="Which sensor to watch")
    parser.add_argument("--url",  help="AEGIS API URL override")
    parser.add_argument("--key",  help="AEGIS API key override")
    args = parser.parse_args()

    if args.url:
        AEGIS_URL = args.url
    if args.key:
        AEGIS_KEY  = args.key
        HEADERS["X-AEGIS-Key"] = args.key

    print(f"""
╔══════════════════════════════════════════╗
║        AEGIS Forwarder — Blue Team       ║
╚══════════════════════════════════════════╝
  Target: {AEGIS_URL}
  Mode  : {args.mode}
""")

    if args.mode == "all":
        threads = []
        for name, fn in MODES.items():
            t = threading.Thread(target=fn, daemon=True, name=name)
            t.start()
            threads.append(t)
        try:
            while True:
                time.sleep(1)
        except KeyboardInterrupt:
            print("\n[AEGIS] Forwarder stopped.")
    else:
        try:
            MODES[args.mode]()
        except KeyboardInterrupt:
            print("\n[AEGIS] Forwarder stopped.")
