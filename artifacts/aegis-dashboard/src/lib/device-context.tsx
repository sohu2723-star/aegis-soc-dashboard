import { createContext, useContext, useEffect, useMemo, useState, ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";

export interface NetworkHost {
  id: number;
  ip: string;
  hostname: string;
  role: string;
  os: string | null;
  mac: string | null;
  openPorts: string | null;
  status: string;
  isMonitored: boolean;
  lastSeen: string;
}

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const STORAGE_KEY = "aegis-selected-device-ip";

function useAllHosts() {
  return useQuery<NetworkHost[]>({
    queryKey: ["network-hosts"],
    queryFn: async () => {
      const r = await fetch(`${BASE}/api/network/hosts`);
      if (!r.ok) throw new Error("Failed to fetch hosts");
      return r.json();
    },
    refetchInterval: 15000,
  });
}

interface DeviceContextValue {
  /** null = "All Devices" selected */
  selectedIp: string | null;
  setSelectedIp: (ip: string | null) => void;
  /** Selectable devices — Kali (attacker) is intentionally excluded. */
  devices: NetworkHost[];
  selectedDevice: NetworkHost | null;
  isLoading: boolean;
}

const DeviceContext = createContext<DeviceContextValue | null>(null);

export function DeviceProvider({ children }: { children: ReactNode }) {
  const { data: hosts = [], isLoading } = useAllHosts();
  const [selectedIp, setSelectedIpState] = useState<string | null>(() => {
    try { return localStorage.getItem(STORAGE_KEY); } catch { return null; }
  });

  // Kali is the attacker VM — never selectable as a "device to monitor".
  const devices = useMemo(() => hosts.filter(h => h.role !== "kali"), [hosts]);

  // If a previously-selected device disappears (removed / role changed / list emptied
  // while loading finished), fall back to "All" rather than staying scoped to a
  // device that no longer exists.
  useEffect(() => {
    if (!selectedIp || isLoading) return;
    if (!devices.some(d => d.ip === selectedIp)) {
      setSelectedIpState(null);
      try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
    }
  }, [devices, selectedIp, isLoading]);

  function setSelectedIp(ip: string | null) {
    setSelectedIpState(ip);
    try {
      if (ip) localStorage.setItem(STORAGE_KEY, ip);
      else localStorage.removeItem(STORAGE_KEY);
    } catch { /* localStorage unavailable — selection just won't persist */ }
  }

  const selectedDevice = devices.find(d => d.ip === selectedIp) ?? null;

  return (
    <DeviceContext.Provider value={{ selectedIp, setSelectedIp, devices, selectedDevice, isLoading }}>
      {children}
    </DeviceContext.Provider>
  );
}

export function useDeviceContext(): DeviceContextValue {
  const ctx = useContext(DeviceContext);
  if (!ctx) throw new Error("useDeviceContext must be used within a DeviceProvider");
  return ctx;
}
