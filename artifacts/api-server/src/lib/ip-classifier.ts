/**
 * AEGIS IP Classifier
 * ===================
 * Shared utility for classifying IP addresses as defender-owned (private/loopback)
 * vs external (potential attacker). Used by auto-defense and ingest endpoints.
 *
 * Covers:
 *   IPv4  — RFC1918 (10/8, 172.16/12, 192.168/16) + loopback (127/8) + link-local (169.254/16)
 *   IPv6  — loopback (::1), ULA (fc00::/7 covers fc::/8 + fd::/8), link-local (fe80::/10),
 *            IPv4-mapped (::ffff:192.168.x.x etc.)
 */

// ─── IPv4 ────────────────────────────────────────────────────────────────────

function parseIPv4(ip: string): number[] | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  const octets = parts.map(Number);
  // Strict validation: each octet must be an integer in [0,255]
  for (const o of octets) {
    if (!Number.isInteger(o) || o < 0 || o > 255) return null;
  }
  return octets;
}

function isPrivateIPv4(ip: string): boolean {
  const octets = parseIPv4(ip);
  if (!octets) return false;
  const [a, b] = octets;
  // 10.0.0.0/8
  if (a === 10) return true;
  // 172.16.0.0/12
  if (a === 172 && b >= 16 && b <= 31) return true;
  // 192.168.0.0/16
  if (a === 192 && b === 168) return true;
  // 127.0.0.0/8 — loopback
  if (a === 127) return true;
  // 169.254.0.0/16 — link-local (APIPA)
  if (a === 169 && b === 254) return true;
  return false;
}

// ─── IPv6 ────────────────────────────────────────────────────────────────────

function isPrivateIPv6(ip: string): boolean {
  const lower = ip.toLowerCase().trim();

  // ::1 — loopback
  if (lower === "::1") return true;

  // ::ffff:x.x.x.x or ::ffff:0:x.x.x.x — IPv4-mapped; extract and re-check the IPv4 part
  const v4mapped = lower.match(/^::ffff:(?:0:)?(\d+\.\d+\.\d+\.\d+)$/);
  if (v4mapped) return isPrivateIPv4(v4mapped[1]);

  // fc00::/7 — Unique Local Addresses (ULA): covers fc::/8 and fd::/8
  // The first 7 bits must be 1111110x → first byte is fc or fd
  if (/^f[cd][0-9a-f]{2}:/i.test(lower)) return true;

  // fe80::/10 — link-local
  if (/^fe[89ab][0-9a-f]:/i.test(lower)) return true;

  return false;
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Returns true if the IP address belongs to our own defender network
 * (private, loopback, or link-local range). These IPs must never be
 * auto-blocked; they are our own hosts making legitimate outbound connections.
 *
 * Returns false for public IPs (potential attackers) and for
 * null/empty/"unknown" inputs (treated as external = not whitelisted).
 */
export function isDefenderIp(ip: string | null | undefined): boolean {
  if (!ip || ip === "unknown") return false;
  const trimmed = ip.trim();
  // Try IPv4 first (most common in lab)
  if (trimmed.includes(".") && !trimmed.includes(":")) {
    return isPrivateIPv4(trimmed);
  }
  // IPv6 (includes ::1, ::ffff: mapped, ULA, link-local)
  if (trimmed.includes(":")) {
    return isPrivateIPv6(trimmed);
  }
  return false;
}
