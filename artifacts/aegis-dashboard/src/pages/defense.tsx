import { useState, useEffect, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Shield, ShieldOff, Lock, Unlock, Bot, UserCheck, AlertTriangle, RefreshCcw, Sparkles, Zap, Plus, Check } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { HostLabel } from "@/lib/host-utils";
import { useToast } from "@/hooks/use-toast";
import { useDeviceContext } from "@/lib/device-context";
import { Switch } from "@/components/ui/switch";
import { useAuth } from "@/contexts/auth-context";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

interface BlockedIp {
  id: number;
  ip: string;
  reason: string;
  blockedBy: string;
  targetHost: string | null;
  isActive: boolean;
  blockedAt: string;
  unblockedAt: string | null;
}

interface DefenseAction {
  id: number;
  type: string;
  action: string;
  targetIp: string;
  targetHost: string | null;
  reason: string;
  performedBy: string;
  status: string;
  createdAt: string;
}

interface HostSensorRow {
  hostIp: string;
  sensors: { component: string; status: string }[];
  fail2ban: boolean | null;
  suricata: boolean | null;
}

interface DefenseStatus {
  autoDefenseEnabled: boolean;
  fail2banActive: boolean;
  suricataActive: boolean;
  totalBlocked: number;
  recentActions: DefenseAction[];
  perHostSensors?: HostSensorRow[];
}

function useBlocks(device: string | null) {
  return useQuery<BlockedIp[]>({
    queryKey: ["defense-blocks", device],
    queryFn: async () => {
      const qs = device ? `?device=${encodeURIComponent(device)}` : "";
      const r = await fetch(`${BASE}/api/defense/blocks${qs}`);
      return r.json();
    },
    refetchInterval: 8000,
  });
}

function useDefenseStatus(device: string | null) {
  return useQuery<DefenseStatus>({
    queryKey: ["defense-status", device],
    queryFn: async () => {
      const qs = device ? `?device=${encodeURIComponent(device)}` : "";
      const r = await fetch(`${BASE}/api/defense/status${qs}`);
      return r.json();
    },
    refetchInterval: 5000,
  });
}

function useDefenseActions(device: string | null) {
  return useQuery<DefenseAction[]>({
    queryKey: ["defense-actions", device],
    queryFn: async () => {
      const qs = device ? `?device=${encodeURIComponent(device)}` : "";
      const r = await fetch(`${BASE}/api/defense/actions${qs}`);
      return r.json();
    },
    refetchInterval: 8000,
  });
}

const actionColors: Record<string, string> = {
  block: "text-red-400",
  unblock: "text-green-400",
  alert: "text-yellow-400",
  rate_limit: "text-orange-400",
};

const actionIcons: Record<string, React.ReactNode> = {
  block: <Lock className="w-3.5 h-3.5" />,
  unblock: <Unlock className="w-3.5 h-3.5" />,
  alert: <AlertTriangle className="w-3.5 h-3.5" />,
  rate_limit: <ShieldOff className="w-3.5 h-3.5" />,
};

/** Animated service status indicator */
function ServiceCard({
  label,
  active,
  icon,
  justChanged,
}: {
  label: string;
  active: boolean | undefined;
  icon: React.ReactNode;
  justChanged: boolean;
}) {
  return (
    <Card className={`bg-card border-border transition-all duration-700 ${
      justChanged
        ? active
          ? "ring-1 ring-green-500 shadow-[0_0_12px_rgba(34,197,94,0.3)]"
          : "ring-1 ring-red-500 shadow-[0_0_12px_rgba(239,68,68,0.3)]"
        : ""
    }`}>
      <CardContent className="p-4 flex items-center gap-3">
        <div className="relative">
          {icon}
          {/* Real-time pulse dot */}
          {active !== undefined && (
            <span className={`absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full ${
              active ? "bg-green-400" : "bg-red-500"
            } ${active ? "animate-ping" : ""}`} />
          )}
        </div>
        <div>
          <p className="text-xs text-muted-foreground uppercase tracking-wider">{label}</p>
          {active === undefined ? (
            <p className="text-sm font-bold text-gray-500">UNKNOWN</p>
          ) : (
            <p className={`text-sm font-bold flex items-center gap-1.5 ${active ? "text-green-400" : "text-red-400"}`}>
              {active ? "ACTIVE" : "DOWN"}
              {justChanged && (
                <span className={`text-[10px] px-1 rounded ${active ? "bg-green-900/40 text-green-300" : "bg-red-900/40 text-red-300"}`}>
                  just changed
                </span>
              )}
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export default function Defense() {
  const [blockIp, setBlockIp] = useState("");
  const [blockReason, setBlockReason] = useState("");
  const [aiIp, setAiIp] = useState("");
  const [aiResult, setAiResult] = useState<{ ip: string; recommendation: string; eventCount: number; attackTypes: Record<string, number> } | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);

  // AI Rule Recommendations state
  interface RuleRec {
    name: string; description: string; reasoning: string;
    triggerAttackType: string; triggerSeverity: string;
    triggerThreshold: number; triggerWindowSecs: number;
    actionType: string; defenseType: string;
    targetVm: string; priority: number;
  }
  const [ruleRecs, setRuleRecs] = useState<RuleRec[] | null>(null);
  const [ruleRecsLoading, setRuleRecsLoading] = useState(false);
  const [ruleRecsError, setRuleRecsError] = useState<string | null>(null);
  const [appliedRules, setAppliedRules] = useState<Set<string>>(new Set());
  const { toast } = useToast();
  const qc = useQueryClient();
  const { selectedDevice } = useDeviceContext();
  const { getToken } = useAuth();

  const defAuthHeaders = (extra: Record<string,string> = {}) => {
    const tok = getToken();
    return tok
      ? { "Content-Type": "application/json", "Authorization": `Bearer ${tok}`, ...extra }
      : { "Content-Type": "application/json", ...extra };
  };
  // Devices are matched against blocked_ips/defense_actions.targetHost by IP —
  // most ingest routes populate targetHost from the real destination IP
  // (dest_ip/target_ip), which is the same identity network_hosts.ip uses.
  // A minority of ingest paths still fall back to a generic label (e.g.
  // "mail-server") when no real IP is known; those actions won't match any
  // specific device and only appear under "All Devices" — expected until every
  // sensor forwards a concrete destination IP.
  const deviceFilter = selectedDevice ? selectedDevice.ip : null;

  const { data: blocks = [] } = useBlocks(deviceFilter);
  const { data: status } = useDefenseStatus(deviceFilter);
  const { data: actions = [] } = useDefenseActions(deviceFilter);

  // Track which services just changed state for visual flash
  const prevStatusRef = useRef<{ fail2ban?: boolean; suricata?: boolean }>({});
  const [changedServices, setChangedServices] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!status) return;
    const prev = prevStatusRef.current;
    const changed = new Set<string>();
    if (prev.fail2ban !== undefined && prev.fail2ban !== status.fail2banActive) changed.add("fail2ban");
    if (prev.suricata !== undefined && prev.suricata !== status.suricataActive) changed.add("suricata");
    if (changed.size > 0) {
      setChangedServices(changed);
      const svc = Array.from(changed).join(", ");
      toast({
        title: "Service status changed",
        description: `${svc} is now ${changed.has("fail2ban") ? (status.fail2banActive ? "ACTIVE" : "DOWN") : (status.suricataActive ? "ACTIVE" : "DOWN")}`,
        variant: changed.has("fail2ban") ? (status.fail2banActive ? "default" : "destructive") : "default",
      });
      setTimeout(() => setChangedServices(new Set()), 5000);
    }
    prevStatusRef.current = { fail2ban: status.fail2banActive, suricata: status.suricataActive };
  }, [status, toast]);

  const activeBlocks = blocks.filter(b => b.isActive);
  const historyBlocks = blocks.filter(b => !b.isActive);

  const blockMutation = useMutation({
    mutationFn: async ({ ip, reason }: { ip: string; reason: string }) => {
      const r = await fetch(`${BASE}/api/defense/block`, {
        method: "POST",
        headers: defAuthHeaders(),
        body: JSON.stringify({ ip, reason, targetHost: deviceFilter ?? undefined }),
      });
      if (!r.ok) {
        const e = await r.json();
        throw new Error(e.error ?? "Block failed");
      }
      return r.json();
    },
    onSuccess: () => {
      toast({ title: "IP Blocked", description: `${blockIp} has been blocked.` });
      setBlockIp("");
      setBlockReason("");
      qc.invalidateQueries({ queryKey: ["defense-blocks"] });
      qc.invalidateQueries({ queryKey: ["defense-status"] });
      qc.invalidateQueries({ queryKey: ["defense-actions"] });
    },
    onError: (e: Error) => {
      toast({ title: "Block Failed", description: e.message, variant: "destructive" });
    },
  });

  const unblockMutation = useMutation({
    mutationFn: async (ip: string) => {
      const r = await fetch(`${BASE}/api/defense/block/${encodeURIComponent(ip)}`, {
        method: "DELETE",
        headers: defAuthHeaders(),
      });
      if (!r.ok) throw new Error("Unblock failed");
      return r.json();
    },
    onSuccess: (_data, ip) => {
      toast({ title: "IP Unblocked", description: `${ip} has been removed from block list.` });
      qc.invalidateQueries({ queryKey: ["defense-blocks"] });
      qc.invalidateQueries({ queryKey: ["defense-status"] });
      qc.invalidateQueries({ queryKey: ["defense-actions"] });
    },
    onError: () => {
      toast({ title: "Unblock Failed", variant: "destructive" });
    },
  });

  const toggleAutoDefenseMutation = useMutation({
    mutationFn: async (enabled: boolean) => {
      const r = await fetch(`${BASE}/api/defense/settings`, {
        method: "PATCH",
        headers: defAuthHeaders(),
        body: JSON.stringify({ autoDefenseEnabled: enabled }),
      });
      if (!r.ok) {
        const e = await r.json().catch(() => ({}));
        throw new Error(e.error ?? "Failed to update auto-defense setting");
      }
      return r.json();
    },
    onSuccess: (data: { autoDefenseEnabled: boolean }) => {
      toast({ title: data.autoDefenseEnabled ? "Auto Defense Enabled" : "Auto Defense Disabled" });
      qc.invalidateQueries({ queryKey: ["defense-status"] });
    },
    onError: (e: Error) => {
      toast({ title: "Toggle Failed", description: e.message, variant: "destructive" });
    },
  });

  const handleBlock = () => {
    if (!blockIp || !blockReason) return;
    blockMutation.mutate({ ip: blockIp, reason: blockReason });
  };

  async function fetchRuleRecs() {
    setRuleRecsLoading(true);
    setRuleRecsError(null);
    setRuleRecs(null);
    setAppliedRules(new Set());
    try {
      const r = await fetch(`${BASE}/api/ai/recommend-rules`, { method: "POST" });
      if (!r.ok) { const e = await r.json(); throw new Error(e.error ?? `HTTP ${r.status}`); }
      const data = await r.json();
      setRuleRecs(data.recommendations ?? []);
    } catch (err: any) {
      setRuleRecsError(err.message);
    } finally {
      setRuleRecsLoading(false);
    }
  }

  async function applyRule(rec: RuleRec) {
    try {
      const r = await fetch(`${BASE}/api/ui/defense/rules`, {
        method: "POST",
        headers: defAuthHeaders(),
        body: JSON.stringify({
          name: rec.name, description: rec.description,
          triggerAttackType: rec.triggerAttackType, triggerSeverity: rec.triggerSeverity,
          triggerThreshold: rec.triggerThreshold, triggerWindowSecs: rec.triggerWindowSecs,
          actionType: rec.actionType, defenseType: rec.defenseType,
          targetVm: rec.targetVm, priority: rec.priority, isActive: true,
        }),
      });
      if (!r.ok) {
        const e = await r.json();
        const msg = typeof e.error === "string" ? e.error
          : e.error?.fieldErrors
            ? Object.entries(e.error.fieldErrors).map(([f, v]) => `${f}: ${(v as string[]).join(", ")}`).join(" | ")
            : JSON.stringify(e.error ?? "Failed");
        throw new Error(msg);
      }
      setAppliedRules(prev => new Set([...prev, rec.name]));
      toast({ title: "Rule Applied", description: `"${rec.name}" — Defense Rules page မှာ ကြည့်နိုင်သည်` });
    } catch (err: any) {
      toast({ title: "Failed", description: err.message, variant: "destructive" });
    }
  }

  async function runAiDefend(ip: string) {
    if (!ip) return;
    setAiLoading(true);
    setAiError(null);
    setAiResult(null);
    try {
      const r = await fetch(`${BASE}/api/ai/defend`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ip }),
      });
      if (!r.ok) {
        const e = await r.json();
        throw new Error(e.error ?? `HTTP ${r.status}`);
      }
      setAiResult(await r.json());
    } catch (err: any) {
      setAiError(err.message);
    } finally {
      setAiLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-primary uppercase">Defense Center</h1>
          <p className="text-sm text-muted-foreground">
            Auto and manual threat response controls.
            {deviceFilter && <span className="text-cyan-400 font-mono"> — scoped to {deviceFilter}</span>}
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground font-mono">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-primary" />
          </span>
          Live · auto-refreshes every 5–8s
        </div>
      </div>

      {/* ── Top status row ─────────────────────────────────────────────────── */}
      <div className={`grid gap-4 ${deviceFilter ? "grid-cols-4" : "grid-cols-2"}`}>
        {/* Auto Defense — real, persisted toggle (app_settings table) */}
        <Card className={`bg-card border-border ${status?.autoDefenseEnabled ? "" : "border-red-800/40"}`}>
          <CardContent className="p-4 flex items-center gap-3">
            <Bot className={`w-8 h-8 ${status?.autoDefenseEnabled ? "text-cyan-400" : "text-red-400"}`} />
            <div className="flex-1 min-w-0">
              <p className="text-xs text-muted-foreground uppercase tracking-wider">Auto Defense</p>
              <div className="flex items-center gap-2 mt-0.5">
                <Switch
                  checked={status?.autoDefenseEnabled ?? false}
                  disabled={toggleAutoDefenseMutation.isPending || !status}
                  onCheckedChange={checked => toggleAutoDefenseMutation.mutate(checked)}
                />
                <p className={`text-sm font-bold ${status?.autoDefenseEnabled ? "text-green-400" : "text-red-400"}`}>
                  {status?.autoDefenseEnabled ? "ENABLED" : "DISABLED"}
                </p>
              </div>
              <p className="text-[10px] text-muted-foreground/60 mt-1 leading-tight">
                company VM iptables · pfSense API · all active rules
              </p>
            </div>
          </CardContent>
        </Card>

        {/* IPs Blocked */}
        <Card className="bg-card border-border">
          <CardContent className="p-4 flex items-center gap-3">
            <Lock className="w-8 h-8 text-red-400" />
            <div>
              <p className="text-xs text-muted-foreground uppercase tracking-wider">IPs Blocked</p>
              <p className="text-3xl font-bold text-red-400">{status?.totalBlocked ?? activeBlocks.length}</p>
            </div>
          </CardContent>
        </Card>

        {/* When device scoped: show inline Fail2ban + Suricata in same 4-col row */}
        {deviceFilter && (
          <>
            <ServiceCard
              label="Fail2Ban"
              active={status?.fail2banActive}
              icon={<Shield className="w-8 h-8 text-green-400" />}
              justChanged={changedServices.has("fail2ban")}
            />
            <ServiceCard
              label="pfSense Suricata IDS"
              active={status?.suricataActive}
              icon={<Shield className="w-8 h-8 text-primary" />}
              justChanged={changedServices.has("suricata")}
            />
          </>
        )}
      </div>

      {/* ── "All Devices" per-host sensor breakdown ─────────────────────────── */}
      {!deviceFilter && (
        <Card className="bg-card border-border">
          <CardHeader className="pb-2 pt-3 px-4">
            <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
              <Shield className="w-3.5 h-3.5 text-primary" />
              Security Sensors — per host
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            {(!status?.perHostSensors || status.perHostSensors.length === 0) ? (
              <p className="text-xs text-muted-foreground py-2">No VM sensor data yet — forwarder must be running on each host</p>
            ) : (
              <div className="space-y-2">
                {status.perHostSensors.map(h => {
                  const anyOnline = h.sensors.some(s => s.status === "online");
                  return (
                    <div key={h.hostIp} className="bg-background rounded border border-border/50 px-3 py-2">
                      <div className="flex items-center gap-2 mb-2">
                        <div className="w-52 shrink-0">
                          <HostLabel ip={h.hostIp} showIp={true} />
                        </div>
                        <div className="ml-auto">
                          {anyOnline ? (
                            <span className="inline-block w-1.5 h-1.5 rounded-full bg-green-400 animate-ping" />
                          ) : (
                            <span className="inline-block w-1.5 h-1.5 rounded-full bg-red-500" />
                          )}
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {h.sensors.map(s => (
                          <div key={s.component} className="flex items-center gap-1">
                            <span className="text-[10px] text-muted-foreground font-mono">{s.component}</span>
                            <Badge
                              variant="outline"
                              className={`text-[10px] ${
                                s.status === "online"  ? "border-green-600 text-green-400" :
                                s.status === "offline" ? "border-red-600 text-red-400" :
                                                         "border-border text-muted-foreground"
                              }`}
                            >
                              {s.status === "online" ? "● UP" : s.status === "offline" ? "● DOWN" : "?"}
                            </Badge>
                          </div>
                        ))}
                        {h.sensors.length === 0 && (
                          <span className="text-[10px] text-muted-foreground">No sensor data</span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <Card className="bg-card border-border">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
              <UserCheck className="w-4 h-4 text-primary" /> Manual Block / Unblock
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Input
                placeholder="IP Address (e.g. 10.10.10.99 or 203.0.113.5)"
                value={blockIp}
                onChange={e => setBlockIp(e.target.value)}
                className="bg-background border-border font-mono text-sm"
              />
              <Input
                placeholder="Reason (e.g. Port scan detected, SSH breach)"
                value={blockReason}
                onChange={e => setBlockReason(e.target.value)}
                className="bg-background border-border text-sm"
              />
              <Button
                onClick={handleBlock}
                disabled={!blockIp || !blockReason || blockMutation.isPending}
                className="w-full bg-red-600 hover:bg-red-700 text-white font-semibold uppercase tracking-wider text-xs"
              >
                <Lock className="w-3.5 h-3.5 mr-2" />
                {blockMutation.isPending ? "Blocking..." : "Block IP"}
              </Button>
            </div>

            <div className="space-y-1.5 max-h-48 overflow-y-auto">
              <p className="text-xs text-muted-foreground uppercase tracking-wider mb-2">Active Blocks ({activeBlocks.length})</p>
              {activeBlocks.length === 0 ? (
                <p className="text-xs text-muted-foreground text-center py-4">No IPs currently blocked</p>
              ) : activeBlocks.map(b => (
                <div key={b.id} className="bg-background rounded border border-border/50 overflow-hidden">
                  {/* Top row: IP + badges + unblock button */}
                  <div className="flex items-center justify-between p-2">
                    <div className="flex items-center gap-2">
                      <Lock className="w-3 h-3 text-red-400 shrink-0" />
                      <div>
                        <p className="font-mono text-xs text-red-400">{b.ip}</p>
                        <p className="text-xs text-muted-foreground">{b.reason}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className={`text-[10px] flex items-center gap-1 ${b.blockedBy === "auto" ? "border-cyan-500/50 text-cyan-400 bg-cyan-500/10" : "border-slate-500/50 text-slate-400 bg-slate-500/10"}`}>
                        {b.blockedBy === "auto" ? (
                          <><Bot className="w-2.5 h-2.5" />AUTO</>
                        ) : (
                          <><UserCheck className="w-2.5 h-2.5" />MANUAL</>
                        )}
                      </Badge>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-6 px-2 text-xs border-green-800 text-green-400 hover:bg-green-900/20"
                        onClick={() => unblockMutation.mutate(b.ip)}
                        disabled={unblockMutation.isPending}
                      >
                        <Unlock className="w-3 h-3 mr-1" />Unblock
                      </Button>
                    </div>
                  </div>
                  {/* Unblock commands preview */}
                  <div className="border-t border-green-500/10 bg-green-950/20 px-3 py-2 space-y-1">
                    <p className="text-[9px] uppercase tracking-widest text-green-400/60 mb-1.5">Unblock will run:</p>
                    <pre className="font-mono text-[10px] text-green-300/70 whitespace-pre-wrap break-all leading-relaxed">
                      {`[VMs]     iptables -D INPUT -s ${b.ip} -j DROP\n[pfSense] easyrule pass WAN ${b.ip}`}
                    </pre>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

      {/* ── AI DEFENSE RECOMMENDATION ─────────────────────────────── */}
      <Card className="bg-card border-primary/30 shadow-[0_0_16px_rgba(var(--primary-rgb),0.06)]">
        <CardHeader className="pb-3 border-b border-border/50">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded bg-primary/10 flex items-center justify-center">
              <Bot className="w-3.5 h-3.5 text-primary" />
            </div>
            <CardTitle className="text-sm font-bold uppercase tracking-widest text-primary">
              AI Defense Recommendation
            </CardTitle>
          </div>
        </CardHeader>
        <CardContent className="pt-4 space-y-3">
          <div className="flex gap-2">
            <Input
              placeholder="Attacker IP (e.g. 10.10.10.99 or any IP)"
              value={aiIp}
              onChange={e => setAiIp(e.target.value)}
              className="bg-background border-border font-mono text-sm flex-1"
              onKeyDown={e => e.key === "Enter" && runAiDefend(aiIp)}
            />
            <Button
              onClick={() => runAiDefend(aiIp)}
              disabled={!aiIp || aiLoading}
              className="shrink-0"
            >
              {aiLoading ? (
                <><RefreshCcw className="w-3.5 h-3.5 mr-1.5 animate-spin" />Analyzing...</>
              ) : (
                <><Sparkles className="w-3.5 h-3.5 mr-1.5" />Analyze IP</>
              )}
            </Button>
          </div>

          {/* Quick-fill from active blocks */}
          {activeBlocks.length > 0 && !aiIp && (
            <div className="flex flex-wrap gap-1">
              <span className="text-[10px] text-muted-foreground uppercase tracking-wider self-center mr-1">Quick:</span>
              {activeBlocks.slice(0, 5).map(b => (
                <button
                  key={b.ip}
                  onClick={() => setAiIp(b.ip)}
                  className="font-mono text-[10px] px-2 py-0.5 rounded border border-border hover:border-primary/50 hover:text-primary transition-colors text-muted-foreground bg-background"
                >
                  {b.ip}
                </button>
              ))}
            </div>
          )}

          {aiError && (
            <div className="flex items-center gap-2 text-sm text-red-400 bg-red-900/20 border border-red-500/30 rounded p-3">
              <AlertTriangle className="w-4 h-4 flex-shrink-0" />
              <span>{aiError}</span>
            </div>
          )}

          {aiResult && (
            <div className="space-y-3">
              <div className="flex items-center gap-3 text-xs">
                <span className="font-mono text-red-400 font-bold">{aiResult.ip}</span>
                {(aiResult.eventCount ?? 0) > 0 && (
                  <Badge variant="outline" className="border-border text-muted-foreground">
                    {aiResult.eventCount} events
                  </Badge>
                )}
                {Object.entries(aiResult.attackTypes ?? {}).slice(0, 3).map(([t, n]) => (
                  <Badge key={t} variant="secondary" className="text-[10px]">{t}: {n}</Badge>
                ))}
              </div>
              <div className="bg-background border border-primary/20 rounded p-4 text-sm text-foreground leading-relaxed whitespace-pre-wrap max-h-56 overflow-y-auto">
                {aiResult.recommendation}
              </div>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  className="border-border text-xs"
                  onClick={() => runAiDefend(aiResult.ip)}
                  disabled={aiLoading}
                >
                  <RefreshCcw className={`w-3 h-3 mr-1 ${aiLoading ? "animate-spin" : ""}`} />
                  Re-analyze
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="border-red-800 text-red-400 hover:bg-red-900/20 text-xs"
                  onClick={() => { setBlockIp(aiResult.ip); setBlockReason("AI flagged — see AI Defense Recommendation"); }}
                >
                  <Lock className="w-3 h-3 mr-1" />
                  Block this IP
                </Button>
              </div>
            </div>
          )}

          {!aiResult && !aiLoading && !aiError && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground bg-muted/30 rounded p-3">
              <Zap className="w-3.5 h-3.5 text-primary/50" />
              IP တစ်ခု ထည့်ပြီး Analyze လုပ်ပါ — AI မှ attack history ကို ခွဲခြမ်းပြီး defense action recommend လုပ်မည်
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── AI RULE RECOMMENDATIONS ───────────────────────────────── */}
      <Card className="bg-card border-primary/30 shadow-[0_0_16px_rgba(var(--primary-rgb),0.06)]">
        <CardHeader className="pb-3 border-b border-border/50">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded bg-primary/10 flex items-center justify-center">
                <Sparkles className="w-3.5 h-3.5 text-primary" />
              </div>
              <CardTitle className="text-sm font-bold uppercase tracking-widest text-primary">
                AI Rule Suggestions
              </CardTitle>
            </div>
            <Button
              size="sm"
              onClick={fetchRuleRecs}
              disabled={ruleRecsLoading}
              className="text-xs"
            >
              {ruleRecsLoading ? (
                <><RefreshCcw className="w-3.5 h-3.5 mr-1.5 animate-spin" />Generating…</>
              ) : (
                <><Sparkles className="w-3.5 h-3.5 mr-1.5" />Get AI Suggestions</>
              )}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="pt-4">
          {!ruleRecs && !ruleRecsLoading && !ruleRecsError && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground bg-muted/30 rounded p-3">
              <Zap className="w-3.5 h-3.5 text-primary/50" />
              Recent attack pattern ကို analyze ပြီး defense rules suggest ပေးမည် — "Get AI Suggestions" နှိပ်ပါ
            </div>
          )}
          {ruleRecsError && (
            <div className="flex items-center gap-2 text-sm text-red-400 bg-red-900/20 border border-red-500/30 rounded p-3">
              <AlertTriangle className="w-4 h-4 flex-shrink-0" />{ruleRecsError}
            </div>
          )}
          {ruleRecs && ruleRecs.length === 0 && (
            <p className="text-xs text-muted-foreground text-center py-4">Attack data မလုံလောက်ဘဲ recommendation မထွက်သေးပါ</p>
          )}
          {ruleRecs && ruleRecs.length > 0 && (
            <div className="space-y-3">
              {ruleRecs.map((rec) => {
                const applied = appliedRules.has(rec.name);
                return (
                  <div key={rec.name} className={`rounded border p-3 space-y-2 transition-colors ${applied ? "border-green-700/50 bg-green-900/10" : "border-border bg-background/60"}`}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-bold text-foreground truncate">{rec.name}</p>
                        <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{rec.description}</p>
                      </div>
                      <Button
                        size="sm"
                        variant={applied ? "outline" : "default"}
                        className={`shrink-0 text-xs h-7 px-2 ${applied ? "border-green-700 text-green-400" : ""}`}
                        onClick={() => !applied && applyRule(rec)}
                        disabled={applied}
                      >
                        {applied ? <><Check className="w-3 h-3 mr-1" />Applied</> : <><Plus className="w-3 h-3 mr-1" />Apply</>}
                      </Button>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      <Badge variant="outline" className="text-[10px] border-border text-muted-foreground">
                        {rec.triggerAttackType}
                      </Badge>
                      <Badge variant="outline" className="text-[10px] border-orange-800 text-orange-400">
                        {rec.triggerSeverity}
                      </Badge>
                      <Badge variant="outline" className="text-[10px] border-border text-muted-foreground">
                        ≥{rec.triggerThreshold} / {rec.triggerWindowSecs}s
                      </Badge>
                      <Badge variant="outline" className={`text-[10px] ${rec.actionType === "auto" ? "border-cyan-800 text-cyan-400" : "border-yellow-800 text-yellow-400"}`}>
                        {rec.actionType.toUpperCase()}
                      </Badge>
                      <Badge variant="outline" className="text-[10px] border-border text-muted-foreground">
                        {rec.defenseType} @ {rec.targetVm}
                      </Badge>
                    </div>
                    {rec.reasoning && (
                      <p className="text-[11px] text-muted-foreground/80 leading-relaxed border-t border-border/40 pt-2">
                        {rec.reasoning}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="bg-card border-border">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            Defense Action Log
          </CardTitle>
        </CardHeader>
        <CardContent>
          {actions.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Shield className="w-10 h-10 mx-auto mb-3 opacity-30" />
              <p className="text-sm">No defense actions yet.</p>
              <p className="text-xs mt-1">Actions appear when IPs are blocked or unblocked.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-xs text-muted-foreground uppercase tracking-wider">
                    <th className="text-left py-2 px-3">Time</th>
                    <th className="text-left py-2 px-3">Action</th>
                    <th className="text-left py-2 px-3">Target IP</th>
                    <th className="text-left py-2 px-3">Reason</th>
                    <th className="text-left py-2 px-3">By</th>
                    <th className="text-left py-2 px-3">Type</th>
                    <th className="text-left py-2 px-3">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {actions.map(a => (
                    <tr key={a.id} className="border-b border-border/50 hover:bg-primary/5 transition-colors">
                      <td className="py-2 px-3 text-xs text-muted-foreground font-mono">
                        {format(new Date(a.createdAt), "MM/dd HH:mm:ss")}
                      </td>
                      <td className={`py-2 px-3 flex items-center gap-1.5 font-mono text-xs font-bold ${actionColors[a.action] ?? "text-gray-400"}`}>
                        {actionIcons[a.action]}
                        {a.action.toUpperCase()}
                      </td>
                      <td className="py-2 px-3 font-mono text-xs text-cyan-400">{a.targetIp}</td>
                      <td className="py-2 px-3 text-xs text-muted-foreground max-w-xs truncate">{a.reason}</td>
                      <td className="py-2 px-3 text-xs">
                        {a.performedBy === "admin"
                          ? <span className="flex items-center gap-1 text-blue-400"><UserCheck className="w-3 h-3" />Admin</span>
                          : <span className="flex items-center gap-1 text-cyan-400"><Bot className="w-3 h-3" />Auto</span>}
                      </td>
                      <td className="py-2 px-3">
                        <Badge variant="outline" className={`text-xs ${a.type === "auto" ? "border-cyan-800 text-cyan-400" : "border-blue-800 text-blue-400"}`}>
                          {a.type.toUpperCase()}
                        </Badge>
                      </td>
                      <td className="py-2 px-3">
                        <span className={`text-xs ${a.status === "success" ? "text-green-400" : "text-red-400"}`}>
                          {a.status.toUpperCase()}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {historyBlocks.length > 0 && (
        <Card className="bg-card border-border">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
              Block History
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-1.5 max-h-48 overflow-y-auto">
              {historyBlocks.map(b => (
                <div key={b.id} className="flex items-center justify-between bg-background/50 rounded p-2 border border-border/30 opacity-60">
                  <div className="flex items-center gap-2">
                    <Unlock className="w-3 h-3 text-gray-500 shrink-0" />
                    <div>
                      <p className="font-mono text-xs text-gray-400">{b.ip}</p>
                      <p className="text-xs text-muted-foreground">{b.reason}</p>
                    </div>
                  </div>
                  <div className="text-xs text-muted-foreground font-mono">
                    {b.unblockedAt ? format(new Date(b.unblockedAt), "MM/dd HH:mm") : "—"}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
