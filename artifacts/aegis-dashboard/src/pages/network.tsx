import { useState, useEffect, useRef } from "react";
import { HostLabel } from "@/lib/host-utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Wifi, Monitor, Shield, Activity, X, AlertTriangle, Trash2, Search } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid, BarChart, Bar } from "recharts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { format, formatDistanceToNow } from "date-fns";
import { useDeviceContext, type NetworkHost } from "@/lib/device-context";

interface TrafficPoint {
  time: string;
  inbound: number;
  outbound: number;
  blocked: number;
}

interface HostEvents {
  ip: string;
  totalEvents: number;
  byType: { type: string; count: number }[];
  bySeverity: { critical: number; high: number; medium: number; low: number };
  recentEvents: {
    id: number; type: string; subtype: string; severity: string;
    sourceIp: string; targetHost: string; description: string;
    toolUsed: string | null; createdAt: string;
  }[];
}

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

function useNetworkHosts() {
  return useQuery<NetworkHost[]>({
    queryKey: ["network-hosts"],
    queryFn: async () => {
      const r = await fetch(`${BASE}/api/network/hosts`);
      if (!r.ok) throw new Error("Failed to fetch hosts");
      return r.json();
    },
    refetchInterval: 8000,
  });
}

function useNetworkTraffic() {
  return useQuery<TrafficPoint[]>({
    queryKey: ["network-traffic"],
    queryFn: async () => {
      const r = await fetch(`${BASE}/api/network/traffic`);
      if (!r.ok) throw new Error("Failed to fetch traffic");
      return r.json();
    },
    refetchInterval: 15000,
  });
}

function useHostEvents(ip: string | null) {
  return useQuery<HostEvents>({
    queryKey: ["host-events", ip],
    queryFn: async () => {
      const r = await fetch(`${BASE}/api/network/hosts/${encodeURIComponent(ip!)}/events?limit=500`);
      if (!r.ok) throw new Error("Failed to fetch host events");
      return r.json();
    },
    enabled: !!ip,
    refetchInterval: 8000,
  });
}

const roleColors: Record<string, string> = {
  kali:     "text-red-400 border-red-400",
  ubuntu:   "text-cyan-400 border-cyan-400",
  honeypot: "text-yellow-400 border-yellow-400",
  router:   "text-green-400 border-green-400",
  unknown:  "text-gray-400 border-gray-400",
};

const roleLabels: Record<string, string> = {
  kali: "ATTACKER", ubuntu: "DEFENDER", honeypot: "HONEYPOT", router: "ROUTER", unknown: "UNKNOWN",
};

const severityColor: Record<string, string> = {
  critical: "text-red-400", high: "text-orange-400", medium: "text-yellow-400", low: "text-green-400",
};
const severityBg: Record<string, string> = {
  critical: "bg-red-500/20", high: "bg-orange-500/20", medium: "bg-yellow-500/20", low: "bg-green-500/20",
};

/** Live "last seen X seconds ago" ticker */
function LastSeenTicker({ lastSeen, status }: { lastSeen: string; status: string }) {
  const [secsAgo, setSecsAgo] = useState(() =>
    Math.floor((Date.now() - new Date(lastSeen).getTime()) / 1000)
  );

  useEffect(() => {
    // Recalculate immediately when lastSeen changes (e.g. after refetch)
    setSecsAgo(Math.floor((Date.now() - new Date(lastSeen).getTime()) / 1000));
    const id = setInterval(() => {
      setSecsAgo(Math.floor((Date.now() - new Date(lastSeen).getTime()) / 1000));
    }, 1000);
    return () => clearInterval(id);
  }, [lastSeen]);

  // Always show the actual clock time (HH:mm:ss) — never resets on navigate
  const clockTime = format(new Date(lastSeen), "HH:mm:ss");

  if (status === "offline") {
    return (
      <span className="text-gray-500 text-xs font-mono" title={`offline since ${clockTime}`}>
        {clockTime}
      </span>
    );
  }

  return (
    <span
      className={`text-xs font-mono ${secsAgo > 60 ? "text-yellow-400" : "text-green-400/80"}`}
      title={`last heartbeat: ${clockTime}`}
    >
      {clockTime}
      <span className="text-muted-foreground ml-1">({secsAgo < 5 ? "just now" : `${secsAgo}s ago`})</span>
    </span>
  );
}

/** Online/offline status dot with animated pulse */
function StatusDot({ status, size = "sm" }: { status: string; size?: "sm" | "lg" }) {
  const dim = size === "lg" ? "w-2.5 h-2.5" : "w-1.5 h-1.5";
  if (status === "online") {
    return (
      <span className="relative inline-flex">
        <span className={`${dim} rounded-full bg-green-400 animate-ping absolute opacity-60`} />
        <span className={`${dim} rounded-full bg-green-400 relative`} />
      </span>
    );
  }
  return <span className={`${dim} rounded-full bg-gray-500`} />;
}

/** Build hourly event-count timeline from recentEvents array */
function buildTimeline(recentEvents: HostEvents["recentEvents"]): { time: string; events: number; blocked: number }[] {
  const now = new Date();
  const buckets: Record<string, { events: number; blocked: number }> = {};
  for (let i = 11; i >= 0; i--) {
    const t = new Date(now.getTime() - i * 3_600_000);
    t.setMinutes(0, 0, 0);
    buckets[t.toISOString()] = { events: 0, blocked: 0 };
  }
  for (const e of recentEvents) {
    const t = new Date(e.createdAt);
    t.setMinutes(0, 0, 0);
    const key = t.toISOString();
    if (buckets[key]) {
      buckets[key].events++;
      if ((e as any).status === "blocked") buckets[key].blocked++;
    }
  }
  return Object.entries(buckets).map(([key, v]) => ({
    time: format(new Date(key), "HH:mm"),
    events: v.events,
    blocked: v.blocked,
  }));
}

function HostDetailPanel({ host, onClose }: { host: NetworkHost; onClose: () => void }) {
  const { data: eventsData, isLoading } = useHostEvents(host.ip);

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative w-full max-w-lg bg-background border-l border-border flex flex-col overflow-hidden">
        <div className="flex items-center justify-between p-4 border-b border-border bg-card">
          <div>
            <div className="flex items-center gap-2">
              <span className="font-mono text-primary text-lg font-bold">{host.ip}</span>
              <Badge variant="outline" className={`text-xs ${roleColors[host.role] ?? roleColors.unknown}`}>
                {roleLabels[host.role] ?? host.role.toUpperCase()}
              </Badge>
              <span className={`flex items-center gap-1.5 text-xs ${host.status === "online" ? "text-green-400" : "text-gray-500"}`}>
                <StatusDot status={host.status} />
                {host.status.toUpperCase()}
              </span>
            </div>
            <p className="text-xs text-muted-foreground mt-0.5 font-mono">{host.hostname} {host.os ? `· ${host.os}` : ""}</p>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} className="shrink-0">
            <X className="w-4 h-4" />
          </Button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-5">
          <div className="grid grid-cols-2 gap-3 text-xs">
            {[
              { label: "MAC", value: host.mac ?? "—" },
              { label: "Open Ports", value: host.openPorts ?? "—" },
              { label: "Last Seen", value: format(new Date(host.lastSeen), "MM/dd HH:mm:ss") },
              {
                label: "Monitored",
                value: (() => {
                  if (!host.isMonitored) return "⬜ PASSIVE";
                  const ageS = Math.floor((Date.now() - new Date(host.lastSeen).getTime()) / 1000);
                  if (ageS < 120)  return "🟢 LIVE";
                  if (ageS < 900)  return `⚠️ STALE (${Math.floor(ageS / 60)}m ago)`;
                  return "🔴 OFFLINE";
                })(),
              },
            ].map(({ label, value }) => (
              <div key={label} className="bg-card border border-border rounded p-2">
                <p className="text-muted-foreground uppercase tracking-wider text-[10px]">{label}</p>
                <p className="font-mono text-foreground mt-0.5 break-all">{value}</p>
              </div>
            ))}
          </div>

          {isLoading ? (
            <div className="text-muted-foreground text-xs text-center py-4">Loading attack data…</div>
          ) : eventsData && eventsData.totalEvents > 0 ? (
            <>
              {/* Attack Severity breakdown for THIS host */}
              <div>
                <p className="text-xs uppercase tracking-wider text-muted-foreground mb-2 font-bold">
                  Attack Severity — {host.ip}
                </p>
                <div className="grid grid-cols-4 gap-2">
                  {(["critical","high","medium","low"] as const).map(s => (
                    <div key={s} className={`rounded p-2 text-center ${severityBg[s]}`}>
                      <p className={`text-xl font-bold ${severityColor[s]}`}>{eventsData.bySeverity[s]}</p>
                      <p className={`text-[10px] uppercase ${severityColor[s]}`}>{s}</p>
                    </div>
                  ))}
                </div>
              </div>

              {eventsData.byType.length > 0 && (
                <div>
                  <p className="text-xs uppercase tracking-wider text-muted-foreground mb-2 font-bold">
                    Attack Types <span className="text-primary">({eventsData.totalEvents} total)</span>
                  </p>
                  <ResponsiveContainer width="100%" height={Math.min(eventsData.byType.length * 32 + 20, 200)}>
                    <BarChart data={eventsData.byType} layout="vertical" margin={{ left: 0, right: 30, top: 4, bottom: 4 }}>
                      <XAxis type="number" tick={{ fill: "#6b7280", fontSize: 10 }} />
                      <YAxis dataKey="type" type="category" tick={{ fill: "#94a3b8", fontSize: 10 }} width={110} />
                      <Tooltip contentStyle={{ background: "#111827", border: "1px solid #374151", fontSize: 11 }} />
                      <Bar dataKey="count" fill="hsl(var(--primary))" radius={[0, 4, 4, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}

              <div>
                <p className="text-xs uppercase tracking-wider text-muted-foreground mb-2 font-bold">Recent Events</p>
                <div className="space-y-1.5 max-h-64 overflow-y-auto">
                  {eventsData.recentEvents.slice(0, 20).map(e => (
                    <div key={e.id} className="bg-card border border-border/50 rounded p-2.5 text-xs">
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                            e.severity === "critical" ? "bg-red-400" :
                            e.severity === "high"     ? "bg-orange-400" :
                            e.severity === "medium"   ? "bg-yellow-400" : "bg-green-400"
                          }`} />
                          <span className="font-bold text-foreground truncate">{e.subtype}</span>
                        </div>
                        <span className="text-[10px] text-muted-foreground shrink-0">
                          {format(new Date(e.createdAt), "HH:mm:ss")}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 text-muted-foreground">
                        <span className="font-mono text-cyan-400">{e.sourceIp}</span>
                        <span>→</span>
                        <HostLabel ip={e.targetHost} />
                        {e.toolUsed && <span className="text-yellow-400/80">· {e.toolUsed}</span>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </>
          ) : (
            <div className="text-center py-6 text-muted-foreground">
              <AlertTriangle className="w-8 h-8 mx-auto mb-2 opacity-30" />
              <p className="text-sm">No attacks recorded for this host yet.</p>
              <p className="text-xs mt-1 opacity-60">Events appear when forwarder sends data.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function Network() {
  const { data: allHosts = [], isLoading: hostsLoading } = useNetworkHosts();
  const { data: traffic = [] } = useNetworkTraffic();
  const { selectedIp } = useDeviceContext();

  const [selectedHost, setSelectedHost] = useState<NetworkHost | null>(null);
  const [ipSearch, setIpSearch] = useState("");

  // Active IP: local search wins over global device-context filter
  const activeIp = ipSearch.trim() || selectedIp;
  const chartIp = selectedHost?.ip ?? activeIp;
  const { data: hostEvents } = useHostEvents(chartIp);

  // Inline IP-analysis data for arbitrary typed IPs
  const { data: searchedIpEvents, isLoading: searchedIpLoading } = useHostEvents(
    ipSearch.trim() && !allHosts.find(h => h.ip === ipSearch.trim()) ? ipSearch.trim() : null
  );

  const hosts = activeIp
    ? allHosts.filter(h => h.ip === activeIp)
    : allHosts.filter(h => h.role !== "kali");

  // When user typed an IP with no registered host, show inline analysis
  const showIpAnalysis = !!ipSearch.trim() && hosts.length === 0;

  const [loadingId, setLoadingId] = useState<number | null>(null);
  const [flashedIds, setFlashedIds] = useState<Set<number>>(new Set());
  const [deleteTarget, setDeleteTarget] = useState<NetworkHost | null>(null);
  const prevHostsRef = useRef<NetworkHost[]>([]);
  const qc = useQueryClient();
  const { toast } = useToast();

  // Flash row when status changes
  useEffect(() => {
    const prev = prevHostsRef.current;
    if (prev.length === 0) { prevHostsRef.current = hosts; return; }
    const changed = hosts.filter(h => {
      const old = prev.find(p => p.id === h.id);
      return old && old.status !== h.status;
    });
    if (changed.length > 0) {
      const ids = new Set(changed.map(h => h.id));
      setFlashedIds(ids);
      setTimeout(() => setFlashedIds(new Set()), 2000);
    }
    prevHostsRef.current = hosts;
  }, [hosts]);

  function removeHost(e: React.MouseEvent, host: NetworkHost) {
    e.stopPropagation();
    setDeleteTarget(host);
  }

  async function confirmRemoveHost() {
    if (!deleteTarget) return;
    const host = deleteTarget;
    setDeleteTarget(null);
    setLoadingId(host.id);
    try {
      const res = await fetch(`${BASE}/api/network/hosts/${host.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      toast({ title: "Host Removed", description: `${host.ip} (${host.hostname}) ကို list ကနေ ဖြုတ်ပြီးပြီ။` });
      if (selectedHost?.id === host.id) setSelectedHost(null);
    } catch (err: any) {
      toast({ title: "Delete Failed", description: err.message, variant: "destructive" });
    } finally {
      qc.invalidateQueries({ queryKey: ["network-hosts"] });
      setLoadingId(null);
    }
  }

  const onlineCount    = hosts.filter(h => h.status === "online").length;
  const offlineCount   = hosts.filter(h => h.status === "offline").length;
  const monitoredCount = hosts.filter(h => h.isMonitored).length;

  // "All Devices" traffic area chart (uses global traffic ring)
  const allTrafficChart = traffic.slice(-12).map(p => ({
    time:     format(new Date(p.time), "HH:mm"),
    inbound:  p.inbound,
    outbound: p.outbound,
    blocked:  p.blocked,
  }));

  // Per-device event timeline (area chart from recentEvents)
  const deviceTimeline = chartIp && hostEvents
    ? buildTimeline(hostEvents.recentEvents)
    : [];

  const showDeviceChart = !!chartIp;
  const chartTitle = selectedHost
    ? `Attack Events — ${selectedHost.ip}`
    : chartIp
    ? `Attack Events — ${chartIp}`
    : "Traffic (Last 12h)";

  return (
    <>
    <AlertDialog open={!!deleteTarget} onOpenChange={open => { if (!open) setDeleteTarget(null); }}>
      <AlertDialogContent className="bg-card border-border">
        <AlertDialogHeader>
          <AlertDialogTitle className="text-red-400 uppercase tracking-widest">Device ဖြုတ်မည်</AlertDialogTitle>
          <AlertDialogDescription>
            <span className="font-bold text-foreground">{deleteTarget?.hostname}</span> ({deleteTarget?.ip}) ကို list ကနေ ဖြုတ်မည်။{" "}
            Forwarder script ပြန် run ရင် ပြန်ပေါ်လာမည်။
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel className="border-border">Cancel</AlertDialogCancel>
          <AlertDialogAction
            className="bg-red-600 hover:bg-red-700 text-white"
            onClick={confirmRemoveHost}
          >
            Remove
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    <div className="space-y-6">
      {selectedHost && (
        <HostDetailPanel
          host={hosts.find(h => h.id === selectedHost.id) ?? selectedHost}
          onClose={() => setSelectedHost(null)}
        />
      )}

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-primary uppercase">Network Monitor</h1>
          <p className="text-sm text-muted-foreground">Real-time network topology and traffic analysis.</p>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground font-mono">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-primary" />
          </span>
          Live · auto-refreshes every 15s
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <Card className="bg-card border-border">
          <CardContent className="p-4 flex items-center gap-4">
            <div className="relative">
              <Monitor className="w-8 h-8 text-cyan-400" />
              {onlineCount > 0 && (
                <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-green-400 animate-ping" />
              )}
            </div>
            <div>
              <p className="text-xs text-muted-foreground uppercase tracking-wider">Hosts Online</p>
              <p className="text-3xl font-bold text-cyan-400">
                {onlineCount}
                {offlineCount > 0 && (
                  <span className="text-sm text-gray-500 ml-2 font-normal">/ {offlineCount} offline</span>
                )}
              </p>
            </div>
          </CardContent>
        </Card>
        <Card className="bg-card border-border">
          <CardContent className="p-4 flex items-center gap-4">
            <Shield className="w-8 h-8 text-green-400" />
            <div>
              <p className="text-xs text-muted-foreground uppercase tracking-wider">Monitored</p>
              <p className="text-3xl font-bold text-green-400">{monitoredCount}</p>
            </div>
          </CardContent>
        </Card>
        <Card className="bg-card border-border">
          <CardContent className="p-4 flex items-center gap-4">
            <Activity className="w-8 h-8 text-primary" />
            <div>
              <p className="text-xs text-muted-foreground uppercase tracking-wider">Traffic (last hr)</p>
              {(() => {
                const hasPackets = traffic.some(p => (p as any).packets > 0);
                const oneHourAgo = Date.now() - 3_600_000;
                if (hasPackets) {
                  const lastHr = traffic.filter(p => new Date(p.time).getTime() >= oneHourAgo);
                  const total = lastHr.reduce((s, p) => s + p.inbound, 0);
                  return (
                    <p className="text-3xl font-bold text-primary">
                      {total.toFixed(1)} <span className="text-base">Mb/s</span>
                    </p>
                  );
                }
                const lastActive = [...traffic].reverse().find(p => p.inbound > 0);
                const val = lastActive?.inbound ?? 0;
                return (
                  <p className="text-3xl font-bold text-primary">
                    {val} <span className="text-base text-muted-foreground">events/hr</span>
                  </p>
                );
              })()}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Traffic / Event-timeline chart */}
      <Card className="bg-card border-border">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
            <Activity className="w-4 h-4" />
            {chartTitle}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {showDeviceChart ? (
            deviceTimeline.every(p => p.events === 0) ? (
              <div className="h-48 flex items-center justify-center text-muted-foreground text-sm">
                No events recorded for {chartIp} yet
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={200}>
                <AreaChart data={deviceTimeline}>
                  <defs>
                    <linearGradient id="evGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="blkGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#f87171" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#f87171" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
                  <XAxis dataKey="time" tick={{ fill: "#6b7280", fontSize: 10 }} />
                  <YAxis tick={{ fill: "#6b7280", fontSize: 10 }} />
                  <Tooltip contentStyle={{ background: "#111827", border: "1px solid #374151", color: "#e5e7eb", fontSize: 11 }} />
                  <Area type="monotone" dataKey="events" stroke="hsl(var(--primary))" fill="url(#evGrad)" name="Events" />
                  <Area type="monotone" dataKey="blocked" stroke="#f87171" fill="url(#blkGrad)" name="Blocked" />
                </AreaChart>
              </ResponsiveContainer>
            )
          ) : allTrafficChart.length === 0 ? (
            <div className="h-48 flex items-center justify-center text-muted-foreground text-sm">No traffic data</div>
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <AreaChart data={allTrafficChart}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
                <XAxis dataKey="time" tick={{ fill: "#6b7280", fontSize: 10 }} />
                <YAxis tick={{ fill: "#6b7280", fontSize: 10 }} />
                <Tooltip contentStyle={{ background: "#111827", border: "1px solid #374151", color: "#e5e7eb", fontSize: 11 }} />
                <Area type="monotone" dataKey="inbound"  stroke="#22d3ee" fill="#22d3ee22" name="Inbound" />
                <Area type="monotone" dataKey="outbound" stroke="#22c55e" fill="#22c55e22" name="Outbound" />
                <Area type="monotone" dataKey="blocked"  stroke="#f87171" fill="#f8717122" name="Blocked" />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      {/* Connected Hosts table */}
      <Card className="bg-card border-border">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between gap-4">
            <CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
              <Wifi className="w-4 h-4" /> Connected Hosts
              <span className="text-[10px] text-muted-foreground/60 ml-1 font-normal normal-case">— click a row to see attack details</span>
            </CardTitle>
            <div className="relative w-60 shrink-0">
              <Search className="absolute left-2.5 top-2.5 w-3.5 h-3.5 text-muted-foreground" />
              <Input
                placeholder="Search any IP..."
                value={ipSearch}
                onChange={e => { setIpSearch(e.target.value); setSelectedHost(null); }}
                className="pl-8 h-8 text-xs bg-background border-border font-mono"
              />
              {ipSearch && (
                <button onClick={() => setIpSearch("")} className="absolute right-2 top-2 text-muted-foreground hover:text-foreground">
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {/* Inline IP Analysis — shown when typed IP has no registered host */}
          {showIpAnalysis && (
            <div className="mb-4 border border-primary/30 rounded-lg bg-primary/5 p-4">
              <p className="text-xs font-mono text-primary font-bold mb-3 uppercase tracking-wider">
                IP Analysis — {ipSearch.trim()}
              </p>
              {searchedIpLoading ? (
                <p className="text-muted-foreground text-xs">Loading events…</p>
              ) : searchedIpEvents && searchedIpEvents.totalEvents > 0 ? (
                <div className="space-y-3">
                  <div className="grid grid-cols-4 gap-2">
                    {(["critical","high","medium","low"] as const).map(s => (
                      <div key={s} className={`rounded p-2 text-center ${s==="critical"?"bg-red-500/20":s==="high"?"bg-orange-500/20":s==="medium"?"bg-yellow-500/20":"bg-green-500/20"}`}>
                        <p className={`text-lg font-bold ${s==="critical"?"text-red-400":s==="high"?"text-orange-400":s==="medium"?"text-yellow-400":"text-green-400"}`}>
                          {searchedIpEvents.bySeverity[s]}
                        </p>
                        <p className={`text-[10px] uppercase ${s==="critical"?"text-red-400":s==="high"?"text-orange-400":s==="medium"?"text-yellow-400":"text-green-400"}`}>{s}</p>
                      </div>
                    ))}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    <span className="text-foreground font-bold">{searchedIpEvents.totalEvents}</span> events found · Top types:{" "}
                    {searchedIpEvents.byType.slice(0,3).map(t => `${t.type} (${t.count})`).join(", ")}
                  </div>
                  <div className="space-y-1 max-h-48 overflow-y-auto">
                    {searchedIpEvents.recentEvents.slice(0,10).map((e: any) => (
                      <div key={e.id} className="flex items-center gap-2 text-xs font-mono border-b border-border/30 py-1">
                        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${e.severity==="critical"?"bg-red-400":e.severity==="high"?"bg-orange-400":e.severity==="medium"?"bg-yellow-400":"bg-green-400"}`} />
                        <span className="text-muted-foreground shrink-0">{format(new Date(e.createdAt),"HH:mm:ss")}</span>
                        <span className="text-foreground truncate">{e.subtype}</span>
                        <span className="text-muted-foreground shrink-0">→ {e.targetHost}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-2 text-muted-foreground text-xs">
                  <AlertTriangle className="w-4 h-4 opacity-50" />
                  No events found for {ipSearch.trim()} — IP may not be in the database yet.
                </div>
              )}
            </div>
          )}

          {hostsLoading ? (
            <p className="text-muted-foreground text-sm">Loading hosts...</p>
          ) : !showIpAnalysis && hosts.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Monitor className="w-10 h-10 mx-auto mb-3 opacity-30" />
              <p className="text-sm">No hosts registered yet.</p>
              <p className="text-xs mt-1">Hosts appear when forwarder scripts connect from your VMs.</p>
            </div>
          ) : !showIpAnalysis && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-xs text-muted-foreground uppercase tracking-wider">
                    <th className="text-left py-2 px-3">IP Address</th>
                    <th className="text-left py-2 px-3">Hostname</th>
                    <th className="text-left py-2 px-3">Role</th>
                    <th className="text-left py-2 px-3">OS</th>
                    <th className="text-left py-2 px-3">Open Ports</th>
                    <th className="text-left py-2 px-3">Status</th>
                    <th className="text-left py-2 px-3">Last Seen</th>
                    <th className="py-2 px-3" />
                  </tr>
                </thead>
                <tbody>
                  {hosts.map(h => (
                    <tr
                      key={h.id}
                      onClick={() => setSelectedHost(h)}
                      className={`border-b border-border/50 hover:bg-primary/10 transition-all cursor-pointer group ${
                        selectedHost?.id === h.id ? "bg-primary/5 border-l-2 border-l-primary" : ""
                      } ${
                        flashedIds.has(h.id)
                          ? h.status === "online"
                            ? "bg-green-500/10"
                            : "bg-red-500/10"
                          : ""
                      }`}
                    >
                      <td className="py-2 px-3 font-mono text-primary">{h.ip}</td>
                      <td className="py-2 px-3 font-mono">{h.hostname}</td>
                      <td className="py-2 px-3">
                        <Badge variant="outline" className={`text-xs ${roleColors[h.role] ?? roleColors.unknown}`}>
                          {roleLabels[h.role] ?? h.role.toUpperCase()}
                        </Badge>
                      </td>
                      <td className="py-2 px-3 text-muted-foreground">{h.os ?? "—"}</td>
                      <td className="py-2 px-3 font-mono text-xs text-muted-foreground">{h.openPorts ?? "—"}</td>
                      <td className="py-2 px-3">
                        <span className={`flex items-center gap-1.5 text-xs font-semibold ${h.status === "online" ? "text-green-400" : "text-gray-400"}`}>
                          <StatusDot status={h.status} />
                          {h.status === "online" ? "ONLINE" : "OFFLINE"}
                        </span>
                      </td>
                      <td className="py-2 px-3">
                        <LastSeenTicker lastSeen={h.lastSeen} status={h.status} />
                      </td>
                      <td className="py-2 px-3" onClick={e => e.stopPropagation()}>
                        <Button
                          variant="ghost" size="icon"
                          className="h-7 w-7 text-red-500 hover:text-red-400 hover:bg-red-500/10"
                          title="Remove from list"
                          disabled={loadingId === h.id}
                          onClick={e => removeHost(e, h)}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {/* Legend */}
              <div className="mt-3 flex items-center gap-4 text-[10px] text-muted-foreground border-t border-border/30 pt-2">
                <span className="flex items-center gap-1.5">
                  <StatusDot status="online" /> ONLINE — heartbeat active, iptables open
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-gray-500" /> OFFLINE — no heartbeat / manually isolated, iptables DROP queued
                </span>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
    </>
  );
}
