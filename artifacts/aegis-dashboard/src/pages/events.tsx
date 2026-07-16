import { useState } from "react";
import { useListEvents, getListEventsQueryKey } from "@workspace/api-client-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { format } from "date-fns";
import { Search, Filter, RefreshCcw, Sparkles, Bot, X } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

interface AiPanel {
  eventId: number;
  sourceIp: string;
  type: string;
  explanation: string | null;
  loading: boolean;
  error: string | null;
}

export default function Events() {
  const [severityFilter, setSeverityFilter] = useState<string>("all");
  const [aiPanel, setAiPanel] = useState<AiPanel | null>(null);
  const queryClient = useQueryClient();

  const { data: events, isLoading, refetch, isRefetching } = useListEvents(
    severityFilter !== "all" ? { severity: severityFilter as any } : {},
    { query: { queryKey: getListEventsQueryKey(severityFilter !== "all" ? { severity: severityFilter as any } : {}) } }
  );

  async function openAiPanel(eventId: number, sourceIp: string, type: string) {
    setAiPanel({ eventId, sourceIp, type, explanation: null, loading: true, error: null });
    try {
      const r = await fetch(`${BASE}/api/ai/analyze-event/${eventId}`);
      if (!r.ok) {
        const e = await r.json();
        throw new Error(e.error ?? `HTTP ${r.status}`);
      }
      const data = await r.json();
      setAiPanel(p => p ? { ...p, explanation: data.explanation, loading: false } : null);
    } catch (err: any) {
      setAiPanel(p => p ? { ...p, error: err.message, loading: false } : null);
    }
  }

  return (
    <div className="space-y-6 h-full flex flex-col">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-primary uppercase">Security Events</h1>
          <p className="text-sm text-muted-foreground">Raw telemetry from all network and host sensors.</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isRefetching} className="border-border">
          <RefreshCcw className={`w-4 h-4 mr-2 ${isRefetching ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      <div className="flex gap-4 items-center bg-card p-4 border border-border rounded-lg">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search IP, host, or type..."
            className="pl-9 bg-background border-border"
          />
        </div>
        <Select value={severityFilter} onValueChange={setSeverityFilter}>
          <SelectTrigger className="w-[180px] bg-background border-border">
            <Filter className="w-4 h-4 mr-2 text-muted-foreground" />
            <SelectValue placeholder="Filter Severity" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Severities</SelectItem>
            <SelectItem value="critical">Critical</SelectItem>
            <SelectItem value="high">High</SelectItem>
            <SelectItem value="medium">Medium</SelectItem>
            <SelectItem value="low">Low</SelectItem>
          </SelectContent>
        </Select>
        <div className="flex items-center gap-1.5 text-xs text-primary/70 bg-primary/5 border border-primary/20 rounded px-2 py-1">
          <Sparkles className="w-3 h-3" />
          <span>AI Explain available</span>
        </div>
      </div>

      <div className="flex-1 overflow-auto border border-border rounded-lg bg-card">
        <Table>
          <TableHeader className="bg-muted/50 sticky top-0">
            <TableRow className="border-border">
              <TableHead className="w-[160px]">Timestamp</TableHead>
              <TableHead className="w-[90px]">Severity</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Source</TableHead>
              <TableHead>Target</TableHead>
              <TableHead className="w-[90px]">Status</TableHead>
              <TableHead className="w-[60px]">AI</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                  Analyzing network traffic...
                </TableCell>
              </TableRow>
            ) : events?.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                  No events detected.
                </TableCell>
              </TableRow>
            ) : events?.map((event) => (
              <TableRow
                key={event.id}
                className={`border-border hover:bg-muted/20 ${aiPanel?.eventId === event.id ? "bg-primary/5" : ""}`}
              >
                <TableCell className="font-mono text-xs whitespace-nowrap">
                  {format(new Date(event.createdAt), "MM-dd HH:mm:ss")}
                </TableCell>
                <TableCell>
                  <Badge variant="outline" className={`
                    ${event.severity === 'critical' ? 'border-destructive text-destructive' : ''}
                    ${event.severity === 'high' ? 'border-orange-500 text-orange-500' : ''}
                    ${event.severity === 'medium' ? 'border-yellow-500 text-yellow-500' : ''}
                    ${event.severity === 'low' ? 'border-green-500 text-green-500' : ''}
                    uppercase text-[10px] tracking-wider
                  `}>
                    {event.severity}
                  </Badge>
                </TableCell>
                <TableCell className="font-medium text-primary text-sm">{event.type}</TableCell>
                <TableCell className="font-mono text-xs text-muted-foreground">{event.sourceIp}</TableCell>
                <TableCell className="font-mono text-xs text-muted-foreground">{event.targetHost}</TableCell>
                <TableCell>
                  <Badge variant="secondary" className="uppercase text-[10px] bg-muted text-muted-foreground">
                    {event.status}
                  </Badge>
                </TableCell>
                <TableCell>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="w-7 h-7 text-primary/60 hover:text-primary hover:bg-primary/10"
                    title="AI Explain this event"
                    onClick={() => openAiPanel(event.id, event.sourceIp, event.type)}
                  >
                    <Bot className="w-3.5 h-3.5" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* AI Explanation Dialog */}
      <Dialog open={!!aiPanel} onOpenChange={open => { if (!open) setAiPanel(null); }}>
        <DialogContent className="sm:max-w-[500px] bg-card border-border">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-primary uppercase tracking-widest text-sm">
              <Bot className="w-4 h-4" />
              AI Event Analysis
            </DialogTitle>
          </DialogHeader>
          {aiPanel && (
            <div className="space-y-4 pt-2">
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="bg-background border border-border rounded p-2">
                  <div className="text-muted-foreground uppercase tracking-wider mb-0.5">Event ID</div>
                  <div className="font-mono font-bold">#{aiPanel.eventId}</div>
                </div>
                <div className="bg-background border border-border rounded p-2">
                  <div className="text-muted-foreground uppercase tracking-wider mb-0.5">Source IP</div>
                  <div className="font-mono font-bold text-red-400">{aiPanel.sourceIp}</div>
                </div>
                <div className="bg-background border border-border rounded p-2 col-span-2">
                  <div className="text-muted-foreground uppercase tracking-wider mb-0.5">Attack Type</div>
                  <div className="font-medium text-primary">{aiPanel.type}</div>
                </div>
              </div>

              <div className="bg-background border border-primary/20 rounded p-4 min-h-[100px]">
                {aiPanel.loading && (
                  <div className="flex items-center gap-2 text-muted-foreground text-sm">
                    <RefreshCcw className="w-4 h-4 animate-spin text-primary" />
                    AI မှ event ကို analyze လုပ်နေသည်...
                  </div>
                )}
                {aiPanel.error && (
                  <div className="text-red-400 text-sm">{aiPanel.error}</div>
                )}
                {aiPanel.explanation && (
                  <p className="text-sm text-foreground leading-relaxed">{aiPanel.explanation}</p>
                )}
              </div>

              <div className="flex justify-end gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  className="border-border"
                  onClick={() => openAiPanel(aiPanel.eventId, aiPanel.sourceIp, aiPanel.type)}
                  disabled={aiPanel.loading}
                >
                  <RefreshCcw className={`w-3.5 h-3.5 mr-1.5 ${aiPanel.loading ? "animate-spin" : ""}`} />
                  Re-analyze
                </Button>
                <Button size="sm" onClick={() => setAiPanel(null)}>Close</Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
