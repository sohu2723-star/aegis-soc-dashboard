import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Check, Siren, AlertTriangle, Bell, ArrowRight, Monitor } from "lucide-react";
import { format } from "date-fns";
import { HostLabel } from "@/lib/host-utils";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { useDeviceContext } from "@/lib/device-context";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

interface Alert {
  id: number;
  message: string;
  severity: string;
  channel: string;
  acknowledged: boolean;
  eventId: number | null;
  createdAt: string;
  // Enriched from security event
  sourceIp: string | null;
  targetHost: string | null;
  attackType: string | null;
  attackSubtype: string | null;
  toolUsed: string | null;
}

function useAlerts() {
  return useQuery<Alert[]>({
    queryKey: ["alerts"],
    queryFn: async () => {
      const r = await fetch(`${BASE}/api/alerts`);
      if (!r.ok) throw new Error("Failed to fetch alerts");
      return r.json();
    },
    refetchInterval: 10000,
  });
}

const sevBorder: Record<string, string> = {
  critical: "border-red-600 bg-red-950/30 shadow-[0_0_15px_rgba(220,38,38,0.15)]",
  high:     "border-orange-600 bg-orange-950/20",
  medium:   "border-yellow-600 bg-yellow-950/10",
  low:      "border-border bg-card",
};
const sevText: Record<string, string> = {
  critical: "text-red-400",
  high:     "text-orange-400",
  medium:   "text-yellow-400",
  low:      "text-gray-400",
};
const sevBadge: Record<string, string> = {
  critical: "border-red-600 text-red-400",
  high:     "border-orange-500 text-orange-400",
  medium:   "border-yellow-500 text-yellow-400",
  low:      "border-gray-600 text-gray-400",
};

const attackTypeLabel: Record<string, string> = {
  network:    "Network Attack",
  web:        "Web Attack",
  ssh:        "SSH Attack",
  tls:        "TLS Anomaly",
  fail2ban:   "Fail2ban Ban",
  malware:    "Malware",
};

export default function Alerts() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [filter, setFilter] = useState<"all" | "unacknowledged">("unacknowledged");
  const { selectedIp, selectedDevice } = useDeviceContext();

  const { data: allAlerts = [], isLoading } = useAlerts();

  const ackMutation = useMutation({
    mutationFn: async (id: number) => {
      const r = await fetch(`${BASE}/api/alerts/${id}/acknowledge`, { method: "PATCH" });
      if (!r.ok) throw new Error("Failed to acknowledge");
      return r.json();
    },
    onSuccess: (_data, id) => {
      queryClient.invalidateQueries({ queryKey: ["alerts"] });
      toast({ title: "Alert Acknowledged", description: `Alert #${id} marked as acknowledged.` });
    },
  });

  // Device filter — match on sourceIp or targetHost
  const deviceFiltered = selectedIp
    ? allAlerts.filter(
        a => a.sourceIp === selectedIp || a.targetHost === selectedIp,
      )
    : allAlerts;

  const displayed = filter === "unacknowledged"
    ? deviceFiltered.filter(a => !a.acknowledged)
    : deviceFiltered;

  const unackCount = deviceFiltered.filter(a => !a.acknowledged).length;

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-primary uppercase">Active Alerts</h1>
          {selectedDevice ? (
            <p className="text-xs text-cyan-400 font-mono mt-0.5">
              Scoped to: {selectedDevice.hostname} ({selectedDevice.ip})
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">Real-time notifications from real lab devices requiring immediate attention.</p>
          )}
        </div>
        {/* Filter toggle */}
        <div className="flex items-center gap-1 border border-border rounded p-0.5 shrink-0">
          <button
            onClick={() => setFilter("unacknowledged")}
            className={`px-3 py-1 text-xs rounded transition-colors ${filter === "unacknowledged" ? "bg-primary/20 text-primary" : "text-muted-foreground hover:text-foreground"}`}
          >
            Unacked {unackCount > 0 && <span className="ml-1 bg-red-500 text-white rounded-full px-1.5 py-0.5 text-[10px]">{unackCount}</span>}
          </button>
          <button
            onClick={() => setFilter("all")}
            className={`px-3 py-1 text-xs rounded transition-colors ${filter === "all" ? "bg-primary/20 text-primary" : "text-muted-foreground hover:text-foreground"}`}
          >
            All ({deviceFiltered.length})
          </button>
        </div>
      </div>

      <div className="space-y-3">
        {isLoading ? (
          <div className="text-center py-12 text-muted-foreground border border-border rounded-lg bg-card border-dashed">
            Scanning for active alerts...
          </div>
        ) : displayed.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground border border-border rounded-lg bg-card border-dashed flex flex-col items-center justify-center">
            <Bell className="h-8 w-8 mb-4 text-muted-foreground/50" />
            <p>
              {filter === "unacknowledged"
                ? selectedDevice
                  ? `No unacknowledged alerts for ${selectedDevice.hostname}.`
                  : "No unacknowledged alerts. All clear."
                : selectedDevice
                  ? `No alerts for ${selectedDevice.hostname} (${selectedDevice.ip}).`
                  : "No alerts yet. Systems normal."}
            </p>
          </div>
        ) : displayed.map((alert) => (
          <div
            key={alert.id}
            className={`rounded-lg border p-4 transition-opacity ${
              sevBorder[alert.severity] ?? "border-border bg-card"
            } ${alert.acknowledged ? "opacity-50" : ""}`}
          >
            <div className="flex flex-col sm:flex-row gap-4 justify-between">
              {/* Left: icon + content */}
              <div className="flex items-start gap-3 min-w-0">
                <div className="mt-0.5 shrink-0">
                  {alert.severity === "critical" ? (
                    <Siren className={`h-5 w-5 text-red-500 ${!alert.acknowledged ? "animate-pulse" : ""}`} />
                  ) : (
                    <AlertTriangle className={`h-5 w-5 ${sevText[alert.severity] ?? "text-gray-400"}`} />
                  )}
                </div>

                <div className="min-w-0 space-y-1.5">
                  {/* Header row */}
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline" className={`uppercase text-[10px] tracking-wider ${sevBadge[alert.severity] ?? ""}`}>
                      {alert.severity}
                    </Badge>
                    {alert.attackType && (
                      <Badge variant="outline" className="text-[10px] border-primary/30 text-primary/80">
                        {attackTypeLabel[alert.attackType] ?? alert.attackType.toUpperCase()}
                        {alert.attackSubtype ? ` / ${alert.attackSubtype}` : ""}
                      </Badge>
                    )}
                    <span className="text-xs text-muted-foreground font-mono">
                      {format(new Date(alert.createdAt), "HH:mm:ss · yyyy-MM-dd")}
                    </span>
                    {alert.eventId && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                        EVT-{alert.eventId}
                      </span>
                    )}
                  </div>

                  {/* Alert message */}
                  <p className={`text-sm ${!alert.acknowledged ? "font-medium text-foreground" : "text-muted-foreground"}`}>
                    {alert.message}
                  </p>

                  {/* Device / IP info */}
                  {(alert.sourceIp || alert.targetHost) && (
                    <div className="flex items-center gap-1.5 text-xs font-mono mt-1">
                      <Monitor className="w-3 h-3 text-muted-foreground shrink-0" />
                      {alert.sourceIp && (
                        <span className="text-red-400">{alert.sourceIp}</span>
                      )}
                      {alert.sourceIp && alert.targetHost && (
                        <ArrowRight className="w-3 h-3 text-muted-foreground" />
                      )}
                      {alert.targetHost && (
                        <HostLabel ip={alert.targetHost} />
                      )}
                      {alert.toolUsed && (
                        <span className="text-yellow-400/80 ml-1">· {alert.toolUsed}</span>
                      )}
                    </div>
                  )}

                  <div className="text-[10px] text-muted-foreground uppercase tracking-wider">
                    Channel: {alert.channel}
                  </div>
                </div>
              </div>

              {/* Right: acknowledge button */}
              <div className="flex sm:flex-col items-center sm:items-end justify-end gap-2 shrink-0">
                {!alert.acknowledged ? (
                  <Button
                    size="sm"
                    variant={alert.severity === "critical" ? "destructive" : "default"}
                    onClick={() => ackMutation.mutate(alert.id)}
                    disabled={ackMutation.isPending}
                  >
                    <Check className="h-4 w-4 mr-2" />
                    Acknowledge
                  </Button>
                ) : (
                  <Badge variant="outline" className="text-muted-foreground border-border bg-background text-xs">
                    ✓ Acknowledged
                  </Badge>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
