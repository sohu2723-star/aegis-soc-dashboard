#!/usr/bin/env python3
"""A bounded, offline hash-verification demo using a dummy secret.

This intentionally does not read Wi-Fi captures, wordlists, interfaces, or
credentials. It demonstrates only the educational idea:
candidate -> hash -> constant-time comparison.
"""

from __future__ import annotations

import argparse
import hashlib
import hmac


DEFAULT_SECRET = "lab-demo-42"
DEFAULT_CANDIDATES = (
    "password123",
    "qwerty123",
    "letmein",
    "lab-demo-42",
    "correct-horse-battery-staple",
)


def sha256_hex(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def find_matching_candidate(secret: str, candidates: tuple[str, ...]) -> str | None:
    """Find a match in a small, in-memory demo candidate set."""
    target_digest = sha256_hex(secret)
    for candidate in candidates:
        candidate_digest = sha256_hex(candidate)
        if hmac.compare_digest(candidate_digest, target_digest):
            return candidate
    return None


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Demonstrate hash verification with a dummy lab secret."
    )
    parser.add_argument(
        "--secret",
        default=DEFAULT_SECRET,
        help="Dummy secret used only in this local demonstration.",
    )
    args = parser.parse_args()

    target_digest = sha256_hex(args.secret)
    print("Synthetic demo only: no Wi-Fi, network, interface, or external wordlist.")
    print(f"Target SHA-256: {target_digest}")
    print(f"Testing {len(DEFAULT_CANDIDATES)} built-in demo candidates...")

    match = find_matching_candidate(args.secret, DEFAULT_CANDIDATES)
    if match is None:
        print("No candidate matched.")
        return 1

    print(f"Matched dummy candidate: {match!r}")
    print("Concept: candidate -> hash -> compare. This does not recover Wi-Fi passwords.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
