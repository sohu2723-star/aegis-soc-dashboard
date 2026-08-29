import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Activity, ShieldAlert, Siren, Server, Wifi } from "lucide-react";
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, Legend,
  BarChart, Bar, CartesianGrid,
} from "recharts";
import { format } from "date-fns";
import { Skeleton } from "@/components/ui/skeleton";
import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useDeviceContext } from "@/lib/device-context";
import { useGetRecentEvents, getGetRecentEventsQueryKey, type DashboardSummary } from "@workspace/api-client-react";
import { HostLabel } from "@/lib/host-utils";
import { motion, AnimatePresence } from "framer-motion";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

type AttackTrendRow = { hour: string; type: string; count: number };
type DashboardSummaryWithAttackTrend = DashboardSummary & {
  deviceSystemsOnline: number;
  deviceSystemsTotal: number;
  eventsTrendByType?: AttackTrendRow[];
};

const ATTACK_LINE_COLORS = [
  "#4fa3a5", "#c56b70", "#c5a45a", "#6faf82",
  "#8f82a6", "#7c83a8", "#b08a56", "#5f9da1",
];

function attackTypeLabel(type: string): string {
  return type.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
}

function buildAttackTrend(rows: AttackTrendRow[]): { data: Record<string, string | number>[]; types: string[] } {
  const totals = new Map<string, number>();
  for (const row of rows) totals.set(row.type, (totals.get(row.type) ?? 0) + row.count);
  const types = [...totals.entries()]
    .sort(([, a], [, b]) => b - a)
    .slice(0, ATTACK_LINE_COLORS.length)
    .map(([type]) => type);
  if (types.length === 0) return { data: [], types: [] };
  const byHour = new Map<string, Record<string, string | number>>();
  for (const row of rows) {
    if (!types.includes(row.type)) continue;
    const point = byHour.get(row.hour) ?? { hour: row.hour };
    point[row.type] = row.count;
    byHour.set(row.hour, point);
  }

  // Keep a complete 12-hour x-axis and end it at the current Myanmar hour.
  // Intl handles the browser/server timezone difference without changing event data.
  const myanmarHour = Number(new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Yangon",
    hour: "2-digit",
    hourCycle: "h23",
  }).format(new Date()));
  const endHour = Number.isFinite(myanmarHour) ? myanmarHour : 0;
  const hours = Array.from({ length: 12 }, (_, index) => {
    const hour = (endHour - 11 + index + 24) % 24;
    return `${String(hour).padStart(2, "0")}:00`;
  });

  return {
    data: hours.map(hour => {
      const point = byHour.get(hour) ?? { hour };
      for (const type of types) if (!(type in point)) point[type] = 0;
      return point;
    }),
    types,
  };
}

// ── Internet Speed Live Card ────────────────────────────────────────────────
function InternetSpeedCard() {
  const [speed, setSpeed] = useState<number | null>(null);
  const [latency, setLatency] = useState<number | null>(null);
  const [history, setHistory] = useState<number[]>([]);
  const [peak, setPeak] = useState<number>(0);
  const [measuring, setMeasuring] = useState(false);
  const prevSpeed = useRef<number | null>(null);

  const measure = useCallback(async () => {
    setMeasuring(true);
    try {
      // Download speed
      const t0 = performance.now();
      const r = await fetch(`${BASE}/api/speedtest`, { cache: "no-store" });
      if (!r.ok) throw new Error(`Speed test HTTP ${r.status}`);
      const buf = await r.arrayBuffer();
      const elapsed = (performance.now() - t0) / 1000;
      const mbps = parseFloat(((buf.byteLength * 8) / elapsed / 1_000_000).toFixed(2));
      prevSpeed.current = mbps;
      setSpeed(mbps);
      setPeak(p => Math.max(p, mbps));
      setHistory(h => [...h.slice(-19), mbps]);

      // Ping latency
      const t1 = performance.now();
      await fetch(`${BASE}/api/ping`, { cache: "no-store" });
      setLatency(Math.round(performance.now() - t1));
    } catch {
      // keep old values — API temporarily unreachable
    } finally {
      setMeasuring(false);
    }
  }, []);

  useEffect(() => {
    measure();
    const id = setInterval(measure, 5_000);
    return () => clearInterval(id);
  }, [measure]);

  const max = Math.max(...history, 1);
  const barCount = 20;
  const bars = history.length < barCount
    ? [...Array(barCount - history.length).fill(0), ...history]
    : history;

  const getColor = (v: number | null) =>
    v === null ? "text-muted-foreground" : v > 10 ? "text-green-400" : v > 2 ? "text-yellow-400" : "text-red-400";
  const getBarColor = (v: number) =>
    v === 0 ? "bg-muted/20" : v / max > 0.6 ? "bg-cyan-400/70" : v / max > 0.3 ? "bg-cyan-500/50" : "bg-cyan-600/40";
  const statusLabel = speed === null ? "MEASURING" : speed > 10 ? "GOOD" : speed > 2 ? "FAIR" : "POOR";
  const statusColor = speed === null ? "text-muted-foreground" : speed > 10 ? "text-green-400" : speed > 2 ? "text-yellow-400" : "text-red-400";

  return (
    <Card className="bg-card border-border">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-xs uppercase tracking-wider text-muted-foreground flex items-center gap-2">
          <Wifi className="h-3.5 w-3.5 text-cyan-400" />
          Internet Speed — Live
          {measuring && (
            <span className="relative flex h-1.5 w-1.5 ml-1">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-cyan-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-cyan-400" />
            </span>
          )}
        </CardTitle>
        <span className={`text-[10px] font-mono font-bold tracking-widest ${statusColor}`}>{statusLabel}</span>
      </CardHeader>
      <CardContent>
        {/* Metrics row */}
        <div className="flex items-end gap-6 mb-3">
          {/* Download speed */}
          <div>
            <AnimatePresence mode="wait">
              <motion.div
                key={String(speed)}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.25 }}
                className={`text-3xl font-bold font-mono tabular-nums ${getColor(speed)}`}
              >
                {speed !== null ? speed.toFixed(1) : "—"}
              </motion.div>
            </AnimatePresence>
            <div className="text-[10px] text-muted-foreground font-mono">Mbps down</div>
          </div>

          {/* Latency */}
          <div>
            <AnimatePresence mode="wait">
              <motion.div
                key={String(latency)}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.25 }}
                className="text-xl font-bold font-mono tabular-nums text-cyan-400"
              >
                {latency !== null ? latency : "—"}
              </motion.div>
            </AnimatePresence>
            <div className="text-[10px] text-muted-foreground font-mono">ms ping</div>
          </div>

          {/* Peak */}
          <div className="ml-auto text-right">
            <div className="text-[10px] font-mono text-muted-foreground">Peak</div>
            <div className="text-sm font-bold font-mono text-green-400">
              {peak > 0 ? peak.toFixed(1) : "—"} <span className="text-[10px] text-muted-foreground">Mbps</span>
            </div>
          </div>
        </div>

        {/* Live waveform bars */}
        <div className="flex items-end gap-[2px] h-8">
          {bars.map((v, i) => (
            <motion.div
              key={i}
              animate={{ height: `${Math.max(3, (v / max) * 32)}px` }}
              transition={{ duration: 0.4, ease: "easeOut" }}
              className={`flex-1 rounded-sm ${getBarColor(v)}`}
            />
          ))}
        </div>
        <div className="flex justify-between mt-1 text-[9px] text-muted-foreground/50 font-mono">
          <span>-{barCount * 5}s</span>
          <span>now</span>
        </div>
      </CardContent>
    </Card>
  );
}

function useDashboardSummary(targetHost: string | null) {
  const url = targetHost
    ? `${BASE}/api/dashboard/summary?targetHost=${encodeURIComponent(targetHost)}`
    : `${BASE}/api/dashboard/summary`;

  return useQuery<DashboardSummaryWithAttackTrend>({
    queryKey: ["dashboard-summary", targetHost],
    // Keep the last successful summary visible while switching from a saved
    // device to "All Devices" or while a background refresh is in flight.
    // A slow refresh must never replace already-rendered data with skeletons.
    placeholderData: (previousData) => previousData,
    queryFn: async ({ signal }) => {
      // React Query supplies an AbortSignal. Passing it through prevents stale
      // retries/navigation from leaving requests open at the Vercel proxy.
      const r = await fetch(url, { signal, cache: "no-store" });
      if (!r.ok) throw new Error("Failed to fetch summary");
      return r.json();
    },
    refetchInterval: 8000,
    retry: 3,
    retryDelay: (attempt) => Math.min(2000 * 2 ** attempt, 10000),
  });
}

// Inline skeleton for a KPI number
function NumSkeleton() {
  return <Skeleton className="h-8 w-20 bg-muted/40" />;
}

export default function Dashboard() {
  const queryClient = useQueryClient();
  const { selectedIp, selectedDevice } = useDeviceContext();

  const summaryTarget = selectedDevice?.hostname ?? selectedIp;
  const {
    data: summary,
    isLoading: isLoadingSummary,
    isError: isSummaryError,
    isFetching,
  } = useDashboardSummary(summaryTarget);

  const { data: recentEvents, isLoading: isLoadingEvents } = useGetRecentEvents({
    query: { queryKey: getGetRecentEventsQueryKey(), refetchInterval: 5000 },
  });

  const filteredEvents = selectedIp
    ? (recentEvents ?? []).filter(
        (e: any) =>
          e.targetHost === selectedIp ||
          e.targetHost === selectedDevice?.hostname ||
          e.sourceIp === selectedIp,
      )
    : recentEvents ?? [];

  const attackTrend = useMemo(
    () => buildAttackTrend(summary?.eventsTrendByType ?? []),
    [summary?.eventsTrendByType],
  );
  const attackTrendData = attackTrend.data.length > 0
    ? attackTrend.data
    : (summary?.eventsTrend ?? []);

  // Show warm-up banner after 8 s of still loading (reduced from 12)
  const [slowLoad, setSlowLoad] = useState(false);
  useEffect(() => {
    if (!isLoadingSummary) { setSlowLoad(false); return; }
    const t = setTimeout(() => setSlowLoad(true), 8000);
    return () => clearTimeout(t);
  }, [isLoadingSummary]);

  // Auto-retry every 6 s while in a degraded state — no manual click required
  const isWarming = isSummaryError || (isLoadingSummary && slowLoad);
  useEffect(() => {
    if (!isWarming) return;
    const t = setInterval(() => {
      queryClient.invalidateQueries({ queryKey: ["dashboard-summary"] });
    }, 6000);
    return () => clearInterval(t);
  }, [isWarming, queryClient]);

  return (
    <div className="space-y-6">
      {/* ── Warm-up banner — shown as a slim strip, NOT a full-page block ── */}
      {isWarming && (
        <div className="flex items-center justify-between gap-3 px-4 py-2 rounded border border-primary/30 bg-primary/5 text-xs font-mono text-primary">
          <span className="flex items-center gap-2">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-primary" />
            </span>
            {isSummaryError
              ? "API unreachable — auto-retrying…"
              : "API slow to respond — auto-retrying…"}
          </span>
          <button
            onClick={() => {
              setSlowLoad(false);
              queryClient.invalidateQueries({ queryKey: ["dashboard-summary"] });
            }}
            className="underline underline-offset-2 hover:text-primary/70 transition-colors"
          >
            retry now
          </button>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-primary uppercase">Command Center</h1>
          {selectedDevice && (
            <p className="text-xs text-cyan-400 font-mono mt-0.5">
              Scoped to: {selectedDevice.hostname} ({selectedDevice.ip})
            </p>
          )}
        </div>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <span className="relative flex h-3 w-3">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75" />
            <span className="relative inline-flex rounded-full h-3 w-3 bg-primary" />
          </span>
          {isFetching && !isLoadingSummary ? (
            <span className="text-primary/60 text-xs font-mono">updating…</span>
          ) : (
            "Live Monitoring"
          )}
        </div>
      </div>

      {/* ── KPI cards — rendered immediately; skeleton inside each card ── */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card className="bg-card border-border">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-xs uppercase tracking-wider text-muted-foreground">
              {selectedDevice ? `Events — ${selectedDevice.ip}` : "Total Events"}
            </CardTitle>
            <Activity className="h-4 w-4 text-primary" />
          </CardHeader>
          <CardContent>
            {isLoadingSummary && !summary
              ? <NumSkeleton />
              : <div className="text-3xl font-bold text-foreground">
                  {summary?.totalEvents.toLocaleString() ?? 0}
                </div>
            }
          </CardContent>
        </Card>

        <Card className="bg-card border-border">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-xs uppercase tracking-wider text-muted-foreground">Critical Threats</CardTitle>
            <ShieldAlert className="h-4 w-4 text-destructive" />
          </CardHeader>
          <CardContent>
            {isLoadingSummary && !summary
              ? <NumSkeleton />
              : <div className="text-3xl font-bold text-destructive">
                  {summary?.criticalEvents.toLocaleString() ?? 0}
                </div>
            }
          </CardContent>
        </Card>

        <Card className="bg-card border-border">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-xs uppercase tracking-wider text-muted-foreground">Active Alerts</CardTitle>
            <Siren className="h-4 w-4 text-orange-500" />
          </CardHeader>
          <CardContent>
            {isLoadingSummary && !summary
              ? <NumSkeleton />
              : <div className="text-3xl font-bold text-orange-500">
                  {summary?.activeAlerts.toLocaleString() ?? 0}
                </div>
            }
          </CardContent>
        </Card>

        <Card className="bg-card border-border">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-xs uppercase tracking-wider text-muted-foreground">
              {selectedDevice ? `Systems Online — ${selectedDevice.ip}` : "Systems Online"}
            </CardTitle>
            <Server className="h-4 w-4 text-green-500" />
          </CardHeader>
          <CardContent>
            {isLoadingSummary && !summary
              ? <NumSkeleton />
              : <div className="text-3xl font-bold text-green-500">
                  {selectedDevice
                    ? <>{summary?.deviceSystemsOnline ?? 0}<span className="text-lg text-muted-foreground">/{summary?.deviceSystemsTotal ?? 0}</span></>
                    : <>{summary?.systemsOnline ?? 0}<span className="text-lg text-muted-foreground">/{summary?.systemsTotal ?? 0}</span></>
                  }
                </div>
            }
            {selectedDevice && (
              <div className="text-[10px] text-muted-foreground font-mono mt-1">sensors / infra</div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Internet Speed Live */}
      <InternetSpeedCard />

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-7">
        <Card className="col-span-4 bg-card border-border">
          <CardHeader>
            <CardTitle className="text-sm uppercase tracking-wider">
              {selectedDevice ? `Attack Value by Type — ${selectedDevice.ip}` : "Attack Value by Type (12h)"}
            </CardTitle>
          </CardHeader>
          <CardContent className="h-[300px]">
            {isLoadingSummary && !summary ? (
              <Skeleton className="h-full w-full bg-muted/20" />
            ) : attackTrendData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={attackTrendData} margin={{ top: 10, right: 18, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                  <XAxis dataKey="hour" stroke="hsl(var(--muted-foreground))" fontSize={12} tickLine={false} axisLine={false} />
                  <YAxis allowDecimals={false} stroke="hsl(var(--muted-foreground))" fontSize={12} tickLine={false} axisLine={false} />
                  <Tooltip
                    contentStyle={{ backgroundColor: "hsl(var(--card))", borderColor: "hsl(var(--border))", borderRadius: "4px", fontFamily: "monospace" }}
                    labelStyle={{ color: "hsl(var(--muted-foreground))" }}
                  />
                  {attackTrend.types.length > 0 ? (
                    attackTrend.types.map((type, index) => (
                      <Line
                        key={type}
                        type="monotone"
                        dataKey={type}
                        name={attackTypeLabel(type)}
                        stroke={ATTACK_LINE_COLORS[index]}
                        strokeWidth={2}
                        dot={{ r: 2 }}
                        activeDot={{ r: 4 }}
                        connectNulls
                      />
                    ))
                  ) : (
                    <Line type="monotone" dataKey="count" name="All Attacks" stroke="hsl(var(--primary))" strokeWidth={2} dot={{ r: 2 }} activeDot={{ r: 4 }} />
                  )}
                  {attackTrend.types.length > 0 && <Legend wrapperStyle={{ fontSize: "11px", paddingTop: "6px" }} />}
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
                No events in the last 12 h
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="col-span-3 bg-card border-border">
          <CardHeader>
            <CardTitle className="text-sm uppercase tracking-wider">
              {selectedDevice ? `Attack Types — ${selectedDevice.ip}` : "Events By Type"}
            </CardTitle>
          </CardHeader>
          <CardContent className="h-[300px]">
            {isLoadingSummary && !summary ? (
              <Skeleton className="h-full w-full bg-muted/20" />
            ) : summary?.attacksByType && summary.attacksByType.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={summary.attacksByType} layout="vertical" margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="hsl(var(--border))" />
                  <XAxis type="number" stroke="hsl(var(--muted-foreground))" fontSize={12} />
                  <YAxis dataKey="type" type="category" stroke="hsl(var(--muted-foreground))" fontSize={12} width={100} />
                  <Tooltip
                    contentStyle={{ backgroundColor: "hsl(var(--card))", borderColor: "hsl(var(--border))", borderRadius: "4px", fontFamily: "monospace" }}
                    cursor={{ fill: "hsl(var(--muted)/0.2)" }}
                  />
                  <Bar dataKey="count" fill="hsl(var(--chart-3))" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
                {selectedDevice ? `No events targeting ${selectedDevice.ip} yet` : "No events"}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="bg-card border-border overflow-hidden">
        <CardHeader>
          <CardTitle className="text-sm uppercase tracking-wider">Recent Telemetry</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="flex flex-col max-h-[400px] overflow-auto">
            {isLoadingEvents ? (
              Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full my-1 rounded-none bg-muted/20" />
              ))
            ) : filteredEvents.length > 0 ? (
              filteredEvents.map((event: any) => (
                <div
                  key={event.id}
                  className="flex items-center justify-between p-3 border-b border-border/50 hover:bg-muted/20 text-xs"
                >
                  <div className="flex items-center gap-2 overflow-hidden">
                    <div
                      className={`w-2 h-2 rounded-full flex-shrink-0 ${
                        event.severity === "critical"
                          ? "bg-destructive"
                          : event.severity === "high"
                          ? "bg-orange-500"
                          : event.severity === "medium"
                          ? "bg-yellow-500"
                          : "bg-green-500"
                      }`}
                    />
                    <span className="font-mono text-xs text-cyan-400 truncate">{event.sourceIp}</span>
                    <span className="text-muted-foreground truncate hidden sm:inline-block">
                      → <HostLabel ip={event.targetHost} />
                    </span>
                    <span className="text-muted-foreground truncate hidden md:inline-block text-[10px]">
                      [{event.subtype}]
                    </span>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <div className="text-primary truncate">{event.type}</div>
                    <div className="text-[10px] text-muted-foreground">
                      {format(new Date(event.createdAt), "HH:mm:ss")}
                    </div>
                  </div>
                </div>
              ))
            ) : (
              <div className="flex flex-col items-center justify-center py-16 text-muted-foreground text-xs gap-2">
                <span className="text-2xl">📡</span>
                <span>
                  {selectedDevice
                    ? `No events targeting ${selectedDevice.ip} yet`
                    : "Waiting for real events from VMs..."}
                </span>
                <span className="text-[10px] opacity-60">
                  Start the forwarder on your Ubuntu VM to see live data
                </span>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
