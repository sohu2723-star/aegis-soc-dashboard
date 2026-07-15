import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { RefreshCcw, Terminal, FolderOpen, Lock, Globe } from "lucide-react";
import { format } from "date-fns";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

// ─── Types ─────────────────────────────────────────────────────────────────────

interface SshSession {
  id: number; sourceIp: string; username: string | null;
  status: string; authMethod: string | null; sessionId: string | null;
  failures: number; bannedBy: string | null; createdAt: string; endedAt: string | null;
}
interface FtpSession {
  id: number; sourceIp: string; username: string | null;
  command: string | null; filePath: string | null; fileSize: number | null;
  status: string; createdAt: string;
}
interface TlsRecord {
  id: number; sourceIp: string; destIp: string; destPort: number | null;
  tlsVersion: string | null; cipherSuite: string | null; sni: string | null;
  certIssuer: string | null; isSuspicious: boolean; reason: string | null; createdAt: string;
}
interface HttpAttack {
  id: number; sourceIp: string; targetUrl: string; method: string;
  statusCode: number | null; attackType: string | null; payload: string | null;
  userAgent: string | null; ruleId: string | null; blocked: boolean; createdAt: string;
}

// ─── Fetch hooks ───────────────────────────────────────────────────────────────

function useSsh()        { return useQuery<SshSession[]>({ queryKey: ["conn-ssh"],  queryFn: () => fetch(`${BASE}/api/connections/ssh?limit=100`).then(r => r.json()),  refetchInterval: 15000 }); }
function useFtp()        { return useQuery<FtpSession[]>({ queryKey: ["conn-ftp"],  queryFn: () => fetch(`${BASE}/api/connections/ftp?limit=100`).then(r => r.json()),  refetchInterval: 15000 }); }
function useTls()        { return useQuery<TlsRecord[]>({ queryKey: ["conn-tls"],   queryFn: () => fetch(`${BASE}/api/connections/tls?limit=100`).then(r => r.json()),  refetchInterval: 15000 }); }
function useTlsSusp()    { return useQuery<TlsRecord[]>({ queryKey: ["conn-tls-s"], queryFn: () => fetch(`${BASE}/api/connections/tls/suspicious`).then(r => r.json()), refetchInterval: 15000 }); }
function useHttpAttacks(){ return useQuery<HttpAttack[]>({ queryKey: ["conn-http"], queryFn: () => fetch(`${BASE}/api/connections/http-attacks?limit=100`).then(r => r.json()), refetchInterval: 15000 }); }

// ─── Helpers ───────────────────────────────────────────────────────────────────

const sevColor: Record<string, string> = {
  critical: "border-red-500 text-red-400",
  high:     "border-orange-500 text-orange-400",
  failed:   "border-orange-500 text-orange-400",
  success:  "border-green-500 text-green-400",
  blocked:  "border-red-500 text-red-400",
};

function Ts({ v }: { v: string }) {
  return <span className="font-mono text-xs text-muted-foreground whitespace-nowrap">{format(new Date(v), "MM/dd HH:mm:ss")}</span>;
}
function Ip({ v }: { v: string }) {
  return <span className="font-mono text-xs text-cyan-400">{v}</span>;
}

type TabId = "ssh" | "ftp" | "tls" | "http";
const TABS: { id: TabId; label: string; icon: React.ReactNode }[] = [
  { id: "ssh",  label: "SSH Sessions",  icon: <Terminal className="w-3.5 h-3.5" /> },
  { id: "ftp",  label: "FTP Sessions",  icon: <FolderOpen className="w-3.5 h-3.5" /> },
  { id: "tls",  label: "TLS Traffic",   icon: <Lock className="w-3.5 h-3.5" /> },
  { id: "http", label: "HTTP Attacks",  icon: <Globe className="w-3.5 h-3.5" /> },
];

// ─── Tab content ───────────────────────────────────────────────────────────────

function SshTab() {
  const { data = [], isLoading } = useSsh();
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
          <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">No SSH sessions recorded yet.</TableCell></TableRow>
        ) : data.map(s => (
          <TableRow key={s.id} className="border-border hover:bg-muted/10">
            <TableCell><Ts v={s.createdAt} /></TableCell>
            <TableCell><Ip v={s.sourceIp} /></TableCell>
            <TableCell className="font-mono text-xs text-foreground">{s.username ?? "—"}</TableCell>
            <TableCell>
              <Badge variant="outline" className={`text-[10px] uppercase ${sevColor[s.status] ?? "border-border text-muted-foreground"}`}>
                {s.status}
              </Badge>
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

function FtpTab() {
  const { data = [], isLoading } = useFtp();
  const suspiciousExts = [".conf",".key",".pem",".shadow",".passwd",".env",".sql",".id_rsa"];
  return (
    <Table>
      <TableHeader className="bg-muted/50 sticky top-0">
        <TableRow className="border-border">
          <TableHead>Time</TableHead>
          <TableHead>Source IP</TableHead>
          <TableHead>Username</TableHead>
          <TableHead>Command</TableHead>
          <TableHead>File Path</TableHead>
          <TableHead className="text-right">Size</TableHead>
          <TableHead>Status</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {isLoading ? (
          <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">Loading FTP sessions…</TableCell></TableRow>
        ) : data.length === 0 ? (
          <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">No FTP sessions recorded yet.</TableCell></TableRow>
        ) : data.map(s => {
          const isSuspiciousFile = s.filePath && suspiciousExts.some(e => s.filePath!.toLowerCase().endsWith(e));
          return (
            <TableRow key={s.id} className={`border-border hover:bg-muted/10 ${isSuspiciousFile ? "bg-red-950/20" : ""}`}>
              <TableCell><Ts v={s.createdAt} /></TableCell>
              <TableCell><Ip v={s.sourceIp} /></TableCell>
              <TableCell className="font-mono text-xs text-foreground">{s.username ?? "—"}</TableCell>
              <TableCell>
                <Badge variant="outline" className="text-[10px] font-mono border-primary/30 text-primary/80">{s.command ?? "—"}</Badge>
              </TableCell>
              <TableCell className={`font-mono text-xs max-w-[200px] truncate ${isSuspiciousFile ? "text-red-400" : "text-muted-foreground"}`}>
                {s.filePath ?? "—"}
                {isSuspiciousFile && <span className="ml-1 text-[9px] bg-red-900/40 text-red-300 px-1 rounded">sensitive</span>}
              </TableCell>
              <TableCell className="text-right font-mono text-xs text-muted-foreground">
                {s.fileSize ? `${(s.fileSize / 1024).toFixed(1)} KB` : "—"}
              </TableCell>
              <TableCell>
                <Badge variant="outline" className={`text-[10px] uppercase ${sevColor[s.status] ?? "border-border text-muted-foreground"}`}>
                  {s.status}
                </Badge>
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

function TlsTab() {
  const [suspOnly, setSuspOnly] = useState(false);
  const { data: all = [], isLoading: loadAll }   = useTls();
  const { data: susp = [], isLoading: loadSusp } = useTlsSusp();
  const data = suspOnly ? susp : all;
  const isLoading = suspOnly ? loadSusp : loadAll;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 px-4 pt-3">
        <Switch id="susp-only" checked={suspOnly} onCheckedChange={setSuspOnly} />
        <Label htmlFor="susp-only" className="text-xs text-muted-foreground cursor-pointer">
          Suspicious only {susp.length > 0 && <span className="ml-1 text-red-400 font-bold">({susp.length})</span>}
        </Label>
      </div>
      <Table>
        <TableHeader className="bg-muted/50 sticky top-0">
          <TableRow className="border-border">
            <TableHead>Time</TableHead>
            <TableHead>Source IP</TableHead>
            <TableHead>Dest IP</TableHead>
            <TableHead>Port</TableHead>
            <TableHead>TLS Version</TableHead>
            <TableHead>SNI</TableHead>
            <TableHead>Cert Issuer</TableHead>
            <TableHead>Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {isLoading ? (
            <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground">Loading TLS records…</TableCell></TableRow>
          ) : data.length === 0 ? (
            <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
              {suspOnly ? "No suspicious TLS traffic detected." : "No TLS records yet."}
            </TableCell></TableRow>
          ) : data.map(r => (
            <TableRow key={r.id} className={`border-border hover:bg-muted/10 ${r.isSuspicious ? "bg-orange-950/20" : ""}`}>
              <TableCell><Ts v={r.createdAt} /></TableCell>
              <TableCell><Ip v={r.sourceIp} /></TableCell>
              <TableCell><Ip v={r.destIp} /></TableCell>
              <TableCell className="font-mono text-xs text-muted-foreground">{r.destPort ?? "—"}</TableCell>
              <TableCell>
                <Badge variant="outline" className={`text-[10px] font-mono ${
                  r.tlsVersion === "SSLv3" || r.tlsVersion === "TLSv1"
                    ? "border-red-500 text-red-400"
                    : "border-green-500/50 text-green-400"
                }`}>
                  {r.tlsVersion ?? "unknown"}
                </Badge>
              </TableCell>
              <TableCell className="font-mono text-xs text-muted-foreground max-w-[140px] truncate">{r.sni ?? "—"}</TableCell>
              <TableCell className="text-xs text-muted-foreground max-w-[120px] truncate">{r.certIssuer ?? "self-signed"}</TableCell>
              <TableCell>
                {r.isSuspicious
                  ? <Badge variant="outline" className="text-[10px] border-red-500 text-red-400">⚠ {r.reason ?? "suspicious"}</Badge>
                  : <Badge variant="outline" className="text-[10px] border-green-500/50 text-green-400">OK</Badge>}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function HttpTab() {
  const { data = [], isLoading } = useHttpAttacks();
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
          <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">No HTTP attacks recorded yet.</TableCell></TableRow>
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

// ─── Page ──────────────────────────────────────────────────────────────────────

export default function Connections() {
  const [tab, setTab] = useState<TabId>("ssh");
  const qc = useQueryClient();

  function handleRefresh() {
    qc.invalidateQueries({ queryKey: ["conn-ssh"] });
    qc.invalidateQueries({ queryKey: ["conn-ftp"] });
    qc.invalidateQueries({ queryKey: ["conn-tls"] });
    qc.invalidateQueries({ queryKey: ["conn-tls-s"] });
    qc.invalidateQueries({ queryKey: ["conn-http"] });
  }

  return (
    <div className="space-y-6 h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-primary uppercase">Connection Logs</h1>
          <p className="text-sm text-muted-foreground">Detailed protocol-level session data from all sensors.</p>
        </div>
        <Button variant="outline" size="sm" onClick={handleRefresh} className="border-border">
          <RefreshCcw className="w-4 h-4 mr-2" /> Refresh
        </Button>
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
          {tab === "ssh"  && <SshTab />}
          {tab === "ftp"  && <FtpTab />}
          {tab === "tls"  && <TlsTab />}
          {tab === "http" && <HttpTab />}
        </div>
      </Card>
    </div>
  );
}
