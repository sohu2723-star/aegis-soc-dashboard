#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SOURCE="$ROOT/deliverables/AEGIS_SOC_Dashboard_Project_Book.docx.base64"
EXPECTED="$(cat "$ROOT/deliverables/AEGIS_SOC_Dashboard_Project_Book.docx.sha256")"
OUTPUT="${1:-$ROOT/AEGIS_SOC_Dashboard_Project_Book.docx}"

base64 --decode "$SOURCE" > "$OUTPUT"
ACTUAL="$(sha256sum "$OUTPUT" | awk '{print $1}')"
if [[ "$ACTUAL" != "$EXPECTED" ]]; then
  rm -f "$OUTPUT"
  echo "Checksum verification failed" >&2
  exit 1
fi
printf 'Created %s\n' "$OUTPUT"
