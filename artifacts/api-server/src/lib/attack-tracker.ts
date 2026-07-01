/**
 * In-memory attack frequency tracker.
 * Keys: `${sourceIp}::${actualTriggerType}` — uses the resolved trigger type,
 * not the rule's "any" wildcard, to avoid cross-event aggregation.
 *
 * Buckets are evicted 10 minutes after their window expires to bound memory.
 * Under high-cardinality IPs the map may grow; a production deployment
 * should replace this with a Redis INCR + EXPIRE pipeline.
 */

interface BucketEntry {
  count:       number;
  windowStart: number; // Unix ms
}

const buckets = new Map<string, BucketEntry>();

// Evict stale entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of buckets) {
    if (now - entry.windowStart > 10 * 60 * 1000) {
      buckets.delete(key);
    }
  }
}, 5 * 60 * 1000).unref(); // unref so this doesn't keep Node alive in tests

/**
 * Record an attack and return the current count within the window.
 * @param sourceIp    - attacker IP (must already be validated)
 * @param triggerType - the resolved trigger type (NOT "any")
 * @param windowSecs  - rolling window length
 */
export function recordAttack(
  sourceIp:    string,
  triggerType: string,
  windowSecs:  number,
): number {
  const key     = `${sourceIp}::${triggerType}`;
  const now     = Date.now();
  const windowMs = windowSecs * 1000;
  const existing = buckets.get(key);

  if (!existing || now - existing.windowStart > windowMs) {
    buckets.set(key, { count: 1, windowStart: now });
    return 1;
  }

  existing.count += 1;
  return existing.count;
}

export function getAttackCount(sourceIp: string, triggerType: string): number {
  return buckets.get(`${sourceIp}::${triggerType}`)?.count ?? 0;
}

export function resetCounter(sourceIp: string, triggerType: string): void {
  buckets.delete(`${sourceIp}::${triggerType}`);
}

/** Return all IPs/types currently at or above threshold (for dashboard display). */
export function getHotIps(threshold: number): Array<{ ip: string; type: string; count: number }> {
  const result = [];
  for (const [key, entry] of buckets) {
    if (entry.count >= threshold) {
      const sep  = key.indexOf("::");
      const ip   = key.slice(0, sep);
      const type = key.slice(sep + 2);
      result.push({ ip, type, count: entry.count });
    }
  }
  return result.sort((a, b) => b.count - a.count);
}
