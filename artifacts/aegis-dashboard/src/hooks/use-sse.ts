import { useEffect, useRef, useCallback, type MutableRefObject } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  getGetDashboardSummaryQueryKey,
  getGetRecentEventsQueryKey,
  getListAlertsQueryKey,
  getListEventsQueryKey,
  getGetSystemStatusQueryKey,
} from "@workspace/api-client-react";
import {
  appendLiveFeed,
  markLiveFeedTelegram,
} from "@/lib/live-feed";
import { RAILWAY_API_URL } from "@/lib/api-failover";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const EVENT_POLL_INTERVAL_MS = 3000;

export function useSSE() {
  const queryClient = useQueryClient();
  const esRef = useRef<EventSource | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollInFlightRef = useRef(false);
  const lastEventAtRef = useRef(new Date(Date.now() - EVENT_POLL_INTERVAL_MS).toISOString());
  const backupPollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const backupPollInFlightRef = useRef(false);
  const lastBackupEventAtRef = useRef(new Date(Date.now() - EVENT_POLL_INTERVAL_MS).toISOString());
  const seenEventKeysRef = useRef<Set<string>>(new Set());
  const announcedAlertsRef = useRef<Set<string>>(new Set());
  const eventsDebounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const invalidateAll = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetRecentEventsQueryKey() });
    queryClient.invalidateQueries({ queryKey: getListAlertsQueryKey({}) });
    queryClient.invalidateQueries({ queryKey: getListEventsQueryKey({}) });
  }, [queryClient]);

  // Debounce rapid security_event bursts (e.g. port scans sending 20+ events/s).
  // React Query refetch fires at most once per 250 ms per key instead of on every event.
  const scheduleEventRefresh = useCallback(() => {
    if (eventsDebounceTimerRef.current) clearTimeout(eventsDebounceTimerRef.current);
    eventsDebounceTimerRef.current = setTimeout(() => {
      queryClient.invalidateQueries({ queryKey: getGetRecentEventsQueryKey() });
      queryClient.invalidateQueries({ queryKey: getListEventsQueryKey({}) });
      // Also refresh KPI cards so Total Events updates without waiting for stats_update
      queryClient.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() });
      queryClient.invalidateQueries({ queryKey: ["dashboard-summary"] });
      eventsDebounceTimerRef.current = null;
    }, 250);
  }, [queryClient]);

  const processSecurityEvent = useCallback((
    data: Record<string, any>,
    cursorRef: MutableRefObject<string>,
  ) => {
    const createdAt = typeof data.createdAt === "string"
      ? data.createdAt
      : new Date().toISOString();
    if (createdAt > cursorRef.current) cursorRef.current = createdAt;

    const eventKey = data.id != null
      ? `id:${String(data.id)}`
      : `event:${data.type ?? "unknown"}:${data.sourceIp ?? ""}:${data.targetHost ?? ""}:${data.createdAt ?? ""}`;
    if (seenEventKeysRef.current.has(eventKey)) return;
    seenEventKeysRef.current.add(eventKey);
    if (seenEventKeysRef.current.size > 1000) {
      seenEventKeysRef.current.delete(seenEventKeysRef.current.values().next().value as string);
    }

    const eventSeverity = String(data.severity ?? "").toLowerCase();

    // All realtime producers use the same browser events, so the global
    // notice bar, sound alert, and Threat Map stay in sync for both SSE and
    // REST-poll fallback delivery.
    window.dispatchEvent(new CustomEvent("aegis:security-event", { detail: data }));
    // Some ingest paths broadcast security_event before creating the alert
    // row. Trigger the sound here as well, then deduplicate the later alert.
    if ((eventSeverity === "critical" || eventSeverity === "high") && data.id) {
      const alertKey = `${data.id}:${eventSeverity}`;
      if (!announcedAlertsRef.current.has(alertKey)) {
        announcedAlertsRef.current.add(alertKey);
        window.dispatchEvent(new CustomEvent("aegis:alert", {
          detail: { ...data, eventId: data.id, severity: eventSeverity },
        }));
      }
    }
    appendLiveFeed({
      id: `event-${data.id}`,
      eventId: data.id,
      createdAt,
      evType: data.type ?? "unknown",
      severity: data.severity ?? "medium",
      srcIp: data.sourceIp ?? "?",
      target: data.targetHost ?? "?",
      desc: data.description ?? "",
      defense: false,
      telegram: false,
      toolUsed: data.toolUsed ?? undefined,
      signatureText: data.signatureText ?? undefined,
    });

    // Paint the persisted event immediately instead of waiting for the
    // next polling cycle. The background invalidation below still
    // reconciles this optimistic cache entry with PostgreSQL.
    queryClient.setQueryData<any[]>(getGetRecentEventsQueryKey(), (current) => {
      const withoutDuplicate = (current ?? []).filter((item: any) => item.id !== data.id);
      return [data, ...withoutDuplicate].slice(0, 20);
    });
    scheduleEventRefresh();
  }, [queryClient, scheduleEventRefresh]);

  const stopEventPolling = useCallback(() => {
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }, []);

  const pollEvents = useCallback(async () => {
    if (pollInFlightRef.current) return;
    pollInFlightRef.current = true;
    try {
      const since = encodeURIComponent(lastEventAtRef.current);
      const response = await fetch(`${BASE}/api/events?limit=100&since=${since}`, {
        cache: "no-store",
      });
      if (!response.ok) return;
      const rows = await response.json();
      if (!Array.isArray(rows)) return;
      // The API returns newest first; process oldest first so the notice bar,
      // sound, and map reflect the actual event order during a short outage.
      rows
        .filter((row): row is Record<string, any> => row && typeof row === "object")
        .sort((a, b) => String(a.createdAt ?? "").localeCompare(String(b.createdAt ?? "")))
        .forEach((row) => processSecurityEvent(row, lastEventAtRef));
    } catch {
      // Keep retrying while the API is unavailable. SSE remains the primary
      // channel and will stop this fallback as soon as it reconnects.
    } finally {
      pollInFlightRef.current = false;
    }
  }, [processSecurityEvent]);

  const startEventPolling = useCallback(() => {
    if (pollTimerRef.current) return;
    void pollEvents();
    pollTimerRef.current = setInterval(() => void pollEvents(), EVENT_POLL_INTERVAL_MS);
  }, [pollEvents]);

  // The forwarder can fail over from Render to Railway while both API
  // instances remain healthy. In that window Railway owns the in-memory SSE
  // broadcast, so also read its persisted events. This is intentionally
  // secondary-only; Render remains the dashboard's primary API.
  const pollBackupEvents = useCallback(async () => {
    if (backupPollInFlightRef.current) return;
    backupPollInFlightRef.current = true;
    try {
      const since = encodeURIComponent(lastBackupEventAtRef.current);
      const response = await fetch(
        `${RAILWAY_API_URL}/api/events?limit=100&since=${since}`,
        { cache: "no-store" },
      );
      if (!response.ok) return;
      const rows = await response.json();
      if (!Array.isArray(rows)) return;
      rows
        .filter((row): row is Record<string, any> => row && typeof row === "object")
        .sort((a, b) => String(a.createdAt ?? "").localeCompare(String(b.createdAt ?? "")))
        .forEach((row) => processSecurityEvent(row, lastBackupEventAtRef));
    } catch {
      // Railway is an optional secondary source. Render SSE and polling keep
      // working if Railway is unavailable.
    } finally {
      backupPollInFlightRef.current = false;
    }
  }, [processSecurityEvent]);

  const startBackupEventPolling = useCallback(() => {
    if (backupPollTimerRef.current) return;
    void pollBackupEvents();
    backupPollTimerRef.current = setInterval(
      () => void pollBackupEvents(),
      EVENT_POLL_INTERVAL_MS,
    );
  }, [pollBackupEvents]);

  const stopBackupEventPolling = useCallback(() => {
    if (backupPollTimerRef.current) {
      clearInterval(backupPollTimerRef.current);
      backupPollTimerRef.current = null;
    }
  }, []);

  const connect = useCallback(() => {
    if (esRef.current) {
      esRef.current.close();
    }

    const es = new EventSource(`${BASE}/api/events/stream`);
    esRef.current = es;

    es.addEventListener("connected", () => {
      if (esRef.current !== es) return;
      stopEventPolling();
    });

    es.addEventListener("security_event", (event: MessageEvent) => {
      // Keep the live feed independent from the currently mounted page.
      // The store is pruned to the last 24 hours by appendLiveFeed/readLiveFeed.
      try {
        processSecurityEvent(JSON.parse(event.data ?? "{}"), lastEventAtRef);
      } catch { /* malformed data — skip persistence */ }
    });

    es.addEventListener("defense_action", (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data ?? "{}");
        appendLiveFeed({
          id: `defense-${data.commandId ?? data.timestamp ?? Date.now()}`,
          createdAt: data.timestamp ?? new Date().toISOString(),
          evType: data.action ?? "block",
          severity: "info",
          srcIp: data.targetIp ?? "?",
          target: data.targetHost ?? "?",
          desc: data.reason ?? "Defense executed",
          defense: true,
          telegram: false,
          ruleName: data.ruleName ?? undefined,
        });
      } catch { /* malformed data — skip persistence */ }
    });

    es.addEventListener("defense_result", () => {
      queryClient.invalidateQueries({ queryKey: ["defense-blocks"] });
      queryClient.invalidateQueries({ queryKey: ["defense-actions"] });
      queryClient.invalidateQueries({ queryKey: ["ui-cmds"] });
    });

    es.addEventListener("alert", (e: MessageEvent) => {
      queryClient.invalidateQueries({ queryKey: getListAlertsQueryKey({}) });
      // Also invalidate custom alerts key used in alerts.tsx
      queryClient.invalidateQueries({ queryKey: ["alerts"] });
      // Dispatch custom event so sound-alert hook can play a tone
      try {
        const data = JSON.parse(e.data ?? "{}");
        if (data.eventId) markLiveFeedTelegram(data.eventId, data.telegramSent !== false);
        const alertSeverity = String(data.severity ?? "").toLowerCase();
        const alertKey = data.eventId ? `${data.eventId}:${alertSeverity}` : "";
        if (alertKey && announcedAlertsRef.current.has(alertKey)) return;
        if (alertKey) {
          announcedAlertsRef.current.add(alertKey);
          if (announcedAlertsRef.current.size > 500) {
            announcedAlertsRef.current.delete(announcedAlertsRef.current.values().next().value as string);
          }
        }
        // Some backend paths may emit the alert row without a preceding
        // security_event packet. Keep the global Viewing bar in sync too.
        window.dispatchEvent(new CustomEvent("aegis:security-event", {
          detail: { ...data, type: data.type ?? "attack", severity: alertSeverity },
        }));
        if (alertSeverity === "critical" || alertSeverity === "high") {
          window.dispatchEvent(new CustomEvent("aegis:alert", {
            detail: { ...data, severity: alertSeverity },
          }));
        }
      } catch { /* malformed data — skip */ }
    });

    es.addEventListener("stats_update", () => {
      // Invalidate both the generated client key AND the custom key used in dashboard.tsx
      queryClient.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() });
      queryClient.invalidateQueries({ queryKey: ["dashboard-summary"] });
    });

    // Host online/offline status changed — refresh network monitor
    es.addEventListener("host_status_change", () => {
      queryClient.invalidateQueries({ queryKey: ["network-hosts"] });
    });

    // Sensor/service status changed — refresh defense center + system status page
    es.addEventListener("service_status_change", () => {
      queryClient.invalidateQueries({ queryKey: ["defense-status"] });
      queryClient.invalidateQueries({ queryKey: getGetSystemStatusQueryKey() });
    });

    es.onerror = () => {
      if (esRef.current !== es) return;
      es.close();
      esRef.current = null;
      // REST polling keeps notifications and the map alive while the SSE
      // connection is down. A later successful SSE connection stops polling.
      startEventPolling();
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      reconnectTimer.current = setTimeout(connect, 3000);
    };
  }, [processSecurityEvent, queryClient, startEventPolling, stopEventPolling]);

  useEffect(() => {
    connect();
    startBackupEventPolling();
    return () => {
      if (esRef.current) {
        esRef.current.close();
        esRef.current = null;
      }
      if (reconnectTimer.current) {
        clearTimeout(reconnectTimer.current);
        reconnectTimer.current = null;
      }
      stopEventPolling();
      stopBackupEventPolling();
      if (eventsDebounceTimerRef.current) {
        clearTimeout(eventsDebounceTimerRef.current);
        eventsDebounceTimerRef.current = null;
      }
    };
  }, [connect, startBackupEventPolling, stopEventPolling, stopBackupEventPolling]);

  return { invalidateAll };
}
