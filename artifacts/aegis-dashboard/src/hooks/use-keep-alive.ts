import { useEffect } from "react";

// Render free tier sleeps after ~15 min idle.
// Ping every 4 min so the server never goes cold while the tab is open.
const PING_INTERVAL_MS = 4 * 60 * 1000;

export function useKeepAlive() {
  useEffect(() => {
    const ping = () => {
      // Liveness only: do not make every browser tab query Supabase.
      fetch("/api/ping", { method: "GET", cache: "no-store" }).catch(() => {});
    };

    ping();

    const interval = setInterval(ping, PING_INTERVAL_MS);
    return () => clearInterval(interval);
  }, []);
}
