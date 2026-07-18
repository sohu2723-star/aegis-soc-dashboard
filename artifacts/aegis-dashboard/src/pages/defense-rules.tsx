import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/auth-context";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Trash2, Plus, Download, Flame, Terminal, BookOpen, Shield } from "lucide-react";
import { format } from "date-fns";
import { HostLabel } from "@/lib/host-utils";
import { useToast } from "@/hooks/use-toast";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

// ─── Types ─────────────────────────────────────────────────────────────────────

interface DefenseRule {
  id: number; name: string; description: string | null;
  triggerAttackType: string; triggerSeverity: string;
  triggerThreshold: number; triggerWindowSecs: number;
  actionType: string; defenseType: string;
  actionParams: string | null; targetVm: string;
  priority: number; isActive: boolean; createdAt: string;
}

interface FirewallRule {
  id: number; chain: string; action: string;
  protocol: string | null; sourceIp: string | null; destIp: string | null;
  sourcePort: string | null; destPort: string | null; iface: string | null;
  ruleText: string; isActive: boolean; createdBy: string; appliedAt: string;
}

interface DefenseCommand {
  id: number; commandType: string; commandText: string;
  targetIp: string | null; targetVm: string;
  status: string; errorMsg: string | null;
  createdAt: string; executedAt: string | null;
}

interface HotIp { ip: string; count: number; }

// ─── Fetch hooks ───────────────────────────────────────────────────────────────

function useRules()     { return useQuery<DefenseRule[]>({ queryKey: ["ui-rules"],    queryFn: () => fetch(`${BASE}/api/ui/defense/rules`).then(r => r.json()),            refetchInterval: 15000 }); }
function useFwRules()   { return useQuery<FirewallRule[]>({ queryKey: ["ui-fw"],      queryFn: () => fetch(`${BASE}/api/ui/firewall/rules`).then(r => r.json()),           refetchInterval: 15000 }); }
function useCmdHist()   { return useQuery<DefenseCommand[]>({ queryKey: ["ui-cmds"], queryFn: () => fetch(`${BASE}/api/ui/defense/commands/history`).then(r => r.json()), refetchInterval: 10000 }); }
function useHotIps()    { return useQuery<HotIp[]>({ queryKey: ["ui-hotips"],         queryFn: () => fetch(`${BASE}/api/ui/defense/hot-ips`).then(r => r.json()),          refetchInterval: 10000 }); }

// ─── Helpers ───────────────────────────────────────────────────────────────────

function Ts({ v }: { v: string }) {
  return <span className="font-mono text-xs text-muted-foreground whitespace-nowrap">{format(new Date(v), "MM/dd HH:mm:ss")}</span>;
}

// ─── VM name badge ─────────────────────────────────────────────────────────────
const VM_META: Record<string, { label: string; ip?: string; color: string }> = {
  "bank-web":    { label: "bank-web",    ip: "10.10.10.10",  color: "border-cyan-500/50 text-cyan-300" },
  "customer-db": { label: "customer-db", ip: "10.20.20.20",  color: "border-purple-500/50 text-purple-300" },
  "aegis":       { label: "aegis",       ip: "10.30.30.10",  color: "border-green-500/50 text-green-300" },
  "pfsense":     { label: "pfSense",                         color: "border-orange-500/50 text-orange-300" },
  "all":         { label: "all VMs",                         color: "border-yellow-500/50 text-yellow-300" },
};

function VmBadge({ vm }: { vm: string }) {
  const meta = VM_META[vm];
  if (!meta) return <span className="font-mono text-xs text-muted-foreground">{vm}</span>;
  return (
    <div className="flex flex-col gap-0.5">
      <Badge variant="outline" className={`text-[10px] font-mono w-fit ${meta.color}`}>{meta.label}</Badge>
      {meta.ip && <span className="text-[9px] text-muted-foreground font-mono">{meta.ip}</span>}
    </div>
  );
}

const defenseTypeLabels: Record<string, string> = {
  block_ip: "Block IP", null_route: "Null Route", rate_limit: "Rate Limit",
  port_block: "Port Block", dns_block: "DNS Block", waf_rule: "WAF Rule",
  pfsense_block: "pfSense SSH Block", pfsense_port_block: "pfSense SSH Port Block", alert_only: "Alert Only",
};

const statusColors: Record<string, string> = {
  executed: "border-green-500 text-green-400", failed: "border-red-500 text-red-400",
  sent:     "border-yellow-500 text-yellow-400", pending: "border-blue-500 text-blue-400",
};

type TabId = "rules" | "firewall" | "history";
const TABS: { id: TabId; label: string; icon: React.ReactNode }[] = [
  { id: "rules",    label: "Auto-Defense Rules", icon: <Shield className="w-3.5 h-3.5" /> },
  { id: "firewall", label: "Firewall Rules",     icon: <Terminal className="w-3.5 h-3.5" /> },
  { id: "history",  label: "Command History",    icon: <BookOpen className="w-3.5 h-3.5" /> },
];

// ─── Auto-Defense Rules Tab ────────────────────────────────────────────────────

function RulesTab() {
  const { data: rules = [], isLoading } = useRules();
  const { data: hotIps = [] } = useHotIps();
  const qc = useQueryClient();
  const { toast } = useToast();
  const { getToken } = useAuth();
  const [createOpen, setCreateOpen] = useState(false);

  // Create form state
  const [name, setName]                         = useState("");
  const [description, setDescription]           = useState("");
  const [triggerAttackType, setTriggerAttack]   = useState("any");
  const [triggerSeverity, setTriggerSeverity]   = useState("any");
  const [triggerThreshold, setTriggerThreshold] = useState(3);
  const [triggerWindow, setTriggerWindow]       = useState(60);
  const [actionType, setActionType]             = useState("auto");
  const [defenseType, setDefenseType]           = useState("block_ip");
  const [targetVm, setTargetVm]                 = useState("bank-web");
  const [priority, setPriority]                 = useState(100);

  const authHeaders = () => {
    const tok = getToken();
    return tok ? { "Content-Type": "application/json", "Authorization": `Bearer ${tok}` }
               : { "Content-Type": "application/json" };
  };

  const toggleMutation = useMutation({
    mutationFn: ({ id, isActive }: { id: number; isActive: boolean }) =>
      fetch(`${BASE}/api/ui/defense/rules/${id}`, {
        method: "PATCH",
        headers: authHeaders(),
        body: JSON.stringify({ isActive }),
      }).then(r => r.json()),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["ui-rules"] }),
    onError: () => toast({ title: "Update Failed", variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) =>
      fetch(`${BASE}/api/ui/defense/rules/${id}`, {
        method: "DELETE",
        headers: authHeaders(),
      }).then(r => r.json()),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ui-rules"] });
      toast({ title: "Rule Deleted" });
    },
    onError: () => toast({ title: "Delete Failed", variant: "destructive" }),
  });

  const createMutation = useMutation({
    mutationFn: (data: object) =>
      fetch(`${BASE}/api/ui/defense/rules`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify(data),
      }).then(async r => { if (!r.ok) throw new Error(await r.text()); return r.json(); }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ui-rules"] });
      setCreateOpen(false);
      setName(""); setDescription("");
      toast({ title: "Rule Created", description: "Auto-defense rule added." });
    },
    onError: (e: Error) => toast({ title: "Create Failed", description: e.message, variant: "destructive" }),
  });

  function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    createMutation.mutate({ name, description, triggerAttackType, triggerSeverity,
      triggerThreshold, triggerWindowSecs: triggerWindow, actionType, defenseType, targetVm, priority });
  }

  return (
    <div className="space-y-6 p-4">
      {/* Hot IPs widget */}
      {hotIps.length > 0 && (
        <Card className="bg-red-950/20 border-red-500/30">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2 text-red-400">
              <Flame className="w-4 h-4" /> Hot Attackers (In-Memory, Current Session)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {hotIps.map(h => (
                <div key={h.ip} className="flex items-center gap-2 bg-red-900/30 border border-red-500/30 rounded px-3 py-1.5">
                  <span className="font-mono text-xs text-red-300">{h.ip}</span>
                  <span className="text-[10px] bg-red-500/20 text-red-300 px-1.5 rounded font-bold">{h.count} hits</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Header row */}
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          {rules.filter(r => r.isActive).length} active / {rules.length} total rules
        </p>
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger asChild>
            <Button size="sm"><Plus className="w-3.5 h-3.5 mr-1.5" /> New Rule</Button>
          </DialogTrigger>
          <DialogContent className="bg-card border-border max-w-lg">
            <DialogHeader>
              <DialogTitle className="text-primary uppercase tracking-widest text-sm">Create Auto-Defense Rule</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleCreate} className="space-y-4 pt-2">
              <div className="space-y-1.5">
                <Label className="text-xs uppercase text-muted-foreground">Rule Name</Label>
                <Input value={name} onChange={e => setName(e.target.value)} required className="bg-background border-border" placeholder="e.g. Block SSH Brute Force" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs uppercase text-muted-foreground">Description</Label>
                <Textarea value={description} onChange={e => setDescription(e.target.value)} className="bg-background border-border min-h-[60px] text-sm" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs uppercase text-muted-foreground">Trigger Attack Type</Label>
                  <Select value={triggerAttackType} onValueChange={setTriggerAttack}>
                    <SelectTrigger className="bg-background border-border text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {[
                        { v: "any",            label: "any (all types)" },
                        { v: "network_attack", label: "network_attack" },
                        { v: "web_attack",     label: "web_attack (SQLi/XSS/LFI/RFI)" },
                        { v: "ssh_brute",      label: "ssh_brute" },
                        { v: "ftp_brute",      label: "ftp_brute" },
                        { v: "ddos",           label: "ddos / SYN flood" },
                        { v: "port_scan",      label: "port_scan (nmap)" },
                      ].map(({ v, label }) => (
                        <SelectItem key={v} value={v}>{label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs uppercase text-muted-foreground">Trigger Severity</Label>
                  <Select value={triggerSeverity} onValueChange={setTriggerSeverity}>
                    <SelectTrigger className="bg-background border-border text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {["any","critical","high","medium","low"].map(v => (
                        <SelectItem key={v} value={v}>{v}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs uppercase text-muted-foreground">Threshold (hits)</Label>
                  <Input type="number" min={1} value={triggerThreshold} onChange={e => setTriggerThreshold(Number(e.target.value))} className="bg-background border-border" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs uppercase text-muted-foreground">Window (seconds)</Label>
                  <Input type="number" min={1} value={triggerWindow} onChange={e => setTriggerWindow(Number(e.target.value))} className="bg-background border-border" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs uppercase text-muted-foreground">Defense Type</Label>
                  <Select value={defenseType} onValueChange={setDefenseType}>
                    <SelectTrigger className="bg-background border-border text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {Object.entries(defenseTypeLabels).map(([v, l]) => (
                        <SelectItem key={v} value={v}>{l}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs uppercase text-muted-foreground">Action Mode</Label>
                  <Select value={actionType} onValueChange={setActionType}>
                    <SelectTrigger className="bg-background border-border text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="auto">Auto Execute</SelectItem>
                      <SelectItem value="suggest">Suggest Only</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs uppercase text-muted-foreground">Target VM</Label>
                  <Select value={targetVm} onValueChange={setTargetVm}>
                    <SelectTrigger className="bg-background border-border text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="bank-web">bank-web (10.10.10.10)</SelectItem>
                      <SelectItem value="customer-db">customer-db (10.20.20.20)</SelectItem>
                      <SelectItem value="aegis">aegis (10.30.30.10)</SelectItem>
                      <SelectItem value="pfsense">pfsense (WAN firewall — SSH)</SelectItem>
                      <SelectItem value="all">all (every VM)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs uppercase text-muted-foreground">Priority (1=highest)</Label>
                  <Input type="number" min={1} max={9999} value={priority} onChange={e => setPriority(Number(e.target.value))} className="bg-background border-border" />
                </div>
              </div>
              <div className="flex justify-end pt-2">
                <Button type="submit" disabled={createMutation.isPending} size="sm">
                  {createMutation.isPending ? "Creating…" : "Create Rule"}
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {/* Rules table */}
      <div className="rounded-lg border border-border overflow-hidden">
        <Table>
          <TableHeader className="bg-muted/50">
            <TableRow className="border-border">
              <TableHead className="w-12">Active</TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Trigger</TableHead>
              <TableHead>Defense</TableHead>
              <TableHead>Mode</TableHead>
              <TableHead>Target</TableHead>
              <TableHead className="text-right">Priority</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground">Loading rules…</TableCell></TableRow>
            ) : rules.length === 0 ? (
              <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground">No defense rules configured.</TableCell></TableRow>
            ) : rules.map(r => (
              <TableRow key={r.id} className={`border-border hover:bg-muted/10 ${!r.isActive ? "opacity-40" : ""}`}>
                <TableCell>
                  <Switch
                    checked={r.isActive}
                    onCheckedChange={v => toggleMutation.mutate({ id: r.id, isActive: v })}
                    className="scale-75"
                  />
                </TableCell>
                <TableCell>
                  <p className="text-xs font-semibold text-foreground">{r.name}</p>
                  {r.description && <p className="text-[10px] text-muted-foreground mt-0.5">{r.description}</p>}
                </TableCell>
                <TableCell>
                  <div className="space-y-0.5">
                    <p className="text-[10px] text-muted-foreground">type: <span className="text-foreground/80">{r.triggerAttackType}</span></p>
                    <p className="text-[10px] text-muted-foreground">sev: <span className="text-foreground/80">{r.triggerSeverity}</span></p>
                    <p className="text-[10px] text-muted-foreground">≥{r.triggerThreshold} in {r.triggerWindowSecs}s</p>
                  </div>
                </TableCell>
                <TableCell>
                  <Badge variant="outline" className="text-[10px] border-primary/40 text-primary/80">
                    {defenseTypeLabels[r.defenseType] ?? r.defenseType}
                  </Badge>
                </TableCell>
                <TableCell>
                  <Badge variant="outline" className={`text-[10px] ${r.actionType === "auto" ? "border-green-500/50 text-green-400" : "border-yellow-500/50 text-yellow-400"}`}>
                    {r.actionType}
                  </Badge>
                </TableCell>
                <TableCell><VmBadge vm={r.targetVm} /></TableCell>
                <TableCell className="text-right font-mono text-xs text-muted-foreground">{r.priority}</TableCell>
                <TableCell>
                  <Button
                    variant="ghost" size="icon"
                    className="h-7 w-7 text-muted-foreground hover:text-red-400"
                    onClick={() => {
                      if (confirm(`"${r.name}" ကို ဖျက်မလား?`)) deleteMutation.mutate(r.id);
                    }}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
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

// ─── Firewall Rules Tab ────────────────────────────────────────────────────────

function FirewallTab() {
  const { data: rules = [], isLoading } = useFwRules();
  const qc = useQueryClient();
  const { toast } = useToast();
  const { getToken } = useAuth();
  const [createOpen, setCreateOpen] = useState(false);

  // Form state
  const [chain, setChain]       = useState("INPUT");
  const [action, setAction]     = useState("DROP");
  const [protocol, setProtocol] = useState("");
  const [sourceIp, setSourceIp] = useState("");
  const [destIp, setDestIp]     = useState("");
  const [sourcePort, setSrcPort] = useState("");
  const [destPort, setDstPort]  = useState("");
  const [iface, setIface]       = useState("");

  const fwAuthHeaders = () => {
    const tok = getToken();
    return tok ? { "Content-Type": "application/json", "Authorization": `Bearer ${tok}` }
               : { "Content-Type": "application/json" };
  };

  const deleteMutation = useMutation({
    mutationFn: (id: number) =>
      fetch(`${BASE}/api/ui/firewall/rules/${id}`, {
        method: "DELETE",
        headers: fwAuthHeaders(),
      }).then(r => r.json()),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ui-fw"] });
      toast({ title: "Rule Removed" });
    },
    onError: () => toast({ title: "Remove Failed", variant: "destructive" }),
  });

  const createMutation = useMutation({
    mutationFn: (data: object) =>
      fetch(`${BASE}/api/ui/firewall/rules`, {
        method: "POST",
        headers: fwAuthHeaders(),
        body: JSON.stringify(data),
      }).then(async r => { if (!r.ok) throw new Error(await r.text()); return r.json(); }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ui-fw"] });
      setCreateOpen(false);
      setSourceIp(""); setDestIp(""); setSrcPort(""); setDstPort(""); setIface(""); setProtocol("");
      toast({ title: "Firewall Rule Added" });
    },
    onError: (e: Error) => toast({ title: "Create Failed", description: e.message, variant: "destructive" }),
  });

  function handleExport() {
    const a = document.createElement("a");
    a.href = `${BASE}/api/ui/firewall/rules/export`;
    a.download = "aegis-firewall.sh";
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    toast({ title: "Exporting", description: "aegis-firewall.sh download ကို စတင်နေပြီ။" });
  }

  function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    createMutation.mutate({
      chain, action,
      protocol: protocol || undefined,
      sourceIp: sourceIp || undefined, destIp: destIp || undefined,
      sourcePort: sourcePort || undefined, destPort: destPort || undefined,
      iface: iface || undefined,
    });
  }

  return (
    <div className="space-y-4 p-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          {rules.filter(r => r.isActive).length} active rules
        </p>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={handleExport} className="border-border">
            <Download className="w-3.5 h-3.5 mr-1.5" /> Export .sh
          </Button>
          <Dialog open={createOpen} onOpenChange={setCreateOpen}>
            <DialogTrigger asChild>
              <Button size="sm"><Plus className="w-3.5 h-3.5 mr-1.5" /> Add Rule</Button>
            </DialogTrigger>
            <DialogContent className="bg-card border-border max-w-lg">
              <DialogHeader>
                <DialogTitle className="text-primary uppercase tracking-widest text-sm">Add Firewall Rule</DialogTitle>
              </DialogHeader>
              <form onSubmit={handleCreate} className="space-y-4 pt-2">
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs uppercase text-muted-foreground">Chain</Label>
                    <Select value={chain} onValueChange={setChain}>
                      <SelectTrigger className="bg-background border-border text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {["INPUT","OUTPUT","FORWARD"].map(v => <SelectItem key={v} value={v}>{v}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs uppercase text-muted-foreground">Action</Label>
                    <Select value={action} onValueChange={setAction}>
                      <SelectTrigger className="bg-background border-border text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {["DROP","ACCEPT","REJECT","LOG"].map(v => <SelectItem key={v} value={v}>{v}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs uppercase text-muted-foreground">Protocol (optional)</Label>
                    <Select value={protocol} onValueChange={setProtocol}>
                      <SelectTrigger className="bg-background border-border text-xs"><SelectValue placeholder="any" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="">any</SelectItem>
                        {["tcp","udp","icmp","all"].map(v => <SelectItem key={v} value={v}>{v}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs uppercase text-muted-foreground">Interface (optional)</Label>
                    <Input value={iface} onChange={e => setIface(e.target.value)} className="bg-background border-border" placeholder="e.g. ens3" />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs uppercase text-muted-foreground">Source IP</Label>
                    <Input value={sourceIp} onChange={e => setSourceIp(e.target.value)} className="bg-background border-border" placeholder="e.g. 192.168.122.132" />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs uppercase text-muted-foreground">Dest IP</Label>
                    <Input value={destIp} onChange={e => setDestIp(e.target.value)} className="bg-background border-border" placeholder="e.g. 10.10.10.10" />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs uppercase text-muted-foreground">Source Port</Label>
                    <Input value={sourcePort} onChange={e => setSrcPort(e.target.value)} className="bg-background border-border" placeholder="e.g. 22" />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs uppercase text-muted-foreground">Dest Port</Label>
                    <Input value={destPort} onChange={e => setDstPort(e.target.value)} className="bg-background border-border" placeholder="e.g. 22" />
                  </div>
                </div>
                <div className="flex justify-end pt-2">
                  <Button type="submit" disabled={createMutation.isPending} size="sm">
                    {createMutation.isPending ? "Adding…" : "Add Rule"}
                  </Button>
                </div>
              </form>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <div className="rounded-lg border border-border overflow-hidden">
        <Table>
          <TableHeader className="bg-muted/50">
            <TableRow className="border-border">
              <TableHead>Chain</TableHead>
              <TableHead>Action</TableHead>
              <TableHead>iptables Command</TableHead>
              <TableHead>Created By</TableHead>
              <TableHead>Time</TableHead>
              <TableHead>Status</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">Loading firewall rules…</TableCell></TableRow>
            ) : rules.length === 0 ? (
              <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">No firewall rules yet.</TableCell></TableRow>
            ) : rules.map(r => (
              <TableRow key={r.id} className={`border-border hover:bg-muted/10 ${!r.isActive ? "opacity-40" : ""}`}>
                <TableCell>
                  <Badge variant="outline" className="text-[10px] font-mono border-primary/30 text-primary/80">{r.chain}</Badge>
                </TableCell>
                <TableCell>
                  <Badge variant="outline" className={`text-[10px] ${
                    r.action === "DROP" || r.action === "REJECT" ? "border-red-500 text-red-400" : "border-green-500 text-green-400"
                  }`}>{r.action}</Badge>
                </TableCell>
                <TableCell className="font-mono text-xs text-muted-foreground max-w-[280px] truncate" title={r.ruleText}>
                  {r.ruleText}
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">{r.createdBy}</TableCell>
                <TableCell><span className="font-mono text-xs text-muted-foreground">{format(new Date(r.appliedAt), "MM/dd HH:mm")}</span></TableCell>
                <TableCell>
                  {r.isActive
                    ? <Badge variant="outline" className="text-[10px] border-green-500/50 text-green-400">ACTIVE</Badge>
                    : <Badge variant="outline" className="text-[10px] border-gray-500/50 text-gray-400">REMOVED</Badge>}
                </TableCell>
                <TableCell>
                  {r.isActive && (
                    <Button
                      variant="ghost" size="icon"
                      className="h-7 w-7 text-muted-foreground hover:text-red-400"
                      onClick={() => { if (confirm("Rule ဖယ်မလား?")) deleteMutation.mutate(r.id); }}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

// ─── Command History Tab ───────────────────────────────────────────────────────

function HistoryTab() {
  const { data: cmds = [], isLoading } = useCmdHist();

  return (
    <div className="p-4">
      <div className="rounded-lg border border-border overflow-hidden">
        <Table>
          <TableHeader className="bg-muted/50">
            <TableRow className="border-border">
              <TableHead>Created</TableHead>
              <TableHead>Executed</TableHead>
              <TableHead>Target IP</TableHead>
              <TableHead>VM</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Command</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">Loading command history…</TableCell></TableRow>
            ) : cmds.length === 0 ? (
              <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">No defense commands executed yet.</TableCell></TableRow>
            ) : cmds.map(c => (
              <TableRow key={c.id} className="border-border hover:bg-muted/10">
                <TableCell><span className="font-mono text-xs text-muted-foreground">{format(new Date(c.createdAt), "MM/dd HH:mm:ss")}</span></TableCell>
                <TableCell>
                  {c.executedAt
                    ? <span className="font-mono text-xs text-green-400/80">{format(new Date(c.executedAt), "HH:mm:ss")}</span>
                    : <span className="text-xs text-muted-foreground">—</span>}
                </TableCell>
                <TableCell className="font-mono text-xs text-cyan-400">{c.targetIp ?? "—"}</TableCell>
                <TableCell><HostLabel ip={c.targetVm} /></TableCell>
                <TableCell>
                  <Badge variant="outline" className="text-[10px] border-primary/30 text-primary/80">{c.commandType}</Badge>
                </TableCell>
                <TableCell className="font-mono text-xs text-muted-foreground max-w-[260px] truncate" title={c.commandText}>
                  {c.commandText}
                </TableCell>
                <TableCell>
                  <div className="space-y-0.5">
                    <Badge variant="outline" className={`text-[10px] ${statusColors[c.status] ?? "border-border text-muted-foreground"}`}>
                      {c.status}
                    </Badge>
                    {c.errorMsg && <p className="text-[10px] text-red-400 max-w-[140px] truncate" title={c.errorMsg}>{c.errorMsg}</p>}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

// ─── Page ──────────────────────────────────────────────────────────────────────

export default function DefenseRules() {
  const [tab, setTab] = useState<TabId>("rules");
  const qc = useQueryClient();

  return (
    <div className="space-y-6 h-full flex flex-col">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-primary uppercase">Defense Rules</h1>
          <p className="text-sm text-muted-foreground">Auto-defense rules, firewall policies, and command execution history.</p>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground font-mono">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-primary" />
          </span>
          Live · auto-refreshes every 10–15s
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

      {/* Tab content */}
      <Card className="bg-card border-border flex-1 overflow-auto">
        {tab === "rules"    && <RulesTab />}
        {tab === "firewall" && <FirewallTab />}
        {tab === "history"  && <HistoryTab />}
      </Card>
    </div>
  );
}
