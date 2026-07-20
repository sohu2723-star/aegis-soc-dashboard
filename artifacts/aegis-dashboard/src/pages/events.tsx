import { useState } from "react";
import { useListEvents, getListEventsQueryKey } from "@workspace/api-client-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { format } from "date-fns";
import { Search, Filter, ShieldAlert, ShieldCheck, Clock, Monitor, Wifi, FileText, Hash, RefreshCw, Zap, Tag } from "lucide-react";
import { HostLabel } from "@/lib/host-utils";
import { useDeviceContext } from "@/lib/device-context";

const SEV_COLORS: Record<string, string> = {
  critical: "border-destructive text-destructive",
  high:     "border-orange-500 text-orange-500",
  medium:   "border-yellow-500 text-yellow-500",
  low:      "border-green-500 text-green-500",
};

const ACTION_COLORS: Record<string, string> = {
  drop:    "bg-red-500/10 text-red-400 border-red-500/30",
  blocked: "bg-red-500/10 text-red-400 border-red-500/30",
  allowed: "bg-yellow-500/10 text-yellow-400 border-yellow-500/30",
  alert:   "bg-blue-500/10 text-blue-400 border-blue-500/30",
};

function SeverityBadge({ severity }: { severity: string }) {
  return (
    <Badge variant="outline" className={`${SEV_COLORS[severity] ?? ""} uppercase text-[10px] tracking-wider`}>
      {severity}
    </Badge>
  );
}

function DetailRow({ icon: Icon, label, value, mono = false, className = "" }: {
  icon: React.ElementType;
  label: string;
  value: React.ReactNode;
  mono?: boolean;
  className?: string;
}) {
  if (value === null || value === undefined || value === "") return null;
  return (
    <div className={`flex items-start gap-3 py-3 border-b border-border last:border-0 ${className}`}>
      <Icon className="w-4 h-4 text-muted-foreground mt-0.5 shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-0.5">{label}</p>
        <p className={`text-sm text-foreground break-words ${mono ? "font-mono text-xs" : ""}`}>{value}</p>
      </div>
    </div>
  );
}

export default function Events() {
  const [severityFilter, setSeverityFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [selectedEvent, setSelectedEvent] = useState<any>(null);
  const { selectedIp, selectedDevice } = useDeviceContext();

  const params = severityFilter !== "all" ? { severity: severityFilter as any } : {};

  const { data: events, isLoading } = useListEvents(params, {
    query: {
      queryKey: getListEventsQueryKey(params),
      refetchInterval: 5000,
    },
  });

  const deviceFiltered = selectedIp
    ? (events ?? []).filter(
        (e: any) => e.targetHost === selectedIp || e.sourceIp === selectedIp,
      )
    : events ?? [];

  const filtered = search.trim()
    ? deviceFiltered.filter((e: any) =>
        e.sourceIp?.includes(search) ||
        e.targetHost?.toLowerCase().includes(search.toLowerCase()) ||
        e.type?.toLowerCase().includes(search.toLowerCase()) ||
        e.subtype?.toLowerCase().includes(search.toLowerCase()),
      )
    : deviceFiltered;

  const ev = selectedEvent;

  return (
    <div className="space-y-6 h-full flex flex-col">
      {/* Header */}
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

      {/* Filters */}
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
        <p className="text-xs text-muted-foreground hidden sm:block">Row ကို click → rule details ကြည့်ရန်</p>
      </div>

      {/* Table */}
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
                className="border-border hover:bg-muted/20 cursor-pointer"
                onClick={() => setSelectedEvent(event)}
              >
                <TableCell className="font-mono text-xs whitespace-nowrap">
                  {format(new Date(event.createdAt), "MM-dd HH:mm:ss")}
                </TableCell>
                <TableCell>
                  <SeverityBadge severity={event.severity} />
                </TableCell>
                <TableCell className="font-medium text-primary text-sm">{event.type}</TableCell>
                <TableCell className="max-w-[260px]">
                  {event.subtype ? (
                    <div>
                      <span className="font-mono text-xs text-yellow-400 truncate block">
                        {event.subtype}
                      </span>
                      {event.signatureId && (
                        <span className="font-mono text-[10px] text-muted-foreground">
                          SID:{event.signatureId}
                        </span>
                      )}
                    </div>
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

      {/* Rule Detail Sheet */}
      <Sheet open={!!selectedEvent} onOpenChange={open => { if (!open) setSelectedEvent(null); }}>
        <SheetContent
          side="right"
          className="w-full sm:max-w-md bg-card border-border overflow-y-auto"
        >
          {ev && (
            <>
              <SheetHeader className="mb-5">
                <div className="flex items-center gap-2 mb-1">
                  <ShieldAlert className="w-5 h-5 text-primary" />
                  <SheetTitle className="text-primary uppercase tracking-wide text-base">
                    Event Detail
                  </SheetTitle>
                </div>
                <SheetDescription className="font-mono text-xs text-muted-foreground">
                  Event ID #{ev.id}
                </SheetDescription>
              </SheetHeader>

              {/* Status badges */}
              <div className="flex flex-wrap gap-2 mb-5">
                <SeverityBadge severity={ev.severity} />
                <Badge variant="secondary" className="uppercase text-[10px] bg-muted text-muted-foreground">
                  {ev.status}
                </Badge>
                {ev.toolUsed && (
                  <Badge variant="outline" className="uppercase text-[10px] border-primary/40 text-primary/70">
                    {ev.toolUsed}
                  </Badge>
                )}
                {ev.alertAction && (
                  <Badge
                    variant="outline"
                    className={`uppercase text-[10px] ${ACTION_COLORS[ev.alertAction.toLowerCase()] ?? "border-border text-muted-foreground"}`}
                  >
                    {ev.alertAction}
                  </Badge>
                )}
              </div>

              {/* ── Matched Detection Rule Block ── */}
              {ev.subtype && (
                <div className="bg-yellow-500/5 border border-yellow-500/20 rounded-lg p-4 mb-5 space-y-3">
                  {/* Section label */}
                  <p className="text-[10px] uppercase tracking-widest text-yellow-500/70 font-semibold">
                    Matched Detection Rule
                  </p>

                  {/* Signature name — main hero */}
                  <p className="font-mono text-sm text-yellow-400 break-words leading-relaxed">
                    {ev.subtype}
                  </p>

                  {/* Rule metadata grid */}
                  <div className="grid grid-cols-2 gap-x-4 gap-y-2 pt-1">
                    {ev.signatureId != null && (
                      <div className="flex items-center gap-1.5">
                        <Hash className="w-3 h-3 text-muted-foreground shrink-0" />
                        <div>
                          <p className="text-[9px] uppercase text-muted-foreground tracking-widest">SID</p>
                          <p className="font-mono text-xs text-foreground">{ev.signatureId}</p>
                        </div>
                      </div>
                    )}
                    {ev.alertRev != null && (
                      <div className="flex items-center gap-1.5">
                        <RefreshCw className="w-3 h-3 text-muted-foreground shrink-0" />
                        <div>
                          <p className="text-[9px] uppercase text-muted-foreground tracking-widest">Rev</p>
                          <p className="font-mono text-xs text-foreground">{ev.alertRev}</p>
                        </div>
                      </div>
                    )}
                    {ev.alertAction && (
                      <div className="flex items-center gap-1.5">
                        <Zap className="w-3 h-3 text-muted-foreground shrink-0" />
                        <div>
                          <p className="text-[9px] uppercase text-muted-foreground tracking-widest">Action</p>
                          <p className="font-mono text-xs text-foreground capitalize">{ev.alertAction}</p>
                        </div>
                      </div>
                    )}
                    {ev.alertCategory && (
                      <div className="flex items-center gap-1.5 col-span-2">
                        <Tag className="w-3 h-3 text-muted-foreground shrink-0" />
                        <div>
                          <p className="text-[9px] uppercase text-muted-foreground tracking-widest">Category</p>
                          <p className="text-xs text-foreground">{ev.alertCategory}</p>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Full rule text — shown when available */}
                  {ev.signatureText && (
                    <div className="pt-2 border-t border-yellow-500/15">
                      <p className="text-[9px] uppercase text-muted-foreground tracking-widest mb-2">
                        Full Rule Text
                      </p>
                      <pre className="font-mono text-[11px] text-yellow-300/90 bg-black/30 rounded p-3 overflow-x-auto whitespace-pre-wrap break-all leading-relaxed border border-yellow-500/10">
                        {ev.signatureText}
                      </pre>
                    </div>
                  )}
                </div>
              )}

              {/* ── Event Details ── */}
              <div className="space-y-0">
                <DetailRow icon={Clock}       label="Timestamp"     value={format(new Date(ev.createdAt), "yyyy-MM-dd HH:mm:ss")} mono />
                <DetailRow icon={ShieldAlert} label="Event Type"    value={ev.type} />
                <DetailRow icon={Wifi}        label="Source IP"     value={ev.sourceIp} mono />
                <DetailRow icon={Monitor}     label="Target Host"   value={ev.targetHost} mono />
                <DetailRow icon={ShieldCheck} label="Network Layer" value={ev.layer} />
                <DetailRow icon={FileText}    label="Full Description" value={ev.description} />
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
