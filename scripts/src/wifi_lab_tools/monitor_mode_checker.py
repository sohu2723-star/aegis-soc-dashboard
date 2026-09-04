#!/usr/bin/env python3
"""Check the current nl80211 interface mode without changing it."""

from __future__ import annotations

import argparse
import re
import subprocess
import sys


def interface_info(interface: str) -> str:
    """Return ``iw`` information for an interface or raise a useful error."""
    result = subprocess.run(
        ["iw", "dev", interface, "info"],
        check=False,
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        detail = (result.stderr or result.stdout).strip()
        raise RuntimeError(detail or f"Could not inspect interface {interface!r}")
    return result.stdout


def interface_type(iw_output: str) -> str | None:
    """Extract the interface type from ``iw dev <name> info`` output."""
    match = re.search(r"^\s*type\s+(\S+)\s*$", iw_output, flags=re.MULTILINE)
    return match.group(1) if match else None


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Check whether a Wi-Fi interface is in monitor mode."
    )
    parser.add_argument(
        "interface",
        nargs="?",
        default="wlx1cbfce9caba1",
        help="Wireless interface name (default: wlx1cbfce9caba1)",
    )
    args = parser.parse_args()

    try:
        output = interface_info(args.interface)
    except (OSError, RuntimeError) as exc:
        print(f"Error: {exc}", file=sys.stderr)
        print(
            "Make sure the interface exists and the 'iw' command is installed.",
            file=sys.stderr,
        )
        return 1

    mode = interface_type(output)
    print(f"Interface: {args.interface}")
    print(f"Mode: {mode or 'unknown'}")
    print(f"Monitor mode: {'YES' if mode == 'monitor' else 'NO'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
