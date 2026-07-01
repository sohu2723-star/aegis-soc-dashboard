import { useEffect } from "react";

const PING_INTERVAL_MS = 10 * 60 * 1000;

export function useKeepAlive() {
  useEffect(() => {
    const ping = () => {
      fetch("/api/healthz", { method: "GET" }).catch(() => {});
    };

    ping();

    const interval = setInterval(ping, PING_INTERVAL_MS);
    return () => clearInterval(interval);
  }, []);
}
