#!/usr/bin/env python3
"""Display Wi-Fi metadata or passively print 802.11 frames.

This tool does not connect to an AP, send frames, disconnect clients, or
attempt to recover passwords. Use it only on networks and lab equipment you
are authorized to observe.

Metadata mode normally needs managed mode:
    python3 passive_wifi_monitor.py --interface wlx1cbfce9caba1 --metadata

Frame mode needs monitor mode and usually root privileges:
    sudo python3 passive_wifi_monitor.py --interface wlx1cbfce9caba1 --frames 30
"""

from __future__ import annotations

import argparse
import shutil
import subprocess
import sys


def scan_metadata(interface: str) -> int:
    """Print SSID, BSSID, channel, frequency, signal and security metadata."""
    if shutil.which("nmcli") is None:
        print("Error: nmcli is not installed.", file=sys.stderr)
        return 1

    result = subprocess.run(
        [
            "nmcli",
            "-f",
            "IN-USE,SSID,BSSID,CHAN,FREQ,SIGNAL,SECURITY",
            "device",
            "wifi",
            "list",
            "ifname",
            interface,
        ],
        check=False,
        text=True,
    )
    return result.returncode


def capture_frames(interface: str, count: int) -> int:
    """Print a bounded number of passive link-layer frames via tcpdump."""
    if shutil.which("tcpdump") is None:
        print("Error: tcpdump is not installed.", file=sys.stderr)
        return 1

    print(
        f"Listening passively on {interface}; waiting for {count} frame(s).",
        file=sys.stderr,
    )
    print("Press Ctrl-C to stop early.", file=sys.stderr)
    result = subprocess.run(
        [
            "tcpdump",
            "--immediate-mode",
            "-l",
            "-n",
            "-e",
            "-i",
            interface,
            "-c",
            str(count),
        ],
        check=False,
        text=True,
    )
    return result.returncode


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Passively inspect Wi-Fi metadata or captured frames."
    )
    parser.add_argument(
        "--interface",
        default="wlx1cbfce9caba1",
        help="Wireless interface name (default: wlx1cbfce9caba1)",
    )
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument(
        "--metadata",
        action="store_true",
        help="List nearby Wi-Fi metadata using NetworkManager.",
    )
    mode.add_argument(
        "--frames",
        type=int,
        metavar="COUNT",
        help="Print COUNT passive frames using tcpdump.",
    )
    args = parser.parse_args()

    if args.frames is not None and args.frames <= 0:
        parser.error("--frames must be greater than zero")

    if args.metadata:
        return scan_metadata(args.interface)
    return capture_frames(args.interface, args.frames)


if __name__ == "__main__":
    raise SystemExit(main())
