import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Shield, ShieldOff, Lock, Unlock, Bot, UserCheck, AlertTriangle, RefreshCcw } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { useToast } from "@/hooks/use-toast";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

interface BlockedIp {
  id: number;
  ip: string;
  reason: string;
  blockedBy: string;
  isActive: boolean;
  blockedAt: string;
  unblockedAt: string | null;
}

interface DefenseAction {
  id: number;
  type: string;
  action: string;
  targetIp: string;
  reason: string;
  performedBy: string;
  status: string;
  createdAt: string;
}

interface DefenseStatus {
  autoDefenseEnabled: boolean;
  fail2banActive: boolean;
  suricataActive: boolean;
  totalBlocked: number;
  recentActions: DefenseAction[];
}

function useBlocks() {
  return useQuery<BlockedIp[]>({
    queryKey: ["defense-blocks"],
    queryFn: async () => {
      const r = await fetch(`${BASE}/api/defense/blocks`);
      return r.json();
    },
    refetchInterval: 8000,
  });
}

function useDefenseStatus() {
  return useQuery<DefenseStatus>({
    queryKey: ["defense-status"],
    queryFn: async () => {
      const r = await fetch(`${BASE}/api/defense/status`);
      return r.json();
    },
    refetchInterval: 8000,
  });
}

function useDefenseActions() {
  return useQuery<DefenseAction[]>({
    queryKey: ["defense-actions"],
    queryFn: async () => {
      const r = await fetch(`${BASE}/api/defense/actions`);
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

export default function Defense() {
  const [blockIp, setBlockIp] = useState("");
  const [blockReason, setBlockReason] = useState("");
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data: blocks = [], refetch: refetchBlocks } = useBlocks();
  const { data: status } = useDefenseStatus();
  const { data: actions = [] } = useDefenseActions();

  const activeBlocks = blocks.filter(b => b.isActive);
  const historyBlocks = blocks.filter(b => !b.isActive);

  const blockMutation = useMutation({
    mutationFn: async ({ ip, reason }: { ip: string; reason: string }) => {
      const r = await fetch(`${BASE}/api/defense/block`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ip, reason }),
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
      const r = await fetch(`${BASE}/api/defense/block/${encodeURIComponent(ip)}`, { method: "DELETE" });
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

  const handleBlock = () => {
    if (!blockIp || !blockReason) return;
    blockMutation.mutate({ ip: blockIp, reason: blockReason });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-primary uppercase">Defense Center</h1>
          <p className="text-sm text-muted-foreground">Auto and manual threat response controls.</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetchBlocks()} className="border-border">
          <RefreshCcw className="w-4 h-4 mr-2" />
          Refresh
        </Button>
      </div>

      <div className="grid grid-cols-4 gap-4">
        <Card className="bg-card border-border">
          <CardContent className="p-4 flex items-center gap-3">
            <Bot className="w-8 h-8 text-cyan-400" />
            <div>
              <p className="text-xs text-muted-foreground uppercase tracking-wider">Auto Defense</p>
              <p className={`text-sm font-bold ${status?.autoDefenseEnabled ? "text-green-400" : "text-red-400"}`}>
                {status?.autoDefenseEnabled ? "ENABLED" : "DISABLED"}
              </p>
            </div>
          </CardContent>
        </Card>
        <Card className="bg-card border-border">
          <CardContent className="p-4 flex items-center gap-3">
            <Shield className="w-8 h-8 text-green-400" />
            <div>
              <p className="text-xs text-muted-foreground uppercase tracking-wider">Fail2Ban</p>
              <p className={`text-sm font-bold ${status?.fail2banActive ? "text-green-400" : "text-red-400"}`}>
                {status?.fail2banActive ? "ACTIVE" : "DOWN"}
              </p>
            </div>
          </CardContent>
        </Card>
        <Card className="bg-card border-border">
          <CardContent className="p-4 flex items-center gap-3">
            <Shield className="w-8 h-8 text-primary" />
            <div>
              <p className="text-xs text-muted-foreground uppercase tracking-wider">Suricata IDS</p>
              <p className={`text-sm font-bold ${status?.suricataActive ? "text-green-400" : "text-red-400"}`}>
                {status?.suricataActive ? "ACTIVE" : "DOWN"}
              </p>
            </div>
          </CardContent>
        </Card>
        <Card className="bg-card border-border">
          <CardContent className="p-4 flex items-center gap-3">
            <Lock className="w-8 h-8 text-red-400" />
            <div>
              <p className="text-xs text-muted-foreground uppercase tracking-wider">IPs Blocked</p>
              <p className="text-3xl font-bold text-red-400">{status?.totalBlocked ?? activeBlocks.length}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="bg-card border-border">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
              <UserCheck className="w-4 h-4 text-primary" /> Manual Block / Unblock
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Input
                placeholder="IP Address (e.g. 192.168.56.101)"
                value={blockIp}
                onChange={e => setBlockIp(e.target.value)}
                className="bg-background border-border font-mono text-sm"
              />
              <Input
                placeholder="Reason (e.g. Port scan from Kali)"
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
                <div key={b.id} className="flex items-center justify-between bg-background rounded p-2 border border-border/50">
                  <div className="flex items-center gap-2">
                    <Lock className="w-3 h-3 text-red-400 shrink-0" />
                    <div>
                      <p className="font-mono text-xs text-red-400">{b.ip}</p>
                      <p className="text-xs text-muted-foreground">{b.reason}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="text-xs">
                      {b.blockedBy === "auto" ? (
                        <span className="flex items-center gap-1"><Bot className="w-3 h-3" />AUTO</span>
                      ) : (
                        <span className="flex items-center gap-1"><UserCheck className="w-3 h-3" />MANUAL</span>
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
              ))}
            </div>
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
                      <td className="py-2 px-3 font-mono text-xs text-primary">{a.targetIp}</td>
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
