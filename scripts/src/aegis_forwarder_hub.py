#!/usr/bin/env python3
"""
AEGIS Forwarder Hub — Central Collector (runs on aegis-forwarder VM)
=====================================================================
SSHes into every target VM and tails their log files remotely.
No agent needed on bank-web, mail, teller, or customer-db.

Usage:
    python3 aegis_forwarder_hub.py

Requirements:
    pip3 install requests paramiko

Environment variables:
    AEGIS_URL   — Render API base URL  (e.g. https://aegis-api-server-jp3b.onrender.com/api)
    AEGIS_KEY   — AEGIS_INGEST_KEY from Render environment
    SSH_USER    — SSH username for all target VMs   (default: sithu)
    SSH_PASS    — SSH password for all target VMs
    SSH_KEY     — Path to SSH private key file (alternative to SSH_PASS)
"""

import json
import os
import re
import socket
import sys
import time
import threading
import requests
import paramiko
from datetime import datetime

# ─── AEGIS API CONFIG ────────────────────────────────────────────────────────
AEGIS_URL = os.environ.get("AEGIS_URL", "https://aegis-api-server-jp3b.onrender.com/api")
AEGIS_KEY = os.environ.get("AEGIS_KEY", "aegis-demo-key-change-me")
HEADERS   = {"Content-Type": "application/json", "X-AEGIS-Key": AEGIS_KEY}

# ─── SSH CONFIG ───────────────────────────────────────────────────────────────
SSH_USER     = os.environ.get("SSH_USER", "sithu")
SSH_PASS     = os.environ.get("SSH_PASS", "")        # password auth
SSH_KEY_FILE = os.environ.get("SSH_KEY", "")         # key auth (preferred)
SSH_PORT     = 22
SSH_TIMEOUT  = 15

# ─── TARGET VMs ───────────────────────────────────────────────────────────────
# Add / remove VMs here. Each VM needs SSH access from aegis-forwarder.
# "sensors" = which log watchers to run on that VM.
REMOTE_VMS = [
    {
        "name":    "bank-web",
        "ip":      "10.10.10.10",
        "role":    "web-server",
        "sensors": ["suricata", "fail2ban", "ssh", "http"],
    },
    {
        "name":    "bank-mail",
        "ip":      "10.10.10.20",
        "role":    "mail-server",
        "sensors": ["suricata", "fail2ban", "ssh"],
    },
    {
        "name":    "teller-pc",
        "ip":      "10.20.20.10",
        "role":    "workstation",
        "sensors": ["suricata", "fail2ban", "ssh"],
    },
    {
        "name":    "customer-db",
        "ip":      "10.20.20.20",
        "role":    "database",
        "sensors": ["suricata", "fail2ban", "ssh"],
    },
]

# ─── LOG PATHS ────────────────────────────────────────────────────────────────
LOG_PATHS = {
    "suricata": "/var/log/suricata/eve.json",
    "fail2ban": "/var/log/fail2ban.log",
    "ssh":      "/var/log/auth.log",
    "snort":    "/var/log/snort/alert",
    "http":     "/var/log/apache2/modsec_audit.log",
    "ftp":      "/var/log/vsftpd.log",
    "cowrie":   "/home/cowrie/cowrie/var/log/cowrie/cowrie.json",
}

# ─── REGEX ────────────────────────────────────────────────────────────────────
FAIL2BAN_RE    = re.compile(r"NOTICE\s+\[(\S+)\] Ban ([\d.]+)")
SSH_FAIL_RE    = re.compile(r"Failed password for (\S+) from ([\d.]+)")
SSH_SUCCESS_RE = re.compile(r"Accepted (password|publickey) for (\S+) from ([\d.]+)")
MODSEC_MSG_RE  = re.compile(r'\[id "(\d+)"\].*\[msg "([^"]+)"\].*\[severity "([^"]+)"\]')
MODSEC_IP_RE   = re.compile(r"^\[.*?\] .* (\d+\.\d+\.\d+\.\d+) \d+ (\w+) (.*?) HTTP")


# ─── API HELPERS ─────────────────────────────────────────────────────────────
def post(endpoint: str, data: dict):
    try:
        r = requests.post(
            f"{AEGIS_URL}/ingest/{endpoint}",
            headers=HEADERS,
            json=data,
            timeout=10,
        )
        if r.status_code not in (200, 201):
            print(f"  [WARN] POST /{endpoint} → {r.status_code}: {r.text[:80]}")
    except Exception as e:
        print(f"  [ERROR] Cannot reach AEGIS: {e}")


def register_vm(vm: dict):
    """Register a remote VM in AEGIS Network Monitor."""
    try:
        requests.post(
            f"{AEGIS_URL}/network/hosts",
            headers=HEADERS,
            json={
                "ip":       vm["ip"],
                "hostname": vm["name"],
                "role":     vm["role"],
                "status":   "online",
            },
            timeout=10,
        )
        print(f"  ✓ Registered: {vm['name']} ({vm['ip']})")
    except Exception as e:
        print(f"  ✗ Failed to register {vm['name']}: {e}")


# ─── SSH CONNECTION ───────────────────────────────────────────────────────────
def make_ssh_client(ip: str, vm_name: str) -> paramiko.SSHClient | None:
    """Create and return a connected SSH client for a remote VM."""
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    try:
        connect_kwargs = dict(
            hostname=ip,
            port=SSH_PORT,
            username=SSH_USER,
            timeout=SSH_TIMEOUT,
        )
        if SSH_KEY_FILE and os.path.exists(SSH_KEY_FILE):
            connect_kwargs["key_filename"] = SSH_KEY_FILE
        elif SSH_PASS:
            connect_kwargs["password"] = SSH_PASS
        else:
            # Try SSH agent / default keys (~/.ssh/id_rsa etc.)
            pass

        client.connect(**connect_kwargs)
        print(f"  [SSH] Connected → {vm_name} ({ip})")
        return client
    except Exception as e:
        print(f"  [SSH] Cannot connect to {vm_name} ({ip}): {e}")
        return None


def ssh_tail(client: paramiko.SSHClient, path: str, vm_name: str):
    """
    Yield new lines from a remote file using 'tail -F'.
    Reconnects automatically on failure.
    """
    while True:
        try:
            _, stdout, _ = client.exec_command(
                f"tail -F {path} 2>/dev/null",
                get_pty=False,
            )
            print(f"  [TAIL] {vm_name}:{path}")
            for line in stdout:
                yield line.rstrip("\n")
        except Exception as e:
            print(f"  [WARN] SSH tail lost {vm_name}:{path} — {e} — retrying in 15s")
            time.sleep(15)
            # Try to reconnect
            try:
                client.close()
            except Exception:
                pass
            ip = next((v["ip"] for v in REMOTE_VMS if v["name"] == vm_name), None)
            if ip:
                new = make_ssh_client(ip, vm_name)
                if new:
                    client = new
            time.sleep(5)


# ─── PARSERS (per sensor, per remote VM) ────────────────────────────────────
def watch_suricata_remote(client: paramiko.SSHClient, vm: dict):
    for line in ssh_tail(client, LOG_PATHS["suricata"], vm["name"]):
        try:
            evt = json.loads(line)
            etype = evt.get("event_type")
            if etype == "alert":
                evt["_vm"] = vm["name"]
                post("suricata", evt)
            elif etype == "tls":
                post("suricata/tls", {
                    "src_ip":    evt.get("src_ip"),
                    "dest_ip":   evt.get("dest_ip"),
                    "dest_port": evt.get("dest_port"),
                    "tls":       evt.get("tls", {}),
                    "_vm":       vm["name"],
                })
        except json.JSONDecodeError:
            pass


def watch_fail2ban_remote(client: paramiko.SSHClient, vm: dict):
    for line in ssh_tail(client, LOG_PATHS["fail2ban"], vm["name"]):
        m = FAIL2BAN_RE.search(line)
        if m:
            post("fail2ban", {
                "jail":     m.group(1),
                "ip":       m.group(2),
                "failures": 5,
                "_vm":      vm["name"],
            })


def watch_ssh_remote(client: paramiko.SSHClient, vm: dict):
    fail_counts: dict[str, int] = {}
    for line in ssh_tail(client, LOG_PATHS["ssh"], vm["name"]):
        m_fail = SSH_FAIL_RE.search(line)
        if m_fail:
            user, ip = m_fail.group(1), m_fail.group(2)
            fail_counts[ip] = fail_counts.get(ip, 0) + 1
            post("ssh", {
                "src_ip":   ip,
                "username": user,
                "status":   "failed",
                "failures": fail_counts[ip],
                "_vm":      vm["name"],
            })
        m_ok = SSH_SUCCESS_RE.search(line)
        if m_ok:
            auth, user, ip = m_ok.group(1), m_ok.group(2), m_ok.group(3)
            fail_counts.pop(ip, None)
            post("ssh", {
                "src_ip":      ip,
                "username":    user,
                "status":      "success",
                "auth_method": auth,
                "_vm":         vm["name"],
            })


def watch_http_remote(client: paramiko.SSHClient, vm: dict):
    current_ip, current_method, current_url = None, None, None
    for line in ssh_tail(client, LOG_PATHS["http"], vm["name"]):
        ip_m = MODSEC_IP_RE.search(line)
        if ip_m:
            current_ip     = ip_m.group(1)
            current_method = ip_m.group(2)
            current_url    = ip_m.group(3)
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
                "url":         current_url or "/",
                "method":      current_method or "GET",
                "attack_type": atype,
                "payload":     msg,
                "rule_id":     rule_id,
                "blocked":     severity.upper() in ("CRITICAL", "ERROR"),
                "_vm":         vm["name"],
            })
            current_ip = None


SENSOR_FUNCS = {
    "suricata": watch_suricata_remote,
    "fail2ban": watch_fail2ban_remote,
    "ssh":      watch_ssh_remote,
    "http":     watch_http_remote,
}


# ─── HEARTBEAT ────────────────────────────────────────────────────────────────
def heartbeat_loop():
    """Send periodic heartbeat for aegis-forwarder itself every 15s."""
    ip       = socket.gethostbyname(socket.gethostname())
    hostname = socket.gethostname()
    while True:
        try:
            requests.post(
                f"{AEGIS_URL}/network/hosts",
                headers=HEADERS,
                json={"ip": ip, "hostname": hostname, "role": "forwarder", "status": "online"},
                timeout=5,
            )
        except Exception:
            pass
        time.sleep(15)


# ─── MAIN ─────────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    print("""
╔══════════════════════════════════════════════════════╗
║      AEGIS Forwarder HUB — Central Collector v1      ║
╚══════════════════════════════════════════════════════╝""")
    print(f"  API   : {AEGIS_URL}")
    print(f"  VMs   : {', '.join(v['name'] for v in REMOTE_VMS)}")
    print(f"  SSH   : user={SSH_USER}, key={'yes' if SSH_KEY_FILE else 'no'}, pass={'yes' if SSH_PASS else 'no'}")
    print()

    if not SSH_PASS and not SSH_KEY_FILE:
        print("[WARN] SSH_PASS and SSH_KEY are both empty — will try ~/.ssh default keys")

    # Register all VMs in AEGIS Network Monitor
    print("[*] Registering remote VMs …")
    for vm in REMOTE_VMS:
        register_vm(vm)

    # Start heartbeat for this hub VM
    threading.Thread(target=heartbeat_loop, daemon=True, name="heartbeat").start()

    threads = []
    for vm in REMOTE_VMS:
        client = make_ssh_client(vm["ip"], vm["name"])
        if not client:
            print(f"  [SKIP] {vm['name']} — SSH failed, skipping")
            continue

        for sensor in vm["sensors"]:
            fn = SENSOR_FUNCS.get(sensor)
            if not fn:
                print(f"  [SKIP] {vm['name']}/{sensor} — no parser")
                continue
            # Each sensor on each VM gets its own SSH client for independent channels
            sensor_client = make_ssh_client(vm["ip"], vm["name"])
            if sensor_client:
                t = threading.Thread(
                    target=fn,
                    args=(sensor_client, vm),
                    daemon=True,
                    name=f"{vm['name']}-{sensor}",
                )
                t.start()
                threads.append(t)
                print(f"  ► {vm['name']} / {sensor} thread started")

    if not threads:
        print("\n[ERROR] No threads started — check SSH credentials and VM connectivity.")
        sys.exit(1)

    print(f"\n[AEGIS HUB] Monitoring {len(threads)} streams across {len(REMOTE_VMS)} VMs …\n")

    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        print("\n[AEGIS HUB] Stopped.")
        sys.exit(0)
