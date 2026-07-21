import { useGetSystemStatus, getGetSystemStatusQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Server, Activity, AlertTriangle, CheckCircle, HelpCircle, Network, HardDrive, Shield } from "lucide-react";
import { format } from "date-fns";
import { useDeviceContext } from "@/lib/device-context";
import { HostLabel } from "@/lib/host-utils";

export default function SystemStatus() {
  const { selectedIp, selectedDevice } = useDeviceContext();
  const { data: allSystems, isLoading } = useGetSystemStatus({ query: { queryKey: getGetSystemStatusQueryKey(), refetchInterval: 5000 } });

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
                      {globalSystems.map(sys => <SystemCard key={sys.id} sys={sys} getStatusIcon={getStatusIcon} />)}
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
                          {hostSystems.map(sys => <SystemCard key={sys.id} sys={sys} getStatusIcon={getStatusIcon} />)}
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
                  {layerSystems.map((sys) => <SystemCard key={sys.id} sys={sys} getStatusIcon={getStatusIcon} />)}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function SystemCard({ sys, getStatusIcon }: { sys: any; getStatusIcon: (s: string) => React.ReactNode }) {
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
        </div>
      </CardContent>
    </Card>
  );
}
