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
import { Trash2, Plus, Flame, Terminal, BookOpen, Shield, ChevronRight } from "lucide-react";
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
  targetVm: string;
  ruleText: string; isActive: boolean; createdBy: string; appliedAt: string;
}

interface DefenseCommand {
  id: number; commandType: string; commandText: string;
  targetIp: string | null; targetVm: string;
  status: string; errorMsg: string | null;
  createdAt: string; executedAt: string | null;
  // Joined fields from defense_rules + security_events
  ruleId: number | null; ruleName: string | null;
  eventId: number | null;
  eventSourceIp: string | null; eventSubtype: string | null;
  eventType: string | null; eventDescription: string | null;
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
  "company-web-server":  { label: "company-web-server",  ip: "10.10.10.10",  color: "border-cyan-500/50 text-cyan-300" },
  "company-customer-db": { label: "company-customer-db", ip: "10.20.20.10",  color: "border-purple-500/50 text-purple-300" },
  "company-dns-server":  { label: "company-dns-server",  ip: "10.10.10.20",  color: "border-blue-500/50 text-blue-300" },
  "company-ldap-server": { label: "company-ldap-server", ip: "10.20.20.20",  color: "border-violet-500/50 text-violet-300" },
  "aegis":               { label: "aegis-company-admin", ip: "10.30.30.10",  color: "border-green-500/50 text-green-300" },
  "pfsense":             { label: "pfSense",                                  color: "border-orange-500/50 text-orange-300" },
  "all":                 { label: "all VMs",                                  color: "border-yellow-500/50 text-yellow-300" },
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
  block_ip:      "Linux VM Block (iptables DROP)",
  rate_limit:    "Linux VM Rate Limit (iptables, 10/min)",
  pfsense_block: "pfSense WAN Block (SSH + easyrule)",
  alert_only:    "Alert Only (Linux log, no block)",
};

// Certain defense types must target a specific VM — auto-enforce consistency.
const DEFENSE_TYPE_FORCED_VM: Record<string, string> = {
  pfsense_block: "pfsense",
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

// ─── Attack-type smart presets ─────────────────────────────────────────────────
// When the user picks a trigger attack type, all other fields auto-fill with
// sensible defaults that match the AEGIS lab topology and ingest logic.
const ATTACK_PRESETS: Record<string, {
  name: string; description: string; severity: string;
  threshold: number; windowSecs: number;
  defenseType: string; targetVm: string;
}> = {
  ssh_brute: {
    name: "Block SSH Brute Force",
    description: "Auto-block IPs that trigger SSH brute-force alerts (fail2ban / auth.log watcher)",
    severity: "high", threshold: 3, windowSecs: 60,
    defenseType: "block_ip", targetVm: "all",
  },
  auth_event: {
    name: "Block Unauthorized SSH Access",
    description: "Block IP immediately when unauthorized SSH login succeeds (stolen creds / single clean login)",
    severity: "critical", threshold: 1, windowSecs: 60,
    defenseType: "block_ip", targetVm: "all",
  },
  web_attack: {
    name: "Block Web Attack",
    description: "Block IPs launching SQLi/XSS attacks against web server",
    severity: "high", threshold: 3, windowSecs: 120,
    defenseType: "block_ip", targetVm: "company-web-server",
  },
  network_attack: {
    name: "Alert on Unclassified Network Attack",
    description: "Log repeated high-severity Suricata alerts that do not match a specific attack category",
    severity: "high", threshold: 3, windowSecs: 60,
    defenseType: "alert_only", targetVm: "aegis",
  },
  ddos: {
    name: "Block DDoS Source at pfSense WAN",
    description: "Block DDoS/SYN-flood source IP at pfSense WAN boundary — stops Suricata alerts at source",
    severity: "high", threshold: 1, windowSecs: 30,
    defenseType: "pfsense_block", targetVm: "pfsense",
  },
  port_scan: {
    name: "Block Port Scanner",
    description: "Block IPs performing nmap / port scans at pfSense WAN boundary",
    severity: "medium", threshold: 1, windowSecs: 60,
    defenseType: "pfsense_block", targetVm: "pfsense",
  },
  dns_attack: {
    name: "Block DNS Attack",
    description: "Block IPs attacking BIND9 DNS server",
    severity: "high", threshold: 3, windowSecs: 60,
    defenseType: "block_ip", targetVm: "company-dns-server",
  },
  db_attack: {
    name: "Block Database Attack",
    description: "Block IPs attacking MySQL / PostgreSQL database",
    severity: "high", threshold: 3, windowSecs: 60,
    defenseType: "block_ip", targetVm: "company-customer-db",
  },
  ldap_brute: {
    name: "Block LDAP Brute Force",
    description: "Block IPs attempting LDAP credential brute force (invalid bind credentials)",
    severity: "high", threshold: 3, windowSecs: 60,
    defenseType: "block_ip", targetVm: "company-ldap-server",
  },
  ldap_enum: {
    name: "Block LDAP Enumeration",
    description: "Block IPs performing LDAP directory enumeration (DN enumeration)",
    severity: "medium", threshold: 5, windowSecs: 120,
    defenseType: "block_ip", targetVm: "company-ldap-server",
  },
  any: {
    name: "Alert on Repeated Any Attack",
    description: "Log only after repeated high-severity events of any type; does not automatically block",
    severity: "high", threshold: 10, windowSecs: 60,
    defenseType: "alert_only", targetVm: "aegis",
  },
};

const DEFAULT_ATTACK_TYPE = "ssh_brute";
const DEFAULT_PRESET = ATTACK_PRESETS[DEFAULT_ATTACK_TYPE];

function normalizeNumericInput(value: string): string {
  const digits = value.replace(/\D/g, "");
  return digits.replace(/^0+(?=\d)/, "");
}

function numericValue(value: string): number {
  return Number(value) || 0;
}

// ─── Auto-Defense Rules Tab ────────────────────────────────────────────────────

function RulesTab() {
  const { data: rules = [], isLoading } = useRules();
  const { data: hotIps = [] } = useHotIps();
  const qc = useQueryClient();
  const { toast } = useToast();
  const { getToken, isDemo } = useAuth();
  const [createOpen, setCreateOpen] = useState(false);

  // Create form state
  const [name, setName]                         = useState(DEFAULT_PRESET.name);
  const [description, setDescription]           = useState(DEFAULT_PRESET.description);
  const [triggerAttackType, setTriggerAttack]   = useState(DEFAULT_ATTACK_TYPE);
  const [triggerSeverity, setTriggerSeverity]   = useState(DEFAULT_PRESET.severity);
  const [triggerThreshold, setTriggerThreshold] = useState(String(DEFAULT_PRESET.threshold));
  const [triggerWindow, setTriggerWindow]       = useState(String(DEFAULT_PRESET.windowSecs));
  const [defenseType, setDefenseType]           = useState(DEFAULT_PRESET.defenseType);
  const [targetVm, setTargetVm]                 = useState(DEFAULT_PRESET.targetVm);
  const [priority, setPriority]                 = useState(String(100));

  // When attack type changes, auto-fill all dependent fields
  function handleAttackTypeChange(v: string) {
    setTriggerAttack(v);
    const p = ATTACK_PRESETS[v];
    if (!p) return;
    setName(p.name);
    setDescription(p.description);
    setTriggerSeverity(p.severity);
    setTriggerThreshold(String(p.threshold));
    setTriggerWindow(String(p.windowSecs));
    setDefenseType(p.defenseType);
    setTargetVm(p.targetVm);
  }

  function handleCreateOpenChange(open: boolean) {
    if (isDemo) return;
    if (open) {
      handleAttackTypeChange(DEFAULT_ATTACK_TYPE);
      setPriority(String(100));
    }
    setCreateOpen(open);
  }

  // When defense type changes, auto-enforce the required target VM
  function handleDefenseTypeChange(v: string) {
    setDefenseType(v);
    const forced = DEFENSE_TYPE_FORCED_VM[v];
    if (forced) setTargetVm(forced);
    else if (targetVm === "pfsense") setTargetVm("all");
  }

  const authHeaders = (): Record<string, string> => {
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
      }).then(async r => {
        if (!r.ok) throw new Error(await r.text());
        return r.json();
      }),
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
      handleAttackTypeChange(DEFAULT_ATTACK_TYPE);
      setPriority(String(100));
      toast({ title: "Rule Created", description: "Auto-defense rule added." });
    },
    onError: (e: Error) => toast({ title: "Create Failed", description: e.message, variant: "destructive" }),
  });

  function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    createMutation.mutate({ name, description, triggerAttackType, triggerSeverity,
      triggerThreshold: numericValue(triggerThreshold),
      triggerWindowSecs: numericValue(triggerWindow),
      actionType: "auto", defenseType, targetVm,
      priority: numericValue(priority) });
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
        <Dialog open={createOpen} onOpenChange={handleCreateOpenChange}>
          <DialogTrigger asChild>
            <Button size="sm" disabled={isDemo} title={isDemo ? "Demo mode — read only" : undefined}><Plus className="w-3.5 h-3.5 mr-1.5" /> New Rule</Button>
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
                <div className="space-y-1.5 col-span-2">
                  <Label className="text-xs uppercase text-muted-foreground">Trigger Attack Type</Label>
                  <Select value={triggerAttackType} onValueChange={handleAttackTypeChange}>
                    <SelectTrigger className="bg-background border-border text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {[
                        { v: "ssh_brute",      label: "ssh_brute — fail2ban / SSH watcher (brute force)" },
                        { v: "auth_event",     label: "auth_event — unauthorized login success (stolen creds)" },
                        { v: "web_attack",     label: "web_attack — SQLi / XSS" },
                        { v: "ddos",           label: "ddos — SYN flood / hping3" },
                        { v: "port_scan",      label: "port_scan — nmap" },
                        { v: "dns_attack",     label: "dns_attack — BIND9 / dnsspoof" },
                        { v: "db_attack",      label: "db_attack — MySQL auth brute force" },
                        { v: "ldap_brute",     label: "ldap_brute — invalid bind credentials" },
                        { v: "ldap_enum",      label: "ldap_enum — DN enumeration" },
                        { v: "any",            label: "any — all event types (use carefully)" },
                      ].map(({ v, label }) => (
                        <SelectItem key={v} value={v}>{label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-[10px] text-cyan-400/70">
                    Selecting an attack type auto-fills name, description, minimum severity, threshold, window, defense, and target.
                  </p>
                  {triggerAttackType === "any" && (
                    <p className="text-[10px] text-yellow-400/80 bg-yellow-950/30 border border-yellow-500/20 rounded px-2 py-1.5 mt-1">
                      ⚠ "any" fires on <strong>every</strong> ingest event regardless of type — including normal fail2ban, SSH, Suricata alerts. Set a high threshold (≥10) to avoid false positives.
                    </p>
                  )}
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs uppercase text-muted-foreground">Minimum Trigger Severity</Label>
                  <Select value={triggerSeverity} onValueChange={setTriggerSeverity}>
                    <SelectTrigger className="bg-background border-border text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {["critical","high","medium","low"].map(v => (
                        <SelectItem key={v} value={v}>{v}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-[10px] text-muted-foreground">
                    critical only; high includes critical; medium includes high/critical; low matches every severity.
                  </p>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs uppercase text-muted-foreground">Threshold (hits)</Label>
                  <Input type="text" inputMode="numeric" pattern="[0-9]*" value={triggerThreshold} onChange={e => setTriggerThreshold(normalizeNumericInput(e.target.value))} className="bg-background border-border" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs uppercase text-muted-foreground">Window (seconds)</Label>
                  <Input type="text" inputMode="numeric" pattern="[0-9]*" value={triggerWindow} onChange={e => setTriggerWindow(normalizeNumericInput(e.target.value))} className="bg-background border-border" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs uppercase text-muted-foreground">Defense Type</Label>
                  <Select value={defenseType} onValueChange={handleDefenseTypeChange}>
                    <SelectTrigger className="bg-background border-border text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {Object.entries(defenseTypeLabels).map(([v, l]) => (
                        <SelectItem key={v} value={v}>{l}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {defenseType === "pfsense_block" && (
                    <p className="text-[10px] text-cyan-400/80 bg-cyan-950/30 border border-cyan-500/20 rounded px-2 py-1.5 mt-1">
                      ℹ pfSense WAN Block — SSH into pfSense and runs <code>easyrule block WAN &lt;IP&gt;</code>. Stops Suricata from alerting because traffic is dropped before it reaches LAN/DMZ interfaces.
                    </p>
                  )}
                  {defenseType === "rate_limit" && (
                    <p className="text-[10px] text-yellow-400/80 bg-yellow-950/30 border border-yellow-500/20 rounded px-2 py-1.5 mt-1">
                      ⚠ Rate Limit ကို VM iptables မှာ run တာဆိုတော့ Suricata (pfSense) က traffic ကိုဆက်မြင်နိုင်ပြီး alerts ဆက်ဝင်နိုင်သည်။ DDoS ကိုရပ်ချင်ရင် pfSense WAN Block သုံးပါ။
                    </p>
                  )}
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs uppercase text-muted-foreground">
                    Target VM
                    {DEFENSE_TYPE_FORCED_VM[defenseType] && (
                      <span className="ml-2 text-cyan-400/70 normal-case font-normal">(auto-set by defense type)</span>
                    )}
                  </Label>
                  <Select
                    value={targetVm}
                    onValueChange={setTargetVm}
                    disabled={!!DEFENSE_TYPE_FORCED_VM[defenseType]}
                  >
                    <SelectTrigger className={`bg-background border-border text-xs${DEFENSE_TYPE_FORCED_VM[defenseType] ? " opacity-60 cursor-not-allowed" : ""}`}><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="company-web-server">company-web-server (10.10.10.10)</SelectItem>
                      <SelectItem value="company-dns-server">company-dns-server (10.10.10.20)</SelectItem>
                      <SelectItem value="company-customer-db">company-customer-db (10.20.20.10)</SelectItem>
                      <SelectItem value="company-ldap-server">company-ldap-server (10.20.20.20)</SelectItem>
                      <SelectItem value="aegis">aegis-company-admin (10.30.30.10)</SelectItem>
                      <SelectItem value="pfsense" disabled={defenseType !== "pfsense_block"}>
                        pfsense (WAN firewall — SSH + easyrule)
                      </SelectItem>
                      <SelectItem value="all">all Linux VMs (pfSense excluded)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs uppercase text-muted-foreground">Priority (1=highest)</Label>
                  <Input type="text" inputMode="numeric" pattern="[0-9]*" maxLength={4} value={priority} onChange={e => setPriority(normalizeNumericInput(e.target.value))} className="bg-background border-border" />
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
                    onCheckedChange={v => !isDemo && toggleMutation.mutate({ id: r.id, isActive: v })}
                    disabled={isDemo}
                    title={isDemo ? "Demo mode — read only" : undefined}
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
                    disabled={isDemo}
                    title={isDemo ? "Demo mode — read only" : undefined}
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
  const { getToken, isDemo } = useAuth();
  const [createOpen, setCreateOpen] = useState(false);

  // Form state
  const [chain, setChain]       = useState("INPUT");
  const [action, setAction]     = useState("DROP");
  const [protocol, setProtocol] = useState("all");
  const [sourceIp, setSourceIp] = useState("");
  const [destIp, setDestIp]     = useState("");
  const [sourcePort, setSrcPort] = useState("");
  const [destPort, setDstPort]  = useState("");
  const [iface, setIface]       = useState("");
  const [firewallTarget, setFirewallTarget] = useState("company-web-server");
  const supportsPorts = protocol === "tcp" || protocol === "udp";

  function resetFirewallForm() {
    setChain("INPUT"); setAction("DROP"); setProtocol("all");
    setSourceIp(""); setDestIp(""); setSrcPort(""); setDstPort(""); setIface("");
    setFirewallTarget("company-web-server");
  }

  function handleFirewallOpenChange(open: boolean) {
    if (isDemo) return;
    if (open) resetFirewallForm();
    setCreateOpen(open);
  }

  const fwAuthHeaders = (): Record<string, string> => {
    const tok = getToken();
    return tok ? { "Content-Type": "application/json", "Authorization": `Bearer ${tok}` }
               : { "Content-Type": "application/json" };
  };

  const deleteMutation = useMutation({
    mutationFn: (id: number) =>
      fetch(`${BASE}/api/ui/firewall/rules/${id}`, {
        method: "DELETE",
        headers: fwAuthHeaders(),
      }).then(async r => {
        if (!r.ok) throw new Error(await r.text());
        return r.json();
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ui-fw"] });
      toast({ title: "Rule Removal Queued", description: "Undo command was queued only for the rule's configured target." });
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
      resetFirewallForm();
      toast({ title: "Firewall Rule Queued", description: `Rule queued for ${firewallTarget === "all" ? "all four company servers" : firewallTarget}.` });
    },
    onError: (e: Error) => toast({ title: "Create Failed", description: e.message, variant: "destructive" }),
  });

  function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if ((sourcePort || destPort) && !supportsPorts) {
      toast({
        title: "Protocol Required",
        description: "Select TCP or UDP before adding a source or destination port.",
        variant: "destructive",
      });
      return;
    }
    if (!sourceIp && !destIp && !sourcePort && !destPort) {
      toast({
        title: "Rule Too Broad",
        description: "Enter at least one source/destination IP or port. An unrestricted rule is blocked for safety.",
        variant: "destructive",
      });
      return;
    }
    createMutation.mutate({
      chain, action,
      protocol: protocol === "all" ? undefined : protocol,
      sourceIp: sourceIp || undefined, destIp: destIp || undefined,
      sourcePort: sourcePort || undefined, destPort: destPort || undefined,
      iface: iface || undefined,
      targetVm: firewallTarget,
    });
  }

  return (
    <div className="space-y-4 p-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          {rules.filter(r => r.isActive).length} active rules
        </p>
        <div className="flex gap-2">
          <Dialog open={createOpen} onOpenChange={handleFirewallOpenChange}>
            <DialogTrigger asChild>
              <Button size="sm" disabled={isDemo} title={isDemo ? "Demo mode — read only" : undefined}><Plus className="w-3.5 h-3.5 mr-1.5" /> Add Rule</Button>
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
                        {["INPUT","OUTPUT"].map(v => <SelectItem key={v} value={v}>{v}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs uppercase text-muted-foreground">Action</Label>
                    <Select value={action} onValueChange={setAction}>
                      <SelectTrigger className="bg-background border-border text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {["DROP","ACCEPT"].map(v => <SelectItem key={v} value={v}>{v}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs uppercase text-muted-foreground">Protocol (optional)</Label>
                    <Select value={protocol} onValueChange={value => {
                      setProtocol(value);
                      if (value !== "tcp" && value !== "udp") {
                        setSrcPort("");
                        setDstPort("");
                      }
                    }}>
                      <SelectTrigger className="bg-background border-border text-xs"><SelectValue placeholder="any" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">any</SelectItem>
                        {["tcp","udp"].map(v => <SelectItem key={v} value={v}>{v.toUpperCase()}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs uppercase text-muted-foreground">{chain === "OUTPUT" ? "Output Interface (-o)" : "Input Interface (-i)"} (optional)</Label>
                    <Input value={iface} onChange={e => setIface(e.target.value)} className="bg-background border-border" placeholder="e.g. ens3" />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs uppercase text-muted-foreground">Source IP</Label>
                    <Input value={sourceIp} onChange={e => setSourceIp(e.target.value)} className="bg-background border-border" placeholder="e.g. 192.168.122.153" />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs uppercase text-muted-foreground">Dest IP</Label>
                    <Input value={destIp} onChange={e => setDestIp(e.target.value)} className="bg-background border-border" placeholder="e.g. 10.10.10.10" />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs uppercase text-muted-foreground">Source Port</Label>
                    <Input value={sourcePort} onChange={e => setSrcPort(e.target.value)} disabled={!supportsPorts} className="bg-background border-border" placeholder={supportsPorts ? "e.g. 22" : "Select TCP or UDP"} />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs uppercase text-muted-foreground">Dest Port</Label>
                    <Input value={destPort} onChange={e => setDstPort(e.target.value)} disabled={!supportsPorts} className="bg-background border-border" placeholder={supportsPorts ? "e.g. 22" : "Select TCP or UDP"} />
                  </div>
                  <div className="space-y-1.5 col-span-2">
                    <Label className="text-xs uppercase text-muted-foreground">Target Linux VM</Label>
                    <Select value={firewallTarget} onValueChange={setFirewallTarget}>
                      <SelectTrigger className="bg-background border-border text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="company-web-server">company-web-server (10.10.10.10)</SelectItem>
                        <SelectItem value="company-dns-server">company-dns-server (10.10.10.20)</SelectItem>
                        <SelectItem value="company-customer-db">company-customer-db (10.20.20.10)</SelectItem>
                        <SelectItem value="company-ldap-server">company-ldap-server (10.20.20.20)</SelectItem>
                        <SelectItem value="all">all four company Linux VMs</SelectItem>
                      </SelectContent>
                    </Select>
                    {firewallTarget === "all" && <p className="text-[10px] text-yellow-400">⚠ This queues the same rule on all four company servers.</p>}
                  </div>
                </div>
                {action === "ACCEPT" && (
                  <p className="text-[10px] text-yellow-400 bg-yellow-950/30 border border-yellow-500/20 rounded px-2 py-1.5">
                    ⚠ ACCEPT is inserted at the top of the selected chain. Use a narrow IP/port selector to avoid exposing services.
                  </p>
                )}
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
              <TableHead>Target</TableHead>
              <TableHead>Created By</TableHead>
              <TableHead>Time</TableHead>
              <TableHead>Status</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground">Loading firewall rules…</TableCell></TableRow>
            ) : rules.length === 0 ? (
              <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground">No firewall rules yet.</TableCell></TableRow>
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
                <TableCell><VmBadge vm={r.targetVm} /></TableCell>
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
                      disabled={isDemo}
                      title={isDemo ? "Demo mode — read only" : undefined}
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
// Shows the full Attack → Rule → Command chain for every defense action.
// commandText is expandable so analysts can see the exact VM command.

function HistoryTab() {
  const { data: cmds = [], isLoading } = useCmdHist();
  const [expandedId, setExpandedId] = useState<number | null>(null);

  return (
    <div className="p-4 space-y-3">
      {isLoading ? (
        <p className="text-center py-8 text-muted-foreground text-sm">Loading command history…</p>
      ) : cmds.length === 0 ? (
        <p className="text-center py-8 text-muted-foreground text-sm">No defense commands executed yet.</p>
      ) : cmds.map(c => {
        const isExpanded = expandedId === c.id;
        return (
          <div key={c.id} className="rounded-lg border border-border bg-card overflow-hidden">
            {/* ── Chain header: Attack → Rule → Command ── */}
            {(c.eventSubtype || c.ruleName) && (
              <div className="flex items-center gap-1.5 flex-wrap px-4 py-2.5 bg-muted/30 border-b border-border text-xs">
                {c.eventSubtype && (
                  <>
                    <Terminal className="w-3 h-3 text-orange-400 shrink-0" />
                    <span className="text-orange-300/90 font-medium">{c.eventSubtype}</span>
                  </>
                )}
                {c.ruleName && (
                  <>
                    <ChevronRight className="w-3 h-3 text-muted-foreground" />
                    <Shield className="w-3 h-3 text-cyan-400 shrink-0" />
                    <span className="text-cyan-300/90 font-medium">{c.ruleName}</span>
                  </>
                )}
                <ChevronRight className="w-3 h-3 text-muted-foreground" />
                <Badge variant="outline" className="text-[10px] border-primary/30 text-primary/80">{c.commandType}</Badge>
                {c.eventSourceIp && (
                  <span className="ml-auto font-mono text-[10px] text-muted-foreground">src: {c.eventSourceIp}</span>
                )}
              </div>
            )}

            {/* ── Command body ── */}
            <div className="px-4 py-3 space-y-2">
              {/* Row: IP / VM / status / timestamps */}
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                {c.targetIp && (
                  <span className="font-mono text-xs text-cyan-400">{c.targetIp}</span>
                )}
                <HostLabel ip={c.targetVm} />
                <Badge variant="outline" className={`text-[10px] ${statusColors[c.status] ?? "border-border text-muted-foreground"}`}>
                  {c.status}
                </Badge>
                <span className="ml-auto font-mono text-[10px] text-muted-foreground">
                  {format(new Date(c.createdAt), "MM/dd HH:mm:ss")}
                  {c.executedAt && (
                    <> → <span className="text-green-400/80">{format(new Date(c.executedAt), "HH:mm:ss")}</span></>
                  )}
                </span>
              </div>

              {/* Actual VM command — click to expand full text */}
              <button
                className="w-full text-left group"
                onClick={() => setExpandedId(isExpanded ? null : c.id)}
              >
                <pre className={`font-mono text-[11px] bg-black/30 border border-border rounded px-3 py-2 text-cyan-200/80 overflow-x-auto leading-relaxed whitespace-pre-wrap break-all transition-all ${isExpanded ? "" : "max-h-[3.4rem] overflow-hidden"}`}>
                  {c.commandText}
                </pre>
                {!isExpanded && c.commandText.length > 80 && (
                  <p className="text-[10px] text-muted-foreground mt-0.5 group-hover:text-primary/60 transition-colors">
                    Click to expand full command ↓
                  </p>
                )}
              </button>

              {/* Error */}
              {c.errorMsg && (
                <p className="text-[10px] text-red-400 font-mono break-all">{c.errorMsg}</p>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Page ──────────────────────────────────────────────────────────────────────

export default function DefenseRules() {
  const [tab, setTab] = useState<TabId>("rules");
  const qc = useQueryClient();

  return (
    <div className="space-y-6 h-full flex flex-col">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
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
      <div className="flex gap-1 border border-border rounded-lg p-1 bg-card w-fit overflow-x-auto max-w-full">
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
