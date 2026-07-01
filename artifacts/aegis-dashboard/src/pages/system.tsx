import { useGetSystemStatus, getGetSystemStatusQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Server, Activity, AlertTriangle, CheckCircle, HelpCircle, Network, HardDrive, Shield } from "lucide-react";
import { format } from "date-fns";

export default function SystemStatus() {
  const { data: systems, isLoading } = useGetSystemStatus({ query: { queryKey: getGetSystemStatusQueryKey() } });

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'online': return <CheckCircle className="h-5 w-5 text-green-500" />;
      case 'offline': return <AlertTriangle className="h-5 w-5 text-destructive" />;
      case 'warning': return <Activity className="h-5 w-5 text-yellow-500" />;
      default: return <HelpCircle className="h-5 w-5 text-muted-foreground" />;
    }
  };

  const getLayerIcon = (layer: string) => {
    switch (layer) {
      case 'perimeter': return <Network className="h-4 w-4 text-primary" />;
      case 'brain': return <Server className="h-4 w-4 text-primary" />;
      case 'output': return <HardDrive className="h-4 w-4 text-primary" />;
      case 'attacker': return <Shield className="h-4 w-4 text-destructive" />;
      default: return <Server className="h-4 w-4 text-primary" />;
    }
  };

  const layers = ['perimeter', 'brain', 'output', 'attacker'];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-primary uppercase">System Status</h1>
        <p className="text-sm text-muted-foreground">Health and metrics for all AEGIS architecture components.</p>
      </div>

      {isLoading ? (
        <div className="text-center py-12 text-muted-foreground border border-border rounded-lg bg-card border-dashed">
          Polling system components...
        </div>
      ) : (
        <div className="space-y-8">
          {layers.map((layer) => {
            const layerSystems = systems?.filter(s => s.layer === layer) || [];
            if (layerSystems.length === 0) return null;

            return (
              <div key={layer} className="space-y-4">
                <h2 className="text-lg font-bold uppercase tracking-widest text-muted-foreground flex items-center gap-2 border-b border-border pb-2">
                  {getLayerIcon(layer)}
                  {layer} Layer
                </h2>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {layerSystems.map((sys) => (
                    <Card key={sys.id} className="bg-card border-border overflow-hidden">
                      <div className={`h-1 w-full ${
                        sys.status === 'online' ? 'bg-green-500' :
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
                              ${sys.status === 'online' ? 'border-green-500 text-green-500' : ''}
                              ${sys.status === 'offline' ? 'border-destructive text-destructive' : ''}
                              ${sys.status === 'warning' ? 'border-yellow-500 text-yellow-500' : ''}
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
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
