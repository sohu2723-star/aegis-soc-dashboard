import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Activity, ShieldAlert, Siren, Server, ListTodo, Ban } from "lucide-react";
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip,
  BarChart, Bar, CartesianGrid,
} from "recharts";
import { format } from "date-fns";
import { Skeleton } from "@/components/ui/skeleton";
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useDeviceContext } from "@/lib/device-context";
import { useGetRecentEvents, getGetRecentEventsQueryKey } from "@workspace/api-client-react";
import { HostLabel } from "@/lib/host-utils";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

function useDashboardSummary(targetHost: string | null) {
  const url = targetHost
    ? `${BASE}/api/dashboard/summary?targetHost=${encodeURIComponent(targetHost)}`
    : `${BASE}/api/dashboard/summary`;

  return useQuery({
    queryKey: ["dashboard-summary", targetHost],
    queryFn: async () => {
      const r = await fetch(url);
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

  const {
    data: summary,
    isLoading: isLoadingSummary,
    isError: isSummaryError,
    isFetching,
  } = useDashboardSummary(selectedIp);

  const { data: recentEvents, isLoading: isLoadingEvents } = useGetRecentEvents({
    query: { queryKey: getGetRecentEventsQueryKey(), refetchInterval: 5000 },
  });

  const filteredEvents = selectedIp
    ? (recentEvents ?? []).filter(
        (e: any) => e.targetHost === selectedIp || e.sourceIp === selectedIp,
      )
    : recentEvents ?? [];

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
              : "API warming up (Render cold start ~50 s) — auto-retrying…"}
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
            <CardTitle className="text-xs uppercase tracking-wider text-muted-foreground">Systems Online</CardTitle>
            <Server className="h-4 w-4 text-green-500" />
          </CardHeader>
          <CardContent>
            {isLoadingSummary && !summary
              ? <NumSkeleton />
              : <div className="text-3xl font-bold text-green-500">
                  {summary?.systemsOnline ?? 0}/{summary?.systemsTotal ?? 0}
                </div>
            }
          </CardContent>
        </Card>
      </div>

      {/* Secondary KPI row */}
      <div className="grid gap-4 md:grid-cols-2">
        <Card className="bg-card border-border">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-xs uppercase tracking-wider text-muted-foreground">Open Incidents</CardTitle>
            <ListTodo className="h-4 w-4 text-yellow-500" />
          </CardHeader>
          <CardContent className="flex items-end justify-between">
            {isLoadingSummary && !summary
              ? <NumSkeleton />
              : <div className="text-3xl font-bold text-yellow-500">{summary?.openIncidents ?? 0}</div>
            }
            <span className="text-[10px] text-muted-foreground font-mono pb-1">status = open</span>
          </CardContent>
        </Card>

        <Card className="bg-card border-border">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-xs uppercase tracking-wider text-muted-foreground">
              {selectedDevice ? `Blocked Events — ${selectedDevice.ip}` : "Blocked Events"}
            </CardTitle>
            <Ban className="h-4 w-4 text-red-500" />
          </CardHeader>
          <CardContent className="flex items-end justify-between">
            {isLoadingSummary && !summary
              ? <NumSkeleton />
              : <div className="text-3xl font-bold text-red-500">{summary?.blockedIPs ?? 0}</div>
            }
            <span className="text-[10px] text-muted-foreground font-mono pb-1">status = blocked</span>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-7">
        <Card className="col-span-4 bg-card border-border">
          <CardHeader>
            <CardTitle className="text-sm uppercase tracking-wider">
              {selectedDevice ? `Attack Volume — ${selectedDevice.ip}` : "Attack Volume (12h)"}
            </CardTitle>
          </CardHeader>
          <CardContent className="h-[300px]">
            {isLoadingSummary && !summary ? (
              <Skeleton className="h-full w-full bg-muted/20" />
            ) : summary?.eventsTrend && summary.eventsTrend.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={summary.eventsTrend} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <defs>
                    <linearGradient id="colorCount" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%"  stopColor="hsl(var(--primary))" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <XAxis dataKey="hour" stroke="hsl(var(--muted-foreground))" fontSize={12} tickLine={false} axisLine={false} />
                  <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} tickLine={false} axisLine={false} />
                  <Tooltip
                    contentStyle={{ backgroundColor: "hsl(var(--card))", borderColor: "hsl(var(--border))", borderRadius: "4px", fontFamily: "monospace" }}
                    itemStyle={{ color: "hsl(var(--primary))" }}
                  />
                  <Area type="monotone" dataKey="count" stroke="hsl(var(--primary))" fillOpacity={1} fill="url(#colorCount)" />
                </AreaChart>
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
