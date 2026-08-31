const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export const RAILWAY_API_URL = (
  import.meta.env.VITE_RAILWAY_API_URL ??
  "https://aegis-api-server-production.up.railway.app"
).replace(/\/$/, "");

const RETRYABLE_STATUSES = new Set([500, 502, 503, 504]);

function buildPrimaryUrl(path: string): string {
  return path.startsWith("http") ? path : `${BASE}${path}`;
}

function buildBackupUrl(path: string): string {
  if (path.startsWith("http")) {
    const parsed = new URL(path);
    return `${RAILWAY_API_URL}${parsed.pathname}${parsed.search}`;
  }
  return `${RAILWAY_API_URL}${path}`;
}

/**
 * Read-only API requests use Render first and Railway only when the primary
 * endpoint is unreachable or returns a gateway/service failure. Mutating
 * requests never fail over automatically because retrying a write can create
 * duplicate registrations or commands.
 */
export async function fetchWithApiFailover(
  path: string,
  init?: RequestInit,
): Promise<Response> {
  const method = String(init?.method ?? "GET").toUpperCase();
  const canFailover = method === "GET" || method === "HEAD" || method === "OPTIONS";
  const primaryUrl = buildPrimaryUrl(path);

  try {
    const primaryResponse = await fetch(primaryUrl, init);
    if (!canFailover || !RETRYABLE_STATUSES.has(primaryResponse.status)) {
      return primaryResponse;
    }
  } catch (primaryError) {
    if (!canFailover) throw primaryError;
    try {
      return await fetch(buildBackupUrl(path), init);
    } catch {
      throw primaryError;
    }
  }

  return fetch(buildBackupUrl(path), init);
}