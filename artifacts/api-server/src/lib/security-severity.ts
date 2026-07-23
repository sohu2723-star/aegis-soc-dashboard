/**
 * AEGIS severity policy.
 *
 * Severity is a security decision, not just a copy of a sensor's numeric
 * value.  In particular, an authentication success from an attacker source
 * is an unauthorized-access breach even when it is the attacker's first try.
 */
export type SecuritySeverity = "critical" | "high" | "medium" | "low";

const UNKNOWN_ATTACK_VALUES = new Set([
  "",
  "unknown",
  "unknown attack",
  "unclassified",
  "unspecified",
  "other",
  "n/a",
  "na",
]);

export function isUnknownAttack(value: unknown): boolean {
  return UNKNOWN_ATTACK_VALUES.has(String(value ?? "").trim().toLowerCase());
}

function mappedSeverity(value: unknown): SecuritySeverity {
  const v = String(value ?? "").trim().toLowerCase();
  if (v === "critical" || v === "1") return "critical";
  if (v === "high" || v === "2") return "high";
  if (v === "medium" || v === "3" || v === "warning") return "medium";
  if (v === "low" || v === "4") return "low";
  // Missing sensor severity is not permission to downgrade an event.
  return "medium";
}

export interface SeverityContext {
  type?: unknown;
  subtype?: unknown;
  description?: unknown;
  status?: unknown;
  /** Source is known to be outside the defender infrastructure. */
  untrustedSource?: boolean;
  authentication?: "success" | "failure";
  /** Trusted/defender sources may emit informational auth telemetry. */
  trustedSource?: boolean;
}

/**
 * Apply the shared policy before writing an event.
 *
 * - Successful authentication from an untrusted source = CRITICAL.
 * - Explicit unauthorized-access language = CRITICAL.
 * - Unknown/unclassified attack type = CRITICAL.
 * - Otherwise preserve the sensor's known severity.
 */
export function resolveSeverity(
  requested: unknown,
  context: SeverityContext = {},
): SecuritySeverity {
  const text = [
    context.type,
    context.subtype,
    context.description,
    context.status,
  ]
    .map(value => String(value ?? "").toLowerCase())
    .join(" ");

  if (
    context.authentication === "success" &&
    context.trustedSource !== true
  ) {
    return "critical";
  }

  if (
    context.untrustedSource === true &&
    /\b(login|logged in|authenticated|authentication|access)\b/.test(text) &&
    /\b(success|successful|allowed|authorized|authenticated|logged in)\b/.test(text)
  ) {
    return "critical";
  }

  if (
    /\bunauthori[sz]ed\b|\baccess denied\b|\bbreach\b|\bintrusion\b/.test(text)
  ) {
    return "critical";
  }

  if (isUnknownAttack(context.subtype) || isUnknownAttack(context.type)) {
    return "critical";
  }

  return mappedSeverity(requested);
}