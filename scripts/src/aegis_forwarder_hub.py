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
import subprocess
import sys
import time
import threading
import xml.etree.ElementTree as ET
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
TCPDUMP_RE     = re.compile(r"[\d:.]+ IP(?:6)? ([\d.]+)\.(\d+) > ([\d.]+)\.(\d+):")
TCPDUMP_ICMP   = re.compile(r"[\d:.]+ IP ([\d.]+) > ([\d.]+): ICMP")

# ─── NETWORK SCANNER CONFIG ───────────────────────────────────────────────────
SCAN_SUBNETS  = ["10.10.10.0/24", "10.20.20.0/24", "10.30.30.0/24"]
SCAN_INTERVAL = 300   # 5 minutes
SCAN_PORTS    = "22,80,443,21,25,110,143,3306,5432,8080,8443,3389"

# Known IP → name/role mapping (static lab config)
KNOWN_HOSTS: dict = {
    "10.10.10.10":    {"name": "bank-web",        "role": "ubuntu"},
    "10.10.10.20":    {"name": "bank-mail",        "role": "ubuntu"},
    "10.20.20.10":    {"name": "teller-pc",        "role": "ubuntu"},
    "10.20.20.20":    {"name": "customer-db",      "role": "ubuntu"},
    "10.30.30.10":    {"name": "aegis-forwarder",  "role": "ubuntu"},
    "10.0.12.1":      {"name": "R1-MikroTik",      "role": "router"},
    "10.0.23.1":      {"name": "R2-MikroTik",      "role": "router"},
}

# Traffic stats (per-minute counter, reset each report cycle)
_traffic_lock = threading.Lock()
_traffic_stats: dict = {"packets": 0, "inbound": 0, "outbound": 0, "blocked": 0}
_OWN_IPS: set = set()  # populated in main

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


# ─── NMAP NETWORK SCANNER ─────────────────────────────────────────────────────
def _has_passwordless_sudo() -> bool:
    """nmap install + tcpdump both run under sudo. If SSH_USER doesn't have
    NOPASSWD sudo, these silently fail (no tty to prompt for a password) and
    OS/Ports/MAC/Traffic never populate — with no obvious error anywhere."""
    try:
        r = subprocess.run(["sudo", "-n", "true"], capture_output=True, timeout=5)
        return r.returncode == 0
    except Exception:
        return False


def _nmap_available() -> bool:
    try:
        r = subprocess.run(["nmap", "--version"], capture_output=True, timeout=5)
        return r.returncode == 0
    except (FileNotFoundError, subprocess.TimeoutExpired):
        return False


def _port_to_role(open_ports: list[int]) -> str:
    if 3306 in open_ports or 5432 in open_ports:
        return "ubuntu"
    if 80 in open_ports or 443 in open_ports or 8080 in open_ports:
        return "ubuntu"
    if 25 in open_ports or 110 in open_ports or 143 in open_ports:
        return "ubuntu"
    return "ubuntu"


def nmap_scan_subnet(subnet: str) -> list[dict]:
    """Scan subnet with nmap. Returns list of host dicts with ip/mac/os/ports.

    MUST run under sudo: an unprivileged ping-scan (-sn) cannot send raw ARP
    requests, so it will NEVER return a MAC address — even for hosts on the
    same L2 subnet. Root is required to get MAC at all."""
    try:
        cmd = ["nmap", "-sn", "--host-timeout", "5s", "-oX", "-", subnet]
        if _has_passwordless_sudo():
            cmd = ["sudo", "-n"] + cmd
        result = subprocess.run(
            cmd,
            capture_output=True, text=True, timeout=90,
        )
        if result.returncode != 0 or not result.stdout.strip():
            return []

        root = ET.fromstring(result.stdout)
        hosts = []
        for host in root.findall("host"):
            status = host.find("status")
            if status is None or status.get("state") != "up":
                continue
            ip = mac = None
            for addr in host.findall("address"):
                if addr.get("addrtype") == "ipv4":
                    ip = addr.get("addr")
                elif addr.get("addrtype") == "mac":
                    mac = addr.get("addr")
            if not ip:
                continue

            # Hostname
            hn_elem = host.find(".//hostname")
            hostname = hn_elem.get("name") if hn_elem is not None else None

            # Look up known name / role first
            known = KNOWN_HOSTS.get(ip, {})
            hostname = known.get("name") or hostname or ip
            role     = known.get("role", "unknown")

            hosts.append({"ip": ip, "hostname": hostname, "mac": mac, "role": role, "os": None})
        return hosts

    except Exception as e:
        print(f"  [NMAP] Scan error {subnet}: {e}")
        return []


def nmap_port_scan(ip: str) -> tuple[str | None, str]:
    """Run port+OS scan on a single IP. Returns (os_str, open_ports_csv).

    OS detection (-O) was missing entirely before, so <osmatch> never
    appeared in the XML and OS stayed None for every host regardless of
    privileges. -O also requires root, same as MAC above."""
    try:
        cmd = ["nmap", f"-p{SCAN_PORTS}", "--open", "-sV", "--host-timeout", "15s",
               "--version-intensity", "0", "-oX", "-", ip]
        has_sudo = _has_passwordless_sudo()
        if has_sudo:
            cmd = cmd[:1] + ["-O", "--osscan-guess"] + cmd[1:]
            cmd = ["sudo", "-n"] + cmd
        result = subprocess.run(
            cmd,
            capture_output=True, text=True, timeout=60,
        )
        if result.returncode != 0:
            return None, ""
        root    = ET.fromstring(result.stdout)
        ports   = []
        os_str  = None
        for port in root.findall(".//port"):
            state = port.find("state")
            if state is not None and state.get("state") == "open":
                portid = port.get("portid")
                svc    = port.find("service")
                sname  = svc.get("name", "") if svc is not None else ""
                ports.append(f"{portid}/{sname}" if sname else portid)
        osmatch = root.find(".//osmatch")
        if osmatch is not None:
            os_str = osmatch.get("name")
        return os_str, ", ".join(ports)
    except Exception as e:
        print(f"  [NMAP] Port scan error {ip}: {e}")
        return None, ""


def nmap_scanner_loop():
    """Discover all hosts on lab subnets every SCAN_INTERVAL seconds."""
    if not _nmap_available():
        if not _has_passwordless_sudo():
            print("[NMAP] nmap not found and sudo needs a password (no tty available "
                  "to prompt for it) — cannot auto-install.")
            print("[NMAP] Fix: on this VM run  sudo apt-get install -y nmap  once by hand, "
                  "or grant NOPASSWD sudo:  echo \"$USER ALL=(ALL) NOPASSWD: ALL\" | "
                  "sudo tee /etc/sudoers.d/aegis-hub")
            print("[NMAP] Skipping network discovery — OS/Ports/MAC will stay empty until this is fixed.")
            return
        print("[NMAP] nmap not found — installing...")
        subprocess.run(["sudo", "apt-get", "install", "-y", "nmap"],
                       capture_output=True, timeout=120)
        if not _nmap_available():
            print("[NMAP] Install failed — skipping network discovery")
            return

    print(f"[NMAP] Scanner started — subnets: {', '.join(SCAN_SUBNETS)}")
    while True:
        total = 0
        for subnet in SCAN_SUBNETS:
            print(f"  [NMAP] Scanning {subnet} …")
            hosts = nmap_scan_subnet(subnet)
            for h in hosts:
                # Port scan each discovered host for open ports + OS
                os_str, open_ports = nmap_port_scan(h["ip"])
                h["os"]        = os_str
                h["openPorts"] = open_ports or None
                try:
                    resp = requests.post(
                        f"{AEGIS_URL}/network/hosts",
                        headers=HEADERS,
                        json={
                            "ip":        h["ip"],
                            "hostname":  h["hostname"],
                            "role":      h["role"],
                            "os":        h.get("os"),
                            "mac":       h.get("mac"),
                            "openPorts": h.get("openPorts"),
                            "status":    "online",
                        },
                        timeout=10,
                    )
                    # A 4xx/5xx response does NOT raise an exception in requests —
                    # without this check we'd print "✓" even when the API rejected
                    # the host (e.g. bad AEGIS key, validation error) and nothing
                    # was actually saved.
                    if resp.status_code in (200, 201):
                        print(f"    ✓ {h['hostname']} ({h['ip']}) | OS: {h.get('os','?')} | Ports: {h.get('openPorts','?')} | MAC: {h.get('mac','N/A')}")
                    else:
                        print(f"    ✗ Register REJECTED {h['ip']} → HTTP {resp.status_code}: {resp.text[:120]}")
                except Exception as e:
                    print(f"    ✗ Register failed {h['ip']}: {e}")
                total += 1
        print(f"  [NMAP] Scan cycle done — {total} hosts found. Next in {SCAN_INTERVAL}s.")
        time.sleep(SCAN_INTERVAL)


# ─── TCPDUMP PACKET CAPTURE ───────────────────────────────────────────────────
def _tcpdump_available() -> bool:
    try:
        subprocess.run(["tcpdump", "--version"], capture_output=True, timeout=5)
        return True
    except (FileNotFoundError, subprocess.TimeoutExpired):
        return False


def _detect_attack_type(dst_port: int, flags: str) -> str | None:
    """Heuristic: guess if a packet looks like an attack."""
    suspicious_ports = {22: "SSH Brute Force", 3306: "DB Attack", 5432: "DB Attack",
                        21: "FTP Attack", 25: "SMTP Attack", 3389: "RDP Attack"}
    if dst_port in suspicious_ports:
        return suspicious_ports[dst_port]
    if "S" in flags and "A" not in flags:
        return "SYN Scan"
    return None


def traffic_reporter_loop():
    """POST per-minute packet stats to AEGIS every 60 s."""
    while True:
        time.sleep(60)
        with _traffic_lock:
            snap = dict(_traffic_stats)
            _traffic_stats.update({"packets": 0, "inbound": 0, "outbound": 0, "blocked": 0})
        if snap["packets"] == 0:
            continue
        try:
            requests.post(
                f"{AEGIS_URL}/ingest/traffic",
                headers=HEADERS,
                json={**snap, "timestamp": datetime.utcnow().isoformat() + "Z"},
                timeout=10,
            )
        except Exception:
            pass


def tcpdump_loop():
    """Capture live packets with tcpdump, count stats, forward suspicious ones."""
    global _OWN_IPS
    _OWN_IPS = {v["ip"] for v in REMOTE_VMS} | {socket.gethostbyname(socket.gethostname())}

    if not _tcpdump_available():
        print("[TCPDUMP] tcpdump not found — skipping packet capture")
        return
    if not _has_passwordless_sudo():
        print("[TCPDUMP] sudo needs a password (no tty available) — 'sudo tcpdump' will "
              "fail silently and Traffic (Last Hr) will stay at 0 Mb/s.")
        print("[TCPDUMP] Fix: grant NOPASSWD sudo for this user, e.g. "
              "echo \"$USER ALL=(ALL) NOPASSWD: ALL\" | sudo tee /etc/sudoers.d/aegis-hub")
        return

    threading.Thread(target=traffic_reporter_loop, daemon=True, name="traffic-reporter").start()
    print("[TCPDUMP] Packet capture started")

    while True:
        try:
            proc = subprocess.Popen(
                ["sudo", "tcpdump", "-i", "any", "-n", "-l", "--immediate-mode",
                 "ip", "and", "not", "host", "127.0.0.1"],
                stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True, bufsize=1,
            )
            for raw in proc.stdout:
                line = raw.strip()

                # Count traffic stats
                m = TCPDUMP_RE.search(line)
                if m:
                    src_ip, src_port_s, dst_ip, dst_port_s = m.groups()
                    dst_port = int(dst_port_s)
                    flags_m  = re.search(r"Flags \[([^\]]+)\]", line)
                    flags    = flags_m.group(1) if flags_m else ""

                    with _traffic_lock:
                        _traffic_stats["packets"] += 1
                        if dst_ip in _OWN_IPS:
                            _traffic_stats["inbound"] += 1
                        else:
                            _traffic_stats["outbound"] += 1

                    # Forward suspicious packets as security events
                    attack = _detect_attack_type(dst_port, flags)
                    if attack:
                        post("generic", {
                            "source":      "tcpdump",
                            "type":        "network_attack",
                            "subtype":     attack,
                            "severity":    "medium",
                            "src_ip":      src_ip,
                            "dst_ip":      dst_ip,
                            "description": f"{attack} | {src_ip}:{src_port_s} → {dst_ip}:{dst_port_s} [{flags}]",
                        })
                        with _traffic_lock:
                            _traffic_stats["blocked"] += 1
                    continue

                # ICMP
                m2 = TCPDUMP_ICMP.search(line)
                if m2:
                    with _traffic_lock:
                        _traffic_stats["packets"] += 1
                        _traffic_stats["inbound"] += 1

        except Exception as e:
            print(f"  [TCPDUMP] Error: {e} — restarting in 10s")
            time.sleep(10)


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
    """
    Watch auth.log on a remote VM.
    Skips events where the source IP is our own forwarder — those are the hub's
    own SSH management connections and must not appear as attacks.
    """
    fail_counts: dict[str, int] = {}
    own_ip = _get_own_ip()
    # Build a set of all "defender" IPs that should never be flagged as attackers
    defender_ips = {own_ip, "10.30.30.10"} | {v["ip"] for v in REMOTE_VMS}

    for line in ssh_tail(client, LOG_PATHS["ssh"], vm["name"]):
        m_fail = SSH_FAIL_RE.search(line)
        if m_fail:
            user, ip = m_fail.group(1), m_fail.group(2)
            if ip in defender_ips:
                continue  # ignore hub's own SSH connections
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
            if ip in defender_ips:
                continue  # ignore hub's own SSH connections
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
def _get_own_ip() -> str:
    """Return the real outbound interface IP (not 127.0.0.1)."""
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return socket.gethostbyname(socket.gethostname())


def heartbeat_loop():
    """Send periodic heartbeat for aegis-forwarder itself every 15s."""
    ip       = _get_own_ip()
    hostname = socket.gethostname()
    print(f"  [HEARTBEAT] My IP = {ip}")
    while True:
        try:
            requests.post(
                f"{AEGIS_URL}/network/hosts",
                headers=HEADERS,
                json={"ip": ip, "hostname": hostname, "role": "ubuntu", "status": "online"},
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

    # NOTE: VMs are registered only when SSH successfully connects — not at startup.
    # This avoids showing offline VMs in the connected-devices list.

    # Start heartbeat for this hub VM
    threading.Thread(target=heartbeat_loop, daemon=True, name="heartbeat").start()

    # Start network scanner (nmap — discovers all devices with MAC/OS/ports)
    threading.Thread(target=nmap_scanner_loop, daemon=True, name="nmap-scanner").start()

    # Start packet capture (tcpdump — real traffic stats + suspicious packet alerts)
    threading.Thread(target=tcpdump_loop, daemon=True, name="tcpdump").start()

    threads = []
    for vm in REMOTE_VMS:
        client = make_ssh_client(vm["ip"], vm["name"])
        if not client:
            print(f"  [SKIP] {vm['name']} — SSH failed, skipping (not added to connected devices)")
            continue

        # DO NOT register remote VMs — each VM runs its own agent script
        # Hub only registers itself via heartbeat_loop

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
        # IMPORTANT: do NOT sys.exit() here. Heartbeat / nmap-scanner / tcpdump
        # threads were already started above and run independently of SSH log
        # tailing — killing the whole process would also kill those, which is
        # why "OS / Ports / MAC / Traffic" never showed up in the dashboard
        # even though nmap+tcpdump don't need SSH to any remote VM at all.
        print("\n[WARN] No SSH log-tailing threads started — check SSH credentials "
              "and VM connectivity (see errors above).")
        print("[WARN] Network discovery (nmap) and traffic capture (tcpdump) will "
              "keep running in the background regardless.\n")
    else:
        print(f"\n[AEGIS HUB] Monitoring {len(threads)} streams across {len(REMOTE_VMS)} VMs …\n")

    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        print("\n[AEGIS HUB] Stopped.")
        sys.exit(0)
