import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Terminal, Globe, Database, Server, Shield, FolderOpen } from "lucide-react";
import { format } from "date-fns";
import { HostLabel } from "@/lib/host-utils";
import { useDeviceContext } from "@/lib/device-context";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

// ─── Types ─────────────────────────────────────────────────────────────────────

interface SshSession {
  id: number; sourceIp: string; username: string | null;
  status: string; authMethod: string | null; sessionId: string | null;
  failures: number; bannedBy: string | null;
  logSource: string | null; matchedRule: string | null;
  createdAt: string; endedAt: string | null;
}
interface HttpAttack {
  id: number; sourceIp: string; targetUrl: string; method: string;
  statusCode: number | null; attackType: string | null; payload: string | null;
  userAgent: string | null; ruleId: string | null; blocked: boolean;
  logSource: string | null; createdAt: string;
}
interface DbAttack {
  id: number; sourceIp: string; targetIp: string; port: number;
  attackType: string | null; username: string | null; query: string | null;
  severity: string; blocked: boolean;
  logSource: string | null; matchedRule: string | null; createdAt: string;
}
interface DnsAttack {
  id: number; sourceIp: string; targetIp: string;
  attackType: string | null; query: string | null; severity: string;
  logSource: string | null; matchedRule: string | null; createdAt: string;
}
interface LdapAttack {
  id: number; sourceIp: string; targetIp: string;
  dn: string | null; errorCode: number | null; attackType: string | null; severity: string;
  logSource: string | null; matchedRule: string | null; createdAt: string;
}
interface FtpSession {
  id: number; sourceIp: string; username: string | null;
  status: string; command: string | null; filename: string | null; filesize: number | null;
  failures: number; bannedBy: string | null;
  logSource: string | null; matchedRule: string | null; createdAt: string;
}

// ─── Fetch hooks ───────────────────────────────────────────────────────────────

function useSsh()        { return useQuery<SshSession[]>({ queryKey: ["conn-ssh"],  queryFn: () => fetch(`${BASE}/api/connections/ssh?limit=100`).then(r => r.json()),          refetchInterval: 15000 }); }
function useHttp()       { return useQuery<HttpAttack[]>({ queryKey: ["conn-http"], queryFn: () => fetch(`${BASE}/api/connections/http-attacks?limit=100`).then(r => r.json()), refetchInterval: 15000 }); }
function useDb()         { return useQuery<DbAttack[]>({   queryKey: ["conn-db"],   queryFn: () => fetch(`${BASE}/api/connections/db-attacks?limit=100`).then(r => r.json()),   refetchInterval: 15000 }); }
function useDns()        { return useQuery<DnsAttack[]>({  queryKey: ["conn-dns"],  queryFn: () => fetch(`${BASE}/api/connections/dns-attacks?limit=100`).then(r => r.json()),  refetchInterval: 15000 }); }
function useLdap()       { return useQuery<LdapAttack[]>({ queryKey: ["conn-ldap"], queryFn: () => fetch(`${BASE}/api/connections/ldap-attacks?limit=100`).then(r => r.json()), refetchInterval: 15000 }); }
function useFtp()        { return useQuery<FtpSession[]>({ queryKey: ["conn-ftp"],  queryFn: () => fetch(`${BASE}/api/connections/ftp?limit=100`).then(r => r.json()),           refetchInterval: 15000 }); }

// ─── Helpers ───────────────────────────────────────────────────────────────────

const sevColor: Record<string, string> = {
  critical: "border-red-500 text-red-400",
  high:     "border-orange-500 text-orange-400",
  medium:   "border-yellow-500 text-yellow-400",
  low:      "border-blue-500 text-blue-400",
  failed:   "border-orange-500 text-orange-400",
  success:  "border-green-500 text-green-400",
  blocked:  "border-red-500 text-red-400",
  active:   "border-cyan-500 text-cyan-400",
  stale:    "border-yellow-500 text-yellow-400",
  ended:    "border-gray-500 text-gray-400",
  upload:   "border-orange-500 text-orange-400",
  download: "border-yellow-500 text-yellow-400",
};

const attackColor: Record<string, string> = {
  SQLi:              "border-red-500 text-red-400",
  XSS:               "border-orange-500 text-orange-400",
  LFI:               "border-red-500 text-red-400",
  RFI:               "border-red-500 text-red-400",
  CSRF:              "border-yellow-500 text-yellow-400",
  Brute:             "border-orange-500 text-orange-400",
  "Auth Brute":      "border-orange-500 text-orange-400",
  "Enum":            "border-yellow-500 text-yellow-400",
  "Data Dump":       "border-red-500 text-red-400",
  "Privilege Esc":   "border-red-500 text-red-400",
  "Port Scan":       "border-yellow-500 text-yellow-400",
  "dns_zone_transfer":"border-red-500 text-red-400",
  "dns_query_refused":"border-yellow-500 text-yellow-400",
  "dns_amplification":"border-orange-500 text-orange-400",
  "dns_tunneling":   "border-orange-500 text-orange-400",
  "ldap_auth_failure":"border-orange-500 text-orange-400",
  "ldap_enum":       "border-yellow-500 text-yellow-400",
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
function LogBadge({ src }: { src: string | null }) {
  if (!src) return <span className="text-muted-foreground">—</span>;
  const short = src.split("/").pop() ?? src;
  return (
    <span className="font-mono text-[10px] text-purple-400/80 bg-purple-950/30 border border-purple-800/30 rounded px-1.5 py-0.5" title={src}>
      {short}
    </span>
  );
}
function RuleBadge({ rule }: { rule: string | null }) {
  if (!rule) return <span className="text-muted-foreground">—</span>;
  return (
    <span className="font-mono text-[10px] text-amber-400/80 max-w-[180px] truncate block" title={rule}>
      {rule}
    </span>
  );
}

type TabId = "ssh" | "http" | "db" | "dns" | "ldap" | "ftp";
const TABS: { id: TabId; label: string; icon: React.ReactNode; host: string }[] = [
  { id: "ssh",  label: "SSH Sessions",  icon: <Terminal  className="w-3.5 h-3.5" />, host: "All VMs · /var/log/auth.log" },
  { id: "http", label: "HTTP Attacks",  icon: <Globe     className="w-3.5 h-3.5" />, host: "company-web-server · modsec_audit.log" },
  { id: "db",   label: "DB Attacks",    icon: <Database  className="w-3.5 h-3.5" />, host: "company-customer-db (10.20.20.10:3306) · /var/log/mysql/error.log" },
  { id: "dns",  label: "DNS Attacks",   icon: <Server    className="w-3.5 h-3.5" />, host: "company-dns-server (10.10.10.20:53) · /var/log/named/named.log" },
  { id: "ldap", label: "LDAP Attacks",  icon: <Shield    className="w-3.5 h-3.5" />, host: "company-ldap-server (10.20.20.20:389) · /var/log/syslog (slapd)" },
  { id: "ftp",  label: "FTP Sessions",  icon: <FolderOpen className="w-3.5 h-3.5" />, host: "company-web-server (10.10.10.10:21) · /var/log/vsftpd.log" },
];

// ─── SSH Tab ───────────────────────────────────────────────────────────────────

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
          <TableHead>Log File</TableHead>
          <TableHead>Matched Rule</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {isLoading ? (
          <TableRow><TableCell colSpan={9} className="text-center py-8 text-muted-foreground">Loading SSH sessions…</TableCell></TableRow>
        ) : data.length === 0 ? (
          <TableRow><TableCell colSpan={9} className="text-center py-8 text-muted-foreground">
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
            <TableCell><LogBadge src={s.logSource} /></TableCell>
            <TableCell><RuleBadge rule={s.matchedRule} /></TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

// ─── HTTP Tab ──────────────────────────────────────────────────────────────────

function HttpTab({ selectedIp }: { selectedIp: string | null }) {
  const { data: raw = [], isLoading } = useHttp();
  const data = selectedIp ? raw.filter(a => a.sourceIp === selectedIp) : raw;
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
          <TableHead>Log File</TableHead>
          <TableHead>Blocked</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {isLoading ? (
          <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground">Loading HTTP attacks…</TableCell></TableRow>
        ) : data.length === 0 ? (
          <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
            {selectedIp ? `No HTTP attacks from ${selectedIp}.` : "No HTTP attacks recorded yet."}
          </TableCell></TableRow>
        ) : data.map(a => (
          <TableRow key={a.id} className={`border-border hover:bg-muted/10 ${a.blocked ? "bg-green-950/10" : ""}`}>
            <TableCell><Ts v={a.createdAt} /></TableCell>
            <TableCell><Ip v={a.sourceIp} /></TableCell>
            <TableCell>
              <Badge variant="outline" className="text-[10px] font-mono border-primary/30 text-primary/80">{a.method}</Badge>
            </TableCell>
            <TableCell className="font-mono text-xs text-muted-foreground max-w-[180px] truncate" title={a.targetUrl}>
              {a.targetUrl}
            </TableCell>
            <TableCell>
              {a.attackType
                ? <Badge variant="outline" className={`text-[10px] ${attackColor[a.attackType] ?? "border-yellow-500 text-yellow-400"}`}>{a.attackType}</Badge>
                : <span className="text-xs text-muted-foreground">—</span>}
            </TableCell>
            <TableCell className="font-mono text-xs text-amber-400/80">{a.ruleId ?? "—"}</TableCell>
            <TableCell><LogBadge src={a.logSource} /></TableCell>
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

// ─── DB Attacks Tab ────────────────────────────────────────────────────────────

function DbTab({ selectedIp }: { selectedIp: string | null }) {
  const { data: raw = [], isLoading } = useDb();
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
          <TableHead>Query / Error</TableHead>
          <TableHead>Log File</TableHead>
          <TableHead>Matched Rule</TableHead>
          <TableHead>Status</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {isLoading ? (
          <TableRow><TableCell colSpan={10} className="text-center py-8 text-muted-foreground">Loading DB attacks…</TableCell></TableRow>
        ) : data.length === 0 ? (
          <TableRow><TableCell colSpan={10} className="text-center py-8 text-muted-foreground">
            {selectedIp ? `No DB attacks from/to ${selectedIp}.` : "No DB attacks recorded yet."}
          </TableCell></TableRow>
        ) : data.map(a => (
          <TableRow key={a.id} className="border-border hover:bg-muted/10">
            <TableCell><Ts v={a.createdAt} /></TableCell>
            <TableCell><Ip v={a.sourceIp} /></TableCell>
            <TableCell><HostLabel ip={a.targetIp} /></TableCell>
            <TableCell className="font-mono text-xs text-muted-foreground">{a.port}</TableCell>
            <TableCell>
              {a.attackType
                ? <Badge variant="outline" className={`text-[10px] ${attackColor[a.attackType] ?? "border-orange-500 text-orange-400"}`}>{a.attackType}</Badge>
                : <span className="text-xs text-muted-foreground">—</span>}
            </TableCell>
            <TableCell className="font-mono text-xs text-muted-foreground">{a.username ?? "—"}</TableCell>
            <TableCell className="font-mono text-xs text-muted-foreground max-w-[150px] truncate" title={a.query ?? ""}>{a.query ?? "—"}</TableCell>
            <TableCell><LogBadge src={a.logSource} /></TableCell>
            <TableCell><RuleBadge rule={a.matchedRule} /></TableCell>
            <TableCell>
              {a.blocked
                ? <Badge variant="outline" className="text-[10px] border-green-500 text-green-400">BLOCKED</Badge>
                : <Badge variant="outline" className={`text-[10px] ${sevColor[a.severity] ?? "border-orange-500 text-orange-400"}`}>{a.severity.toUpperCase()}</Badge>}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

// ─── DNS Attacks Tab ───────────────────────────────────────────────────────────

function DnsTab({ selectedIp }: { selectedIp: string | null }) {
  const { data: raw = [], isLoading } = useDns();
  const data = selectedIp ? raw.filter(a => a.sourceIp === selectedIp) : raw;
  const typeLabel: Record<string, string> = {
    dns_zone_transfer: "Zone Transfer",
    dns_query_refused: "DNS Recon",
    dns_amplification: "Amplification",
    dns_tunneling:     "DNS Tunnel",
  };
  return (
    <Table>
      <TableHeader className="bg-muted/50 sticky top-0">
        <TableRow className="border-border">
          <TableHead>Time</TableHead>
          <TableHead>Source IP</TableHead>
          <TableHead>DNS Server</TableHead>
          <TableHead>Attack Type</TableHead>
          <TableHead>Query</TableHead>
          <TableHead>Severity</TableHead>
          <TableHead>Log File</TableHead>
          <TableHead>Matched Rule</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {isLoading ? (
          <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground">Loading DNS attacks…</TableCell></TableRow>
        ) : data.length === 0 ? (
          <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
            {selectedIp ? `No DNS attacks from ${selectedIp}.` : "No DNS attacks recorded yet."}
          </TableCell></TableRow>
        ) : data.map(a => (
          <TableRow key={a.id} className="border-border hover:bg-muted/10">
            <TableCell><Ts v={a.createdAt} /></TableCell>
            <TableCell><Ip v={a.sourceIp} /></TableCell>
            <TableCell><HostLabel ip={a.targetIp} /></TableCell>
            <TableCell>
              {a.attackType
                ? <Badge variant="outline" className={`text-[10px] ${attackColor[a.attackType] ?? "border-yellow-500 text-yellow-400"}`}>
                    {typeLabel[a.attackType] ?? a.attackType}
                  </Badge>
                : <span className="text-xs text-muted-foreground">—</span>}
            </TableCell>
            <TableCell className="font-mono text-xs text-muted-foreground max-w-[160px] truncate" title={a.query ?? ""}>{a.query ?? "—"}</TableCell>
            <TableCell>
              <Badge variant="outline" className={`text-[10px] uppercase ${sevColor[a.severity] ?? "border-border"}`}>{a.severity}</Badge>
            </TableCell>
            <TableCell><LogBadge src={a.logSource} /></TableCell>
            <TableCell><RuleBadge rule={a.matchedRule} /></TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

// ─── LDAP Attacks Tab ─────────────────────────────────────────────────────────

function LdapTab({ selectedIp }: { selectedIp: string | null }) {
  const { data: raw = [], isLoading } = useLdap();
  const data = selectedIp ? raw.filter(a => a.sourceIp === selectedIp) : raw;
  return (
    <Table>
      <TableHeader className="bg-muted/50 sticky top-0">
        <TableRow className="border-border">
          <TableHead>Time</TableHead>
          <TableHead>Source IP</TableHead>
          <TableHead>LDAP Server</TableHead>
          <TableHead>Attack Type</TableHead>
          <TableHead>Bind DN</TableHead>
          <TableHead>Error</TableHead>
          <TableHead>Severity</TableHead>
          <TableHead>Log File</TableHead>
          <TableHead>Matched Rule</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {isLoading ? (
          <TableRow><TableCell colSpan={9} className="text-center py-8 text-muted-foreground">Loading LDAP attacks…</TableCell></TableRow>
        ) : data.length === 0 ? (
          <TableRow><TableCell colSpan={9} className="text-center py-8 text-muted-foreground">
            {selectedIp ? `No LDAP attacks from ${selectedIp}.` : "No LDAP attacks recorded yet."}
          </TableCell></TableRow>
        ) : data.map(a => (
          <TableRow key={a.id} className="border-border hover:bg-muted/10">
            <TableCell><Ts v={a.createdAt} /></TableCell>
            <TableCell><Ip v={a.sourceIp} /></TableCell>
            <TableCell><HostLabel ip={a.targetIp} /></TableCell>
            <TableCell>
              {a.attackType
                ? <Badge variant="outline" className={`text-[10px] ${attackColor[a.attackType] ?? "border-orange-500 text-orange-400"}`}>{a.attackType}</Badge>
                : <span className="text-xs text-muted-foreground">—</span>}
            </TableCell>
            <TableCell className="font-mono text-xs text-muted-foreground max-w-[160px] truncate" title={a.dn ?? ""}>{a.dn ?? "—"}</TableCell>
            <TableCell className="font-mono text-xs">
              {a.errorCode != null
                ? <span className="text-red-400">err={a.errorCode}{a.errorCode === 49 ? " (Invalid credentials)" : a.errorCode === 32 ? " (No such object)" : ""}</span>
                : <span className="text-muted-foreground">—</span>}
            </TableCell>
            <TableCell>
              <Badge variant="outline" className={`text-[10px] uppercase ${sevColor[a.severity] ?? "border-border"}`}>{a.severity}</Badge>
            </TableCell>
            <TableCell><LogBadge src={a.logSource} /></TableCell>
            <TableCell><RuleBadge rule={a.matchedRule} /></TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

// ─── FTP Sessions Tab ─────────────────────────────────────────────────────────

function FtpTab({ selectedIp }: { selectedIp: string | null }) {
  const { data: raw = [], isLoading } = useFtp();
  const data = selectedIp ? raw.filter(s => s.sourceIp === selectedIp) : raw;
  return (
    <Table>
      <TableHeader className="bg-muted/50 sticky top-0">
        <TableRow className="border-border">
          <TableHead>Time</TableHead>
          <TableHead>Source IP</TableHead>
          <TableHead>Username</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Command</TableHead>
          <TableHead>File</TableHead>
          <TableHead className="text-right">Failures</TableHead>
          <TableHead>Banned By</TableHead>
          <TableHead>Log File</TableHead>
          <TableHead>Matched Rule</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {isLoading ? (
          <TableRow><TableCell colSpan={10} className="text-center py-8 text-muted-foreground">Loading FTP sessions…</TableCell></TableRow>
        ) : data.length === 0 ? (
          <TableRow><TableCell colSpan={10} className="text-center py-8 text-muted-foreground">
            {selectedIp ? `No FTP sessions from ${selectedIp}.` : "No FTP sessions recorded yet."}
          </TableCell></TableRow>
        ) : data.map(s => (
          <TableRow key={s.id} className="border-border hover:bg-muted/10">
            <TableCell><Ts v={s.createdAt} /></TableCell>
            <TableCell><Ip v={s.sourceIp} /></TableCell>
            <TableCell className="font-mono text-xs text-foreground">{s.username ?? "—"}</TableCell>
            <TableCell>
              <Badge variant="outline" className={`text-[10px] uppercase ${sevColor[s.status] ?? "border-border text-muted-foreground"}`}>{s.status}</Badge>
            </TableCell>
            <TableCell>
              {s.command
                ? <Badge variant="outline" className="text-[10px] font-mono border-primary/30 text-primary/80">{s.command}</Badge>
                : <span className="text-muted-foreground">—</span>}
            </TableCell>
            <TableCell className="font-mono text-xs text-muted-foreground max-w-[140px] truncate" title={s.filename ?? ""}>
              {s.filename
                ? <>{s.filename.split("/").pop()}{s.filesize != null ? <span className="text-muted-foreground/60 ml-1">({Math.round(s.filesize / 1024)}KB)</span> : null}</>
                : "—"}
            </TableCell>
            <TableCell className="text-right font-mono text-xs">
              <span className={s.failures > 0 ? "text-orange-400" : "text-muted-foreground"}>{s.failures}</span>
            </TableCell>
            <TableCell className="text-xs">
              {s.bannedBy
                ? <Badge variant="outline" className="text-[10px] border-red-500/50 text-red-400">{s.bannedBy}</Badge>
                : <span className="text-muted-foreground">—</span>}
            </TableCell>
            <TableCell><LogBadge src={s.logSource} /></TableCell>
            <TableCell><RuleBadge rule={s.matchedRule} /></TableCell>
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
  const activeTab = TABS.find(t => t.id === tab)!;

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
      <div className="flex gap-1 border border-border rounded-lg p-1 bg-card w-fit flex-wrap">
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-mono transition-colors ${
              tab === t.id ? "bg-primary/20 text-primary" : "text-muted-foreground hover:text-foreground hover:bg-muted/20"
            }`}
          >
            {t.icon}{t.label}
          </button>
        ))}
      </div>

      {/* Active tab source hint */}
      <p className="text-[10px] font-mono text-purple-400/60 -mt-4">
        📂 {activeTab.host}
      </p>

      {/* Table */}
      <Card className="bg-card border-border flex-1 overflow-hidden">
        <div className="overflow-auto h-full">
          {tab === "ssh"  && <SshTab  selectedIp={selectedIp} />}
          {tab === "http" && <HttpTab selectedIp={selectedIp} />}
          {tab === "db"   && <DbTab   selectedIp={selectedIp} />}
          {tab === "dns"  && <DnsTab  selectedIp={selectedIp} />}
          {tab === "ldap" && <LdapTab selectedIp={selectedIp} />}
          {tab === "ftp"  && <FtpTab  selectedIp={selectedIp} />}
        </div>
      </Card>
    </div>
  );
}
