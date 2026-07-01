import { useState, useEffect } from "react";
import { useParams, Link } from "wouter";
import { useGetIncident, useUpdateIncident, getGetIncidentQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { format } from "date-fns";
import { ArrowLeft, Clock, ShieldAlert, User, Save, FileText } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";

export default function IncidentDetail() {
  const { id } = useParams();
  const incidentId = parseInt(id || "0", 10);
  
  const queryClient = useQueryClient();
  const { toast } = useToast();
  
  const { data: incident, isLoading } = useGetIncident(incidentId, { query: { queryKey: getGetIncidentQueryKey(incidentId), enabled: !!incidentId } });
  const updateIncident = useUpdateIncident();

  const [notes, setNotes] = useState("");
  const [responder, setResponder] = useState("");
  const [status, setStatus] = useState<string>("open");

  useEffect(() => {
    if (incident) {
      setNotes(incident.notes || "");
      setResponder(incident.responder || "");
      setStatus(incident.status);
    }
  }, [incident]);

  const handleUpdate = () => {
    updateIncident.mutate(
      { id: incidentId, data: { status: status as any, notes, responder } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetIncidentQueryKey(incidentId) });
          toast({ title: "Incident Updated", description: "Changes have been saved successfully." });
        }
      }
    );
  };

  if (isLoading) {
    return <div className="text-center py-12 text-muted-foreground border border-border rounded-lg bg-card border-dashed">Loading incident details...</div>;
  }

  if (!incident) {
    return <div className="text-center py-12 text-destructive border border-border rounded-lg bg-card border-dashed">Incident not found</div>;
  }

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <div className="flex items-center gap-4">
        <Button variant="outline" size="icon" asChild className="h-8 w-8 border-border">
          <Link href="/incidents">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight text-foreground">{incident.title}</h1>
            <Badge variant="outline" className={`
              ${incident.severity === 'critical' ? 'border-destructive text-destructive' : ''}
              ${incident.severity === 'high' ? 'border-orange-500 text-orange-500' : ''}
              ${incident.severity === 'medium' ? 'border-yellow-500 text-yellow-500' : ''}
              ${incident.severity === 'low' ? 'border-green-500 text-green-500' : ''}
              uppercase text-[10px] tracking-wider
            `}>
              {incident.severity}
            </Badge>
          </div>
          <p className="text-sm font-mono text-muted-foreground mt-1">INC-{incident.id.toString().padStart(4, '0')}</p>
        </div>
        <Button onClick={handleUpdate} disabled={updateIncident.isPending}>
          <Save className="h-4 w-4 mr-2" />
          {updateIncident.isPending ? "Saving..." : "Save Changes"}
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="md:col-span-2 space-y-6">
          <Card className="bg-card border-border">
            <CardHeader className="pb-3 border-b border-border/50">
              <CardTitle className="text-sm uppercase tracking-wider flex items-center gap-2">
                <FileText className="h-4 w-4 text-primary" />
                Description
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-4">
              <p className="text-sm whitespace-pre-wrap">{incident.description}</p>
            </CardContent>
          </Card>

          <Card className="bg-card border-border">
            <CardHeader className="pb-3 border-b border-border/50">
              <CardTitle className="text-sm uppercase tracking-wider flex items-center gap-2">
                <ShieldAlert className="h-4 w-4 text-primary" />
                Investigation Notes
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-4">
              <Textarea 
                value={notes} 
                onChange={(e) => setNotes(e.target.value)} 
                placeholder="Enter investigation notes, findings, and containment steps..."
                className="min-h-[200px] bg-background border-border font-mono text-sm"
              />
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card className="bg-card border-border">
            <CardHeader className="pb-3 border-b border-border/50">
              <CardTitle className="text-sm uppercase tracking-wider">Properties</CardTitle>
            </CardHeader>
            <CardContent className="pt-4 space-y-4">
              <div className="space-y-2">
                <Label className="text-xs uppercase text-muted-foreground">Status</Label>
                <Select value={status} onValueChange={setStatus}>
                  <SelectTrigger className="bg-background border-border">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="open">Open</SelectItem>
                    <SelectItem value="investigating">Investigating</SelectItem>
                    <SelectItem value="contained">Contained</SelectItem>
                    <SelectItem value="resolved">Resolved</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label className="text-xs uppercase text-muted-foreground flex items-center gap-2">
                  <User className="h-3 w-3" />
                  Lead Responder
                </Label>
                <Input 
                  value={responder} 
                  onChange={(e) => setResponder(e.target.value)} 
                  placeholder="Unassigned"
                  className="bg-background border-border"
                />
              </div>

              <div className="space-y-2">
                <Label className="text-xs uppercase text-muted-foreground">Related Events</Label>
                <div className="text-xl font-mono font-bold">{incident.eventCount}</div>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-card border-border">
            <CardHeader className="pb-3 border-b border-border/50">
              <CardTitle className="text-sm uppercase tracking-wider flex items-center gap-2">
                <Clock className="h-4 w-4 text-primary" />
                Timeline
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-4 space-y-4">
              <div>
                <div className="text-xs uppercase text-muted-foreground mb-1">Created</div>
                <div className="text-sm font-mono">{format(new Date(incident.createdAt), "yyyy-MM-dd HH:mm:ss")}</div>
              </div>
              <div>
                <div className="text-xs uppercase text-muted-foreground mb-1">Last Updated</div>
                <div className="text-sm font-mono">{format(new Date(incident.updatedAt), "yyyy-MM-dd HH:mm:ss")}</div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
