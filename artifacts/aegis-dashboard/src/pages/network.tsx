import { useState, useEffect, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RefreshCcw, Wifi, Monitor, Shield, Activity, X, ChevronRight, Terminal, AlertTriangle, Trash2, WifiOff, WifiIcon } from "lucide-react";
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid, BarChart, Bar } from "recharts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { format, formatDistanceToNow } from "date-fns";

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
    refetchInterval: 15000,
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

function useHostEvents(ip: string | null) {
  return useQuery<HostEvents>({
    queryKey: ["host-events", ip],
    queryFn: async () => {
      const r = await fetch(`${BASE}/api/network/hosts/${encodeURIComponent(ip!)}/events`);
      if (!r.ok) throw new Error("Failed to fetch host events");
      return r.json();
    },
    enabled: !!ip,
    refetchInterval: 10000,
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
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const secsAgo = Math.floor((Date.now() - new Date(lastSeen).getTime()) / 1000);

  if (status === "offline") {
    return (
      <span className="text-gray-500 text-xs font-mono">
        {formatDistanceToNow(new Date(lastSeen), { addSuffix: true })}
      </span>
    );
  }

  return (
    <span className={`text-xs font-mono ${secsAgo > 70 ? "text-yellow-400" : "text-green-400/80"}`}>
      {secsAgo < 5 ? "just now" : `${secsAgo}s ago`}
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

function ConnectionGuide({ host }: { host: NetworkHost }) {
  const apiUrl = "https://aegis-api-server-jp3b.onrender.com/api";
  const guides: Record<string, { icon: string; label: string; desc: string; cmd: string }> = {
    ubuntu: {
      icon: "🛡", label: "DEFENDER (Ubuntu)",
      desc: "Snort/Suricata/Fail2ban/Cowrie events ကို AEGIS ဆီ forward လုပ်ဖို့:",
      cmd: `# Ubuntu VM မှာ run ပါ\nexport AEGIS_URL="${apiUrl}"\nexport AEGIS_KEY="your-aegis-ingest-key"\npython3 /opt/aegis_forwarder.py --mode all`,
    },
    kali: {
      icon: "💀", label: "ATTACKER (Kali Linux)",
      desc: "Kali က attack source — forwarder မလိုဘူး။ Ubuntu/Suricata က Kali ရဲ့ attacks တွေ detect လုပ်ပြီး forward လုပ်တယ်။",
      cmd: `# Kali မှာ attack run ပါ\nnmap -sS <UBUNTU_IP>\nsqlmap -u "http://<UBUNTU_IP>/login.php" --forms\nhping3 -S --flood -p 80 <UBUNTU_IP>`,
    },
    honeypot: {
      icon: "🍯", label: "HONEYPOT (Cowrie)",
      desc: "Cowrie honeypot events ကို AEGIS ဆီ forward လုပ်ဖို့:",
      cmd: `# Honeypot VM မှာ run ပါ\nexport AEGIS_URL="${apiUrl}"\nexport AEGIS_KEY="your-aegis-ingest-key"\npython3 /opt/aegis_forwarder.py --mode cowrie`,
    },
    router: {
      icon: "⊕", label: "ROUTER (pfSense)",
      desc: "Defense Center မှ firewall rules တွေကို execute လုပ်ဖို့ defense agent install ပါ:",
      cmd: `# pfSense မှာ defense agent run ပါ\nexport AEGIS_URL="${apiUrl}"\nexport AEGIS_KEY="your-aegis-ingest-key"\npython3 /opt/defense_agent.py`,
    },
  };

  const g = guides[host.role] ?? {
    icon: "❓", label: "UNKNOWN Device",
    desc: "Device role မသိဘူး — role set ဖို့ forwarder ကနေ heartbeat ပို့ပါ:",
    cmd: `curl -X POST "${apiUrl}/network/hosts" \\\n  -H "Content-Type: application/json" \\\n  -H "X-AEGIS-Key: your-aegis-ingest-key" \\\n  -d '{"ip":"${host.ip}","hostname":"${host.hostname}","role":"ubuntu","status":"online","isMonitored":true}'`,
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-sm font-bold text-primary uppercase tracking-wider">
        <span>{g.icon}</span> {g.label}
      </div>
      <p className="text-xs text-muted-foreground">{g.desc}</p>
      <div className="bg-black/40 rounded border border-border p-3">
        <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground mb-2 uppercase tracking-widest">
          <Terminal className="w-3 h-3" /> bash
        </div>
        <pre className="text-xs font-mono text-primary/90 whitespace-pre-wrap break-all">{g.cmd}</pre>
      </div>
    </div>
  );
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
              { label: "Monitored", value: host.isMonitored ? "✅ ACTIVE" : "⬜ PASSIVE" },
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
              <div>
                <p className="text-xs uppercase tracking-wider text-muted-foreground mb-2 font-bold">Attack Severity</p>
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
                  {eventsData.recentEvents.map(e => (
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
                        <span className="font-mono text-red-400">{e.sourceIp}</span>
                        <span>→</span>
                        <span className="font-mono text-cyan-400">{e.targetHost}</span>
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

          <div className="border-t border-border/50 pt-4">
            <p className="text-xs uppercase tracking-wider text-muted-foreground mb-3 font-bold flex items-center gap-2">
              <Terminal className="w-3.5 h-3.5" /> How to Connect This Device
            </p>
            <ConnectionGuide host={host} />
          </div>
        </div>
      </div>
    </div>
  );
}

export default function Network() {
  const { data: hosts = [], isLoading: hostsLoading } = useNetworkHosts();
  const { data: traffic = [] } = useNetworkTraffic();
  const [selectedHost, setSelectedHost] = useState<NetworkHost | null>(null);
  const [loadingId, setLoadingId] = useState<number | null>(null);
  const [flashedIds, setFlashedIds] = useState<Set<number>>(new Set());
  const prevHostsRef = useRef<NetworkHost[]>([]);
  const qc = useQueryClient();

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

  function handleRefresh() {
    qc.invalidateQueries({ queryKey: ["network-hosts"] });
    qc.invalidateQueries({ queryKey: ["network-traffic"] });
  }

  async function removeHost(e: React.MouseEvent, id: number) {
    e.stopPropagation();
    if (!confirm("Host ကို list ကနေ ဖြုတ်မလား?")) return;
    setLoadingId(id);
    try {
      await fetch(`${BASE}/api/network/hosts/${id}`, { method: "DELETE" });
    } finally {
      qc.invalidateQueries({ queryKey: ["network-hosts"] });
      setLoadingId(null);
      if (selectedHost?.id === id) setSelectedHost(null);
    }
  }

  async function markOffline(e: React.MouseEvent, id: number) {
    e.stopPropagation();
    setLoadingId(id);
    try {
      await fetch(`${BASE}/api/network/hosts/${id}/offline`, { method: "PATCH" });
    } finally {
      qc.invalidateQueries({ queryKey: ["network-hosts"] });
      setLoadingId(null);
    }
  }

  async function markOnline(e: React.MouseEvent, id: number) {
    e.stopPropagation();
    setLoadingId(id);
    try {
      await fetch(`${BASE}/api/network/hosts/${id}/online`, { method: "PATCH" });
    } finally {
      qc.invalidateQueries({ queryKey: ["network-hosts"] });
      setLoadingId(null);
    }
  }

  const onlineCount    = hosts.filter(h => h.status === "online").length;
  const offlineCount   = hosts.filter(h => h.status === "offline").length;
  const monitoredCount = hosts.filter(h => h.isMonitored).length;

  const chartData = traffic.slice(-12).map(p => ({
    time:     format(new Date(p.time), "HH:mm"),
    inbound:  p.inbound,
    outbound: p.outbound,
    blocked:  p.blocked,
  }));

  return (
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
        <Button variant="outline" size="sm" onClick={handleRefresh} className="border-border">
          <RefreshCcw className="w-4 h-4 mr-2" /> Refresh
        </Button>
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
              <p className="text-3xl font-bold text-primary">
                {traffic.length > 0 ? traffic[traffic.length - 1].inbound : "—"} <span className="text-base">Mb/s</span>
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

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
                <Area type="monotone" dataKey="inbound"  stroke="#22d3ee" fill="#22d3ee22" name="Inbound" />
                <Area type="monotone" dataKey="outbound" stroke="#22c55e" fill="#22c55e22" name="Outbound" />
                <Area type="monotone" dataKey="blocked"  stroke="#f87171" fill="#f8717122" name="Blocked" />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      <Card className="bg-card border-border">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
            <Wifi className="w-4 h-4" /> Connected Hosts
            <span className="text-[10px] text-muted-foreground/60 ml-1 font-normal normal-case">— click a row to see attack details</span>
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
              <div className="mt-4 bg-card border border-border rounded p-4 text-left max-w-md mx-auto">
                <p className="text-xs font-bold uppercase text-primary mb-2">Quick Connect — Ubuntu VM</p>
                <pre className="text-xs font-mono text-muted-foreground whitespace-pre-wrap">{`export AEGIS_URL="https://aegis-api-server-jp3b.onrender.com/api"
export AEGIS_KEY="your-aegis-ingest-key"
python3 /opt/aegis_forwarder.py --mode all`}</pre>
              </div>
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
                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          {h.status === "online" ? (
                            <Button
                              variant="ghost" size="icon"
                              className="h-6 w-6 text-yellow-500 hover:text-yellow-400 hover:bg-yellow-500/10"
                              title="Disconnect (mark offline + block on VM)"
                              disabled={loadingId === h.id}
                              onClick={e => markOffline(e, h.id)}
                            >
                              <WifiOff className="w-3.5 h-3.5" />
                            </Button>
                          ) : (
                            <Button
                              variant="ghost" size="icon"
                              className="h-6 w-6 text-green-500 hover:text-green-400 hover:bg-green-500/10"
                              title="Reconnect (mark online + unblock on VM)"
                              disabled={loadingId === h.id}
                              onClick={e => markOnline(e, h.id)}
                            >
                              <WifiIcon className="w-3.5 h-3.5" />
                            </Button>
                          )}
                          <Button
                            variant="ghost" size="icon"
                            className="h-6 w-6 text-red-500 hover:text-red-400 hover:bg-red-500/10"
                            title="Remove from list"
                            disabled={loadingId === h.id}
                            onClick={e => removeHost(e, h.id)}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                          <ChevronRight className="w-4 h-4 text-muted-foreground" />
                        </div>
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
  );
}
