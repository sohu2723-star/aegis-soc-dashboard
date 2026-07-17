#!/usr/bin/env python3
"""
AEGIS Forwarder — Ubuntu Blue Team Script
==========================================
Runs on Ubuntu defense server. Forwards real events from:
  Suricata, Snort, Fail2ban, Cowrie, SSH auth.log, FTP, ModSecurity

Usage:
    python3 aegis_forwarder.py --mode all
    python3 aegis_forwarder.py --mode suricata
    python3 aegis_forwarder.py --mode ssh
    python3 aegis_forwarder.py --mode http

Requirements:
    pip3 install requests
"""

import argparse
import json
import os
import re
import socket
import subprocess
import sys
import time
import threading
import requests
from pathlib import Path
from datetime import datetime

# ─── LOCAL CONFIG FILE (set-once, not committed to git) ───────────────────────
# Real keys go in aegis_forwarder.local.conf next to this script (gitignored),
# so you type them once on the machine that runs this and never again — same
# mechanism defense_agent.py uses. Copy aegis_forwarder.local.conf.example.
_LOCAL_CONF = os.path.join(os.path.dirname(os.path.abspath(__file__)), "aegis_forwarder.local.conf")
_local_values = {}
if os.path.exists(_LOCAL_CONF):
    with open(_LOCAL_CONF) as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            _local_values[k.strip()] = v.strip().strip('"').strip("'")


def _cfg(key: str, default: str = "") -> str:
    return os.environ.get(key) or _local_values.get(key, default)


# ─── CONFIG ──────────────────────────────────────────────────────────────────
AEGIS_URL = _cfg("AEGIS_URL", "http://<YOUR_AEGIS_DOMAIN>/api")
AEGIS_KEY = _cfg("AEGIS_KEY", "aegis-demo-key-change-me")
VM_NAME   = _cfg("VM_NAME",   "ubuntu")   # ubuntu | pfsense — used by the defense-agent thread

# ─── REMOTE / HUB MODE CONFIG ─────────────────────────────────────────────────
# Used when running with --mode hub on the aegis-forwarder VM (10.30.30.10).
# The hub SSHes into bank VMs to tail their logs AND calls pfSense REST API
# to execute firewall rules — all from one script, one machine.
# Override REMOTE_SSH_USER in aegis_forwarder.local.conf if your user differs.
REMOTE_SSH_USER = _cfg("REMOTE_SSH_USER", "sithu")

# pfSense management IP (reachable from aegis-forwarder via OPT2 segment)
PFSENSE_IP      = _cfg("PFSENSE_IP", "10.30.30.1")

# Per-host sensor list — controls which log tailer threads are spawned per VM.
# Sensors: suricata, snort, fail2ban, ssh, http, ftp, cowrie, postgresql
REMOTE_HOSTS = [
    {
        "name": "bank-web",
        "ip":   "10.10.10.10",
        "sensors": ["suricata", "snort", "fail2ban", "ssh", "http", "ftp"],
        # services to health-check via SSH systemctl on this VM
        "health_services": [
            ("suricata",  "Suricata IDS/IPS",        "sensor"),
            ("fail2ban",  "Fail2ban",                 "sensor"),
            ("apache2",   "HTTP Service (Apache2)",   "sensor"),
            ("vsftpd",    "FTP Service (vsftpd)",     "sensor"),
        ],
    },
    {
        "name": "customer-db",
        "ip":   "10.20.20.20",
        "sensors": ["suricata", "fail2ban", "ssh", "postgresql"],
        "health_services": [
            ("suricata",    "Suricata IDS/IPS",   "sensor"),
            ("fail2ban",    "Fail2ban",            "sensor"),
            ("postgresql",  "PostgreSQL Monitor",  "sensor"),
        ],
    },
]

# Hub mode: the defense agent polls for commands addressed to ALL these VMs
# and routes execution accordingly (local iptables / pfSense API / SSH iptables)
HUB_DEFENSE_VMS = ["aegis", "pfsense"] + [h["name"] for h in REMOTE_HOSTS]

HEADERS = {
    "Content-Type": "application/json",
    "X-AEGIS-Key": AEGIS_KEY,
}

# Admin-key headers for the defense-command queue (separate from ingest HEADERS
# above, since /defense/commands endpoints require X-AEGIS-Admin-Key too)
DEFENSE_HEADERS = {
    "Content-Type":      "application/json",
    "X-AEGIS-Key":       AEGIS_KEY,
    "X-AEGIS-Admin-Key": _cfg("AEGIS_ADMIN_KEY", ""),
}

# pfSense REST API (only used when VM_NAME == "pfsense")
PFSENSE_API_URL = _cfg("PFSENSE_API_URL", f"http://{PFSENSE_IP}/api/v1")
PFSENSE_API_KEY = _cfg("PFSENSE_API_KEY", "")
DEFENSE_POLL_SECS = int(_cfg("DEFENSE_POLL_SECS", "5"))


def get_local_ip() -> str:
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return "127.0.0.1"


def get_mac_address(ip: str) -> str:
    """Get MAC address for the interface that holds the given IP."""
    try:
        out = subprocess.check_output(["ip", "addr"], text=True)
        blocks = re.split(r"\d+: ", out)
        for block in blocks:
            if ip in block:
                m = re.search(r"link/ether\s+([0-9a-f:]{17})", block)
                if m:
                    return m.group(1)
    except Exception:
        pass
    return ""


def get_open_ports() -> str:
    """Return comma-separated list of listening TCP ports (e.g. '22,80,443')."""
    try:
        out = subprocess.check_output(
            ["ss", "-tlnp"], text=True, stderr=subprocess.DEVNULL
        )
        ports = set()
        for line in out.splitlines()[1:]:
            parts = line.split()
            if len(parts) >= 4:
                addr = parts[3]
                port = addr.rsplit(":", 1)[-1]
                if port.isdigit():
                    ports.add(port)
        return ",".join(sorted(ports, key=int)) if ports else ""
    except Exception:
        return ""


def get_os_info() -> str:
    """Read OS pretty name from /etc/os-release."""
    try:
        with open("/etc/os-release") as f:
            for line in f:
                if line.startswith("PRETTY_NAME="):
                    return line.split("=", 1)[1].strip().strip('"')
    except Exception:
        pass
    return "Ubuntu"


# ─── Defense agent (merged from defense_agent.py) ─────────────────────────────
# Polls the AEGIS API for pending defense commands (issued when someone clicks
# "Block IP" on the dashboard, or an auto-defense rule fires) and executes them
# on this machine — iptables locally, or the pfSense REST API when VM_NAME is
# "pfsense". Runs as its own thread alongside the log-forwarding sensors.

def _report_defense_result(cmd_id: int, success: bool, error: str = None):
    try:
        requests.post(
            f"{AEGIS_URL}/defense/commands/{cmd_id}/result",
            json={"success": success, "error": error},
            headers=DEFENSE_HEADERS,
            timeout=5,
        )
    except Exception as e:
        print(f"[defense] [WARN] could not report result for cmd {cmd_id}: {e}")


def _exec_defense_shell(command: str, cmd_id: int):
    print(f"[defense] Executing: {command}")
    try:
        result = subprocess.run(command, shell=True, capture_output=True, text=True, timeout=30)
        if result.returncode == 0:
            print(f"[defense] ✓ Success: {result.stdout.strip()}")
            _report_defense_result(cmd_id, True)
        else:
            err = result.stderr.strip()
            print(f"[defense] ✗ Failed: {err}")
            _report_defense_result(cmd_id, False, err)
    except subprocess.TimeoutExpired:
        print("[defense] ✗ Timeout")
        _report_defense_result(cmd_id, False, "Timeout")
    except Exception as e:
        print(f"[defense] ✗ Error: {e}")
        _report_defense_result(cmd_id, False, str(e))


def _pfsense_headers():
    """Return auth headers for pfSense REST API.
    pfSense-API (community package) accepts:
      Authorization: <client-token>  (v1 style — api_key directly, no Bearer prefix)
    Try without Bearer first; if caller set PFSENSE_API_KEY with bearer prefix that's fine too.
    """
    return {
        "Authorization": PFSENSE_API_KEY,   # pfSense API v1: raw key, no 'Bearer' prefix
        "Content-Type":  "application/json",
    }


def _pfsense_descr(ip: str, reason: str = "") -> str:
    return f"AEGIS-block {ip}" + (f" {reason}" if reason else "")


def _exec_defense_pfsense(payload_json: str, cmd_id: int):
    try:
        payload = json.loads(payload_json)
        action  = payload.get("action")
        ip      = payload.get("ip", "")
        reason  = payload.get("reason", "")
        headers = _pfsense_headers()

        if not PFSENSE_API_KEY:
            msg = "PFSENSE_API_KEY not set in config — skipping pfSense action"
            print(f"[defense] ✗ {msg}")
            _report_defense_result(cmd_id, False, msg)
            return

        if action == "block_ip":
            descr = _pfsense_descr(ip, reason)
            rule  = {
                "type": "block", "interface": "wan", "ipprotocol": "inet",
                "protocol": "any",
                "src": ip, "srcmask": "32",
                "dst": "any",
                "descr": descr,
                "top": True,   # insert at top of ruleset
                "apply": True, # apply immediately
            }
            r = requests.post(f"{PFSENSE_API_URL}/firewall/rule", json=rule,
                               headers=headers, verify=False, timeout=15)
            if r.status_code in (200, 201):
                print(f"[defense] ✓ pfSense blocked {ip}")
                _report_defense_result(cmd_id, True)
            else:
                err = r.text[:300]
                print(f"[defense] ✗ pfSense block error {r.status_code}: {err}")
                _report_defense_result(cmd_id, False, err)

        elif action == "unblock_ip":
            # Find all AEGIS-created rules for this IP by description, then delete them
            r = requests.get(f"{PFSENSE_API_URL}/firewall/rule",
                              headers=headers, verify=False, timeout=10)
            if r.status_code != 200:
                _report_defense_result(cmd_id, False, f"GET rules failed: {r.status_code}")
                return

            rules = r.json().get("data", [])
            prefix = f"AEGIS-block {ip}"
            trackers = [
                rule.get("tracker") for rule in rules
                if rule.get("descr", "").startswith(prefix) and rule.get("tracker")
            ]

            if not trackers:
                print(f"[defense] pfSense unblock {ip}: no AEGIS rule found (already clean)")
                _report_defense_result(cmd_id, True)
                return

            errors = []
            for tracker in trackers:
                d = requests.delete(f"{PFSENSE_API_URL}/firewall/rule",
                                     json={"tracker": tracker, "apply": True},
                                     headers=headers, verify=False, timeout=10)
                if d.status_code in (200, 204):
                    print(f"[defense] ✓ pfSense unblocked {ip} (tracker {tracker})")
                else:
                    errors.append(f"tracker {tracker}: {d.status_code}")

            if errors:
                _report_defense_result(cmd_id, False, "; ".join(errors))
            else:
                _report_defense_result(cmd_id, True)

        elif action == "block_port":
            port  = str(payload.get("port", ""))
            proto = payload.get("protocol", "tcp")
            rule  = {
                "type": "block", "interface": "wan", "ipprotocol": "inet",
                "protocol": proto,
                "src": ip, "srcmask": "32",
                "dst": "any", "dstport": port,
                "descr": _pfsense_descr(ip, f"port-{port}"),
                "top": True, "apply": True,
            }
            r = requests.post(f"{PFSENSE_API_URL}/firewall/rule", json=rule,
                               headers=headers, verify=False, timeout=15)
            if r.status_code in (200, 201):
                print(f"[defense] ✓ pfSense port-blocked {ip}:{port}/{proto}")
                _report_defense_result(cmd_id, True)
            else:
                err = r.text[:300]
                print(f"[defense] ✗ pfSense port-block error {r.status_code}: {err}")
                _report_defense_result(cmd_id, False, err)

        else:
            print(f"[defense] Unknown pfSense action: {action}")
            _report_defense_result(cmd_id, False, f"Unknown action: {action}")

    except Exception as e:
        print(f"[defense] ✗ pfSense error: {e}")
        _report_defense_result(cmd_id, False, str(e))


def _dispatch_defense(cmd: dict):
    cmd_id, command_type, command_text = cmd["id"], cmd.get("commandType", ""), cmd.get("commandText", "")
    print(f"[defense] Command #{cmd_id}: [{command_type}] for {cmd.get('targetIp', '')}")
    if command_type == "pfsense_api":
        _exec_defense_pfsense(command_text, cmd_id)
    else:
        _exec_defense_shell(command_text, cmd_id)


def _exec_defense_ssh_remote(target_ip: str, command: str, cmd_id: int):
    """SSH into a bank VM (bank-web / customer-db) and run an iptables command."""
    ssh_cmd = [
        "ssh", "-T",
        "-o", "StrictHostKeyChecking=no",
        "-o", "ConnectTimeout=10",
        "-o", "BatchMode=yes",
        f"{REMOTE_SSH_USER}@{target_ip}",
        f"sudo {command}",
    ]
    print(f"[defense] SSH → {target_ip}: {command}")
    try:
        result = subprocess.run(ssh_cmd, capture_output=True, text=True, timeout=30)
        if result.returncode == 0:
            print(f"[defense] ✓ SSH {target_ip}: {result.stdout.strip()}")
            _report_defense_result(cmd_id, True)
        else:
            err = result.stderr.strip()
            print(f"[defense] ✗ SSH {target_ip}: {err}")
            _report_defense_result(cmd_id, False, err)
    except subprocess.TimeoutExpired:
        _report_defense_result(cmd_id, False, "SSH timeout")
    except Exception as e:
        _report_defense_result(cmd_id, False, str(e))


def _dispatch_defense_hub(cmd: dict):
    """
    Hub-mode dispatcher: routes defense commands to the right executor.
      target_vm == "pfsense"        → pfSense REST API (PFSENSE_IP)
      target_vm in bank VM names    → SSH iptables into that VM
      target_vm == "aegis" / ""     → local iptables on this machine
    """
    cmd_id       = cmd["id"]
    command_type = cmd.get("commandType", "")
    command_text = cmd.get("commandText", "")
    target_ip    = cmd.get("targetIp", "")
    target_vm    = cmd.get("targetVm") or cmd.get("vm") or ""

    print(f"[defense-hub] Command #{cmd_id}: [{command_type}] vm={target_vm} ip={target_ip}")

    # Route to pfSense REST API
    if target_vm == "pfsense" or command_type == "pfsense_api":
        _exec_defense_pfsense(command_text, cmd_id)
        return

    # Route to bank VMs via SSH
    _remote_ips = {h["name"]: h["ip"] for h in REMOTE_HOSTS}
    if target_vm in _remote_ips:
        _exec_defense_ssh_remote(_remote_ips[target_vm], command_text, cmd_id)
        return

    # Route by target IP if name not matched
    if target_ip:
        _all_remote_ips = {h["ip"] for h in REMOTE_HOSTS}
        if target_ip in _all_remote_ips:
            _exec_defense_ssh_remote(target_ip, command_text, cmd_id)
            return
        if target_ip == PFSENSE_IP:
            _exec_defense_pfsense(command_text, cmd_id)
            return

    # Default: run locally on this machine (AEGIS VM iptables)
    _exec_defense_shell(command_text, cmd_id)


def defense_agent_loop(hub_mode: bool = False):
    """
    Poll for pending defense commands and execute them. Runs forever.

    In hub_mode: polls for ALL hub VMs (aegis, pfsense, bank-web, customer-db)
    and routes each command to the right executor.
    In normal mode: polls only for VM_NAME and runs commands locally.
    """
    if hub_mode:
        vms_to_poll = HUB_DEFENSE_VMS
        print(f"[defense-hub] started — polling for VMs: {vms_to_poll} every {DEFENSE_POLL_SECS}s")
    else:
        vms_to_poll = [VM_NAME]
        print(f"[defense] agent started — vm={VM_NAME}, polling every {DEFENSE_POLL_SECS}s")

    while True:
        for vm in vms_to_poll:
            try:
                r = requests.get(f"{AEGIS_URL}/defense/commands/pending",
                                  params={"vm": vm}, headers=DEFENSE_HEADERS, timeout=10)
                if r.status_code == 200:
                    commands = r.json()
                    if commands:
                        print(f"[defense] → {len(commands)} command(s) for vm={vm}")
                        for cmd in commands:
                            cmd.setdefault("targetVm", vm)
                            if hub_mode:
                                _dispatch_defense_hub(cmd)
                            else:
                                _dispatch_defense(cmd)
                elif r.status_code not in (200, 204):
                    print(f"[defense] [WARN] poll vm={vm} returned {r.status_code}")
            except requests.exceptions.ConnectionError:
                print("[defense] [WARN] cannot reach AEGIS API — retrying...")
                break   # no point polling other VMs if API is down
            except Exception as e:
                print(f"[defense] [ERROR] poll vm={vm}: {e}")
        time.sleep(DEFENSE_POLL_SECS)


def register_host():
    """Register this Ubuntu VM as a connected host in AEGIS Network Monitor."""
    ip       = get_local_ip()
    hostname = socket.gethostname()
    mac      = get_mac_address(ip)
    ports    = get_open_ports()
    os_name  = get_os_info()
    try:
        r = requests.post(
            f"{AEGIS_URL}/network/hosts",
            json={
                "ip":          ip,
                "hostname":    hostname,
                "role":        "ubuntu",
                "os":          os_name,
                "mac":         mac or None,
                "openPorts":   ports or None,
                "status":      "online",
                "isMonitored": True,
            },
            headers=HEADERS,
            timeout=10,
        )
        if r.status_code in (200, 201):
            print(f"  ✓ Host registered: {hostname} ({ip})  MAC={mac or '?'}  Ports={ports or '?'}")
        else:
            print(f"  WARN Host registration: HTTP {r.status_code} — {r.text[:80]}")
    except Exception as e:
        print(f"  WARN Host registration failed: {e}")


def _report_pfsense_online():
    """Report pfSense Firewall component as online (called from heartbeat thread)."""
    try:
        requests.post(
            f"{AEGIS_URL}/system/status",
            json={
                "component":   "pfSense Firewall",
                "layer":       "perimeter",
                "status":      "online",
                "description": "Edge firewall & router — enforces pf rules, blocks attacker IPs at network boundary",
                "metrics":     json.dumps({"agent": "aegis_forwarder", "vm": "pfsense"}),
            },
            headers=HEADERS,
            timeout=5,
        )
    except Exception:
        pass


def heartbeat_loop():
    """Send periodic heartbeat every 15s to keep host status ONLINE.
    Auto-timeout on server is 45s, so 3 missed beats = offline.
    When running on pfSense (VM_NAME=pfsense), also reports pfSense Firewall
    component as 'online' — no API key needed, just AEGIS_INGEST_KEY.
    """
    ip       = get_local_ip()
    hostname = socket.gethostname()
    os_name  = get_os_info()
    role     = "pfsense" if VM_NAME == "pfsense" else "ubuntu"
    while True:
        time.sleep(15)
        try:
            mac   = get_mac_address(ip)
            ports = get_open_ports()
            requests.post(
                f"{AEGIS_URL}/network/hosts",
                json={"ip": ip, "hostname": hostname, "role": role,
                      "os": os_name, "mac": mac or None,
                      "openPorts": ports or None,
                      "status": "online", "isMonitored": True},
                headers=HEADERS,
                timeout=5,
            )
            # pfSense: also report the global pfSense Firewall component as online
            if VM_NAME == "pfsense":
                _report_pfsense_online()
        except Exception:
            pass


def send_offline():
    """Send offline status immediately when script shuts down.
    In hub mode: also marks all remote hosts (bank-web, customer-db) offline
    so the dashboard reflects the real state immediately, rather than waiting
    for the 45s heartbeat timeout.
    """
    ip       = get_local_ip()
    hostname = socket.gethostname()
    # Mark this VM offline
    try:
        requests.post(
            f"{AEGIS_URL}/network/hosts",
            json={"ip": ip, "hostname": hostname, "role": "ubuntu",
                  "status": "offline", "isMonitored": True},
            headers=HEADERS,
            timeout=5,
        )
        print("\n[AEGIS] Sent offline status to dashboard.")
    except Exception:
        pass
    # Hub mode: also mark remote hosts offline immediately
    for h in REMOTE_HOSTS:
        try:
            requests.post(
                f"{AEGIS_URL}/network/hosts",
                json={"ip": h["ip"], "hostname": h["name"], "role": "ubuntu",
                      "status": "offline", "isMonitored": True},
                headers=HEADERS,
                timeout=5,
            )
            print(f"[AEGIS] Marked {h['name']} ({h['ip']}) offline.")
        except Exception:
            pass


def get_service_status(service: str) -> str:
    """Check if a systemd service is active."""
    try:
        result = subprocess.run(
            ["systemctl", "is-active", service],
            capture_output=True, text=True, timeout=5,
        )
        return "online" if result.stdout.strip() == "active" else "offline"
    except Exception:
        return "unknown"


# Map: (check_key, component, layer, check_type)
# check_type "systemctl" → systemctl is-active <check_key>
# check_type "port"      → check if TCP port <check_key> is listening (ss -tlnp)
SERVICE_MAP = [
    ("suricata",    "Suricata IDS/IPS",    "sensor", "systemctl"),
    ("fail2ban",    "Fail2ban",            "sensor", "systemctl"),
    ("postgresql",  "PostgreSQL Monitor",  "sensor", "systemctl"),
    (":80",         "Morgan HTTP Logger",  "sensor", "port"),
]


def check_sensor_status(check_key: str, check_type: str) -> str:
    """Return 'online', 'offline', or 'unknown'."""
    try:
        if check_type == "systemctl":
            result = subprocess.run(
                ["systemctl", "is-active", check_key],
                capture_output=True, text=True, timeout=5,
            )
            return "online" if result.stdout.strip() == "active" else "offline"
        elif check_type == "port":
            out = subprocess.check_output(
                ["ss", "-tlnp"], text=True, stderr=subprocess.DEVNULL
            )
            return "online" if check_key in out else "offline"
    except Exception:
        return "unknown"
    return "unknown"


def service_health_loop():
    """
    Report real sensor health to AEGIS every 30s.
    Updates system_status table → triggers SSE service_status_change → real-time UI update.
    Sensors: Suricata, Fail2ban, PostgreSQL (systemctl), Morgan HTTP Logger (port :80).
    """
    print("[SERVICE HEALTH] Monitoring: suricata, fail2ban, postgresql, morgan(:80)")
    own_ip = get_local_ip()
    while True:
        for check_key, component, layer, check_type in SERVICE_MAP:
            status = check_sensor_status(check_key, check_type)
            ts = datetime.now().strftime("%H:%M:%S")
            try:
                r = requests.post(
                    f"{AEGIS_URL}/system/status",
                    json={
                        "component": component,
                        "layer":     layer,
                        "status":    status,
                        "hostIp":    own_ip,
                        "metrics":   json.dumps({
                            "check":      check_key,
                            "type":       check_type,
                            "checked_at": datetime.now().isoformat(),
                        }),
                    },
                    headers=HEADERS,
                    timeout=5,
                )
                indicator = "✓" if status == "online" else "✗"
                if r.status_code in (200, 201):
                    print(f"[{ts}] {indicator} {component}: {status.upper()}")
                else:
                    print(f"[{ts}] WARN service_health/{check_key}: HTTP {r.status_code}")
            except Exception as e:
                print(f"[{ts}] ERROR service_health/{check_key}: {e}")
        time.sleep(30)


def post(endpoint: str, data: dict):
    try:
        r = requests.post(
            f"{AEGIS_URL}/ingest/{endpoint}",
            json=data,
            headers=HEADERS,
            timeout=5,
        )
        ts = datetime.now().strftime("%H:%M:%S")
        if r.status_code == 201:
            print(f"[{ts}] ✓ {endpoint.upper()} → AEGIS")
        else:
            print(f"[{ts}] WARN {endpoint}: HTTP {r.status_code} — {r.text[:80]}")
    except Exception as e:
        print(f"[ERROR] Cannot reach AEGIS: {e}")


def tail_file(path: str):
    """Yield new lines appended to a file (tail -f)."""
    try:
        with open(path, "r") as f:
            f.seek(0, 2)
            while True:
                line = f.readline()
                if line:
                    yield line.strip()
                else:
                    time.sleep(0.3)
    except FileNotFoundError:
        print(f"[WARN] File not found: {path} — retrying in 10s")
        time.sleep(10)


# ─── SURICATA (eve.json) ──────────────────────────────────────────────────────
SURICATA_LOG = "/var/log/suricata/eve.json"


def watch_suricata():
    print(f"[SURICATA] Watching {SURICATA_LOG}")
    for line in tail_file(SURICATA_LOG):
        try:
            evt = json.loads(line)
            etype = evt.get("event_type")

            if etype == "alert":
                post("suricata", evt)

            elif etype == "tls":
                # Encrypted traffic logging
                post("suricata/tls", {
                    "src_ip":    evt.get("src_ip"),
                    "dest_ip":   evt.get("dest_ip"),
                    "dest_port": evt.get("dest_port"),
                    "tls":       evt.get("tls", {}),
                })

        except json.JSONDecodeError:
            pass


# ─── SNORT (alert_fast) ───────────────────────────────────────────────────────
SNORT_LOG = "/var/log/snort/alert"


def watch_snort():
    print(f"[SNORT] Watching {SNORT_LOG}")
    for line in tail_file(SNORT_LOG):
        if "[**]" not in line:
            continue
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


# ─── FAIL2BAN ─────────────────────────────────────────────────────────────────
FAIL2BAN_LOG = "/var/log/fail2ban.log"
FAIL2BAN_RE  = re.compile(r"NOTICE\s+\[(\S+)\] Ban ([\d.]+)")


def watch_fail2ban():
    print(f"[FAIL2BAN] Watching {FAIL2BAN_LOG}")
    _own_ip = get_local_ip()
    for line in tail_file(FAIL2BAN_LOG):
        m = FAIL2BAN_RE.search(line)
        if not m:
            continue
        post("fail2ban", {
            "jail":      m.group(1),
            "ip":        m.group(2),
            "failures":  5,
            "target_ip": _own_ip,   # this VM is the target being protected
        })


# ─── SSH auth.log ─────────────────────────────────────────────────────────────
# /var/log/auth.log on Ubuntu
SSH_LOG = "/var/log/auth.log"

# "Failed password for root from 192.168.1.5 port 54321 ssh2"
SSH_FAIL_RE    = re.compile(r"Failed password for (\S+) from ([\d.]+)")
# "Accepted password for ubuntu from 192.168.1.10 port 22 ssh2"
SSH_SUCCESS_RE = re.compile(r"Accepted (password|publickey) for (\S+) from ([\d.]+)")


def watch_ssh():
    print(f"[SSH] Watching {SSH_LOG}")
    fail_counts: dict[str, int] = {}

    # IPs that belong to our own lab infrastructure — never flag as attackers
    OWN_IP = get_local_ip()
    DEFENDER_IPS = {
        "10.10.10.10",   # bank-web
        "10.20.20.20",   # customer-db
        OWN_IP,          # this VM itself
    }

    for line in tail_file(SSH_LOG):
        m_fail = SSH_FAIL_RE.search(line)
        if m_fail:
            user, ip = m_fail.group(1), m_fail.group(2)
            if ip in DEFENDER_IPS:
                continue   # skip hub's own management SSH
            fail_counts[ip] = fail_counts.get(ip, 0) + 1
            post("ssh", {
                "src_ip":    ip,
                "dest_ip":   OWN_IP,   # this VM is the SSH target
                "username":  user,
                "status":    "failed",
                "failures":  fail_counts[ip],
            })

        m_ok = SSH_SUCCESS_RE.search(line)
        if m_ok:
            auth, user, ip = m_ok.group(1), m_ok.group(2), m_ok.group(3)
            if ip in DEFENDER_IPS:
                continue   # skip hub's own management SSH
            fail_counts.pop(ip, None)
            post("ssh", {
                "src_ip":      ip,
                "dest_ip":     OWN_IP,   # this VM is the SSH target
                "username":    user,
                "status":      "success",
                "auth_method": auth,
            })


# ─── FTP (vsftpd / proftpd) ───────────────────────────────────────────────────
FTP_LOG = "/var/log/vsftpd.log"

# vsftpd: "OK UPLOAD: Client "192.168.1.5", "/etc/passwd", 1024 bytes"
FTP_RE = re.compile(
    r"(OK|FAIL) (UPLOAD|DOWNLOAD|LOGIN|MKDIR|DELETE): Client \"([\d.]+)\",? \"?([^\",]*)\"?,?\s*(\d+)?"
)


def watch_ftp():
    print(f"[FTP] Watching {FTP_LOG}")
    for line in tail_file(FTP_LOG):
        m = FTP_RE.search(line)
        if not m:
            continue
        status_str, cmd, ip, path, size = m.groups()
        cmd_map = {"UPLOAD": "STOR", "DOWNLOAD": "RETR", "LOGIN": "USER",
                   "MKDIR": "MKD", "DELETE": "DELE"}
        post("ftp", {
            "src_ip":    ip,
            "command":   cmd_map.get(cmd, cmd),
            "file_path": path or None,
            "file_size": int(size) if size else None,
            "status":    "success" if status_str == "OK" else "failed",
        })


# ─── HTTP / ModSecurity ───────────────────────────────────────────────────────
# ModSecurity audit log: /var/log/apache2/modsec_audit.log
# or parse Nginx access log with custom format
MODSEC_LOG = "/var/log/apache2/modsec_audit.log"

# ModSecurity message line:
# [id "981243"] [msg "XSS Attack"] [severity "CRITICAL"] [tag "attack-xss"]
MODSEC_MSG_RE = re.compile(r'\[id "(\d+)"\].*\[msg "([^"]+)"\].*\[severity "([^"]+)"\]')
MODSEC_IP_RE  = re.compile(r"^\[.*?\] .* (\d+\.\d+\.\d+\.\d+) \d+ (\w+) (.*?) HTTP")


def watch_modsecurity():
    print(f"[MODSECURITY] Watching {MODSEC_LOG}")
    current_ip = None
    current_method = None
    current_url = None

    for line in tail_file(MODSEC_LOG):
        ip_m = MODSEC_IP_RE.search(line)
        if ip_m:
            current_ip     = ip_m.group(1)
            current_method = ip_m.group(2)
            current_url    = ip_m.group(3)

        msg_m = MODSEC_MSG_RE.search(line)
        if msg_m and current_ip:
            rule_id, msg, severity = msg_m.groups()

            # Map message to attack type
            msg_lower = msg.lower()
            if   "sql"       in msg_lower: atype = "SQLi"
            elif "xss"       in msg_lower: atype = "XSS"
            elif "traversal" in msg_lower or "lfi" in msg_lower: atype = "LFI"
            elif "rfi"       in msg_lower: atype = "RFI"
            elif "csrf"      in msg_lower: atype = "CSRF"
            elif "brute"     in msg_lower: atype = "Brute"
            else:                          atype = "HTTP Attack"

            post("http", {
                "src_ip":      current_ip,
                "url":         current_url or "/",
                "method":      current_method or "GET",
                "attack_type": atype,
                "payload":     msg,
                "rule_id":     rule_id,
                "blocked":     severity.upper() in ("CRITICAL", "ERROR"),
            })
            current_ip = None


# ─── COWRIE ───────────────────────────────────────────────────────────────────
COWRIE_LOG = "/home/cowrie/cowrie/var/log/cowrie/cowrie.json"
COWRIE_EVENTS = {"cowrie.login.failed", "cowrie.login.success", "cowrie.command.input", "cowrie.session.connect"}


def watch_cowrie():
    print(f"[COWRIE] Watching {COWRIE_LOG}")
    for line in tail_file(COWRIE_LOG):
        try:
            evt = json.loads(line)
            if evt.get("eventid") in COWRIE_EVENTS:
                post("cowrie", evt)
        except json.JSONDecodeError:
            pass


# ─── REMOTE MODE (hub SSHes into bank VMs) ───────────────────────────────────

def _ssh_tail(host_name: str, host_ip: str, log_path: str):
    """
    Generator: SSHes into host_ip and yields lines from `tail -F log_path`.
    Reconnects automatically on disconnect. Uses key-based auth (no password).
    """
    ssh_cmd = [
        "ssh", "-T",
        "-o", "StrictHostKeyChecking=no",
        "-o", "ConnectTimeout=10",
        "-o", "ServerAliveInterval=15",
        "-o", "ServerAliveCountMax=3",
        "-o", "BatchMode=yes",        # fail immediately if key auth not set up
        f"{REMOTE_SSH_USER}@{host_ip}",
        f"tail -F {log_path} 2>/dev/null",
    ]
    while True:
        try:
            proc = subprocess.Popen(
                ssh_cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True
            )
            print(f"[SSH] Connected → {REMOTE_SSH_USER}@{host_ip}:{log_path}")
            for line in proc.stdout:
                line = line.strip()
                if line:
                    yield line
            proc.wait()
            print(f"[{host_name}] SSH disconnected from {host_ip} — reconnecting in 10s")
        except Exception as e:
            print(f"[{host_name}] SSH error ({host_ip}): {e} — retrying in 10s")
        time.sleep(10)


def _remote_sysinfo(host_ip: str) -> dict:
    """
    SSH into a remote VM and collect OS name, MAC address, and open ports
    in a single connection. Returns a dict with keys: os, mac, open_ports.
    Falls back to empty strings on any error.
    """
    # One SSH session, three commands separated by |||
    cmd_str = (
        "printf '%s|||%s|||%s' "
        "\"$(grep PRETTY_NAME /etc/os-release 2>/dev/null | cut -d= -f2 | tr -d '\"')\" "
        "\"$(ip addr 2>/dev/null | awk '/link\\/ether/{print $2; exit}')\" "
        "\"$(ss -tlnp 2>/dev/null | awk 'NR>1{split($4,a,\":\"); print a[length(a)]}' "
        "| sort -un | tr '\\n' ',')\""
    )
    ssh_cmd = [
        "ssh", "-T",
        "-o", "StrictHostKeyChecking=no",
        "-o", "ConnectTimeout=8",
        "-o", "BatchMode=yes",
        f"{REMOTE_SSH_USER}@{host_ip}",
        cmd_str,
    ]
    result = {"os": "", "mac": "", "open_ports": ""}
    try:
        out = subprocess.check_output(ssh_cmd, stderr=subprocess.DEVNULL, timeout=12, text=True).strip()
        parts = out.split("|||")
        if len(parts) == 3:
            result["os"]         = parts[0].strip()
            result["mac"]        = parts[1].strip()
            result["open_ports"] = parts[2].strip().rstrip(",")
    except Exception as e:
        print(f"  WARN sysinfo SSH {host_ip}: {e}")
    return result


def _remote_register_host(host_name: str, host_ip: str):
    """SSH into remote VM, collect system info, then register in AEGIS Network Monitor."""
    print(f"  [*] Collecting sysinfo from {host_name} ({host_ip})...")
    info = _remote_sysinfo(host_ip)
    try:
        r = requests.post(
            f"{AEGIS_URL}/network/hosts",
            json={
                "ip":          host_ip,
                "hostname":    host_name,
                "role":        "ubuntu",
                "os":          info["os"] or None,
                "mac":         info["mac"] or None,
                "openPorts":   info["open_ports"] or None,
                "status":      "online",
                "isMonitored": True,
            },
            headers=HEADERS,
            timeout=10,
        )
        if r.status_code in (200, 201):
            print(
                f"  ✓ {host_name} ({host_ip})"
                f"  OS={info['os'] or '?'}"
                f"  MAC={info['mac'] or '?'}"
                f"  Ports={info['open_ports'] or '?'}"
            )
        else:
            print(f"  WARN Remote host registration {host_name}: HTTP {r.status_code}")
    except Exception as e:
        print(f"  WARN Remote host registration {host_name} failed: {e}")


def _watch_remote_suricata(host_name: str, host_ip: str):
    """Tail Suricata eve.json on a remote VM via SSH and forward events."""
    print(f"[{host_name}] suricata thread started")
    for line in _ssh_tail(host_name, host_ip, "/var/log/suricata/eve.json"):
        try:
            evt = json.loads(line)
            etype = evt.get("event_type")
            # Stamp the source VM so the dashboard knows which host triggered it
            evt.setdefault("src_ip", host_ip)
            if etype == "alert":
                post("suricata", evt)
            elif etype == "tls":
                post("suricata/tls", {
                    "src_ip":    evt.get("src_ip", host_ip),
                    "dest_ip":   evt.get("dest_ip"),
                    "dest_port": evt.get("dest_port"),
                    "tls":       evt.get("tls", {}),
                })
        except json.JSONDecodeError:
            pass


def _watch_remote_snort(host_name: str, host_ip: str):
    """Tail Snort alert_fast on a remote VM via SSH and forward events."""
    print(f"[{host_name}] snort thread started")
    for line in _ssh_tail(host_name, host_ip, "/var/log/snort/alert"):
        if "[**]" not in line:
            continue
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


def _watch_remote_ssh(host_name: str, host_ip: str):
    """Tail auth.log on a remote VM via SSH and forward failed/success login events."""
    _defender_ips = {h["ip"] for h in REMOTE_HOSTS} | {"10.30.30.10"}
    fail_counts: dict[str, int] = {}
    print(f"[{host_name}] ssh thread started")
    for line in _ssh_tail(host_name, host_ip, "/var/log/auth.log"):
        m_fail = SSH_FAIL_RE.search(line)
        if m_fail:
            user, ip = m_fail.group(1), m_fail.group(2)
            if ip in _defender_ips:
                continue
            fail_counts[ip] = fail_counts.get(ip, 0) + 1
            post("ssh", {
                "src_ip":    ip,
                "username":  user,
                "status":    "failed",
                "failures":  fail_counts[ip],
                "targetHost": host_ip,
            })
            continue
        m_ok = SSH_SUCCESS_RE.search(line)
        if m_ok:
            _, user, ip = m_ok.group(1), m_ok.group(2), m_ok.group(3)
            if ip in _defender_ips:
                continue
            post("ssh", {
                "src_ip":    ip,
                "username":  user,
                "status":    "success",
                "failures":  0,
                "targetHost": host_ip,
            })


def _watch_remote_fail2ban(host_name: str, host_ip: str):
    """Tail fail2ban.log on a remote VM via SSH and forward ban events."""
    # Never report our own hub or any bank VM as an attacker —
    # aegis-forwarder SSHes into bank VMs so fail2ban may temporarily ban it.
    _defender_ips = {h["ip"] for h in REMOTE_HOSTS} | {"10.30.30.10"}
    print(f"[{host_name}] fail2ban thread started")
    for line in _ssh_tail(host_name, host_ip, "/var/log/fail2ban.log"):
        m = FAIL2BAN_RE.search(line)
        if not m:
            continue
        banned_ip = m.group(2)
        if banned_ip in _defender_ips:
            print(f"[{host_name}] fail2ban: skipped defender IP {banned_ip}")
            continue
        post("fail2ban", {
            "jail":      m.group(1),
            "ip":        banned_ip,
            "failures":  5,
            "target_ip": host_ip,
        })


def _watch_remote_modsecurity(host_name: str, host_ip: str):
    """Tail ModSecurity audit log on a remote VM (bank-web) via SSH."""
    log_path = "/var/log/apache2/modsec_audit.log"
    print(f"[{host_name}] http/modsecurity thread started")
    current_ip     = None
    current_method = None
    current_url    = None
    for line in _ssh_tail(host_name, host_ip, log_path):
        ip_m = MODSEC_IP_RE.search(line)
        if ip_m:
            current_ip     = ip_m.group(1)
            current_method = ip_m.group(2)
            current_url    = ip_m.group(3)
            continue
        msg_m = MODSEC_MSG_RE.search(line)
        if msg_m and current_ip:
            rule_id, msg, severity = msg_m.groups()
            msg_lower = msg.lower()
            if   "sql"       in msg_lower: atype = "SQLi"
            elif "xss"       in msg_lower: atype = "XSS"
            elif "traversal" in msg_lower or "lfi" in msg_lower: atype = "LFI"
            elif "rfi"       in msg_lower: atype = "RFI"
            elif "csrf"      in msg_lower: atype = "CSRF"
            elif "brute"     in msg_lower: atype = "Brute"
            else:                          atype = "HTTP Attack"
            post("http", {
                "src_ip":      current_ip,
                "dest_ip":     host_ip,
                "url":         current_url or "/",
                "method":      current_method or "GET",
                "attack_type": atype,
                "payload":     msg,
                "rule_id":     rule_id,
                "blocked":     severity.upper() in ("CRITICAL", "ERROR"),
                "targetHost":  host_name,
            })
            current_ip = None


def _watch_remote_ftp(host_name: str, host_ip: str):
    """Tail vsftpd/proftpd log on a remote VM via SSH."""
    print(f"[{host_name}] ftp thread started")
    for line in _ssh_tail(host_name, host_ip, "/var/log/vsftpd.log"):
        m = FTP_RE.search(line)
        if not m:
            continue
        status_str, cmd, ip, path, size = m.groups()
        cmd_map = {"UPLOAD": "STOR", "DOWNLOAD": "RETR", "LOGIN": "USER",
                   "MKDIR": "MKD", "DELETE": "DELE"}
        post("ftp", {
            "src_ip":     ip,
            "dest_ip":    host_ip,
            "command":    cmd_map.get(cmd, cmd),
            "file_path":  path or None,
            "file_size":  int(size) if size else None,
            "status":     "success" if status_str == "OK" else "failed",
            "targetHost": host_name,
        })


# PostgreSQL log line examples:
# 2024-01-01 12:00:00 UTC [1234]: [1-1] user=app,db=bankdb,host=192.168.1.5 ERROR: syntax error ...
# 2024-01-01 12:00:00 UTC [1234]: [1-1] user=app,db=bankdb,host=192.168.1.5 FATAL: password auth failed
_PG_LOG_RE = re.compile(
    r"user=(\S+),db=(\S+),host=([\d.]+).*?(ERROR|FATAL|WARNING|LOG):\s*(.+)"
)
_PG_AUTH_FAIL_RE = re.compile(
    r"FATAL:\s+password authentication failed for user \"(\S+)\""
)
_PG_SQL_RE = re.compile(
    r"(syntax error|invalid input|division by zero|out of range|"
    r"ERROR.*column.*does not exist|SELECT.*FROM.*WHERE.*=.*')", re.IGNORECASE
)


def _watch_remote_postgresql(host_name: str, host_ip: str):
    """Tail PostgreSQL log on customer-db via SSH and forward auth failures and SQL errors."""
    # Default pg log location on Ubuntu (may vary by version)
    log_path = "/var/log/postgresql/postgresql-*.log"
    # Use tail -F with glob expansion via bash
    ssh_cmd = [
        "ssh", "-T",
        "-o", "StrictHostKeyChecking=no",
        "-o", "ConnectTimeout=10",
        "-o", "ServerAliveInterval=15",
        "-o", "ServerAliveCountMax=3",
        "-o", "BatchMode=yes",
        f"{REMOTE_SSH_USER}@{host_ip}",
        f"bash -c 'tail -F {log_path} 2>/dev/null'",
    ]
    print(f"[{host_name}] postgresql thread started")
    _defender_ips = {h["ip"] for h in REMOTE_HOSTS} | {"10.30.30.10"}
    while True:
        try:
            proc = subprocess.Popen(
                ssh_cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True
            )
            print(f"[{host_name}] postgresql: SSH connected → {host_ip}:{log_path}")
            for line in proc.stdout:
                line = line.strip()
                if not line:
                    continue
                m = _PG_LOG_RE.search(line)
                if not m:
                    continue
                user, db, client_ip, level, msg = m.groups()
                if client_ip in _defender_ips:
                    continue
                # Auth failure — report as SSH-like brute/credential event
                if "password authentication failed" in msg or "authentication failed" in msg:
                    post("event", {
                        "source":      "postgresql",
                        "type":        "db_auth_failure",
                        "severity":    "high",
                        "srcIp":       client_ip,
                        "targetHost":  host_ip,
                        "description": f"PostgreSQL auth failure: user={user} db={db} — {msg[:120]}",
                        "rawData":     line[:300],
                    })
                # SQL injection patterns
                elif _PG_SQL_RE.search(msg):
                    post("event", {
                        "source":      "postgresql",
                        "type":        "db_sql_error",
                        "severity":    "medium",
                        "srcIp":       client_ip,
                        "targetHost":  host_ip,
                        "description": f"PostgreSQL SQL anomaly: user={user} db={db} — {msg[:120]}",
                        "rawData":     line[:300],
                    })
            proc.wait()
            print(f"[{host_name}] postgresql: SSH disconnected — reconnecting in 10s")
        except Exception as e:
            print(f"[{host_name}] postgresql error: {e} — retrying in 10s")
        time.sleep(10)


def _remote_heartbeat_loop(hosts: list):
    """Send online heartbeat for every remote bank VM every 15s.
    Without this they time out (server marks offline after 45s / 3 missed beats).
    """
    while True:
        time.sleep(15)
        for h in hosts:
            try:
                requests.post(
                    f"{AEGIS_URL}/network/hosts",
                    json={"ip": h["ip"], "hostname": h["name"],
                          "role": "ubuntu", "status": "online", "isMonitored": True},
                    headers=HEADERS,
                    timeout=5,
                )
            except Exception:
                pass


def _remote_service_health_loop(hosts: list):
    """SSH into each bank VM every 30s and report real service health to AEGIS.
    Each host uses its own health_services list so bank-web and customer-db
    get the right set of checks (no postgresql on bank-web, no apache2 on customer-db).
    """
    print("[REMOTE SERVICE HEALTH] Monitoring bank-web & customer-db every 30s via SSH")
    for h in hosts:
        svcs = [s[0] for s in h.get("health_services", [])]
        print(f"[REMOTE SERVICE HEALTH]   {h['name']}: {', '.join(svcs)}")

    while True:
        for h in hosts:
            health_svcs = h.get("health_services", [])
            if not health_svcs:
                continue
            # Build one SSH command: check every service via systemctl in a single call
            cmds = " ".join(
                f"$(systemctl is-active {svc} 2>/dev/null || echo unknown)"
                for svc, _, _ in health_svcs
            )
            full_cmd = f"printf '%s ' {cmds}"
            ssh_cmd = [
                "ssh", "-T",
                "-o", "StrictHostKeyChecking=no",
                "-o", "ConnectTimeout=5",
                "-o", "BatchMode=yes",
                f"{REMOTE_SSH_USER}@{h['ip']}",
                full_cmd,
            ]
            try:
                out = subprocess.check_output(
                    ssh_cmd, stderr=subprocess.DEVNULL, timeout=8, text=True
                ).strip().split()
                ts = datetime.now().strftime("%H:%M:%S")
                for i, (svc, component, layer) in enumerate(health_svcs):
                    raw = out[i] if i < len(out) else "unknown"
                    status = "online" if raw == "active" else ("unknown" if raw == "unknown" else "offline")
                    indicator = "✓" if status == "online" else "✗"
                    try:
                        requests.post(
                            f"{AEGIS_URL}/system/status",
                            json={"component": component, "layer": layer,
                                  "status": status, "hostIp": h["ip"]},
                            headers=HEADERS,
                            timeout=5,
                        )
                    except Exception:
                        pass
                    print(f"[{ts}] [{h['name']}] {indicator} {component}: {status.upper()}")
            except Exception as e:
                print(f"[REMOTE SERVICE HEALTH] {h['name']} SSH error: {e}")
        time.sleep(30)


def _pfsense_health_loop():
    """Report pfSense Firewall as online/offline every 30s in hub mode.
    Tries HTTP to pfSense management IP — if reachable → online, else → offline.
    No API key needed; just connectivity from AEGIS VM to pfSense OPT2 interface.
    """
    print(f"[PFSENSE HEALTH] Monitoring pfSense ({PFSENSE_IP}) every 30s")
    while True:
        try:
            r = requests.get(f"http://{PFSENSE_IP}", timeout=5)
            status = "online"   # pfSense web UI responded (even 200/302/403 = reachable)
        except Exception:
            status = "offline"
        ts = datetime.now().strftime("%H:%M:%S")
        indicator = "✓" if status == "online" else "✗"
        print(f"[{ts}] {indicator} pfSense Firewall ({PFSENSE_IP}): {status.upper()}")
        try:
            requests.post(
                f"{AEGIS_URL}/system/status",
                json={
                    "component":   "pfSense Firewall",
                    "layer":       "perimeter",
                    "status":      status,
                    "description": "Edge firewall & router — enforces pf rules, blocks attacker IPs at network boundary",
                    "metrics":     json.dumps({"agent": "hub", "ip": PFSENSE_IP}),
                },
                headers=HEADERS,
                timeout=5,
            )
        except Exception:
            pass
        time.sleep(30)


def run_hub_mode():
    """
    Hub mode: aegis-forwarder VM (10.30.30.10) SSHes into each bank VM and
    tails their logs. Sensor threads are spawned per-host based on the
    'sensors' key in REMOTE_HOSTS. Defense commands are routed to the right
    executor (local iptables / pfSense API / SSH iptables on bank VMs).

    Supported sensors per host:
      suricata   — /var/log/suricata/eve.json
      snort      — /var/log/snort/alert
      fail2ban   — /var/log/fail2ban.log
      ssh        — /var/log/auth.log
      http       — /var/log/apache2/modsec_audit.log  (bank-web)
      ftp        — /var/log/vsftpd.log                (bank-web)
      postgresql — /var/log/postgresql/*.log           (customer-db)
      cowrie     — cowrie.json honeypot log
    """
    _SENSOR_FN = {
        "suricata":   _watch_remote_suricata,
        "snort":      _watch_remote_snort,
        "fail2ban":   _watch_remote_fail2ban,
        "ssh":        _watch_remote_ssh,
        "http":       _watch_remote_modsecurity,
        "ftp":        _watch_remote_ftp,
        "postgresql": _watch_remote_postgresql,
    }

    print(f"\n  Hub mode — remote hosts ({len(REMOTE_HOSTS)}):")
    for h in REMOTE_HOSTS:
        sensors_str = ", ".join(h.get("sensors", []))
        print(f"    {h['name']:15s} {h['ip']}  sensors=[{sensors_str}]")
        _remote_register_host(h["name"], h["ip"])
    print(f"  pfSense API  : {PFSENSE_IP} (for defense commands)")
    print(f"  Defense VMs  : {HUB_DEFENSE_VMS}")
    print()

    threads = []

    # Heartbeat — keeps remote VMs ONLINE (server marks offline after 45s / 3 misses)
    hb = threading.Thread(target=_remote_heartbeat_loop, args=(REMOTE_HOSTS,),
                          daemon=True, name="remote-heartbeat")
    hb.start()
    threads.append(hb)
    print("  ► remote heartbeat thread started")

    # Service health — SSHes into each bank VM every 30s, checks systemctl per-host
    sh = threading.Thread(target=_remote_service_health_loop, args=(REMOTE_HOSTS,),
                          daemon=True, name="remote-service-health")
    sh.start()
    threads.append(sh)
    print("  ► remote service health thread started")

    # pfSense health — ping pfSense management IP every 30s, report online/offline
    pf = threading.Thread(target=_pfsense_health_loop, daemon=True, name="pfsense-health")
    pf.start()
    threads.append(pf)
    print("  ► pfSense health thread started")
    print()

    # Log tailer threads — one per (host × sensor)
    for h in REMOTE_HOSTS:
        for sensor in h.get("sensors", []):
            fn = _SENSOR_FN.get(sensor)
            if fn is None:
                print(f"  [WARN] Unknown sensor '{sensor}' for {h['name']} — skipped")
                continue
            t = threading.Thread(
                target=fn,
                args=(h["name"], h["ip"]),
                daemon=True,
                name=f"{h['name']}-{sensor}",
            )
            t.start()
            threads.append(t)
            print(f"  ► {h['name']}/{sensor} thread started")

    print()
    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        shutdown()


# Keep backward-compat alias
def run_remote_mode():
    run_hub_mode()


# ─── MAIN ────────────────────────────────────────────────────────────────────
MODES = {
    "suricata":    watch_suricata,
    "snort":       watch_snort,
    "fail2ban":    watch_fail2ban,
    "ssh":         watch_ssh,
    "ftp":         watch_ftp,
    "http":        watch_modsecurity,
    "cowrie":      watch_cowrie,
}

if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="AEGIS Forwarder — Blue Team hub script",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Modes:
  hub     Run on the AEGIS VM (10.30.30.10): SSHes into bank-web + customer-db to
          tail their logs, calls pfSense REST API for firewall commands, and runs
          the defense agent for ALL VMs.  One script, one machine, everything.
  all     Run all local sensors on THIS machine (normal forwarder mode).
  remote  Alias for hub (backward compat).
  <name>  Run a single local sensor: suricata | snort | fail2ban | ssh | ftp | http | cowrie
""",
    )
    parser.add_argument("--mode", choices=list(MODES.keys()) + ["all", "remote", "hub"], default="all")
    parser.add_argument("--url", help="AEGIS API URL override")
    parser.add_argument("--key", help="AEGIS ingest key override")
    parser.add_argument("--admin-key", dest="admin_key", help="AEGIS admin key override")
    parser.add_argument("--no-defense", action="store_true",
                         help="Skip the defense-agent thread (log forwarding only)")
    args = parser.parse_args()

    if args.url:
        AEGIS_URL = args.url
    if args.key:
        AEGIS_KEY = args.key
        HEADERS["X-AEGIS-Key"] = args.key
        DEFENSE_HEADERS["X-AEGIS-Key"] = args.key
    if args.admin_key:
        DEFENSE_HEADERS["X-AEGIS-Admin-Key"] = args.admin_key

    _is_hub = args.mode in ("hub", "remote")

    print(f"""
╔══════════════════════════════════════════════════════════════════╗
║            AEGIS Forwarder — Blue Team v3                        ║
╚══════════════════════════════════════════════════════════════════╝
  Target  : {AEGIS_URL}
  Mode    : {args.mode}{"  ← hub: covers bank-web, customer-db, pfSense" if _is_hub else ""}
  VM_NAME : {VM_NAME}
""")

    # Register this AEGIS VM in Network Monitor on startup
    print("  [*] Registering host with AEGIS...")
    register_host()

    # Heartbeat — server marks host offline after 45s / 3 missed beats
    hb = threading.Thread(target=heartbeat_loop, daemon=True, name="heartbeat")
    hb.start()

    # Local service health:
    #   NON-hub mode → run full SERVICE_MAP checks (suricata/fail2ban/etc on THIS VM)
    #   Hub mode     → skip local checks; _remote_service_health_loop() covers bank VMs
    #                  via SSH.  Running both causes UP/DOWN flapping: local suricata
    #                  is NOT installed on AEGIS VM → posts OFFLINE, remote loop
    #                  sees suricata ONLINE on bank-web → posts ONLINE, seconds apart.
    if not _is_hub:
        sh = threading.Thread(target=service_health_loop, daemon=True, name="service_health")
        sh.start()
        print("  ► service_health thread started (local sensors)")
    else:
        # In hub mode just heartbeat the Hub Forwarder component itself as ONLINE
        def _hub_self_health():
            own_ip = get_local_ip()
            while True:
                try:
                    requests.post(
                        f"{AEGIS_URL}/system/status",
                        json={
                            "component": "Hub Forwarder",
                            "layer":     "sensor",
                            "status":    "online",
                            "hostIp":    own_ip,
                            "metrics":   json.dumps({"pid": os.getpid(), "mode": "hub"}),
                        },
                        headers=HEADERS,
                        timeout=5,
                    )
                except Exception:
                    pass
                time.sleep(30)
        sh = threading.Thread(target=_hub_self_health, daemon=True, name="hub_self_health")
        sh.start()
        print("  ► hub_self_health thread started (Hub Forwarder heartbeat only)")

    def shutdown(sig=None, frame=None):
        """Send offline status immediately before exiting."""
        send_offline()
        print("[AEGIS] Forwarder stopped.")
        sys.exit(0)

    import signal as _signal
    _signal.signal(_signal.SIGINT,  shutdown)
    _signal.signal(_signal.SIGTERM, shutdown)

    # Defense agent — hub mode polls for ALL VMs and routes commands
    if not args.no_defense:
        dt = threading.Thread(
            target=defense_agent_loop,
            kwargs={"hub_mode": _is_hub},
            daemon=True,
            name="defense_agent",
        )
        dt.start()
        if _is_hub:
            print(f"  ► defense_agent thread started (hub — covering {HUB_DEFENSE_VMS})")
        else:
            print(f"  ► defense_agent thread started (vm={VM_NAME})")

    if _is_hub:
        print(f"  SSH user: {REMOTE_SSH_USER}")
        print()
        run_hub_mode()
    elif args.mode == "all":
        threads = []
        for name, fn in MODES.items():
            t = threading.Thread(target=fn, daemon=True, name=name)
            t.start()
            threads.append(t)
            print(f"  ► {name} thread started")
        print()
        try:
            while True:
                time.sleep(1)
        except KeyboardInterrupt:
            shutdown()
    else:
        try:
            MODES[args.mode]()
        except KeyboardInterrupt:
            shutdown()
