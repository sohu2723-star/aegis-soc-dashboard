#!/usr/bin/env python3
"""
AEGIS Forwarder — Ubuntu Blue Team Script
==========================================
Runs on Ubuntu defense server. Forwards real events from:
  Suricata (pfSense syslog), Fail2ban, SSH auth.log, ModSecurity

Usage:
    python3 aegis_forwarder.py --mode all
    python3 aegis_forwarder.py --mode fail2ban
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
# The hub SSHes into company VMs to tail their logs AND SSHes into pfSense
# to execute firewall rules via easyrule — all from one script, one machine.
# Override REMOTE_SSH_USER in aegis_forwarder.local.conf if your user differs.
REMOTE_SSH_USER = _cfg("REMOTE_SSH_USER", "sithu")

# pfSense management IP (reachable from aegis-forwarder via OPT2 segment)
PFSENSE_IP      = _cfg("PFSENSE_IP", "10.30.30.1")

# ─── REMOTE HOST IPs — set in aegis_forwarder.local.conf, no hardcoding ───────
# If not set in conf/env, falls back to empty string → hub mode skips that VM.
BANKWEB_IP     = _cfg("BANKWEB_IP",     "")   # 10.10.10.10
CUSTOMERDB_IP  = _cfg("CUSTOMERDB_IP",  "")   # 10.20.20.10
DNSSERVER_IP   = _cfg("DNSSERVER_IP",   "")   # 10.10.10.20
LDAPSERVER_IP  = _cfg("LDAPSERVER_IP",  "")   # 10.20.20.20

# Per-host sensor list — controls which log tailer threads are spawned per VM.
# Available sensors: fail2ban, ssh, http, mysql, postgresql, bind9, slapd
# Only include hosts whose IP is configured (non-empty).
REMOTE_HOSTS = [h for h in [
    {
        "name": "company-web-server",
        "ip":   BANKWEB_IP,
        "sensors": ["fail2ban", "ssh", "http", "http_access"],
        # services to health-check via SSH systemctl on this VM
        "health_services": [
            ("fail2ban",  "Fail2ban",        "sensor"),
            ("ssh",       "SSH Monitor",     "sensor"),
            ("apache2",   "Apache Monitor",  "sensor"),
        ],
    } if BANKWEB_IP else None,
    {
        "name": "company-customer-db",
        "ip":   CUSTOMERDB_IP,
        "sensors": ["fail2ban", "ssh", "mysql"],
        "health_services": [
            ("fail2ban",  "Fail2ban",      "sensor"),
            ("ssh",       "SSH Monitor",   "sensor"),
            ("mysql",     "MySQL Monitor", "sensor"),
        ],
    } if CUSTOMERDB_IP else None,
    {
        "name": "company-dns-server",
        "ip":   DNSSERVER_IP,
        "sensors": ["fail2ban", "ssh", "bind9"],
        "health_services": [
            ("fail2ban",  "Fail2ban",     "sensor"),
            ("ssh",       "SSH Monitor",  "sensor"),
            ("named",     "DNS Monitor",  "sensor"),
        ],
    } if DNSSERVER_IP else None,
    {
        "name": "company-ldap-server",
        "ip":   LDAPSERVER_IP,
        "sensors": ["fail2ban", "ssh", "slapd"],
        "health_services": [
            ("fail2ban",  "Fail2ban",      "sensor"),
            ("ssh",       "SSH Monitor",   "sensor"),
            ("slapd",     "LDAP Monitor",  "sensor"),
        ],
    } if LDAPSERVER_IP else None,
] if h is not None]

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

# pfSense SSH access — forwarder SSHes into pfSense and runs easyrule/pfctl.
# No REST API package required on pfSense.
PFSENSE_SSH_KEY  = _cfg("PFSENSE_SSH_KEY",  "~/.ssh/pfsense_key")
PFSENSE_SSH_USER = _cfg("PFSENSE_SSH_USER", "admin")

# Legacy REST API vars (kept so old local.conf files don't break on read;
# not used for execution — SSH is used instead)
PFSENSE_API_URL = _cfg("PFSENSE_API_URL", f"http://{PFSENSE_IP}/api/v1")
PFSENSE_API_KEY = _cfg("PFSENSE_API_KEY", "")

DEFENSE_POLL_SECS = int(_cfg("DEFENSE_POLL_SECS", "5"))

# ─── SIGNATURE TEXT HELPERS ───────────────────────────────────────────────────
# Cache per (host:jail) or sid so we SSH/read once, not once per ban event.
_FAIL2BAN_SIG_CACHE: dict = {}   # "local:jail" or "ip:jail" → signature text
_SURICATA_RULE_CACHE: dict = {}  # sid (int) → full rule string or None


def _local_fail2ban_signature(jail: str) -> str:
    """
    Read the Fail2ban filter failregex + jail maxretry/findtime/bantime
    from the LOCAL filesystem (runs on the VM that has Fail2ban installed).
    Returns a multi-line string suitable for `signature_text`.
    """
    cache_key = f"local:{jail}"
    if cache_key in _FAIL2BAN_SIG_CACHE:
        return _FAIL2BAN_SIG_CACHE[cache_key]

    # ── failregex ──────────────────────────────────────────────────────────
    regex_lines = []
    for path in (
        f"/etc/fail2ban/filter.d/{jail}.conf",
        f"/etc/fail2ban/filter.d/{jail}.local",
    ):
        try:
            in_regex = False
            with open(path) as fh:
                for raw in fh:
                    stripped = raw.strip()
                    if stripped.startswith("failregex"):
                        in_regex = True
                        regex_lines.append(stripped)
                    elif in_regex and raw.startswith((" ", "\t")):
                        regex_lines.append(stripped)
                    elif in_regex and stripped and not raw.startswith((" ", "\t")):
                        break
            if regex_lines:
                break
        except FileNotFoundError:
            continue

    # ── jail params (maxretry / findtime / bantime) ─────────────────────────
    params: dict = {}
    search_paths = [
        "/etc/fail2ban/jail.conf",
        "/etc/fail2ban/jail.local",
        f"/etc/fail2ban/jail.d/{jail}.conf",
        f"/etc/fail2ban/jail.d/{jail}.local",
    ]
    for path in search_paths:
        in_section = False
        try:
            with open(path) as fh:
                for raw in fh:
                    line = raw.strip()
                    if line == f"[{jail}]":
                        in_section = True
                        continue
                    if in_section:
                        if line.startswith("[") and line != f"[{jail}]":
                            break
                        for key in ("maxretry", "findtime", "bantime"):
                            if line.startswith(key + " ") or line.startswith(key + "="):
                                val = line.split("=", 1)[-1].strip()
                                try:
                                    params[key] = int(val)
                                except ValueError:
                                    pass
        except FileNotFoundError:
            continue

    # ── assemble ────────────────────────────────────────────────────────────
    parts = regex_lines if regex_lines else [f"jail = {jail}"]
    if params.get("maxretry"):
        parts.append(f"maxretry = {params['maxretry']}")
    if params.get("findtime"):
        parts.append(f"findtime = {params['findtime']}s")
    if params.get("bantime"):
        parts.append(f"bantime  = {params['bantime']}s")
    parts.append("action   = iptables-multiport")

    sig = "\n".join(parts)
    _FAIL2BAN_SIG_CACHE[cache_key] = sig
    return sig


def _remote_fail2ban_signature(host_ip: str, jail: str) -> str:
    """
    SSH into a remote company VM and read its Fail2ban filter + jail config.
    Called from hub mode once per (host, jail) pair — result is cached.
    """
    cache_key = f"{host_ip}:{jail}"
    if cache_key in _FAIL2BAN_SIG_CACHE:
        return _FAIL2BAN_SIG_CACHE[cache_key]

    # Single SSH call: grep failregex, then grep jail params
    remote_cmd = (
        f"REGEX=$(grep -A4 'failregex' /etc/fail2ban/filter.d/{jail}.conf 2>/dev/null | head -6 | tr '\\n' '~'); "
        f"PARAMS=$(grep -h -A15 '\\[{jail}\\]' "
        f"  /etc/fail2ban/jail.conf /etc/fail2ban/jail.local "
        f"  /etc/fail2ban/jail.d/*.conf 2>/dev/null "
        f"  | grep -E '^(maxretry|findtime|bantime)' | head -3 | tr '\\n' '|'); "
        f"printf '%s|||%s' \"$REGEX\" \"$PARAMS\""
    )
    ssh_cmd = [
        "ssh", "-T",
        "-o", "StrictHostKeyChecking=no",
        "-o", "ConnectTimeout=8",
        "-o", "BatchMode=yes",
        f"{REMOTE_SSH_USER}@{host_ip}",
        remote_cmd,
    ]
    try:
        out = subprocess.check_output(
            ssh_cmd, stderr=subprocess.DEVNULL, timeout=12, text=True
        ).strip()
        raw_regex, raw_params = (out.split("|||") + ["", ""])[:2]
        regex_part = raw_regex.replace("~", "\n").strip()
        param_lines = [p.strip() for p in raw_params.split("|") if p.strip()]
    except Exception as e:
        print(f"[WARN] fail2ban sig lookup {host_ip}/{jail}: {e}")
        regex_part = ""
        param_lines = []

    parts = [regex_part] if regex_part else [f"jail = {jail}"]
    parts.extend(param_lines)
    parts.append("action = iptables-multiport")
    sig = "\n".join(parts)
    _FAIL2BAN_SIG_CACHE[cache_key] = sig
    return sig


def _lookup_pfsense_rule(sid: int) -> str | None:
    """
    SSH into pfSense and grep Suricata rule files for the given SID.
    Returns the full rule line (e.g. 'alert tcp ...  sid:9000001; rev:1;)')
    or None if not found. Result is cached per SID.
    """
    if sid in _SURICATA_RULE_CACHE:
        return _SURICATA_RULE_CACHE[sid]

    ssh_key = os.path.expanduser(PFSENSE_SSH_KEY)
    grep_cmd = (
        f"grep -rh 'sid:{sid};' "
        f"/var/db/suricata/ /usr/local/etc/suricata/rules/ 2>/dev/null | head -1"
    )
    ssh_cmd = [
        "ssh", "-T",
        "-i", ssh_key,
        "-o", "StrictHostKeyChecking=no",
        "-o", "ConnectTimeout=8",
        "-o", "BatchMode=yes",
        f"{PFSENSE_SSH_USER}@{PFSENSE_IP}",
        grep_cmd,
    ]
    try:
        out = subprocess.check_output(
            ssh_cmd, stderr=subprocess.DEVNULL, timeout=12, text=True
        ).strip()
        result: str | None = out if out else None
    except Exception:
        result = None

    _SURICATA_RULE_CACHE[sid] = result
    return result


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
# on this machine — iptables locally, or SSH into pfSense (easyrule) when the
# command targets VM "pfsense". Runs as its own thread alongside the log-forwarding sensors.

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


def _exec_defense_pfsense_ssh(command: str, cmd_id: int):
    """SSH into pfSense and run a raw shell command (e.g. easyrule block WAN <ip>).
    Used when commandType == 'ssh_pfsense' — command_text is plain text, not JSON.
    """
    ssh_key = os.path.expanduser(PFSENSE_SSH_KEY)
    ssh_cmd = [
        "ssh", "-T",
        "-i", ssh_key,
        "-o", "StrictHostKeyChecking=no",
        "-o", "ConnectTimeout=10",
        "-o", "BatchMode=yes",
        f"{PFSENSE_SSH_USER}@{PFSENSE_IP}",
        command,
    ]
    print(f"[defense] pfSense SSH → {PFSENSE_SSH_USER}@{PFSENSE_IP}: {command}")
    try:
        result = subprocess.run(ssh_cmd, capture_output=True, text=True, timeout=30)
        if result.returncode == 0:
            out = result.stdout.strip()
            print(f"[defense] ✓ pfSense SSH OK: {out}")
            _report_defense_result(cmd_id, True)
        else:
            err = (result.stderr.strip() or result.stdout.strip())[:300]
            print(f"[defense] ✗ pfSense SSH failed: {err}")
            _report_defense_result(cmd_id, False, err)
    except subprocess.TimeoutExpired:
        print("[defense] ✗ pfSense SSH timeout")
        _report_defense_result(cmd_id, False, "SSH timeout")
    except Exception as e:
        print(f"[defense] ✗ pfSense SSH error: {e}")
        _report_defense_result(cmd_id, False, str(e))


def _exec_defense_pfsense(payload_json: str, cmd_id: int):
    """Execute pfSense firewall actions via SSH + easyrule/pfctl.
    No REST API package needed on pfSense — plain SSH key auth.

    Flow: forwarder (10.30.30.10) → SSH → pfSense (10.30.30.1) → easyrule / pfctl

    Config (aegis_forwarder.local.conf):
        PFSENSE_SSH_KEY  = /root/.ssh/pfsense_key
        PFSENSE_SSH_USER = admin
        PFSENSE_IP       = 10.30.30.1
    """
    try:
        payload = json.loads(payload_json)
        action  = payload.get("action")
        ip      = payload.get("ip", "")
        port    = str(payload.get("port", ""))
        proto   = payload.get("protocol", "tcp")

        ssh_key = os.path.expanduser(PFSENSE_SSH_KEY)
        ssh_base = [
            "ssh", "-T",
            "-i", ssh_key,
            "-o", "StrictHostKeyChecking=no",
            "-o", "ConnectTimeout=10",
            "-o", "BatchMode=yes",
            f"{PFSENSE_SSH_USER}@{PFSENSE_IP}",
        ]

        if action == "block_ip":
            # easyrule adds a block rule on WAN for the source IP
            remote_cmd = f"easyrule block WAN {ip}"

        elif action == "unblock_ip":
            # easyrule has a built-in unblock — mirrors the block exactly
            remote_cmd = f"easyrule unblock WAN {ip}"

        elif action == "block_port":
            # easyrule supports optional dest-port: easyrule block WAN <ip> <port> <proto>
            if port:
                remote_cmd = f"easyrule block WAN {ip} {port} {proto}"
            else:
                remote_cmd = f"easyrule block WAN {ip}"

        else:
            print(f"[defense] Unknown pfSense action: {action}")
            _report_defense_result(cmd_id, False, f"Unknown action: {action}")
            return

        ssh_cmd = ssh_base + [remote_cmd]
        print(f"[defense] pfSense SSH → {PFSENSE_SSH_USER}@{PFSENSE_IP}: {remote_cmd}")
        result = subprocess.run(ssh_cmd, capture_output=True, text=True, timeout=30)

        if result.returncode == 0:
            print(f"[defense] ✓ pfSense {action} {ip} OK")
            _report_defense_result(cmd_id, True)
        else:
            err = (result.stderr.strip() or result.stdout.strip())[:300]
            print(f"[defense] ✗ pfSense {action} {ip}: {err}")
            _report_defense_result(cmd_id, False, err)

    except subprocess.TimeoutExpired:
        print(f"[defense] ✗ pfSense SSH timeout")
        _report_defense_result(cmd_id, False, "SSH timeout")
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
    """SSH into a company VM (company-web-server / company-customer-db) and run an iptables command.
    If the command is an iptables INPUT block, also kill any existing SSH sessions
    from that attacker IP so the block takes effect immediately.
    """
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

            # After a DROP rule is added, kill any active sessions from the blocked IP.
            # Extract the blocked IP from the iptables command (e.g. "iptables -I INPUT -s 1.2.3.4 -j DROP")
            import re as _re
            m = _re.search(r"iptables.*-I INPUT.*-s\s+([\d.]+).*-j DROP", command)
            if m:
                blocked_ip = m.group(1)
                kill_cmd = [
                    "ssh", "-T",
                    "-o", "StrictHostKeyChecking=no",
                    "-o", "ConnectTimeout=10",
                    "-o", "BatchMode=yes",
                    f"{REMOTE_SSH_USER}@{target_ip}",
                    f"sudo ss -K dst {blocked_ip} 2>/dev/null; sudo ss -K src {blocked_ip} 2>/dev/null; true",
                ]
                print(f"[defense] Killing active sessions from {blocked_ip} on {target_ip}")
                subprocess.run(kill_cmd, capture_output=True, text=True, timeout=10)
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
      target_vm == "pfsense"        → SSH into pfSense → easyrule/pfctl (PFSENSE_IP)
      target_vm in company VM names    → SSH iptables into that VM
      target_vm == "aegis" / ""     → local iptables on this machine
    """
    cmd_id       = cmd["id"]
    command_type = cmd.get("commandType", "")
    command_text = cmd.get("commandText", "")
    target_ip    = cmd.get("targetIp", "")
    target_vm    = cmd.get("targetVm") or cmd.get("vm") or ""

    print(f"[defense-hub] Command #{cmd_id}: [{command_type}] vm={target_vm} ip={target_ip}")

    # Route to pfSense
    if target_vm == "pfsense" or command_type in ("pfsense_api", "ssh_pfsense"):
        if command_type == "ssh_pfsense":
            # Plain-text easyrule/pfctl command — run directly via SSH
            _exec_defense_pfsense_ssh(command_text, cmd_id)
        else:
            # JSON payload {"action":..., "ip":...} — pfSense REST API path
            _exec_defense_pfsense(command_text, cmd_id)
        return

    # Route to company VMs via SSH
    _remote_ips = {h["name"]: h["ip"] for h in REMOTE_HOSTS}
    if target_vm in _remote_ips:
        _exec_defense_ssh_remote(_remote_ips[target_vm], command_text, cmd_id)
        return

    # targetVm="all" — run on every monitored VM: local Aegis + all remote hosts
    if target_vm == "all":
        print(f"[defense-hub] Broadcasting to ALL VMs: {command_text}")
        # Local Aegis VM
        _exec_defense_shell(command_text, cmd_id)
        # Remote company VMs via SSH
        for h in REMOTE_HOSTS:
            _exec_defense_ssh_remote(h["ip"], command_text, cmd_id)
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

    In hub_mode: polls for ALL hub VMs (aegis, pfsense, company-web-server, company-customer-db)
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
                                  params={"vm": vm}, headers=DEFENSE_HEADERS, timeout=60)
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
            timeout=60,
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
            timeout=30,
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
                timeout=30,
            )
            # pfSense: also report the global pfSense Firewall component as online
            if VM_NAME == "pfsense":
                _report_pfsense_online()
        except Exception:
            pass


def send_offline():
    """Send offline status immediately when script shuts down.
    In hub mode: also marks all remote hosts (company-web-server, company-customer-db) offline
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
            timeout=30,
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
                timeout=30,
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
    ("fail2ban",  "Fail2ban",   "sensor", "systemctl"),
    ("ssh",       "SSH Monitor","sensor", "systemctl"),
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
    Sensors: Fail2ban, SSH (systemctl).
    """
    print("[SERVICE HEALTH] Monitoring: fail2ban, ssh")
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
                    timeout=30,
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
            timeout=30,
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
        jail = m.group(1)
        post("fail2ban", {
            "jail":         jail,
            "ip":           m.group(2),
            "failures":     5,
            "target_ip":    _own_ip,
            "filter_regex": _local_fail2ban_signature(jail),  # full rule text
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
    DEFENDER_IPS = {ip for ip in [
        BANKWEB_IP,    # company-web-server (from conf)
        CUSTOMERDB_IP, # company-customer-db (from conf)
        OWN_IP,        # this VM itself
    ] if ip}

    for line in tail_file(SSH_LOG):
        m_fail = SSH_FAIL_RE.search(line)
        if m_fail:
            user, ip = m_fail.group(1), m_fail.group(2)
            if ip in DEFENDER_IPS:
                continue   # skip hub's own management SSH
            fail_counts[ip] = fail_counts.get(ip, 0) + 1
            post("ssh", {
                "src_ip":         ip,
                "dest_ip":        OWN_IP,
                "username":       user,
                "status":         "failed",
                "failures":       fail_counts[ip],
                "signature_text": line.strip(),   # raw auth.log line
            })

        m_ok = SSH_SUCCESS_RE.search(line)
        if m_ok:
            auth, user, ip = m_ok.group(1), m_ok.group(2), m_ok.group(3)
            if ip in DEFENDER_IPS:
                continue   # skip hub's own management SSH
            prior = fail_counts.pop(ip, 0)   # capture before clearing
            post("ssh", {
                "src_ip":         ip,
                "dest_ip":        OWN_IP,
                "username":       user,
                "status":         "success",
                "auth_method":    auth,
                "prior_failures": prior,
                "signature_text": line.strip(),   # raw auth.log line
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
                "src_ip":         current_ip,
                "url":            current_url or "/",
                "method":         current_method or "GET",
                "attack_type":    atype,
                "payload":        msg,
                "rule_id":        rule_id,
                "blocked":        severity.upper() in ("CRITICAL", "ERROR"),
                "signature_text": line.strip(),   # raw ModSecurity audit log line
            })
            current_ip = None



# ─── HTTP Access Log — login breach detection ────────────────────────────────
# Apache combined log: IP - - [date] "METHOD URL PROTO" STATUS SIZE
HTTP_ACCESS_LOG = "/var/log/apache2/access.log"
ACCESS_RE       = re.compile(r'^([\d.]+) \S+ \S+ \[[^\]]+\] "(\w+) ([^ ]+) HTTP[^"]*" (\d{3}) ')
# Login-like endpoints worth watching for brute-force breach
_LOGIN_PREFIXES = ("/login", "/admin", "/wp-login", "/phpmyadmin",
                   "/signin", "/auth", "/console", "/manager", "/user/login")


def _is_login_url(url: str) -> bool:
    u = url.split("?")[0].lower()
    return any(u == p or u.startswith(p + "/") or u.startswith(p + "?")
               for p in _LOGIN_PREFIXES)


def watch_http_access():
    """
    Watch Apache access.log for login breach pattern:
      repeated 401/403 on login URLs → 200/302 success = brute-force success.
    Complements ModSecurity (which detects attack payloads); this catches
    successful authentication after brute force even when no WAF rule fires.
    """
    print(f"[HTTP-ACCESS] Watching {HTTP_ACCESS_LOG}")
    login_fails: dict[str, int] = {}   # ip → failed auth count on login endpoints

    OWN_IP = get_local_ip()

    for line in tail_file(HTTP_ACCESS_LOG):
        m = ACCESS_RE.match(line)
        if not m:
            continue
        ip, method, url, status = m.group(1), m.group(2), m.group(3), int(m.group(4))

        if not _is_login_url(url):
            continue

        if status in (401, 403):
            login_fails[ip] = login_fails.get(ip, 0) + 1
            if login_fails[ip] == 1 or login_fails[ip] % 5 == 0:
                post("http_access", {
                    "src_ip":         ip,
                    "dest_ip":        OWN_IP,
                    "url":            url,
                    "method":         method,
                    "status_code":    status,
                    "prior_failures": login_fails[ip],
                    "is_success":     False,
                    "signature_text": line.strip(),   # raw access.log line
                })

        elif status in (200, 302) and method in ("POST", "GET"):
            prior = login_fails.pop(ip, 0)
            post("http_access", {
                "src_ip":         ip,
                "dest_ip":        OWN_IP,
                "url":            url,
                "method":         method,
                "status_code":    status,
                "prior_failures": prior,
                "is_success":     True,
                "signature_text": line.strip(),   # raw access.log line
            })


# ─── REMOTE MODE (hub SSHes into company VMs) ───────────────────────────────────

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
            timeout=60,
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


def _watch_pfsense_suricata(log_path: str | None = None):
    """
    SSH into pfSense (PFSENSE_IP) and tail one Suricata EVE JSON log.
    Call this once per Suricata interface (PUBLIC em1.10 + INTERNAL em2.20).

    aegis_forwarder.local.conf examples:
        # Single custom path (overrides both defaults):
        PFSENSE_SURICATA_LOG = /var/db/suricata/suricata_em110/eve.json
        # Two paths — comma-separated (hub mode spawns one thread per path):
        PFSENSE_SURICATA_LOGS = /var/db/suricata/suricata_em110/eve.json,/var/db/suricata/suricata_em220/eve.json

    Defaults (lab topology v4):
        PUBLIC  (em1.10): /var/db/suricata/suricata_em110/eve.json  (company-web-server + DNS)
        INTERNAL(em2.20): /var/db/suricata/suricata_em220/eve.json  (company-customer-db + LDAP)
    """
    if log_path is None:
        log_path = _cfg("PFSENSE_SURICATA_LOG",
                        "/var/db/suricata/suricata_em110/eve.json")
    ssh_key  = os.path.expanduser(PFSENSE_SSH_KEY)
    ssh_cmd  = [
        "ssh", "-T",
        "-i", ssh_key,
        "-o", "StrictHostKeyChecking=no",
        "-o", "ConnectTimeout=10",
        "-o", "ServerAliveInterval=15",
        "-o", "ServerAliveCountMax=3",
        "-o", "BatchMode=yes",
        f"{PFSENSE_SSH_USER}@{PFSENSE_IP}",
        f"tail -F {log_path} 2>/dev/null",
    ]
    print(f"[pfSense-suricata] Starting — {PFSENSE_SSH_USER}@{PFSENSE_IP}:{log_path}")
    while True:
        try:
            proc = subprocess.Popen(ssh_cmd, stdout=subprocess.PIPE,
                                    stderr=subprocess.PIPE, text=True)
            print(f"[pfSense-suricata] Connected")
            for line in proc.stdout:
                line = line.strip()
                if not line:
                    continue
                try:
                    evt = json.loads(line)
                    etype = evt.get("event_type")
                    evt["targetHost"] = "pfsense"   # stamp source for dashboard
                    if etype == "alert":
                        # Attach full rule text so dashboard can show it.
                        # Priority: 1) EVE JSON already has alert.rule field (Suricata ≥7 with rule logging)
                        #           2) grep the rules files on pfSense by SID
                        alert_obj = evt.get("alert", {})
                        if not alert_obj.get("rule"):
                            sid = alert_obj.get("signature_id")
                            if sid:
                                rule_text = _lookup_pfsense_rule(int(sid))
                                if rule_text:
                                    alert_obj["rule"] = rule_text
                                    evt["alert"] = alert_obj
                        post("suricata", evt)
                    elif etype == "tls":
                        post("suricata/tls", {
                            "src_ip":    evt.get("src_ip"),
                            "dest_ip":   evt.get("dest_ip"),
                            "dest_port": evt.get("dest_port"),
                            "tls":       evt.get("tls", {}),
                        })
                except json.JSONDecodeError:
                    pass
            proc.wait()
            print("[pfSense-suricata] SSH disconnected — reconnecting in 15s")
        except Exception as e:
            print(f"[pfSense-suricata] Error: {e} — retrying in 15s")
        time.sleep(15)


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
                "src_ip":         ip,
                "username":       user,
                "status":         "failed",
                "failures":       fail_counts[ip],
                "targetHost":     host_ip,
                "signature_text": line.strip(),
            })
            continue
        m_ok = SSH_SUCCESS_RE.search(line)
        if m_ok:
            _, user, ip = m_ok.group(1), m_ok.group(2), m_ok.group(3)
            if ip in _defender_ips:
                continue
            prior = fail_counts.pop(ip, 0)
            post("ssh", {
                "src_ip":         ip,
                "username":       user,
                "status":         "success",
                "prior_failures": prior,
                "targetHost":     host_ip,
                "signature_text": line.strip(),
            })


def _watch_remote_fail2ban(host_name: str, host_ip: str):
    """Tail fail2ban.log on a remote VM via SSH and forward ban events."""
    # Never report our own hub or any company VM as an attacker —
    # aegis-forwarder SSHes into company VMs so fail2ban may temporarily ban it.
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
        jail = m.group(1)
        post("fail2ban", {
            "jail":         jail,
            "ip":           banned_ip,
            "failures":     5,
            "target_ip":    host_ip,
            "filter_regex": _remote_fail2ban_signature(host_ip, jail),  # full rule text
        })


def _watch_remote_modsecurity(host_name: str, host_ip: str):
    """Tail ModSecurity audit log on a remote VM (company-web-server) via SSH."""
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


# PostgreSQL log line examples:
# 2024-01-01 12:00:00 UTC [1234]: [1-1] user=app,db=companydb,host=192.168.1.5 ERROR: syntax error ...
# 2024-01-01 12:00:00 UTC [1234]: [1-1] user=app,db=companydb,host=192.168.1.5 FATAL: password auth failed
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


def _watch_remote_http_access(host_name: str, host_ip: str):
    """
    Tail Apache access.log on a remote VM (company-web-server) via SSH.
    Detects login brute-force success: repeated 401/403 → 200/302 on login URLs.
    """
    log_path = "/var/log/apache2/access.log"
    print(f"[{host_name}] http_access thread started")
    login_fails: dict[str, int] = {}

    for line in _ssh_tail(host_name, host_ip, log_path):
        m = ACCESS_RE.match(line)
        if not m:
            continue
        ip, method, url, status = m.group(1), m.group(2), m.group(3), int(m.group(4))

        if not _is_login_url(url):
            continue

        if status in (401, 403):
            login_fails[ip] = login_fails.get(ip, 0) + 1
            if login_fails[ip] == 1 or login_fails[ip] % 5 == 0:
                post("http_access", {
                    "src_ip":         ip,
                    "dest_ip":        host_ip,
                    "url":            url,
                    "method":         method,
                    "status_code":    status,
                    "prior_failures": login_fails[ip],
                    "is_success":     False,
                    "targetHost":     host_name,
                    "signature_text": line.strip(),
                })

        elif status in (200, 302) and method in ("POST", "GET"):
            prior = login_fails.pop(ip, 0)
            post("http_access", {
                "src_ip":         ip,
                "dest_ip":        host_ip,
                "url":            url,
                "method":         method,
                "status_code":    status,
                "prior_failures": prior,
                "is_success":     True,
                "targetHost":     host_name,
                "signature_text": line.strip(),
            })


def _watch_remote_postgresql(host_name: str, host_ip: str):
    """Tail PostgreSQL log on company-customer-db via SSH and forward auth failures and SQL errors."""
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
                        "sourceIp":    client_ip,
                        "targetHost":  host_ip,
                        "description": f"PostgreSQL auth failure: user={user} db={db} — {msg[:120]}",
                        "signature_text": line.strip(),
                    })
                # SQL injection patterns
                elif _PG_SQL_RE.search(msg):
                    post("event", {
                        "source":      "postgresql",
                        "type":        "db_sql_error",
                        "severity":    "medium",
                        "sourceIp":    client_ip,
                        "targetHost":  host_ip,
                        "description": f"PostgreSQL SQL anomaly: user={user} db={db} — {msg[:120]}",
                        "signature_text": line.strip(),
                    })
            proc.wait()
            print(f"[{host_name}] postgresql: SSH disconnected — reconnecting in 10s")
        except Exception as e:
            print(f"[{host_name}] postgresql error: {e} — retrying in 10s")
        time.sleep(10)


def _watch_remote_mysql(host_name: str, host_ip: str):
    """Tail MySQL error log on company-customer-db via SSH and forward auth failures."""
    log_path = "/var/log/mysql/error.log"
    _defender_ips = {h["ip"] for h in REMOTE_HOSTS} | {"10.30.30.10"}
    print(f"[{host_name}] mysql thread started")
    for line in _ssh_tail(host_name, host_ip, log_path):
        # MySQL auth failure: Access denied for user 'root'@'192.168.x.x'
        if "Access denied" in line or "authentication fail" in line.lower():
            m = re.search(r"'([^']+)'@'([\d.]+)'", line)
            if not m:
                continue
            user, src_ip = m.group(1), m.group(2)
            if src_ip in _defender_ips:
                continue
            post("event", {
                "source":      "mysql",
                "type":        "db_auth_failure",
                "severity":    "high",
                "sourceIp":    src_ip,
                "targetHost":  host_ip,
                "description": f"MySQL auth failure: user={user} from {src_ip}",
                "signature_text": line.strip(),
            })


def _watch_remote_bind9(host_name: str, host_ip: str):
    """Tail BIND9 query log on dns-server via SSH and detect DNS attacks."""
    # BIND9 query log path (needs logging category queries { file } in named.conf)
    log_path = "/var/log/named/named.log"
    print(f"[{host_name}] bind9 thread started")
    for line in _ssh_tail(host_name, host_ip, log_path):
        # Zone transfer attempt: "AXFR" or "IXFR"
        if "AXFR" in line or "IXFR" in line:
            m = re.search(r"([\d.]+)#\d+", line)
            src_ip = m.group(1) if m else "unknown"
            post("event", {
                "source":      "bind9",
                "type":        "dns_zone_transfer",
                "severity":    "high",
                "sourceIp":    src_ip,
                "targetHost":  host_ip,
                "description": f"DNS zone transfer attempt from {src_ip}",
                "signature_text": line.strip(),
            })
        # Flood / excessive queries (basic heuristic — forwarder sees repeated lines)
        elif "query" in line.lower() and ("error" in line.lower() or "refused" in line.lower()):
            m = re.search(r"([\d.]+)#\d+", line)
            src_ip = m.group(1) if m else "unknown"
            post("event", {
                "source":      "bind9",
                "type":        "dns_query_refused",
                "severity":    "medium",
                "sourceIp":    src_ip,
                "targetHost":  host_ip,
                "description": f"DNS query refused from {src_ip}: {line[:80]}",
                "signature_text": line.strip(),
            })


def _watch_remote_slapd(host_name: str, host_ip: str):
    """Tail syslog filtered for slapd (OpenLDAP) on ldap-server via SSH."""
    # slapd logs to syslog on Ubuntu — filter with grep
    _defender_ips = {h["ip"] for h in REMOTE_HOSTS} | {"10.30.30.10"}
    print(f"[{host_name}] slapd thread started")
    for line in _ssh_tail(host_name, host_ip, "/var/log/syslog"):
        if "slapd" not in line:
            continue
        # Auth failure: "conn=X op=Y BIND dn="..." method=128 RESULT tag=97 err=49"
        if "err=49" in line or "Invalid credentials" in line:
            m = re.search(r"([\d.]+)(?::\d+)?", line)
            src_ip = m.group(1) if m else "unknown"
            if src_ip in _defender_ips:
                continue
            post("event", {
                "source":      "slapd",
                "type":        "ldap_auth_failure",
                "severity":    "high",
                "sourceIp":    src_ip,
                "targetHost":  host_ip,
                "description": f"LDAP bind failure (err=49) from {src_ip}",
                "signature_text": line.strip(),
            })


def _remote_heartbeat_loop(hosts: list):
    """Send online heartbeat for every remote company VM every 15s.
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
    """SSH into each company VM every 30s and report real service health to AEGIS.
    Each host uses its own health_services list so company-web-server and company-customer-db
    get the right set of checks (no postgresql on company-web-server, no apache2 on company-customer-db).
    """
    print("[REMOTE SERVICE HEALTH] Monitoring company-web-server & company-customer-db every 30s via SSH")
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
                            timeout=30,
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
                timeout=30,
            )
        except Exception:
            pass
        time.sleep(30)


def run_hub_mode():
    """
    Hub mode: aegis-forwarder VM (10.30.30.10) SSHes into each company VM and
    tails their logs. Sensor threads are spawned per-host based on the
    'sensors' key in REMOTE_HOSTS. Defense commands are routed to the right
    executor (local iptables / pfSense API / SSH iptables on company VMs).

    Supported sensors per host (via SSH log tail):
      fail2ban   — /var/log/fail2ban.log
      ssh        — /var/log/auth.log
      http       — /var/log/apache2/modsec_audit.log  (company-web-server)
      mysql      — /var/log/mysql/error.log            (company-customer-db)
      postgresql — /var/log/postgresql/*.log           (company-customer-db, if used)
      bind9      — /var/log/named/                     (dns-server)
      slapd      — /var/log/syslog (filtered)          (ldap-server)

    pfSense Suricata IDS is handled by a dedicated thread (_watch_pfsense_suricata)
    that SSHes into pfSense and tails its EVE JSON log.
    """
    _SENSOR_FN = {
        "fail2ban":    _watch_remote_fail2ban,
        "ssh":         _watch_remote_ssh,
        "http":        _watch_remote_modsecurity,
        "http_access": _watch_remote_http_access,
        "mysql":       _watch_remote_mysql,
        "postgresql":  _watch_remote_postgresql,
        "bind9":       _watch_remote_bind9,
        "slapd":       _watch_remote_slapd,
    }

    print(f"\n  Hub mode — remote hosts ({len(REMOTE_HOSTS)}):")
    for h in REMOTE_HOSTS:
        sensors_str = ", ".join(h.get("sensors", []))
        print(f"    {h['name']:15s} {h['ip']}  sensors=[{sensors_str}]")
        _remote_register_host(h["name"], h["ip"])
    print(f"  pfSense SSH  : {PFSENSE_SSH_USER}@{PFSENSE_IP} (key: {PFSENSE_SSH_KEY})")
    print(f"  Defense VMs  : {HUB_DEFENSE_VMS}")
    print()

    threads = []

    # Heartbeat — keeps remote VMs ONLINE (server marks offline after 45s / 3 misses)
    hb = threading.Thread(target=_remote_heartbeat_loop, args=(REMOTE_HOSTS,),
                          daemon=True, name="remote-heartbeat")
    hb.start()
    threads.append(hb)
    print("  ► remote heartbeat thread started")

    # Service health — SSHes into each company VM every 30s, checks systemctl per-host
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

    # pfSense Suricata IDS — one thread per interface log (PUBLIC + INTERNAL)
    # Configurable via PFSENSE_SURICATA_LOGS (comma-separated paths) or
    # PFSENSE_SURICATA_LOG (single path, used for both if LOGS not set).
    _pf_logs_raw = _cfg("PFSENSE_SURICATA_LOGS", "")
    if _pf_logs_raw:
        _pf_log_paths = [p.strip() for p in _pf_logs_raw.split(",") if p.strip()]
    else:
        # Default: lab topology v4 — PUBLIC (em1.10) + INTERNAL (em2.20)
        _default_public   = "/var/db/suricata/suricata_em110/eve.json"
        _default_internal = "/var/db/suricata/suricata_em220/eve.json"
        _single = _cfg("PFSENSE_SURICATA_LOG", "")
        _pf_log_paths = [_single, _single] if _single else [_default_public, _default_internal]
    _pf_iface_labels = ["PUBLIC(em1.10)", "INTERNAL(em2.20)"] + ["extra"] * 8
    for idx, _lp in enumerate(_pf_log_paths):
        _label = _pf_iface_labels[idx] if idx < len(_pf_iface_labels) else f"iface{idx}"
        pf_sur = threading.Thread(target=_watch_pfsense_suricata, args=(_lp,),
                                  daemon=True, name=f"pfsense-suricata-{idx}")
        pf_sur.start()
        threads.append(pf_sur)
        print(f"  ► pfSense Suricata IDS thread started [{_label}] → {_lp}")

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
    "fail2ban":    watch_fail2ban,
    "ssh":         watch_ssh,
    "http":        watch_modsecurity,
    "http_access": watch_http_access,
}

if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="AEGIS Forwarder — Blue Team hub script",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Modes:
  hub     Run on the AEGIS VM (10.30.30.10): SSHes into company-web-server + company-customer-db to
          tail their logs, SSHes into pfSense to run easyrule/pfctl commands, and
          runs the defense agent for ALL VMs.  One script, one machine, everything.
  all     Run all local sensors on THIS machine (normal forwarder mode).
  remote  Alias for hub (backward compat).
  <name>  Run a single local sensor: fail2ban | ssh | http
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
  Mode    : {args.mode}{"  ← hub: covers company-web-server, company-customer-db, pfSense" if _is_hub else ""}
  VM_NAME : {VM_NAME}
""")

    # Register this AEGIS VM in Network Monitor on startup
    print("  [*] Registering host with AEGIS...")
    register_host()

    # Heartbeat — server marks host offline after 45s / 3 missed beats
    hb = threading.Thread(target=heartbeat_loop, daemon=True, name="heartbeat")
    hb.start()

    # Local service health:
    #   NON-hub mode → run SERVICE_MAP checks (fail2ban/ssh) on THIS VM
    #   Hub mode     → skip local checks; _remote_service_health_loop() covers company VMs
    #                  via SSH. Running both would cause UP/DOWN flapping.
    if not _is_hub:
        sh = threading.Thread(target=service_health_loop, daemon=True, name="service_health")
        sh.start()
        print("  ► service_health thread started (local sensors)")
    else:
        # In hub mode: report Hub Forwarder + local SSH/Fail2ban for aegis VM itself
        def _hub_self_health():
            own_ip = get_local_ip()
            local_checks = [
                ("ssh",      "SSH Monitor", "sensor"),
                ("fail2ban", "Fail2ban",    "sensor"),
            ]
            while True:
                try:
                    # Hub Forwarder heartbeat
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
                        timeout=30,
                    )
                    # Local service checks (ssh, fail2ban) for aegis VM
                    for svc, component, layer in local_checks:
                        try:
                            result = subprocess.run(
                                ["systemctl", "is-active", svc],
                                capture_output=True, text=True, timeout=5,
                            )
                            status = "online" if result.stdout.strip() == "active" else "offline"
                        except Exception:
                            status = "unknown"
                        try:
                            requests.post(
                                f"{AEGIS_URL}/system/status",
                                json={"component": component, "layer": layer,
                                      "status": status, "hostIp": own_ip},
                                headers=HEADERS,
                                timeout=30,
                            )
                        except Exception:
                            pass
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
