export const LIVE_FEED_STORAGE_KEY = "aegis-live-feed-v1";
export const LIVE_FEED_TTL_MS = 24 * 60 * 60 * 1000;

export interface StoredLiveFeedEntry {
  id: string;
  eventId?: number;
  createdAt: string;
  evType: string;
  severity: string;
  srcIp: string;
  target: string;
  desc: string;
  defense: boolean;
  telegram: boolean;
  toolUsed?: string;
  signatureText?: string;
  ruleName?: string;
}

function isBrowser() {
  return typeof window !== "undefined";
}

export function liveFeedCutoffMs() {
  return Date.now() - LIVE_FEED_TTL_MS;
}

export function readLiveFeed(): StoredLiveFeedEntry[] {
  if (!isBrowser()) return [];
  const cutoff = liveFeedCutoffMs();
  try {
    const parsed = JSON.parse(localStorage.getItem(LIVE_FEED_STORAGE_KEY) ?? "[]");
    const entries = Array.isArray(parsed)
      ? parsed.filter((entry): entry is StoredLiveFeedEntry =>
          entry && typeof entry === "object" && Date.parse(entry.createdAt) >= cutoff,
        )
      : [];
    // Persist the cleanup so stale entries are removed even if the map page is
    // not opened for a while.
    localStorage.setItem(LIVE_FEED_STORAGE_KEY, JSON.stringify(entries));
    return entries;
  } catch {
    return [];
  }
}

export function appendLiveFeed(entry: StoredLiveFeedEntry) {
  if (!isBrowser()) return;
  const entries = readLiveFeed();
  const withoutDuplicate = entries.filter((current) => current.id !== entry.id);
  localStorage.setItem(
    LIVE_FEED_STORAGE_KEY,
    JSON.stringify([entry, ...withoutDuplicate]),
  );
}

export function markLiveFeedTelegram(eventId: number, sent: boolean) {
  if (!isBrowser()) return;
  const entries = readLiveFeed().map((entry) =>
    entry.eventId === eventId ? { ...entry, telegram: sent } : entry,
  );
  localStorage.setItem(LIVE_FEED_STORAGE_KEY, JSON.stringify(entries));
}