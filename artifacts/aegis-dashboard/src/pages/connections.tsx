import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Terminal, Globe, Database } from "lucide-react";
import { format } from "date-fns";
import { HostLabel } from "@/lib/host-utils";
import { useDeviceContext } from "@/lib/device-context";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

// ─── Types ─────────────────────────────────────────────────────────────────────

interface SshSession {
  id: number; sourceIp: string; username: string | null;
  status: string; authMethod: string | null; sessionId: string | null;
  failures: number; bannedBy: string | null; createdAt: string; endedAt: string | null;
}
interface HttpAttack {
  id: number; sourceIp: string; targetUrl: string; method: string;
  statusCode: number | null; attackType: string | null; payload: string | null;
  userAgent: string | null; ruleId: string | null; blocked: boolean; createdAt: string;
}

// ─── Fetch hooks ───────────────────────────────────────────────────────────────

function useSsh()         { return useQuery<SshSession[]>({ queryKey: ["conn-ssh"],  queryFn: () => fetch(`${BASE}/api/connections/ssh?limit=100`).then(r => r.json()),  refetchInterval: 15000 }); }
function useHttpAttacks() { return useQuery<HttpAttack[]>({ queryKey: ["conn-http"], queryFn: () => fetch(`${BASE}/api/connections/http-attacks?limit=100`).then(r => r.json()), refetchInterval: 15000 }); }

// ─── Helpers ───────────────────────────────────────────────────────────────────

const sevColor: Record<string, string> = {
  critical: "border-red-500 text-red-400",
  high:     "border-orange-500 text-orange-400",
  failed:   "border-orange-500 text-orange-400",
  success:  "border-green-500 text-green-400",
  blocked:  "border-red-500 text-red-400",
  active:   "border-cyan-500 text-cyan-400",
  stale:    "border-yellow-500 text-yellow-400",
  ended:    "border-gray-500 text-gray-400",
};

function effectiveSshStatus(s: SshSession): string {
  if (s.status !== "active") return s.status;
  if (s.endedAt) return "ended";
  const ageMs = Date.now() - new Date(s.createdAt).getTime();
  return ageMs > 10 * 60 * 1000 ? "stale" : "active";
}

function Ts({ v }: { v: string }) {
  return <span className="font-mono text-xs text-muted-foreground whitespace-nowrap">{format(new Date(v), "MM/dd HH:mm:ss")}</span>;
}
function Ip({ v }: { v: string }) {
  return <span className="font-mono text-xs text-cyan-400">{v}</span>;
}

type TabId = "ssh" | "http" | "db";
const TABS: { id: TabId; label: string; icon: React.ReactNode }[] = [
  { id: "ssh",  label: "SSH Sessions",  icon: <Terminal className="w-3.5 h-3.5" /> },
  { id: "http", label: "HTTP Attacks",  icon: <Globe className="w-3.5 h-3.5" /> },
  { id: "db",   label: "DB Attacks",    icon: <Database className="w-3.5 h-3.5" /> },
];

// ─── Tab content ───────────────────────────────────────────────────────────────

function SshTab({ selectedIp }: { selectedIp: string | null }) {
  const { data: raw = [], isLoading } = useSsh();
  const data = selectedIp ? raw.filter(s => s.sourceIp === selectedIp) : raw;
  return (
    <Table>
      <TableHeader className="bg-muted/50 sticky top-0">
        <TableRow className="border-border">
          <TableHead>Time</TableHead>
          <TableHead>Source IP</TableHead>
          <TableHead>Username</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Auth Method</TableHead>
          <TableHead className="text-right">Failures</TableHead>
          <TableHead>Banned By</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {isLoading ? (
          <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">Loading SSH sessions…</TableCell></TableRow>
        ) : data.length === 0 ? (
          <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
            {selectedIp ? `No SSH sessions from ${selectedIp}.` : "No SSH sessions recorded yet."}
          </TableCell></TableRow>
        ) : data.map(s => (
          <TableRow key={s.id} className="border-border hover:bg-muted/10">
            <TableCell><Ts v={s.createdAt} /></TableCell>
            <TableCell><Ip v={s.sourceIp} /></TableCell>
            <TableCell className="font-mono text-xs text-foreground">{s.username ?? "—"}</TableCell>
            <TableCell>
              {(() => {
                const eff = effectiveSshStatus(s);
                return (
                  <div className="flex items-center gap-1">
                    <Badge variant="outline" className={`text-[10px] uppercase ${sevColor[eff] ?? "border-border text-muted-foreground"}`}>
                      {eff}
                    </Badge>
                    {eff === "stale" && (
                      <span className="text-[9px] text-yellow-500/70 font-mono">no heartbeat</span>
                    )}
                  </div>
                );
              })()}
            </TableCell>
            <TableCell className="text-xs text-muted-foreground">{s.authMethod ?? "—"}</TableCell>
            <TableCell className="text-right font-mono text-xs">
              <span className={s.failures > 0 ? "text-orange-400" : "text-muted-foreground"}>{s.failures}</span>
            </TableCell>
            <TableCell className="text-xs">
              {s.bannedBy
                ? <Badge variant="outline" className="text-[10px] border-red-500/50 text-red-400">{s.bannedBy}</Badge>
                : <span className="text-muted-foreground">—</span>}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function HttpTab({ selectedIp }: { selectedIp: string | null }) {
  const { data: raw = [], isLoading } = useHttpAttacks();
  const data = selectedIp ? raw.filter(a => a.sourceIp === selectedIp) : raw;
  const sevMap: Record<string, string> = {
    SQLi:"border-red-500 text-red-400", XSS:"border-orange-500 text-orange-400",
    LFI:"border-red-500 text-red-400", RFI:"border-red-500 text-red-400",
    CSRF:"border-yellow-500 text-yellow-400", Brute:"border-orange-500 text-orange-400",
  };
  return (
    <Table>
      <TableHeader className="bg-muted/50 sticky top-0">
        <TableRow className="border-border">
          <TableHead>Time</TableHead>
          <TableHead>Source IP</TableHead>
          <TableHead>Method</TableHead>
          <TableHead>URL</TableHead>
          <TableHead>Attack Type</TableHead>
          <TableHead>Rule ID</TableHead>
          <TableHead>Blocked</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {isLoading ? (
          <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">Loading HTTP attacks…</TableCell></TableRow>
        ) : data.length === 0 ? (
          <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
            {selectedIp ? `No HTTP attacks from ${selectedIp}.` : "No HTTP attacks recorded yet."}
          </TableCell></TableRow>
        ) : data.map(a => (
          <TableRow key={a.id} className={`border-border hover:bg-muted/10 ${a.blocked ? "bg-green-950/10" : ""}`}>
            <TableCell><Ts v={a.createdAt} /></TableCell>
            <TableCell><Ip v={a.sourceIp} /></TableCell>
            <TableCell>
              <Badge variant="outline" className="text-[10px] font-mono border-primary/30 text-primary/80">{a.method}</Badge>
            </TableCell>
            <TableCell className="font-mono text-xs text-muted-foreground max-w-[200px] truncate" title={a.targetUrl}>
              {a.targetUrl}
            </TableCell>
            <TableCell>
              {a.attackType
                ? <Badge variant="outline" className={`text-[10px] ${sevMap[a.attackType] ?? "border-yellow-500 text-yellow-400"}`}>{a.attackType}</Badge>
                : <span className="text-xs text-muted-foreground">—</span>}
            </TableCell>
            <TableCell className="font-mono text-xs text-muted-foreground">{a.ruleId ?? "—"}</TableCell>
            <TableCell>
              {a.blocked
                ? <Badge variant="outline" className="text-[10px] border-green-500 text-green-400">BLOCKED</Badge>
                : <Badge variant="outline" className="text-[10px] border-orange-500 text-orange-400">DETECTED</Badge>}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

// DB attack types relevant to this lab (company-customer-db PostgreSQL on 10.20.20.20)
interface DbAttack {
  id: number; sourceIp: string; targetIp: string; port: number | null;
  attackType: string | null; query: string | null; username: string | null;
  blocked: boolean; severity: string | null; createdAt: string;
}

function useDbAttacks() {
  return useQuery<DbAttack[]>({
    queryKey: ["conn-db"],
    queryFn: () => fetch(`${BASE}/api/connections/db-attacks?limit=100`).then(r => r.json()).catch(() => []),
    refetchInterval: 15000,
  });
}

// DB attack type colour map — relevant to PostgreSQL / company system
const dbSevMap: Record<string, string> = {
  "SQLi":          "border-red-500 text-red-400",
  "Auth Brute":    "border-orange-500 text-orange-400",
  "Enum":          "border-yellow-500 text-yellow-400",
  "Data Dump":     "border-red-500 text-red-400",
  "Privilege Esc": "border-red-500 text-red-400",
  "Port Scan":     "border-yellow-500 text-yellow-400",
};

function DbTab({ selectedIp }: { selectedIp: string | null }) {
  const { data: raw = [], isLoading } = useDbAttacks();
  const data = selectedIp ? raw.filter(a => a.sourceIp === selectedIp || a.targetIp === selectedIp) : raw;

  return (
    <Table>
      <TableHeader className="bg-muted/50 sticky top-0">
        <TableRow className="border-border">
          <TableHead>Time</TableHead>
          <TableHead>Source IP</TableHead>
          <TableHead>Target</TableHead>
          <TableHead>Port</TableHead>
          <TableHead>Attack Type</TableHead>
          <TableHead>Username</TableHead>
          <TableHead>Query / Payload</TableHead>
          <TableHead>Status</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {isLoading ? (
          <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground">Loading DB attacks…</TableCell></TableRow>
        ) : data.length === 0 ? (
          <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
            {selectedIp ? `No DB attacks from/to ${selectedIp}.` : "No DB attacks recorded yet."}
          </TableCell></TableRow>
        ) : data.map(a => (
          <TableRow key={a.id} className={`border-border hover:bg-muted/10 ${a.blocked ? "bg-green-950/10" : "bg-red-950/10"}`}>
            <TableCell><Ts v={a.createdAt} /></TableCell>
            <TableCell><Ip v={a.sourceIp} /></TableCell>
            <TableCell><HostLabel ip={a.targetIp} /></TableCell>
            <TableCell className="font-mono text-xs text-muted-foreground">{a.port ?? 5432}</TableCell>
            <TableCell>
              {a.attackType
                ? <Badge variant="outline" className={`text-[10px] ${dbSevMap[a.attackType] ?? "border-yellow-500 text-yellow-400"}`}>{a.attackType}</Badge>
                : <span className="text-xs text-muted-foreground">—</span>}
            </TableCell>
            <TableCell className="font-mono text-xs text-muted-foreground">{a.username ?? "—"}</TableCell>
            <TableCell className="font-mono text-xs text-muted-foreground max-w-[200px] truncate" title={a.query ?? ""}>
              {a.query ?? "—"}
            </TableCell>
            <TableCell>
              {a.blocked
                ? <Badge variant="outline" className="text-[10px] border-green-500 text-green-400">BLOCKED</Badge>
                : <Badge variant="outline" className="text-[10px] border-red-500 text-red-400">DETECTED</Badge>}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

// ─── Page ──────────────────────────────────────────────────────────────────────

export default function Connections() {
  const [tab, setTab] = useState<TabId>("ssh");

  const { selectedIp, selectedDevice } = useDeviceContext();

  return (
    <div className="space-y-6 h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-primary uppercase">Connection Logs</h1>
          {selectedDevice ? (
            <p className="text-xs text-cyan-400 font-mono mt-0.5">
              Scoped to: {selectedDevice.hostname} ({selectedDevice.ip})
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">Detailed protocol-level session data from all sensors.</p>
          )}
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground font-mono">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-primary" />
          </span>
          Live · auto-refreshes every 15s
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border border-border rounded-lg p-1 bg-card w-fit">
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex items-center gap-1.5 px-4 py-1.5 rounded text-xs font-mono transition-colors ${
              tab === t.id ? "bg-primary/20 text-primary" : "text-muted-foreground hover:text-foreground hover:bg-muted/20"
            }`}
          >
            {t.icon}{t.label}
          </button>
        ))}
      </div>

      {/* Table */}
      <Card className="bg-card border-border flex-1 overflow-hidden">
        <div className="overflow-auto h-full">
          {tab === "ssh"  && <SshTab  selectedIp={selectedIp} />}
          {tab === "http" && <HttpTab selectedIp={selectedIp} />}
          {tab === "db"   && <DbTab   selectedIp={selectedIp} />}
        </div>
      </Card>
    </div>
  );
}
