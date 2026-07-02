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

# ─── CONFIG ──────────────────────────────────────────────────────────────────
AEGIS_URL = os.environ.get("AEGIS_URL", "http://<YOUR_AEGIS_DOMAIN>/api")
AEGIS_KEY = os.environ.get("AEGIS_KEY", "aegis-demo-key-change-me")

HEADERS = {
    "Content-Type": "application/json",
    "X-AEGIS-Key": AEGIS_KEY,
}


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


def heartbeat_loop():
    """Send periodic heartbeat every 60s to keep host status ONLINE."""
    ip       = get_local_ip()
    hostname = socket.gethostname()
    os_name  = get_os_info()
    while True:
        time.sleep(60)
        try:
            mac   = get_mac_address(ip)
            ports = get_open_ports()
            requests.post(
                f"{AEGIS_URL}/network/hosts",
                json={"ip": ip, "hostname": hostname, "role": "ubuntu",
                      "os": os_name, "mac": mac or None,
                      "openPorts": ports or None,
                      "status": "online", "isMonitored": True},
                headers=HEADERS,
                timeout=5,
            )
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


# Map: systemd service name → AEGIS component name (must match system_status table)
SERVICE_MAP = [
    ("fail2ban",  "Fail2ban",        "perimeter"),
    ("suricata",  "Suricata IDS/IPS","perimeter"),
    ("snort",     "Snort IDS",       "perimeter"),
    ("cowrie",    "Cowrie Honeypot", "perimeter"),
]


def service_health_loop():
    """
    Report real service health to AEGIS every 30s.
    Updates system_status table → triggers SSE service_status_change → Defense Center updates in real time.
    """
    print("[SERVICE HEALTH] Monitoring: fail2ban, suricata, snort, cowrie")
    while True:
        for svc_name, component, layer in SERVICE_MAP:
            status = get_service_status(svc_name)
            ts = datetime.now().strftime("%H:%M:%S")
            try:
                r = requests.post(
                    f"{AEGIS_URL}/system/status",
                    json={
                        "component": component,
                        "layer":     layer,
                        "status":    status,
                        "metrics":   json.dumps({
                            "service":    svc_name,
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
                    print(f"[{ts}] WARN service_health/{svc_name}: HTTP {r.status_code}")
            except Exception as e:
                print(f"[{ts}] ERROR service_health/{svc_name}: {e}")
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
    for line in tail_file(FAIL2BAN_LOG):
        m = FAIL2BAN_RE.search(line)
        if not m:
            continue
        post("fail2ban", {
            "jail":     m.group(1),
            "ip":       m.group(2),
            "failures": 5,
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

    for line in tail_file(SSH_LOG):
        m_fail = SSH_FAIL_RE.search(line)
        if m_fail:
            user, ip = m_fail.group(1), m_fail.group(2)
            fail_counts[ip] = fail_counts.get(ip, 0) + 1
            post("ssh", {
                "src_ip":   ip,
                "username": user,
                "status":   "failed",
                "failures": fail_counts[ip],
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
    parser = argparse.ArgumentParser(description="AEGIS Forwarder")
    parser.add_argument("--mode", choices=list(MODES.keys()) + ["all"], default="all")
    parser.add_argument("--url", help="AEGIS API URL override")
    parser.add_argument("--key", help="AEGIS API key override")
    args = parser.parse_args()

    if args.url:
        AEGIS_URL = args.url
    if args.key:
        AEGIS_KEY = args.key
        HEADERS["X-AEGIS-Key"] = args.key

    print(f"""
╔══════════════════════════════════════════════════╗
║         AEGIS Forwarder — Blue Team v2           ║
╚══════════════════════════════════════════════════╝
  Target : {AEGIS_URL}
  Mode   : {args.mode}
  Sensors: Suricata, Snort, Fail2ban, SSH, FTP, HTTP, Cowrie
""")

    # Register this VM in AEGIS Network Monitor on startup
    print("  [*] Registering host with AEGIS...")
    register_host()

    # Start heartbeat to keep host ONLINE every 60s
    hb = threading.Thread(target=heartbeat_loop, daemon=True, name="heartbeat")
    hb.start()

    # Start service health reporter — updates fail2ban/suricata/snort/cowrie status every 30s
    sh = threading.Thread(target=service_health_loop, daemon=True, name="service_health")
    sh.start()

    if args.mode == "all":
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
            print("\n[AEGIS] Forwarder stopped.")
    else:
        try:
            MODES[args.mode]()
        except KeyboardInterrupt:
            print("\n[AEGIS] Forwarder stopped.")
