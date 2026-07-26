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
  { prefix: [10, 0, 23],  bits: 24 },  // pfSense WAN transit network
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
 * Covers only configured defender subnets/hosts plus:
 *   192.168.122.x — GNS3 NAT cloud (internet update return traffic — Suricata TCP-reassembly noise)
 *   127.x         — loopback
 *
 * Does NOT cover:
 *   192.168.10.x  — Kali attacker subnet (via R1 router) → must reach event store as attacks
 *
 * Attacker addressing is dynamic; unrelated 10/8 addresses are not blanket-dropped.
 */
export function isLabInternalIp(ip: string | null | undefined): boolean {
  if (!ip || ip === "unknown") return false;
  const trimmed = ip.trim();
  const octets = parseIPv4(trimmed);
  if (octets) {
    if (isDefenderIPv4(trimmed)) return true;
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

// ─── Target host canonical name resolution ───────────────────────────────────

/**
 * Maps known lab VM IPs to their AEGIS canonical server names.
 * Keeps the DB targetHost consistent regardless of whether the forwarder
 * sends a raw IP or an already-resolved name.
 */
const IP_TO_CANONICAL: Record<string, string> = {
  "10.10.10.10": "company-web-server",
  "10.10.10.20": "company-dns-server",
  "10.20.20.10": "company-customer-db",
  "10.20.20.20": "company-ldap-server",
  "10.30.30.10": "aegis-company-admin",
  "10.30.30.1":  "pfSense",
  "10.0.23.2":   "pfSense (WAN)",
  "10.0.23.1":   "R1 (ether3)",
  "192.168.122.2": "R1 (Internet)",
};

// Names that are already canonical — pass through without modification.
const CANONICAL_NAMES = new Set([
  "company-web-server",
  "company-dns-server",
  "company-customer-db",
  "company-ldap-server",
  "aegis-company-admin",
  "aegis-api-server",
  "internal-network",
  "lan-segment",
  "pfSense",
]);

/**
 * Resolve a raw IP or label to an AEGIS canonical server name.
 *
 * Used by every ingest endpoint so the DB always stores canonical names,
 * not raw IPs. This is the root-cause fix for all events showing the wrong
 * target server (e.g. everything mapped to "company-web-server").
 *
 * Priority:
 *   1. Exact IP → canonical name
 *   2. Already a canonical name → pass through
 *   3. Pattern match (e.g. contains "dns", "ldap") → map to canonical
 *   4. Looks like a URL → return as-is (don't resolve HTTP attack URLs)
 *   5. Fallback to provided default
 */
export function resolveTargetHost(
  raw: string | null | undefined,
  fallback: string,
): string {
  if (!raw) return fallback;
  const s = raw.trim();
  if (!s) return fallback;

  // 1. Exact IP match
  if (IP_TO_CANONICAL[s]) return IP_TO_CANONICAL[s];

  // 2. Already canonical
  if (CANONICAL_NAMES.has(s)) return s;

  // 3. Pattern match for partial/prefix labels sent by the forwarder
  const lower = s.toLowerCase();
  if (lower.includes("company-web") || lower === "bank-web" || lower.includes("apache") || lower.includes("dvwa")) return "company-web-server";
  if (lower.includes("company-dns") || lower.includes("dns-server") || lower.includes("bind9") || lower.includes("named")) return "company-dns-server";
  if (lower.includes("company-customer") || lower.includes("customer-db") || lower.includes("mysql") || lower.includes("mariadb")) return "company-customer-db";
  if (lower.includes("company-ldap") || lower.includes("ldap-server") || lower.includes("slapd") || lower.includes("openldap")) return "company-ldap-server";
  if (lower.includes("aegis") || lower.includes("forwarder") || lower.includes("admin") || lower === "10.30.30.10") return "aegis-company-admin";

  // 4. Looks like a URL (HTTP attack targetHost) — keep as-is
  if (s.startsWith("http://") || s.startsWith("https://") || s.startsWith("/")) return s;

  // 5. Return raw value if non-empty, else fallback
  return s || fallback;
}

// ─── Suricata protocol noise filter ──────────────────────────────────────────
/**
 * Suricata generates internal protocol-anomaly events that are NOT real attack
 * signatures. These fire on TCP stream-tracking, malformed packets, and
 * app-layer parsing — including on return traffic from outbound connections
 * (e.g., company VMs doing apt-get, DNS queries).
 *
 * Known Suricata internal SID ranges (never real attack rules):
 *   2200000–2200999  DECODER events        (malformed/truncated packets)
 *   2210000–2210999  STREAM events         (TCP stream-tracking anomalies)  ← SID 2210020 in screenshot
 *   2220000–2220999  STREAM-TCP events     (TCP reassembly issues)
 *   2230000–2230999  APP-LAYER events      (application layer parsing)
 *
 * Example: "SURICATA STREAM ESTABLISHED packet out of window" (SID 2210020)
 * fires when TCP packets arrive out-of-order on an established connection —
 * harmless noise from internet response traffic, NOT an indicator of attack.
 */
export function isSuricataProtocolNoiseSid(sid: number | null | undefined): boolean {
  if (sid == null) return false;
  return (
    (sid >= 2200000 && sid <= 2200999) || // SURICATA DECODER events
    (sid >= 2210000 && sid <= 2210999) || // SURICATA STREAM events
    (sid >= 2220000 && sid <= 2220999) || // SURICATA STREAM-TCP events
    (sid >= 2230000 && sid <= 2230999)    // SURICATA APP-LAYER events
  );
}
