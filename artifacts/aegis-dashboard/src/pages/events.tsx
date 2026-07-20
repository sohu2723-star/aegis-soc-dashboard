import { useState } from "react";
import { useListEvents, getListEventsQueryKey } from "@workspace/api-client-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { format } from "date-fns";
import { Search, Filter } from "lucide-react";
import { HostLabel } from "@/lib/host-utils";
import { useDeviceContext } from "@/lib/device-context";

export default function Events() {
  const [severityFilter, setSeverityFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const { selectedIp, selectedDevice } = useDeviceContext();

  const params = severityFilter !== "all" ? { severity: severityFilter as any } : {};

  const { data: events, isLoading } = useListEvents(params, {
    query: {
      queryKey: getListEventsQueryKey(params),
      refetchInterval: 5000,
    },
  });

  // Client-side device filter
  const deviceFiltered = selectedIp
    ? (events ?? []).filter(
        (e: any) => e.targetHost === selectedIp || e.sourceIp === selectedIp,
      )
    : events ?? [];

  // Client-side search filter
  const filtered = search.trim()
    ? deviceFiltered.filter((e: any) =>
        e.sourceIp?.includes(search) ||
        e.targetHost?.toLowerCase().includes(search.toLowerCase()) ||
        e.type?.toLowerCase().includes(search.toLowerCase()) ||
        e.subtype?.toLowerCase().includes(search.toLowerCase()),
      )
    : deviceFiltered;

  return (
    <div className="space-y-6 h-full flex flex-col">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-primary uppercase">Security Events</h1>
          {selectedDevice ? (
            <p className="text-xs text-cyan-400 font-mono mt-0.5">
              Scoped to: {selectedDevice.hostname} ({selectedDevice.ip})
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">Raw telemetry from all network and host sensors.</p>
          )}
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground font-mono">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-primary" />
          </span>
          Live · {filtered.length} events
        </div>
      </div>

      <div className="flex gap-4 items-center bg-card p-4 border border-border rounded-lg">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search IP, host, or type..."
            value={search}
            onChange={e => setSearch(e.target.value)}
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
              <TableHead className="w-[120px]">Type</TableHead>
              <TableHead>Rule / Signature</TableHead>
              <TableHead>Source</TableHead>
              <TableHead>Target</TableHead>
              <TableHead className="w-[90px]">Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                  Analyzing network traffic...
                </TableCell>
              </TableRow>
            ) : filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                  {selectedDevice
                    ? `No events for ${selectedDevice.hostname} (${selectedDevice.ip}).`
                    : "No events detected."}
                </TableCell>
              </TableRow>
            ) : filtered.map((event: any) => (
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
                <TableCell className="max-w-[260px]">
                  {event.subtype ? (
                    <span
                      className="font-mono text-xs text-yellow-400 truncate block"
                      title={event.description ?? event.subtype}
                    >
                      {event.subtype}
                    </span>
                  ) : (
                    <span className="text-xs text-muted-foreground">—</span>
                  )}
                </TableCell>
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
