/**
 * Sanitisation helpers for auto-defense command building.
 * All values inserted into shell commands MUST pass through these validators.
 * Rejects anything that doesn't match strict allowlists.
 */

const IP_RE = /^(\d{1,3}\.){3}\d{1,3}(\/\d{1,2})?$/;

const ALLOWED_PROTOCOLS = new Set(["tcp", "udp", "icmp", "all"]);
const ALLOWED_CHAINS    = new Set(["INPUT", "OUTPUT", "FORWARD"]);
const ALLOWED_ACTIONS   = new Set(["DROP", "ACCEPT", "REJECT", "LOG"]);

/** Throws if ip is not a valid IPv4 address (with optional CIDR). */
export function sanitizeIp(ip: string): string {
  if (!IP_RE.test(ip)) throw new Error(`Unsafe IP value: ${ip}`);
  // Validate each octet
  const [addr] = ip.split("/");
  const octets = addr.split(".").map(Number);
  if (octets.some(o => o < 0 || o > 255)) throw new Error(`IP octet out of range: ${ip}`);
  return ip;
}

/** Throws if port is not a valid integer 1-65535. Returns stringified int. */
export function sanitizePort(port: unknown): string {
  const n = Number(port);
  if (!Number.isInteger(n) || n < 1 || n > 65535) throw new Error(`Unsafe port value: ${port}`);
  return String(n);
}

/** Throws if proto is not in the allowlist. */
export function sanitizeProtocol(proto: unknown): string {
  const s = String(proto ?? "tcp").toLowerCase();
  if (!ALLOWED_PROTOCOLS.has(s)) throw new Error(`Unsafe protocol: ${proto}`);
  return s;
}

/** Throws if chain is not in the allowlist. */
export function sanitizeChain(chain: unknown): string {
  const s = String(chain ?? "INPUT").toUpperCase();
  if (!ALLOWED_CHAINS.has(s)) throw new Error(`Unsafe chain: ${chain}`);
  return s;
}

/** Throws if action is not in the allowlist. */
export function sanitizeFwAction(action: unknown): string {
  const s = String(action ?? "DROP").toUpperCase();
  if (!ALLOWED_ACTIONS.has(s)) throw new Error(`Unsafe action: ${action}`);
  return s;
}

/** Sanitise a rate-limit string like "10/min". Allowlist only. */
export function sanitizeRate(rate: unknown): string {
  const s = String(rate ?? "10/min");
  if (!/^\d+\/(sec|min|hour|day)$/.test(s)) throw new Error(`Unsafe rate: ${rate}`);
  return s;
}

/**
 * Parse actionParams JSON and sanitise all values before use.
 * Returns a safe-to-use object.
 */
export function parseActionParams(raw: string | null | undefined): {
  durationSecs: number;
  port:         string;
  protocol:     string;
  rate:         string;
  domain:       string | null;
} {
  let params: Record<string, unknown> = {};
  try { if (raw) params = JSON.parse(raw); } catch {}

  const durationSecs = Number(params.durationSecs ?? 3600);
  const port         = params.port ? sanitizePort(params.port) : "";
  const protocol     = sanitizeProtocol(params.protocol ?? "tcp");
  const rate         = sanitizeRate(params.rate ?? "10/min");

  // Domain: only allow hostnames — no special chars
  let domain: string | null = null;
  if (params.domain) {
    const d = String(params.domain);
    if (/^[a-zA-Z0-9.-]{1,253}$/.test(d)) domain = d;
    else throw new Error(`Unsafe domain: ${params.domain}`);
  }

  return { durationSecs, port, protocol, rate, domain };
}
