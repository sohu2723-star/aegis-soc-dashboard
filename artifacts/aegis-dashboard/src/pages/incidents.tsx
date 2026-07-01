import { useState } from "react";
import { Link } from "wouter";
import { useListIncidents, useCreateIncident, getListIncidentsQueryKey } from "@workspace/api-client-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { format } from "date-fns";
import { Search, Plus, ShieldAlert, FileText, ArrowRight } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";

export default function Incidents() {
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [severity, setSeverity] = useState("medium");
  const [description, setDescription] = useState("");
  const [responder, setResponder] = useState("");

  const queryClient = useQueryClient();
  const { toast } = useToast();
  
  const { data: incidents, isLoading } = useListIncidents({}, { query: { queryKey: getListIncidentsQueryKey() } });
  const createIncident = useCreateIncident();

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    createIncident.mutate(
      { data: { title, severity: severity as any, description, responder } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListIncidentsQueryKey() });
          setIsCreateOpen(false);
          setTitle("");
          setDescription("");
          setResponder("");
          toast({ title: "Incident Created", description: "New security incident has been logged." });
        }
      }
    );
  };

  return (
    <div className="space-y-6 h-full flex flex-col">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-primary uppercase">Incident Management</h1>
          <p className="text-sm text-muted-foreground">Track and resolve active security incidents.</p>
        </div>
        <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="w-4 h-4 mr-2" />
              Declare Incident
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-[500px] bg-card border-border">
            <DialogHeader>
              <DialogTitle className="text-primary uppercase tracking-widest">Declare Security Incident</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleCreate} className="space-y-4 pt-4">
              <div className="space-y-2">
                <Label htmlFor="title" className="text-xs uppercase text-muted-foreground">Incident Title</Label>
                <Input id="title" value={title} onChange={e => setTitle(e.target.value)} required className="bg-background border-border" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label className="text-xs uppercase text-muted-foreground">Severity</Label>
                  <Select value={severity} onValueChange={setSeverity}>
                    <SelectTrigger className="bg-background border-border">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="critical">Critical</SelectItem>
                      <SelectItem value="high">High</SelectItem>
                      <SelectItem value="medium">Medium</SelectItem>
                      <SelectItem value="low">Low</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="responder" className="text-xs uppercase text-muted-foreground">Lead Responder</Label>
                  <Input id="responder" value={responder} onChange={e => setResponder(e.target.value)} className="bg-background border-border" placeholder="e.g. jsmith" />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="description" className="text-xs uppercase text-muted-foreground">Description</Label>
                <Textarea id="description" value={description} onChange={e => setDescription(e.target.value)} required className="bg-background border-border min-h-[100px]" />
              </div>
              <div className="flex justify-end pt-4">
                <Button type="submit" disabled={createIncident.isPending}>
                  {createIncident.isPending ? "Creating..." : "Submit Incident"}
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <div className="flex gap-4 items-center bg-card p-4 border border-border rounded-lg">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input 
            placeholder="Search incidents..." 
            className="pl-9 bg-background border-border"
          />
        </div>
      </div>

      <div className="flex-1 overflow-auto border border-border rounded-lg bg-card">
        <Table>
          <TableHeader className="bg-muted/50 sticky top-0">
            <TableRow className="border-border">
              <TableHead className="w-[100px]">ID</TableHead>
              <TableHead>Title</TableHead>
              <TableHead>Severity</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Responder</TableHead>
              <TableHead>Events</TableHead>
              <TableHead className="w-[180px]">Updated</TableHead>
              <TableHead className="w-[80px]"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
                  Loading incidents...
                </TableCell>
              </TableRow>
            ) : incidents?.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
                  No active incidents.
                </TableCell>
              </TableRow>
            ) : incidents?.map((incident) => (
              <TableRow key={incident.id} className="border-border hover:bg-muted/20">
                <TableCell className="font-mono text-xs text-muted-foreground">
                  INC-{incident.id.toString().padStart(4, '0')}
                </TableCell>
                <TableCell className="font-medium text-foreground">
                  {incident.title}
                </TableCell>
                <TableCell>
                  <Badge variant="outline" className={`
                    ${incident.severity === 'critical' ? 'border-destructive text-destructive' : ''}
                    ${incident.severity === 'high' ? 'border-orange-500 text-orange-500' : ''}
                    ${incident.severity === 'medium' ? 'border-yellow-500 text-yellow-500' : ''}
                    ${incident.severity === 'low' ? 'border-green-500 text-green-500' : ''}
                    uppercase text-[10px] tracking-wider
                  `}>
                    {incident.severity}
                  </Badge>
                </TableCell>
                <TableCell>
                  <Badge variant="secondary" className="uppercase text-[10px] bg-muted text-muted-foreground">
                    {incident.status}
                  </Badge>
                </TableCell>
                <TableCell className="text-sm">
                  {incident.responder || <span className="text-muted-foreground text-xs italic">Unassigned</span>}
                </TableCell>
                <TableCell className="text-sm font-mono">
                  {incident.eventCount}
                </TableCell>
                <TableCell className="font-mono text-xs whitespace-nowrap text-muted-foreground">
                  {format(new Date(incident.updatedAt), "yyyy-MM-dd HH:mm")}
                </TableCell>
                <TableCell>
                  <Button variant="ghost" size="icon" asChild className="h-8 w-8 text-primary hover:text-primary hover:bg-primary/10">
                    <Link href={`/incidents/${incident.id}`}>
                      <ArrowRight className="h-4 w-4" />
                    </Link>
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
