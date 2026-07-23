/**
 * AEGIS IP Classifier
 * ===================
 * Classifies IP addresses as defender-owned vs external attacker.
 * Used by auto-defense to prevent self-blocking.
 *
 * Lab topology (GNS3):
 *   10.10.10.x  — company-web-server / company-dns-server subnet (defender)
 *   10.20.20.x  — company-customer-db / company-ldap-server subnet (defender)
 *   10.30.30.x  — aegis-company-admin + pfSense subnet (defender)
 *   127.x       — loopback
 *
 *   192.168.10.x  — Kali attacker subnet (via R1 router) → ATTACKER — never whitelist
 *   192.168.122.x — GNS3 NAT cloud (internet update return traffic) → NOISE — skip for Suricata
 *
 * Two classifiers:
 *   isDefenderIp()     — specific defender subnets only; used by auto-defense to avoid self-block
 *   isLabInternalIp()  — broader check for Suricata/HTTP ingest; covers all 10.x.x.x + NAT cloud
 *
 * NOTE: We do NOT whitelist all RFC1918. 192.168.10.x is the Kali attacker subnet.
 * 192.168.122.x is GNS3 NAT cloud (internet update noise), not an attacker.
 */

// ─── Lab defender subnets ────────────────────────────────────────────────────

// Only these specific subnets are our own defender infrastructure.
const DEFENDER_SUBNETS: Array<{ prefix: number[]; bits: number }> = [
  { prefix: [10, 10, 10], bits: 24 },  // company-web-server + company-dns-server
  { prefix: [10, 20, 20], bits: 24 },  // company-customer-db + company-ldap-server
  { prefix: [10, 30, 30], bits: 24 },  // aegis-company-admin + pfSense
  { prefix: [127],         bits: 8  },  // loopback
];

function parseIPv4(ip: string): number[] | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  const octets = parts.map(Number);
  for (const o of octets) {
    if (!Number.isInteger(o) || o < 0 || o > 255) return null;
  }
  return octets;
}

function isDefenderIPv4(ip: string): boolean {
  const octets = parseIPv4(ip);
  if (!octets) return false;
  for (const { prefix } of DEFENDER_SUBNETS) {
    if (prefix.every((b, i) => octets[i] === b)) return true;
  }
  return false;
}

function isDefenderIPv6(ip: string): boolean {
  const lower = ip.toLowerCase().trim();
  if (lower === "::1") return true;
  // IPv4-mapped — re-check the embedded IPv4
  const v4mapped = lower.match(/^::ffff:(?:0:)?(\d+\.\d+\.\d+\.\d+)$/);
  if (v4mapped) return isDefenderIPv4(v4mapped[1]);
  return false;
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Returns true only for IPs in our known defender subnets (never for
 * 192.168.122.x GNS3 NAT / Kali attacker range).
 * Used by auto-defense engine to avoid self-blocking.
 */
export function isDefenderIp(ip: string | null | undefined): boolean {
  if (!ip || ip === "unknown") return false;
  const trimmed = ip.trim();
  if (trimmed.includes(".") && !trimmed.includes(":")) {
    return isDefenderIPv4(trimmed);
  }
  if (trimmed.includes(":")) {
    return isDefenderIPv6(trimmed);
  }
  return false;
}

/**
 * Broader internal-lab check used by Suricata / HTTP ingest to drop noise
 * before events reach the database.
 *
 * Covers:
 *   10.0.0.0/8    — all lab subnets (VLAN 10/20/30, pfSense WAN link 10.0.23.x, etc.)
 *   192.168.122.x — GNS3 NAT cloud (internet update return traffic — Suricata TCP-reassembly noise)
 *   127.x         — loopback
 *
 * Does NOT cover:
 *   192.168.10.x  — Kali attacker subnet (via R1 router) → must reach event store as attacks
 *
 * Rule: attack traffic must originate from 192.168.10.x (attacker side of R1).
 * Everything else that is internal to the GNS3 lab should be silent.
 */
export function isLabInternalIp(ip: string | null | undefined): boolean {
  if (!ip || ip === "unknown") return false;
  const trimmed = ip.trim();
  const octets = parseIPv4(trimmed);
  if (octets) {
    if (octets[0] === 10) return true;                                                       // 10.0.0.0/8 — all lab VLANs
    if (octets[0] === 127) return true;                                                      // loopback
    if (octets[0] === 192 && octets[1] === 168 && octets[2] === 122) return true;           // GNS3 NAT cloud
    return false;
  }
  // IPv6 loopback / mapped
  const lower = trimmed.toLowerCase();
  if (lower === "::1") return true;
  const v4mapped = lower.match(/^::ffff:(?:0:)?(\d+\.\d+\.\d+\.\d+)$/);
  if (v4mapped) return isLabInternalIp(v4mapped[1]);
  return false;
}
