import { useState } from "react";
import { useListEvents, getListEventsQueryKey } from "@workspace/api-client-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { format } from "date-fns";
import { Search, Filter, RefreshCcw } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { HostLabel } from "@/lib/host-utils";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export default function Events() {
  const [severityFilter, setSeverityFilter] = useState<string>("all");
  const queryClient = useQueryClient();

  const { data: events, isLoading, refetch, isRefetching } = useListEvents(
    severityFilter !== "all" ? { severity: severityFilter as any } : {},
    { query: { queryKey: getListEventsQueryKey(severityFilter !== "all" ? { severity: severityFilter as any } : {}) } }
  );

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
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                  Analyzing network traffic...
                </TableCell>
              </TableRow>
            ) : events?.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                  No events detected.
                </TableCell>
              </TableRow>
            ) : events?.map((event) => (
              <TableRow
                key={event.id}
                className="border-border hover:bg-muted/20"
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
                <TableCell><span className="font-mono text-xs text-cyan-400">{event.sourceIp}</span></TableCell>
                <TableCell><HostLabel ip={event.targetHost} /></TableCell>
                <TableCell>
                  <Badge variant="secondary" className="uppercase text-[10px] bg-muted text-muted-foreground">
                    {event.status}
                  </Badge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
