#!/usr/bin/env python3
"""Local-only Wi-Fi password strength estimate.

The password is read with getpass, never sent to a network, printed, or saved.
This is a heuristic for lab education, not a formal password-cracking tool.
"""

from __future__ import annotations

import argparse
import getpass
import math
import re
import sys


COMMON_PASSWORDS = {
    "12345678",
    "123456789",
    "password",
    "password123",
    "qwerty123",
    "letmein",
    "admin123",
    "welcome123",
}


def _character_pool_size(password: str) -> int:
    pool = 0
    if any(char.islower() for char in password):
        pool += 26
    if any(char.isupper() for char in password):
        pool += 26
    if any(char.isdigit() for char in password):
        pool += 10
    if any(not char.isalnum() for char in password):
        pool += 33
    return pool


def _has_sequence(password: str) -> bool:
    lowered = password.lower()
    sequences = (
        "0123456789",
        "abcdefghijklmnopqrstuvwxyz",
        "qwertyuiop",
        "asdfghjkl",
    )
    return any(sequence in lowered or sequence[::-1] in lowered for sequence in sequences)


def audit_password(password: str) -> dict[str, object]:
    """Return a non-secret heuristic report for a password."""
    lower = password.lower()
    pool = _character_pool_size(password)
    entropy = len(password) * math.log2(pool) if pool else 0.0
    issues: list[str] = []

    if len(password) < 12:
        issues.append("Use at least 12 characters; 16+ is better for Wi-Fi.")
    if lower in COMMON_PASSWORDS:
        issues.append("This is a commonly used password.")
    if re.search(r"(.)\1{2,}", password):
        issues.append("It contains repeated characters.")
    if _has_sequence(password):
        issues.append("It contains an obvious sequence or keyboard pattern.")
    if password.isalpha() or password.isdigit():
        issues.append("Use a mix of character types or a long random passphrase.")

    if entropy >= 80 and not issues:
        rating = "strong"
    elif entropy >= 60 and len(password) >= 12:
        rating = "moderate"
    else:
        rating = "weak"

    return {
        "length": len(password),
        "estimated_entropy_bits": round(entropy, 1),
        "rating": rating,
        "issues": issues,
    }


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Audit one password locally without contacting a network."
    )
    parser.add_argument(
        "--confirm",
        action="store_true",
        help="Ask for the password twice and require both entries to match.",
    )
    args = parser.parse_args()

    password = getpass.getpass("Password to audit (not saved or printed): ")
    if not password:
        print("Error: password cannot be empty.", file=sys.stderr)
        return 1

    if args.confirm:
        confirmation = getpass.getpass("Enter it again for confirmation: ")
        if password != confirmation:
            print("Error: entries did not match.", file=sys.stderr)
            return 1

    report = audit_password(password)
    print(f"Length: {report['length']}")
    print(f"Estimated entropy: {report['estimated_entropy_bits']} bits")
    print(f"Rating: {report['rating']}")
    if report["issues"]:
        print("Recommendations:")
        for issue in report["issues"]:
            print(f"- {issue}")
    else:
        print("No obvious weakness found by this simple local heuristic.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
