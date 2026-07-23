import { useEffect, useRef, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  getGetDashboardSummaryQueryKey,
  getGetRecentEventsQueryKey,
  getListAlertsQueryKey,
  getListEventsQueryKey,
  getGetSystemStatusQueryKey,
} from "@workspace/api-client-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export function useSSE() {
  const queryClient = useQueryClient();
  const esRef = useRef<EventSource | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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

    es.addEventListener("security_event", () => {
      queryClient.invalidateQueries({ queryKey: getGetRecentEventsQueryKey() });
      queryClient.invalidateQueries({ queryKey: getListEventsQueryKey({}) });
    });

    es.addEventListener("alert", (e: MessageEvent) => {
      queryClient.invalidateQueries({ queryKey: getListAlertsQueryKey({}) });
      // Also invalidate custom alerts key used in alerts.tsx
      queryClient.invalidateQueries({ queryKey: ["alerts"] });
      // Dispatch custom event so sound-alert hook can play a tone
      try {
        const data = JSON.parse(e.data ?? "{}");
        if (data.severity === "critical" || data.severity === "high") {
          window.dispatchEvent(new CustomEvent("aegis:alert", { detail: { severity: data.severity } }));
        }
      } catch { /* malformed data — skip */ }
    });

    es.addEventListener("stats_update", () => {
      queryClient.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() });
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
