import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useListEvents, getListEventsQueryKey } from "@workspace/api-client-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { format } from "date-fns";
import { Search, Filter, ShieldAlert, ShieldCheck, Clock, Monitor, Wifi, FileText, Hash, RefreshCw, Zap, Tag, Skull, CheckCircle2, Terminal, Shield, ChevronRight, Loader2, Bot, UserCheck, Undo2, Cpu, Globe } from "lucide-react";
import { HostLabel } from "@/lib/host-utils";
import { useDeviceContext } from "@/lib/device-context";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

// ─── Defense command types ──────────────────────────────────────────────────
interface EventCommand {
  id: number;
  ruleId: number | null;
  ruleName: string | null;
  targetVm: string;
  commandType: string;
  commandText: string;
  undoCommand: string | null;
  targetIp: string | null;
  status: string;
  errorMsg: string | null;
  createdAt: string;
  executedAt: string | null;
}

const CMD_STATUS_COLORS: Record<string, string> = {
  done:      "border-green-500/40 text-green-400 bg-green-500/10",
  pending:   "border-yellow-500/40 text-yellow-400 bg-yellow-500/10",
  running:   "border-blue-500/40 text-blue-400 bg-blue-500/10",
  failed:    "border-red-500/40 text-red-400 bg-red-500/10",
  cancelled: "border-border text-muted-foreground",
};

// ─── Layer badge helpers ─────────────────────────────────────────────────────
function getLayerBadge(cmd: EventCommand): { label: string; cls: string; Icon: React.ElementType } {
  const t = cmd.commandType ?? "";
  if (t.startsWith("pfsense")) {
    return { label: "PFSENSE WAN", cls: "border-purple-500/50 text-purple-400 bg-purple-500/10", Icon: Globe };
  }
  if (t === "block_ip" || t === "port_block" || t === "rate_limit" || t === "null_route") {
    return { label: "VM IPTABLES", cls: "border-orange-500/50 text-orange-400 bg-orange-500/10", Icon: Cpu };
  }
  return { label: t.toUpperCase(), cls: "border-border text-muted-foreground", Icon: Terminal };
}

function getOriginBadge(cmd: EventCommand): { label: string; cls: string; Icon: React.ElementType } {
  if (cmd.ruleName) {
    return { label: "AUTO-DEFENSE", cls: "border-cyan-500/50 text-cyan-400 bg-cyan-500/10", Icon: Bot };
  }
  return { label: "MANUAL", cls: "border-slate-500/50 text-slate-400 bg-slate-500/10", Icon: UserCheck };
}

// Extract blocked IP from iptables block command for ss-K display
function extractBlockedIp(commandText: string): string | null {
  const m = commandText.match(/iptables.*-I INPUT.*-s\s+([\d.]+).*-j DROP/);
  return m ? m[1] : null;
}

function useEventCommands(eventId: number | null) {
  return useQuery<EventCommand[]>({
    queryKey: ["event-commands", eventId],
    queryFn: () => fetch(`${BASE}/api/ui/events/${eventId}/commands`).then(r => r.json()),
    enabled: eventId != null,
    staleTime: 30_000,
  });
}

const SEV_COLORS: Record<string, string> = {
  critical: "border-destructive text-destructive",
  high:     "border-orange-500 text-orange-500",
  medium:   "border-yellow-500 text-yellow-500",
  low:      "border-green-500 text-green-500",
};

// Behavioral classification helpers
function isBreach(event: any)  { return event.status === "breach"; }
function isAuthorized(event: any) {
  return event.status === "allowed" &&
    (event.subtype === "Authorized Login" || event.subtype === "Web Authorized Login");
}

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

// ─── Defense Actions Panel ──────────────────────────────────────────────────
// Shown in the Event detail sheet — lists every defense command triggered by
// this event so the analyst can see the full Attack → Rule → Command chain.

function DefenseActionsPanel({ eventId }: { eventId: number }) {
  const { data: cmds, isLoading } = useEventCommands(eventId);

  if (isLoading) {
    return (
      <div className="mt-5 border border-border rounded-lg p-4 bg-muted/10">
        <p className="text-[10px] uppercase tracking-widest font-semibold text-muted-foreground mb-3 flex items-center gap-2">
          <Terminal className="w-3.5 h-3.5" /> Defense Actions Triggered
        </p>
        <div className="flex items-center gap-2 text-muted-foreground text-xs py-2">
          <Loader2 className="w-3.5 h-3.5 animate-spin" /> Checking for defense responses…
        </div>
      </div>
    );
  }

  if (!cmds || cmds.length === 0) return null;

  return (
    <div className="mt-5 border border-cyan-500/20 rounded-lg bg-cyan-500/5">
      {/* Section header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-cyan-500/15">
        <Shield className="w-4 h-4 text-cyan-400 shrink-0" />
        <p className="text-[10px] uppercase tracking-widest font-semibold text-cyan-400/80">
          Defense Actions Triggered
        </p>
        <Badge className="ml-auto text-[9px] bg-cyan-500/20 text-cyan-400 border-cyan-500/30">
          {cmds.length} command{cmds.length !== 1 ? "s" : ""}
        </Badge>
      </div>

      <div className="divide-y divide-border/50">
        {cmds.map((cmd) => {
          const layer  = getLayerBadge(cmd);
          const origin = getOriginBadge(cmd);
          const ssKillIp = extractBlockedIp(cmd.commandText);
          return (
            <div key={cmd.id} className="px-4 py-3 space-y-2">

              {/* Row 1: Layer + Origin badges + status */}
              <div className="flex items-center gap-1.5 flex-wrap">
                {/* Layer badge — PFSENSE WAN / VM IPTABLES */}
                <Badge variant="outline" className={`text-[9px] flex items-center gap-1 ${layer.cls}`}>
                  <layer.Icon className="w-2.5 h-2.5" />{layer.label}
                </Badge>
                {/* Origin badge — AUTO-DEFENSE / MANUAL */}
                <Badge variant="outline" className={`text-[9px] flex items-center gap-1 ${origin.cls}`}>
                  <origin.Icon className="w-2.5 h-2.5" />{origin.label}
                </Badge>
                <Badge className={`ml-auto text-[9px] ${CMD_STATUS_COLORS[cmd.status] ?? "border-border text-muted-foreground"}`}>
                  {cmd.status}
                </Badge>
              </div>

              {/* Row 2: Rule → VM chain */}
              <div className="flex items-center gap-1.5 flex-wrap">
                {cmd.ruleName && (
                  <>
                    <span className="text-[10px] text-muted-foreground uppercase tracking-widest">Rule</span>
                    <ChevronRight className="w-3 h-3 text-muted-foreground" />
                    <span className="text-xs font-semibold text-cyan-300/90">{cmd.ruleName}</span>
                    <ChevronRight className="w-3 h-3 text-muted-foreground" />
                  </>
                )}
                <span className="text-[10px] text-muted-foreground">Target:</span>
                <span className="font-mono text-[10px] text-foreground/70">{cmd.targetVm}</span>
              </div>

              {/* Block command */}
              <div>
                <p className="text-[9px] uppercase tracking-widest text-muted-foreground mb-1">Block Command</p>
                <pre className="font-mono text-[11px] bg-black/40 border border-cyan-500/10 rounded px-3 py-2 text-cyan-200/80 overflow-x-auto whitespace-pre-wrap break-all leading-relaxed">
                  {cmd.commandText}
                </pre>
              </div>

              {/* ss -K session kill — auto-runs after iptables block */}
              {ssKillIp && (
                <div>
                  <p className="text-[9px] uppercase tracking-widest text-orange-400/70 mb-1 flex items-center gap-1">
                    <Zap className="w-2.5 h-2.5" /> Session Kill (auto-run after block)
                  </p>
                  <pre className="font-mono text-[11px] bg-orange-950/30 border border-orange-500/15 rounded px-3 py-2 text-orange-300/80 overflow-x-auto whitespace-pre-wrap break-all leading-relaxed">
                    {`sudo ss -K dst ${ssKillIp}\nsudo ss -K src ${ssKillIp}`}
                  </pre>
                </div>
              )}

              {/* Undo command — shown for reference */}
              {cmd.undoCommand && (
                <div>
                  <p className="text-[9px] uppercase tracking-widest text-green-400/70 mb-1 flex items-center gap-1">
                    <Undo2 className="w-2.5 h-2.5" /> Unblock Command (undo)
                  </p>
                  <pre className="font-mono text-[11px] bg-green-950/30 border border-green-500/15 rounded px-3 py-2 text-green-300/80 overflow-x-auto whitespace-pre-wrap break-all leading-relaxed">
                    {cmd.undoCommand}
                  </pre>
                </div>
              )}

              {/* Execution time */}
              {cmd.executedAt && (
                <p className="text-[10px] text-muted-foreground font-mono">
                  Executed: {format(new Date(cmd.executedAt), "yyyy-MM-dd HH:mm:ss")}
                </p>
              )}

              {/* Error if any */}
              {cmd.errorMsg && (
                <p className="text-[10px] text-red-400 font-mono break-all">{cmd.errorMsg}</p>
              )}
            </div>
          );
        })}
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
            ) : filtered.map((event: any) => {
              const breach     = isBreach(event);
              const authorized = isAuthorized(event);
              return (
              <TableRow
                key={event.id}
                className={`border-border cursor-pointer transition-colors ${
                  breach
                    ? "bg-red-950/40 hover:bg-red-950/60 border-l-2 border-l-red-500"
                    : authorized
                    ? "bg-green-950/20 hover:bg-green-950/30"
                    : "hover:bg-muted/20"
                }`}
                onClick={() => setSelectedEvent(event)}
              >
                <TableCell className="font-mono text-xs whitespace-nowrap">
                  {format(new Date(event.createdAt), "MM-dd HH:mm:ss")}
                </TableCell>
                <TableCell>
                  <SeverityBadge severity={event.severity} />
                </TableCell>
                <TableCell className="font-medium text-primary text-sm">{event.type}</TableCell>
                <TableCell className="max-w-[280px]">
                  {event.subtype ? (
                    <div className="flex items-center gap-1.5">
                      {breach && <Skull className="w-3 h-3 text-red-400 shrink-0" />}
                      {authorized && <CheckCircle2 className="w-3 h-3 text-green-400 shrink-0" />}
                      <div>
                        <span className={`font-mono text-xs truncate block ${
                          breach ? "text-red-400" : authorized ? "text-green-400" : "text-yellow-400"
                        }`}>
                          {event.subtype}
                        </span>
                        {event.signatureId && (
                          <span className="font-mono text-[10px] text-muted-foreground">
                            SID:{event.signatureId}
                          </span>
                        )}
                      </div>
                    </div>
                  ) : (
                    <span className="text-xs text-muted-foreground">—</span>
                  )}
                </TableCell>
                <TableCell><span className="font-mono text-xs text-cyan-400">{event.sourceIp}</span></TableCell>
                <TableCell><HostLabel ip={event.targetHost} /></TableCell>
                <TableCell>
                  {breach ? (
                    <Badge className="uppercase text-[10px] bg-red-600 text-white border-0 animate-pulse">
                      BREACH
                    </Badge>
                  ) : authorized ? (
                    <Badge variant="outline" className="uppercase text-[10px] border-green-500/50 text-green-400">
                      allowed
                    </Badge>
                  ) : (
                    <Badge variant="secondary" className="uppercase text-[10px] bg-muted text-muted-foreground">
                      {event.status}
                    </Badge>
                  )}
                </TableCell>
              </TableRow>
              );
            })}
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

              {/* Breach / Authorized Login banner */}
              {isBreach(ev) && (
                <div className="flex items-center gap-2 bg-red-950/60 border border-red-500/60 rounded-lg px-4 py-3 mb-4">
                  <Skull className="w-5 h-5 text-red-400 shrink-0" />
                  <div>
                    <p className="text-red-400 font-bold text-sm uppercase tracking-wide">Breach Confirmed</p>
                    <p className="text-red-300/80 text-xs">Attacker successfully authenticated after brute-force attempts.</p>
                  </div>
                </div>
              )}
              {isAuthorized(ev) && (
                <div className="flex items-center gap-2 bg-green-950/40 border border-green-500/30 rounded-lg px-4 py-3 mb-4">
                  <CheckCircle2 className="w-5 h-5 text-green-400 shrink-0" />
                  <div>
                    <p className="text-green-400 font-semibold text-sm uppercase tracking-wide">Authorized Access</p>
                    <p className="text-green-300/70 text-xs">No prior failed attempts — legitimate login.</p>
                  </div>
                </div>
              )}

              {/* Status badges */}
              <div className="flex flex-wrap gap-2 mb-5">
                <SeverityBadge severity={ev.severity} />
                {isBreach(ev) ? (
                  <Badge className="uppercase text-[10px] bg-red-600 text-white border-0">BREACH</Badge>
                ) : (
                  <Badge variant="secondary" className="uppercase text-[10px] bg-muted text-muted-foreground">
                    {ev.status}
                  </Badge>
                )}
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
                <div className={`border rounded-lg p-4 mb-5 space-y-3 ${
                  isBreach(ev) || isAuthorized(ev)
                    ? "bg-slate-500/5 border-slate-500/20"
                    : "bg-yellow-500/5 border-yellow-500/20"
                }`}>
                  {/* Section label */}
                  <p className={`text-[10px] uppercase tracking-widest font-semibold ${
                    isBreach(ev) || isAuthorized(ev)
                      ? "text-slate-400/70"
                      : "text-yellow-500/70"
                  }`}>
                    {ev.toolUsed === "ssh" || ev.toolUsed === "apache"
                      ? "Auth Classification"
                      : "Matched Detection Rule"}
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
                    <div className={`pt-2 border-t ${
                      isBreach(ev) || isAuthorized(ev)
                        ? "border-slate-500/15"
                        : "border-yellow-500/15"
                    }`}>
                      <p className="text-[9px] uppercase text-muted-foreground tracking-widest mb-2">
                        {ev.toolUsed === "ssh"
                          ? "Raw auth.log Entry"
                          : ev.toolUsed === "apache"
                          ? "Raw access.log Entry"
                          : ev.toolUsed === "fail2ban"
                          ? "Jail Filter Config"
                          : "Full Rule Text"}
                      </p>
                      <pre className={`font-mono text-[11px] bg-black/30 rounded p-3 overflow-x-auto whitespace-pre-wrap break-all leading-relaxed border ${
                        isBreach(ev)
                          ? "text-red-300/90 border-red-500/10"
                          : isAuthorized(ev)
                          ? "text-green-300/90 border-green-500/10"
                          : "text-yellow-300/90 border-yellow-500/10"
                      }`}>
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

              {/* ── Defense Actions Triggered ── */}
              <DefenseActionsPanel eventId={ev.id} />
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
