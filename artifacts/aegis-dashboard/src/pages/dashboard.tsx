import { useGetDashboardSummary, useGetRecentEvents, getGetDashboardSummaryQueryKey, getGetRecentEventsQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Activity, ShieldAlert, Siren, Server } from "lucide-react";
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, BarChart, Bar, CartesianGrid } from "recharts";
import { format } from "date-fns";
import { Skeleton } from "@/components/ui/skeleton";

export default function Dashboard() {
  const { data: summary, isLoading: isLoadingSummary } = useGetDashboardSummary({
    query: { queryKey: getGetDashboardSummaryQueryKey(), refetchInterval: 8000 },
  });
  const { data: recentEvents, isLoading: isLoadingEvents } = useGetRecentEvents({
    query: { queryKey: getGetRecentEventsQueryKey(), refetchInterval: 5000 },
  });

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
        </div>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <span className="relative flex h-3 w-3">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75" />
            <span className="relative inline-flex rounded-full h-3 w-3 bg-primary" />
          </span>
          Live Monitoring
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
        <CardHeader>
          <CardTitle className="text-sm uppercase tracking-wider">Recent Telemetry</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="flex flex-col max-h-[400px] overflow-auto">
            {isLoadingEvents ? (
              Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full my-1 rounded-none bg-muted/20" />
              ))
            ) : recentEvents && recentEvents.length > 0 ? recentEvents.map((event) => (
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
            )) : (
              <div className="flex flex-col items-center justify-center py-16 text-muted-foreground text-xs gap-2">
                <span className="text-2xl">📡</span>
                <span>Waiting for real events from VMs...</span>
                <span className="text-[10px] opacity-60">Start the forwarder on your Ubuntu VM to see live data</span>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
