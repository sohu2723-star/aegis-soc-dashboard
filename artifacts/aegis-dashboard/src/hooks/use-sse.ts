import { useEffect, useRef, useCallback } from "react";
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

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export function useSSE() {
  const queryClient = useQueryClient();
  const esRef = useRef<EventSource | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const announcedAlertsRef = useRef<Set<string>>(new Set());

  const invalidateAll = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetRecentEventsQueryKey() });
    queryClient.invalidateQueries({ queryKey: getListAlertsQueryKey({}) });
    queryClient.invalidateQueries({ queryKey: getListEventsQueryKey({}) });
  }, [queryClient]);

  const connect = useCallback(() => {
    if (esRef.current) {
      esRef.current.close();
    }

    const es = new EventSource(`${BASE}/api/events/stream`);
    esRef.current = es;

    es.addEventListener("connected", () => {});

    // Debounce rapid security_event bursts (e.g. port scans sending 20+ events/s).
    // React Query refetch fires at most once per 1.5 s per key instead of on every event.
    let eventsDebounceTimer: ReturnType<typeof setTimeout> | null = null;

    es.addEventListener("security_event", (event: MessageEvent) => {
      // Keep the live feed independent from the currently mounted page.
      // The store is pruned to the last 24 hours by appendLiveFeed/readLiveFeed.
      try {
        const data = JSON.parse((event as MessageEvent).data ?? "{}");
        appendLiveFeed({
          id: `event-${data.id}`,
          eventId: data.id,
          createdAt: data.createdAt ?? new Date().toISOString(),
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
      } catch { /* malformed data — skip persistence */ }
      // Debounce: only refetch after 1.5 s of quiet — avoids a cascade of
      // network requests when a port scan floods 20+ events per second.
      if (eventsDebounceTimer) clearTimeout(eventsDebounceTimer);
      eventsDebounceTimer = setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: getGetRecentEventsQueryKey() });
        queryClient.invalidateQueries({ queryKey: getListEventsQueryKey({}) });
        // Also refresh KPI cards so Total Events updates without waiting for stats_update
        queryClient.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() });
        queryClient.invalidateQueries({ queryKey: ["dashboard-summary"] });
        eventsDebounceTimer = null;
      }, 1500);
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
        const alertKey = data.eventId ? `${data.eventId}:${data.severity}` : "";
        if (alertKey && announcedAlertsRef.current.has(alertKey)) return;
        if (alertKey) {
          announcedAlertsRef.current.add(alertKey);
          if (announcedAlertsRef.current.size > 500) {
            announcedAlertsRef.current.delete(announcedAlertsRef.current.values().next().value as string);
          }
        }
        if (data.severity === "critical" || data.severity === "high") {
          window.dispatchEvent(new CustomEvent("aegis:alert", { detail: data }));
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
      es.close();
      esRef.current = null;
      reconnectTimer.current = setTimeout(connect, 3000);
    };
  }, [queryClient]);

  useEffect(() => {
    connect();
    return () => {
      if (esRef.current) {
        esRef.current.close();
        esRef.current = null;
      }
      if (reconnectTimer.current) {
        clearTimeout(reconnectTimer.current);
      }
    };
  }, [connect]);

  return { invalidateAll };
}
