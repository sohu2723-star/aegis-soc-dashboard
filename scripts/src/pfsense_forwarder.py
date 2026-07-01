#!/usr/bin/env python3
"""
AEGIS pfSense Syslog Forwarder
================================
Receives pfSense firewall logs via syslog (UDP 514) and forwards to AEGIS.
Run on the pfSense router OR on a syslog collector.

Setup on pfSense:
  Status → System Logs → Settings
  Enable Remote Logging → Syslog Server: <this-machine-ip>:514
  Log firewall events: ✓

Usage:
    sudo python3 pfsense_forwarder.py

Requirements:
    pip3 install requests
"""

import os
import re
import socket
import threading
import requests
from datetime import datetime

AEGIS_URL  = os.environ.get("AEGIS_URL", "http://<YOUR_AEGIS_DOMAIN>/api")
AEGIS_KEY  = os.environ.get("AEGIS_KEY", "aegis-demo-key-change-me")
LISTEN_IP  = os.environ.get("LISTEN_IP", "0.0.0.0")
LISTEN_PORT = int(os.environ.get("LISTEN_PORT", "514"))

HEADERS = {
    "Content-Type": "application/json",
    "X-AEGIS-Key": AEGIS_KEY,
}

# pfSense filterlog format:
# <134>filterlog[1234]: 5,,,1000000103,em0,match,block,in,4,0x0,,64,12345,0,none,6,tcp,64,1.2.3.4,10.0.0.1,54321,22,0
FILTERLOG_RE = re.compile(
    r"filterlog.*?:\s+"
    r"(?P<rulenum>\d+),"   # rule number
    r"[^,]*,"             # sub-rule
    r"[^,]*,"             # anchor
    r"[^,]*,"             # tracker
    r"(?P<iface>\w+),"    # interface
    r"(?P<reason>\w+),"   # reason (match/etc)
    r"(?P<action>\w+),"   # action (pass/block)
    r"(?P<direction>\w+),"# direction
    r"\d+,"               # ip version
    r"[^,]*,"             # tos
    r"[^,]*,"             # ecn
    r"[^,]*,"             # ttl
    r"[^,]*,"             # id
    r"[^,]*,"             # offset
    r"[^,]*,"             # flags
    r"(?P<proto_id>\d+)," # protocol id
    r"(?P<proto>\w+),"    # protocol
    r"[^,]*,"             # length
    r"(?P<src_ip>[\d.]+)," # src ip
    r"(?P<dst_ip>[\d.]+)," # dst ip
    r"(?P<src_port>\d+)," # src port
    r"(?P<dst_port>\d+)",  # dst port
)


def post_event(data: dict):
    try:
        r = requests.post(f"{AEGIS_URL}/ingest/pfsense", json=data, headers=HEADERS, timeout=5)
        ts = datetime.now().strftime("%H:%M:%S")
        if r.status_code == 201:
            print(f"[{ts}] ✓ pfSense event → AEGIS ({data.get('action','?')} {data.get('src_ip','?')}→{data.get('dest_ip','?')}:{data.get('dest_port','?')})")
    except Exception as e:
        print(f"[ERROR] {e}")


def parse_syslog(raw: bytes):
    try:
        msg = raw.decode("utf-8", errors="replace").strip()
        m = FILTERLOG_RE.search(msg)
        if not m:
            return

        g = m.groupdict()
        post_event({
            "message":     msg[-200:],
            "src_ip":      g["src_ip"],
            "dest_ip":     g["dst_ip"],
            "src_port":    g["src_port"],
            "dest_port":   g["dst_port"],
            "proto":       g["proto"],
            "rule_number": g["rulenum"],
            "action":      g["action"],
            "interface":   g["iface"],
        })
    except Exception:
        pass


def listen():
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    sock.bind((LISTEN_IP, LISTEN_PORT))
    print(f"[pfSense Forwarder] Listening on UDP {LISTEN_IP}:{LISTEN_PORT}")

    while True:
        data, addr = sock.recvfrom(65535)
        threading.Thread(target=parse_syslog, args=(data,), daemon=True).start()


if __name__ == "__main__":
    print(f"""
╔══════════════════════════════════════════════════╗
║      AEGIS pfSense Syslog Forwarder              ║
╚══════════════════════════════════════════════════╝
  AEGIS  : {AEGIS_URL}
  Listen : {LISTEN_IP}:{LISTEN_PORT} (UDP syslog)

  pfSense Setup:
  → Status > System Logs > Settings
  → Remote Logging: {LISTEN_IP}:{LISTEN_PORT}
  → Check: Firewall Events
""")
    try:
        listen()
    except PermissionError:
        print(f"[ERROR] Cannot bind to port {LISTEN_PORT}. Run as root or use port > 1024.")
