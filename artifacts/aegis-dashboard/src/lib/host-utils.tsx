/**
 * AEGIS Host Label utilities
 * ==========================
 * Resolves raw IPs to human-readable device names using:
 *  1. Live network_hosts data (from DeviceContext / DB)
 *  2. Static fallback map for known lab IPs
 *
 * Usage:
 *   import { HostLabel, resolveHostLabel } from "@/lib/host-utils";
 *   <HostLabel ip="10.10.10.10" />   → renders "bank-web" (with IP tooltip)
 */

import { useDeviceContext, type NetworkHost } from "@/lib/device-context";

// ─── Static fallback — intentionally empty ───────────────────────────────────
// IPs are fully dynamic: defender VMs register via forwarder heartbeat,
// attacker IPs come from live log events. No hardcoded IP→label mappings.
// The live network_hosts DB (priority 1 below) is the only source of truth.
const STATIC_LABELS: Record<string, { label: string; role: "defender" | "attacker" | "infra" }> = {};

// ─── Generic labels stored by ingest routes when no real IP known ─────────────
const GENERIC_LABELS: Record<string, { label: string; role: "defender" | "attacker" | "infra" }> = {
  "bank-web":         { label: "bank-web",        role: "defender" },
  "customer-db":      { label: "customer-db",     role: "defender" },
  "dns-server":       { label: "dns-server",      role: "defender" },
  "atm-server":       { label: "atm-server",      role: "defender" },
  "aegis-forwarder":  { label: "aegis-forwarder", role: "defender" },
  "aegis":            { label: "aegis-forwarder", role: "defender" },
  "ubuntu":           { label: "ubuntu (VM)",     role: "defender" },
  "pfsense":          { label: "pfSense",         role: "infra"    },
  "internal-network": { label: "internal-network",role: "infra"    },
  "lan-segment":      { label: "LAN segment",     role: "infra"    },
};

export interface HostInfo {
  /** Display name — e.g. "bank-web" or "192.168.1.5" */
  label: string;
  /** Original raw value */
  raw: string;
  role: "defender" | "attacker" | "infra" | "unknown";
}

/**
 * Resolve an IP (or generic label) to a HostInfo object.
 * Priority: live DB hosts → static fallback → generic label map → raw value.
 */
export function resolveHostLabel(value: string, hosts: NetworkHost[]): HostInfo {
  if (!value) return { label: "—", raw: value, role: "unknown" };

  // 1. Live DB lookup by IP
  const dbHost = hosts.find(h => h.ip === value);
  if (dbHost) {
    const role = dbHost.role === "kali" ? "attacker"
               : dbHost.role === "pfsense" || dbHost.role === "router" ? "infra"
               : "defender";
    return { label: dbHost.hostname || value, raw: value, role };
  }

  // 2. Static fallback
  const staticEntry = STATIC_LABELS[value];
  if (staticEntry) return { label: staticEntry.label, raw: value, role: staticEntry.role };

  // 3. Generic label passthrough (not a real IP — e.g. "bank-web")
  const generic = GENERIC_LABELS[value];
  if (generic) return { label: generic.label, raw: value, role: generic.role };

  // 4. Raw value (unknown attacker IP, etc.)
  return { label: value, raw: value, role: "unknown" };
}

// ─── Color classes per role ───────────────────────────────────────────────────
const ROLE_CLASSES: Record<string, string> = {
  defender: "text-emerald-400",
  attacker: "text-red-400",
  infra:    "text-purple-400",
  unknown:  "text-cyan-400",
};

// ─── React component ──────────────────────────────────────────────────────────

interface HostLabelProps {
  /** IP address or generic host label */
  ip: string;
  /** Show raw IP as suffix in parentheses — default false */
  showIp?: boolean;
  className?: string;
}

/**
 * Renders a host label with color coding by role.
 * Attacker IPs → red, defender VMs → green, infra → purple, unknown → cyan.
 * Hover over to see the raw IP.
 */
export function HostLabel({ ip, showIp = false, className = "" }: HostLabelProps) {
  const { devices } = useDeviceContext();
  const info = resolveHostLabel(ip, devices);

  const colorClass = ROLE_CLASSES[info.role];
  const isResolved = info.label !== info.raw;

  return (
    <span
      className={`font-mono text-xs ${colorClass} ${className}`}
      title={isResolved ? ip : undefined}
    >
      {info.label}
      {showIp && isResolved && (
        <span className="text-muted-foreground ml-1">({ip})</span>
      )}
    </span>
  );
}
