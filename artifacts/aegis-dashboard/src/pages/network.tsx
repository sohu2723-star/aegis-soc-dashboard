import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RefreshCcw, Wifi, Monitor, Shield, Globe, Activity } from "lucide-react";
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";

interface NetworkHost {
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

interface TrafficPoint {
  time: string;
  inbound: number;
  outbound: number;
  blocked: number;
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
    refetchInterval: 10000,
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
    refetchInterval: 30000,
  });
}

const roleColors: Record<string, string> = {
  kali: "text-red-400 border-red-400",
  ubuntu: "text-cyan-400 border-cyan-400",
  honeypot: "text-yellow-400 border-yellow-400",
  router: "text-green-400 border-green-400",
  unknown: "text-gray-400 border-gray-400",
};

const roleLabels: Record<string, string> = {
  kali: "ATTACKER",
  ubuntu: "DEFENDER",
  honeypot: "HONEYPOT",
  router: "ROUTER",
  unknown: "UNKNOWN",
};

const LAB_NODES = [
  { id: "internet", label: "INTERNET", x: 390, y: 30, icon: "🌐", color: "#6b7280" },
  { id: "router",   label: "ROUTER",   x: 390, y: 120, icon: "⊕", color: "#22c55e" },
  { id: "kali",     label: "KALI LINUX\n192.168.56.101", x: 160, y: 240, icon: "💀", color: "#f87171" },
  { id: "ubuntu",   label: "UBUNTU\n192.168.56.102",    x: 390, y: 240, icon: "🛡", color: "#22d3ee" },
  { id: "honeypot", label: "HONEYPOT\n192.168.56.103",  x: 620, y: 240, icon: "🍯", color: "#facc15" },
];

const EDGES = [
  { from: "internet", to: "router" },
  { from: "router",   to: "kali" },
  { from: "router",   to: "ubuntu" },
  { from: "router",   to: "honeypot" },
];

function nodeCenter(id: string) {
  const n = LAB_NODES.find(n => n.id === id)!;
  return { x: n.x + 50, y: n.y + 24 };
}

export default function Network() {
  const { data: hosts = [], isLoading: hostsLoading, refetch } = useNetworkHosts();
  const { data: traffic = [] } = useNetworkTraffic();

  const onlineCount = hosts.filter(h => h.status === "online").length;
  const monitoredCount = hosts.filter(h => h.isMonitored).length;

  const chartData = traffic.slice(-12).map(p => ({
    time: format(new Date(p.time), "HH:mm"),
    inbound: p.inbound,
    outbound: p.outbound,
    blocked: p.blocked,
  }));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-primary uppercase">Network Monitor</h1>
          <p className="text-sm text-muted-foreground">Real-time network topology and traffic analysis.</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()} className="border-border">
          <RefreshCcw className="w-4 h-4 mr-2" />
          Refresh
        </Button>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <Card className="bg-card border-border">
          <CardContent className="p-4 flex items-center gap-4">
            <Monitor className="w-8 h-8 text-cyan-400" />
            <div>
              <p className="text-xs text-muted-foreground uppercase tracking-wider">Hosts Online</p>
              <p className="text-3xl font-bold text-cyan-400">{onlineCount}</p>
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
              <p className="text-3xl font-bold text-primary">
                {traffic.length > 0 ? `${traffic[traffic.length - 1].inbound}` : "—"} <span className="text-base">Mb/s</span>
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-2 gap-6">
        <Card className="bg-card border-border">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
              <Globe className="w-4 h-4" /> Network Topology
            </CardTitle>
          </CardHeader>
          <CardContent>
            <svg viewBox="0 0 780 330" className="w-full" style={{ background: "rgba(0,0,0,0.2)", borderRadius: 8 }}>
              {EDGES.map((e, i) => {
                const f = nodeCenter(e.from);
                const t = nodeCenter(e.to);
                return (
                  <line key={i} x1={f.x} y1={f.y} x2={t.x} y2={t.y}
                    stroke="#22d3ee" strokeWidth={1.5} strokeDasharray="6 3" opacity={0.4} />
                );
              })}
              {LAB_NODES.map(n => (
                <g key={n.id}>
                  <rect x={n.x} y={n.y} width={100} height={48} rx={6}
                    fill="rgba(0,0,0,0.6)" stroke={n.color} strokeWidth={1.5} />
                  <text x={n.x + 50} y={n.y + 16} textAnchor="middle"
                    fill={n.color} fontSize={14} fontFamily="monospace">{n.icon}</text>
                  {n.label.split("\n").map((line, li) => (
                    <text key={li} x={n.x + 50} y={n.y + 30 + li * 12} textAnchor="middle"
                      fill={n.color} fontSize={9} fontFamily="monospace" fontWeight="bold">{line}</text>
                  ))}
                </g>
              ))}
            </svg>
            <p className="text-xs text-muted-foreground mt-2 text-center">VirtualBox Host-Only Network — 192.168.56.0/24</p>
          </CardContent>
        </Card>

        <Card className="bg-card border-border">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
              <Activity className="w-4 h-4" /> Traffic (Last 12h)
            </CardTitle>
          </CardHeader>
          <CardContent>
            {chartData.length === 0 ? (
              <div className="h-48 flex items-center justify-center text-muted-foreground text-sm">No traffic data</div>
            ) : (
              <ResponsiveContainer width="100%" height={200}>
                <AreaChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
                  <XAxis dataKey="time" tick={{ fill: "#6b7280", fontSize: 10 }} />
                  <YAxis tick={{ fill: "#6b7280", fontSize: 10 }} />
                  <Tooltip contentStyle={{ background: "#111827", border: "1px solid #374151", color: "#e5e7eb", fontSize: 11 }} />
                  <Area type="monotone" dataKey="inbound" stroke="#22d3ee" fill="#22d3ee22" name="Inbound" />
                  <Area type="monotone" dataKey="outbound" stroke="#22c55e" fill="#22c55e22" name="Outbound" />
                  <Area type="monotone" dataKey="blocked" stroke="#f87171" fill="#f8717122" name="Blocked" />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="bg-card border-border">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
            <Wifi className="w-4 h-4" /> Connected Hosts
          </CardTitle>
        </CardHeader>
        <CardContent>
          {hostsLoading ? (
            <p className="text-muted-foreground text-sm">Loading hosts...</p>
          ) : hosts.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Monitor className="w-10 h-10 mx-auto mb-3 opacity-30" />
              <p className="text-sm">No hosts registered yet.</p>
              <p className="text-xs mt-1">Hosts appear when forwarder scripts connect from your VMs.</p>
            </div>
          ) : (
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
                    <th className="text-left py-2 px-3">Monitored</th>
                    <th className="text-left py-2 px-3">Last Seen</th>
                  </tr>
                </thead>
                <tbody>
                  {hosts.map(h => (
                    <tr key={h.id} className="border-b border-border/50 hover:bg-primary/5 transition-colors">
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
                        <span className={`flex items-center gap-1.5 text-xs ${h.status === "online" ? "text-green-400" : "text-gray-500"}`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${h.status === "online" ? "bg-green-400" : "bg-gray-500"}`} />
                          {h.status.toUpperCase()}
                        </span>
                      </td>
                      <td className="py-2 px-3">
                        {h.isMonitored
                          ? <Badge className="bg-primary/20 text-primary border-primary/30 text-xs">ACTIVE</Badge>
                          : <Badge variant="outline" className="text-xs text-gray-500 border-gray-700">PASSIVE</Badge>}
                      </td>
                      <td className="py-2 px-3 text-xs text-muted-foreground">
                        {format(new Date(h.lastSeen), "MM/dd HH:mm:ss")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
