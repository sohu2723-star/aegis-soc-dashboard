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
 *   192.168.122.x — GNS3 NAT cloud / attacker Kali subnet → NOT whitelisted
 *
 * NOTE: We do NOT whitelist all RFC1918. The GNS3 NAT cloud (192.168.122.0/24)
 * is used by attacker VMs (Kali). Whitelisting all 192.168.x.x would silently
 * skip auto-defense for the most common attacker source in this lab.
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
