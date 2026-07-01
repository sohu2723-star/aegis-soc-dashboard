import { useEffect, useRef, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  getGetDashboardSummaryQueryKey,
  getGetRecentEventsQueryKey,
  getListAlertsQueryKey,
  getListEventsQueryKey,
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

    es.addEventListener("connected", () => {
    });

    es.addEventListener("security_event", () => {
      queryClient.invalidateQueries({ queryKey: getGetRecentEventsQueryKey() });
      queryClient.invalidateQueries({ queryKey: getListEventsQueryKey({}) });
    });

    es.addEventListener("alert", () => {
      queryClient.invalidateQueries({ queryKey: getListAlertsQueryKey({}) });
    });

    es.addEventListener("stats_update", () => {
      queryClient.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() });
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

export function useSimulation() {
  const BASE_URL = `${BASE}/api`;

  const triggerAttack = async () => {
    await fetch(`${BASE_URL}/simulate/attack`, { method: "POST" });
  };

  const startAutoSim = async () => {
    await fetch(`${BASE_URL}/simulate/start`, { method: "POST" });
  };

  const stopAutoSim = async () => {
    await fetch(`${BASE_URL}/simulate/stop`, { method: "POST" });
  };

  const getStatus = async () => {
    const res = await fetch(`${BASE_URL}/simulate/status`);
    return res.json() as Promise<{ running: boolean; connectedClients: number }>;
  };

  return { triggerAttack, startAutoSim, stopAutoSim, getStatus };
}
