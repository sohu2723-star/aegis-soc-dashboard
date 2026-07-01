import { useListAlerts, useAcknowledgeAlert, getListAlertsQueryKey } from "@workspace/api-client-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Check, Siren, AlertTriangle, Bell, Trash2 } from "lucide-react";
import { format } from "date-fns";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";

export default function Alerts() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  
  const { data: alerts, isLoading } = useListAlerts({}, { query: { queryKey: getListAlertsQueryKey({}) } });
  const ackAlert = useAcknowledgeAlert();

  const handleAcknowledge = (id: number) => {
    ackAlert.mutate({ id }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListAlertsQueryKey({}) });
        toast({
          title: "Alert Acknowledged",
          description: `Alert #${id} has been marked as acknowledged.`,
        });
      }
    });
  };

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-primary uppercase">Active Alerts</h1>
        <p className="text-sm text-muted-foreground">Real-time notifications requiring immediate attention.</p>
      </div>

      <div className="space-y-4">
        {isLoading ? (
          <div className="text-center py-12 text-muted-foreground border border-border rounded-lg bg-card border-dashed">
            Scanning for active alerts...
          </div>
        ) : alerts?.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground border border-border rounded-lg bg-card border-dashed flex flex-col items-center justify-center">
            <Bell className="h-8 w-8 mb-4 text-muted-foreground/50" />
            <p>No active alerts. Systems normal.</p>
          </div>
        ) : alerts?.map((alert) => (
          <div 
            key={alert.id} 
            className={`flex flex-col sm:flex-row gap-4 justify-between p-4 rounded-lg border ${
              !alert.acknowledged && alert.severity === 'critical' 
                ? 'bg-destructive/10 border-destructive shadow-[0_0_15px_rgba(255,0,0,0.1)]' 
                : !alert.acknowledged 
                  ? 'bg-primary/5 border-primary/30' 
                  : 'bg-card border-border opacity-60'
            }`}
          >
            <div className="flex items-start gap-4">
              <div className="mt-1">
                {alert.severity === 'critical' ? (
                  <Siren className={`h-5 w-5 text-destructive ${!alert.acknowledged ? 'animate-pulse' : ''}`} />
                ) : (
                  <AlertTriangle className={`h-5 w-5 ${alert.severity === 'high' ? 'text-orange-500' : 'text-yellow-500'}`} />
                )}
              </div>
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <Badge variant="outline" className={`
                    uppercase text-[10px] tracking-wider
                    ${alert.severity === 'critical' ? 'border-destructive text-destructive' : ''}
                    ${alert.severity === 'high' ? 'border-orange-500 text-orange-500' : ''}
                  `}>
                    {alert.severity}
                  </Badge>
                  <span className="text-xs text-muted-foreground font-mono">
                    {format(new Date(alert.createdAt), "HH:mm:ss - yyyy-MM-dd")}
                  </span>
                  {alert.eventId && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                      EVT-{alert.eventId}
                    </span>
                  )}
                </div>
                <p className={`text-sm ${!alert.acknowledged ? 'font-medium text-foreground' : 'text-muted-foreground'}`}>
                  {alert.message}
                </p>
                <div className="text-[10px] text-muted-foreground mt-2 uppercase tracking-wider">
                  Channel: {alert.channel}
                </div>
              </div>
            </div>
            
            <div className="flex sm:flex-col items-center sm:items-end justify-end gap-2">
              {!alert.acknowledged ? (
                <Button 
                  size="sm" 
                  variant={alert.severity === 'critical' ? 'destructive' : 'default'}
                  onClick={() => handleAcknowledge(alert.id)}
                  disabled={ackAlert.isPending}
                >
                  <Check className="h-4 w-4 mr-2" />
                  Acknowledge
                </Button>
              ) : (
                <Badge variant="outline" className="text-muted-foreground border-border bg-background">
                  Acknowledged
                </Badge>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
