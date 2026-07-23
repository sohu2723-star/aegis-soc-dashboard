import { useGetSystemStatus, getGetSystemStatusQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Server, Activity, AlertTriangle, CheckCircle, HelpCircle, Network, HardDrive, Shield, Play, Square, Loader2 } from "lucide-react";
import { format } from "date-fns";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useDeviceContext } from "@/lib/device-context";
import { HostLabel } from "@/lib/host-utils";
import { useToast } from "@/hooks/use-toast";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

// Services that can be toggled from the dashboard via defense_commands queue
const TOGGLEABLE = new Set(["Fail2ban", "Suricata", "Snort", "Cowrie Honeypot", "Apache2"]);

// Map component display name → systemctl service name
const SERVICE_NAME: Record<string, string> = {
  "Fail2ban": "fail2ban",
  "Suricata": "suricata",
  "Snort": "snort",
  "Cowrie Honeypot": "cowrie",
  "Apache2": "apache2",
};

// Map component display name → defense-agent targetVm value
const HOST_TO_VM: Record<string, string> = {
  "10.10.10.10": "company-web-server",
  "10.20.20.10": "company-customer-db",
  "10.10.10.20": "company-dns-server",
  "10.20.20.20": "company-ldap-server",
};

export default function SystemStatus() {
  const { selectedIp, selectedDevice } = useDeviceContext();
  const { data: allSystems, isLoading } = useGetSystemStatus({ query: { queryKey: getGetSystemStatusQueryKey(), refetchInterval: 5000 } });
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [togglingId, setTogglingId] = useState<number | null>(null);

  async function controlService(sys: any, action: "start" | "stop") {
    const service = SERVICE_NAME[sys.component];
    const targetVm = HOST_TO_VM[sys.hostIp] ?? sys.hostIp;
    if (!service || !targetVm) return;
    setTogglingId(sys.id);
    try {
      const r2 = await fetch(`${BASE}/api/ui/system/service-control`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ service, action, targetVm }),
      });
      if (!r2.ok) {
        const err = await r2.json().catch(() => ({}));
        throw new Error(err.error ?? `HTTP ${r2.status}`);
      }
      toast({
        title: `${action === "stop" ? "Stopping" : "Starting"} ${sys.component}`,
        description: `Command queued for ${targetVm}. Defense agent will execute shortly.`,
      });
      queryClient.invalidateQueries({ queryKey: getGetSystemStatusQueryKey() });
    } catch (e: any) {
      toast({ title: "Service Control Failed", description: e.message, variant: "destructive" });
    } finally {
      setTogglingId(null);
    }
  }

  // Scope to selected device or show all
  const systems = selectedIp
    ? allSystems?.filter((s: any) => !s.hostIp || s.hostIp === selectedIp)
    : allSystems;

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'online':  return <CheckCircle className="h-5 w-5 text-green-500" />;
      case 'offline': return <AlertTriangle className="h-5 w-5 text-destructive" />;
      case 'warning': return <Activity className="h-5 w-5 text-yellow-500" />;
      default:        return <HelpCircle className="h-5 w-5 text-muted-foreground" />;
    }
  };

  const getLayerIcon = (layer: string) => {
    switch (layer) {
      case 'perimeter': return <Network className="h-4 w-4 text-primary" />;
      case 'brain':     return <Server className="h-4 w-4 text-primary" />;
      case 'output':    return <HardDrive className="h-4 w-4 text-primary" />;
      case 'attacker':  return <Shield className="h-4 w-4 text-destructive" />;
      default:          return <Server className="h-4 w-4 text-primary" />;
    }
  };

  const layerLabels: Record<string, string> = {
    perimeter: "Perimeter Defense",
    sensor:    "Security Sensors",
    brain:     "AEGIS Core",
  };

  const layers = ['perimeter', 'sensor', 'brain'];

  const onlineCount  = systems?.filter((s: any) => s.status === "online").length  ?? 0;
  const offlineCount = systems?.filter((s: any) => s.status === "offline").length ?? 0;
  const unknownCount = systems?.filter((s: any) => s.status === "unknown").length ?? 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-primary uppercase">System Status</h1>
          <p className="text-sm text-muted-foreground">
            Health and metrics for all AEGIS architecture components.
            {selectedDevice && <span className="text-cyan-400 font-mono"> — scoped to {selectedDevice.hostname} ({selectedDevice.ip})</span>}
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground font-mono">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-primary" />
          </span>
          Live · auto-refreshes every 15s
        </div>
      </div>

      {/* Summary bar */}
      {!isLoading && systems && (
        <div className="grid grid-cols-3 gap-4">
          <Card className="bg-card border-border">
            <CardContent className="p-4 flex items-center gap-3">
              <CheckCircle className="w-7 h-7 text-green-500" />
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wider">Online</p>
                <p className="text-2xl font-bold text-green-500">{onlineCount}</p>
              </div>
            </CardContent>
          </Card>
          <Card className="bg-card border-border">
            <CardContent className="p-4 flex items-center gap-3">
              <AlertTriangle className="w-7 h-7 text-destructive" />
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wider">Offline</p>
                <p className="text-2xl font-bold text-destructive">{offlineCount}</p>
              </div>
            </CardContent>
          </Card>
          <Card className="bg-card border-border">
            <CardContent className="p-4 flex items-center gap-3">
              <HelpCircle className="w-7 h-7 text-muted-foreground" />
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wider">Unknown</p>
                <p className="text-2xl font-bold text-muted-foreground">{unknownCount}</p>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {isLoading ? (
        <div className="text-center py-12 text-muted-foreground border border-border rounded-lg bg-card border-dashed">
          Polling system components...
        </div>
      ) : (
        <div className="space-y-8">
          {layers.map((layer) => {
            const layerSystems: any[] = systems?.filter((s: any) => s.layer === layer) || [];
            if (layerSystems.length === 0) return null;

            // When "All Devices" selected: sub-group within each layer by hostIp
            // Global components (hostIp == null) always go in their own group at the top
            if (!selectedIp) {
              // Collect distinct hostIp values (null = global/shared)
              const globalSystems = layerSystems.filter(s => !s.hostIp);
              const hostIps = [...new Set(layerSystems.filter(s => s.hostIp).map(s => s.hostIp as string))];

              return (
                <div key={layer} className="space-y-4">
                  <h2 className="text-lg font-bold uppercase tracking-widest text-muted-foreground flex items-center gap-2 border-b border-border pb-2">
                    {getLayerIcon(layer)}
                    {layerLabels[layer] ?? layer} Layer
                  </h2>

                  {/* Global/shared components (no specific host) */}
                  {globalSystems.length > 0 && (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                      {globalSystems.map(sys => <SystemCard key={sys.id} sys={sys} getStatusIcon={getStatusIcon} onControl={controlService} toggling={togglingId === sys.id} />)}
                    </div>
                  )}

                  {/* Per-host groups */}
                  {hostIps.map(hostIp => {
                    const hostSystems = layerSystems.filter(s => s.hostIp === hostIp);
                    return (
                      <div key={hostIp} className="space-y-2">
                        <div className="flex items-center gap-2 text-xs text-muted-foreground/70 font-mono uppercase tracking-wider">
                          <div className="w-2 h-2 rounded-full bg-cyan-400/50" />
                          <HostLabel ip={hostIp} showIp={true} />
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 pl-4 border-l border-cyan-400/20">
                          {hostSystems.map(sys => <SystemCard key={sys.id} sys={sys} getStatusIcon={getStatusIcon} onControl={controlService} toggling={togglingId === sys.id} />)}
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            }

            // Single device selected: flat list within layer (same as before)
            return (
              <div key={layer} className="space-y-4">
                <h2 className="text-lg font-bold uppercase tracking-widest text-muted-foreground flex items-center gap-2 border-b border-border pb-2">
                  {getLayerIcon(layer)}
                  {layerLabels[layer] ?? layer} Layer
                </h2>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {layerSystems.map((sys) => <SystemCard key={sys.id} sys={sys} getStatusIcon={getStatusIcon} onControl={controlService} toggling={togglingId === sys.id} />)}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function SystemCard({ sys, getStatusIcon, onControl, toggling }: {
  sys: any;
  getStatusIcon: (s: string) => React.ReactNode;
  onControl?: (sys: any, action: "start" | "stop") => void;
  toggling?: boolean;
}) {
  const canToggle = TOGGLEABLE.has(sys.component) && !!sys.hostIp && !!SERVICE_NAME[sys.component];
  return (
    <Card className="bg-card border-border overflow-hidden">
      <div className={`h-1 w-full ${
        sys.status === 'online'  ? 'bg-green-500' :
        sys.status === 'offline' ? 'bg-destructive' :
        sys.status === 'warning' ? 'bg-yellow-500' : 'bg-muted'
      }`} />
      <CardHeader className="pb-2">
        <div className="flex justify-between items-start">
          <CardTitle className="text-base font-bold">{sys.component}</CardTitle>
          {getStatusIcon(sys.status)}
        </div>
        <p className="text-xs text-muted-foreground">{sys.description}</p>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          <div className="flex justify-between items-center text-sm">
            <span className="text-muted-foreground uppercase text-[10px] tracking-wider">Status</span>
            <Badge variant="outline" className={`
              uppercase text-[10px] tracking-wider
              ${sys.status === 'online'  ? 'border-green-500 text-green-500' : ''}
              ${sys.status === 'offline' ? 'border-destructive text-destructive' : ''}
              ${sys.status === 'warning' ? 'border-yellow-500 text-yellow-500' : ''}
              ${sys.status === 'unknown' ? 'border-muted-foreground text-muted-foreground' : ''}
            `}>
              {sys.status}
            </Badge>
          </div>

          {sys.metrics && (
            <div className="bg-background rounded p-2 border border-border/50">
              <pre className="text-[10px] font-mono text-primary/80 whitespace-pre-wrap">
                {sys.metrics}
              </pre>
            </div>
          )}

          <div className="text-[10px] text-muted-foreground font-mono flex justify-between">
            <span>LAST CHECK:</span>
            <span>{format(new Date(sys.lastCheck), "HH:mm:ss")}</span>
          </div>

          {/* Service start/stop toggle — only for toggleable sensors on VMs */}
          {canToggle && onControl && (
            <div className="flex gap-2 pt-1 border-t border-border/40">
              <Button
                size="sm"
                variant="outline"
                className="flex-1 h-7 text-[10px] gap-1.5 text-green-400 border-green-500/40 hover:bg-green-500/10 hover:border-green-500"
                disabled={toggling || sys.status === "online"}
                onClick={() => onControl(sys, "start")}
              >
                {toggling ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}
                START
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="flex-1 h-7 text-[10px] gap-1.5 text-red-400 border-red-500/40 hover:bg-red-500/10 hover:border-red-500"
                disabled={toggling || sys.status === "offline"}
                onClick={() => onControl(sys, "stop")}
              >
                {toggling ? <Loader2 className="w-3 h-3 animate-spin" /> : <Square className="w-3 h-3" />}
                STOP
              </Button>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
