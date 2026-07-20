---
name: Company topology rename
description: Project renamed from bank → company topology (2026-07-21); all node names, rule names, labels updated.
---

# Company Topology Rename (2026-07-21)

## What changed
GNS3 node display labels changed from bank-* to Company-* prefix. All code identifiers updated to match.

## Mapping
| Old | New |
|---|---|
| `bank-web` | `company-web-server` |
| `customer-db` | `company-customer-db` |
| `dns-server` | `company-dns-server` |
| `ldap-server` | `company-ldap-server` |
| `aegis-ADMIN` | `aegis-company-admin` |
| `SecureBank` / `AEGIS-SecureBank` | `SecureCompany` / `AEGIS-SecureCompany` |

## Key rules
- Forwarder `REMOTE_HOSTS[n]["name"]` values → use new names (these are sent as hostnames to API)
- `targetVm` in defense_rules table → use new names (forwarder matches these to route commands)
- Old "bank-web" rule names added to `OBSOLETE_RULE_NAMES` in `auto-defense.ts` — deleted from DB on next Render deploy
- `GENERIC_LABELS` in `host-utils.tsx` keeps legacy aliases as fallback so old DB events still display correctly

**Why:** User renamed GNS3 nodes from bank → company branding. All runtime string matching (forwarder→API→defense routing) must use the same names.

**How to apply:** Any new code that references a specific VM by name must use `company-web-server`, `company-customer-db`, `company-dns-server`, `company-ldap-server`. Never `bank-web` etc.
