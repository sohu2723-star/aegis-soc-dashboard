import { useGetDashboardSummary, useGetRecentEvents, getGetDashboardSummaryQueryKey, getGetRecentEventsQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Activity, ShieldAlert, Siren, Server, Zap, Play, Square } from "lucide-react";
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, BarChart, Bar, CartesianGrid } from "recharts";
import { format } from "date-fns";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { useSimulation } from "@/hooks/use-sse";
import { useState, useEffect, useCallback } from "react";

export default function Dashboard() {
  const { data: summary, isLoading: isLoadingSummary } = useGetDashboardSummary({
    query: { queryKey: getGetDashboardSummaryQueryKey(), refetchInterval: 8000 },
  });
  const { data: recentEvents, isLoading: isLoadingEvents } = useGetRecentEvents({
    query: { queryKey: getGetRecentEventsQueryKey(), refetchInterval: 5000 },
  });

  const { triggerAttack, startAutoSim, stopAutoSim, getStatus } = useSimulation();
  const [simRunning, setSimRunning] = useState(false);
  const [simLoading, setSimLoading] = useState(false);
  const [attackLoading, setAttackLoading] = useState(false);
  const [lastEvent, setLastEvent] = useState<string | null>(null);

  const syncStatus = useCallback(async () => {
    try {
      const s = await getStatus();
      setSimRunning(s.running);
    } catch {}
  }, [getStatus]);

  useEffect(() => {
    syncStatus();
    const t = setInterval(syncStatus, 5000);
    return () => clearInterval(t);
  }, [syncStatus]);

  const handleTrigger = async () => {
    setAttackLoading(true);
    try {
      await triggerAttack();
      setLastEvent(`Attack simulated at ${new Date().toLocaleTimeString()}`);
    } catch {}
    setAttackLoading(false);
  };

  const handleToggleSim = async () => {
    setSimLoading(true);
    try {
      if (simRunning) {
        await stopAutoSim();
        setSimRunning(false);
      } else {
        await startAutoSim();
        setSimRunning(true);
      }
    } catch {}
    setSimLoading(false);
  };

  if (isLoadingSummary) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-32 w-full bg-card" />
        <Skeleton className="h-96 w-full bg-card" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-primary uppercase">Command Center</h1>
          {lastEvent && (
            <p className="text-xs text-muted-foreground mt-0.5">{lastEvent}</p>
          )}
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <span className="relative flex h-3 w-3">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75" />
              <span className="relative inline-flex rounded-full h-3 w-3 bg-primary" />
            </span>
            Live Monitoring
          </div>

          <div className="h-4 w-px bg-border" />

          <Button
            size="sm"
            variant="outline"
            onClick={handleTrigger}
            disabled={attackLoading}
            className="text-xs border-primary/30 text-primary hover:bg-primary/10"
          >
            <Zap className="h-3 w-3 mr-1.5" />
            {attackLoading ? "Firing..." : "Simulate Attack"}
          </Button>

          <Button
            size="sm"
            variant={simRunning ? "destructive" : "outline"}
            onClick={handleToggleSim}
            disabled={simLoading}
            className={`text-xs ${!simRunning ? "border-orange-500/30 text-orange-500 hover:bg-orange-500/10" : ""}`}
          >
            {simRunning ? (
              <>
                <Square className="h-3 w-3 mr-1.5" />
                {simLoading ? "Stopping..." : "Stop Auto-Sim"}
              </>
            ) : (
              <>
                <Play className="h-3 w-3 mr-1.5" />
                {simLoading ? "Starting..." : "Start Auto-Sim"}
              </>
            )}
          </Button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card className="bg-card border-border">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-xs uppercase tracking-wider text-muted-foreground">Total Events</CardTitle>
            <Activity className="h-4 w-4 text-primary" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-foreground">{summary?.totalEvents.toLocaleString() ?? 0}</div>
          </CardContent>
        </Card>

        <Card className="bg-card border-border">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-xs uppercase tracking-wider text-muted-foreground">Critical Threats</CardTitle>
            <ShieldAlert className="h-4 w-4 text-destructive" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-destructive">{summary?.criticalEvents.toLocaleString() ?? 0}</div>
          </CardContent>
        </Card>

        <Card className="bg-card border-border">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-xs uppercase tracking-wider text-muted-foreground">Active Alerts</CardTitle>
            <Siren className="h-4 w-4 text-orange-500" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-orange-500">{summary?.activeAlerts.toLocaleString() ?? 0}</div>
          </CardContent>
        </Card>

        <Card className="bg-card border-border">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-xs uppercase tracking-wider text-muted-foreground">Systems Online</CardTitle>
            <Server className="h-4 w-4 text-green-500" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-green-500">
              {summary?.systemsOnline}/{summary?.systemsTotal}
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-7">
        <Card className="col-span-4 bg-card border-border">
          <CardHeader>
            <CardTitle className="text-sm uppercase tracking-wider">Attack Volume (24h)</CardTitle>
          </CardHeader>
          <CardContent className="h-[300px]">
            {summary?.eventsTrend && (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={summary.eventsTrend} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <defs>
                    <linearGradient id="colorCount" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.3} />
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
            )}
          </CardContent>
        </Card>

        <Card className="col-span-3 bg-card border-border">
          <CardHeader>
            <CardTitle className="text-sm uppercase tracking-wider">Events By Type</CardTitle>
          </CardHeader>
          <CardContent className="h-[300px]">
            {summary?.attacksByType && (
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
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="bg-card border-border overflow-hidden">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-sm uppercase tracking-wider">Recent Telemetry</CardTitle>
          {simRunning && (
            <div className="flex items-center gap-1.5 text-xs text-orange-500">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-orange-500 opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-orange-500" />
              </span>
              Auto-simulation active
            </div>
          )}
        </CardHeader>
        <CardContent className="p-0">
          <div className="flex flex-col max-h-[400px] overflow-auto">
            {isLoadingEvents ? (
              Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full my-1 rounded-none bg-muted/20" />
              ))
            ) : recentEvents?.map((event) => (
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
                  <span className="font-medium text-foreground truncate">{event.sourceIp}</span>
                  <span className="text-muted-foreground truncate hidden sm:inline-block">→ {event.targetHost}</span>
                  <span className="text-muted-foreground truncate hidden md:inline-block text-[10px]">
                    [{event.subtype}]
                  </span>
                </div>
                <div className="text-right flex-shrink-0">
                  <div className="text-primary truncate">{event.type}</div>
                  <div className="text-[10px] text-muted-foreground">{format(new Date(event.createdAt), "HH:mm:ss")}</div>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
