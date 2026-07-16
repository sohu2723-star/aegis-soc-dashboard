import { useState } from "react";
import { useListReports, useGenerateReport, getListReportsQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { format } from "date-fns";
import { Download, Plus, Search, FileBarChart, Trash2, Sparkles, RefreshCcw, Bot, AlertTriangle, ShieldCheck, Zap } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

interface ThreatAnalysis {
  analysis: string;
  generatedAt: string;
  dataPoints: {
    totalEvents: number;
    openIncidents: number;
    unackedAlerts: number;
    topAttackers: { ip: string; count: number }[];
  };
}

/** Renders AI analysis text with section labels highlighted */
function AiAnalysisText({ text }: { text: string }) {
  const lines = text.split("\n");
  return (
    <div className="space-y-1">
      {lines.map((line, i) => {
        const isSectionHeader = /^[A-Z\s]+:/.test(line.trim()) && line.trim().length < 60;
        if (!line.trim()) return <div key={i} className="h-2" />;
        return (
          <p
            key={i}
            className={
              isSectionHeader
                ? "text-xs font-bold text-primary uppercase tracking-widest mt-3 mb-1"
                : "text-sm text-muted-foreground leading-relaxed"
            }
          >
            {line}
          </p>
        );
      })}
    </div>
  );
}

export default function Reports() {
  const [isGenerateOpen, setIsGenerateOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [type, setType] = useState("daily");
  const [formatType, setFormatType] = useState("html");
  const [search, setSearch] = useState("");
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ id: number; title: string } | null>(null);

  // AI Briefing state
  const [aiData, setAiData] = useState<ThreatAnalysis | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);

  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: reports, isLoading } = useListReports({ query: { queryKey: getListReportsQueryKey() } });
  const generateReport = useGenerateReport();

  const filtered = reports?.filter(r =>
    r.title.toLowerCase().includes(search.toLowerCase()) ||
    r.type.toLowerCase().includes(search.toLowerCase())
  );

  const handleGenerate = (e: React.FormEvent) => {
    e.preventDefault();
    generateReport.mutate(
      { data: { title, type: type as any, format: formatType as any } },
      {
        onSuccess: (data: any) => {
          queryClient.invalidateQueries({ queryKey: getListReportsQueryKey() });
          setIsGenerateOpen(false);
          setTitle("");
          toast({
            title: data?.aiGenerated ? "✨ AI Report Generated" : "Report Generated",
            description: data?.aiGenerated
              ? "GROQ AI မှ security analysis ပါ report compile ပြီးပြီ။"
              : "Security report compile ပြီးပြီ။",
          });
        }
      }
    );
  };

  async function loadAiBriefing() {
    setAiLoading(true);
    setAiError(null);
    try {
      const r = await fetch(`${BASE}/api/ai/threat-analysis`);
      if (!r.ok) {
        const e = await r.json();
        throw new Error(e.error ?? `HTTP ${r.status}`);
      }
      setAiData(await r.json());
    } catch (err: any) {
      setAiError(err.message);
    } finally {
      setAiLoading(false);
    }
  }

  function handleDownload(id: number, reportTitle: string, reportType: string) {
    const url = `${BASE}/api/reports/${id}/download`;
    const a = document.createElement("a");
    a.href = url;
    a.download = `aegis-report-${id}-${reportType}.html`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    toast({ title: "Downloading", description: `"${reportTitle}" download ကို စတင်နေပြီ။` });
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    const { id, title } = deleteTarget;
    setDeleteTarget(null);
    setDeletingId(id);
    try {
      const res = await fetch(`${BASE}/api/reports/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      queryClient.invalidateQueries({ queryKey: getListReportsQueryKey() });
      toast({ title: "Report Deleted", description: `"${title}" ကို ဖျက်ပြီးပြီ။` });
    } catch (err: any) {
      toast({ title: "Delete Failed", description: err.message, variant: "destructive" });
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <>
    <AlertDialog open={!!deleteTarget} onOpenChange={open => { if (!open) setDeleteTarget(null); }}>
      <AlertDialogContent className="bg-card border-border">
        <AlertDialogHeader>
          <AlertDialogTitle className="text-red-400 uppercase tracking-widest">Report ဖျက်မည်</AlertDialogTitle>
          <AlertDialogDescription>
            <span className="font-bold text-foreground">"{deleteTarget?.title}"</span> ကို ဖျက်မည်။ ဤ action ကို ပြန်ဖြည်မရပါ။
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel className="border-border">Cancel</AlertDialogCancel>
          <AlertDialogAction className="bg-red-600 hover:bg-red-700 text-white" onClick={confirmDelete}>
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>

    <div className="space-y-6 h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-primary uppercase">Security Reports</h1>
          <p className="text-sm text-muted-foreground">Historical analysis and compliance documentation.</p>
        </div>
        <Dialog open={isGenerateOpen} onOpenChange={setIsGenerateOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="w-4 h-4 mr-2" />
              Generate Report
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-[425px] bg-card border-border">
            <DialogHeader>
              <DialogTitle className="text-primary uppercase tracking-widest">Generate New Report</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleGenerate} className="space-y-4 pt-4">
              <div className="space-y-2">
                <Label htmlFor="title" className="text-xs uppercase text-muted-foreground">Report Title</Label>
                <Input id="title" value={title} onChange={e => setTitle(e.target.value)} required className="bg-background border-border" placeholder="e.g. Q3 Security Summary" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label className="text-xs uppercase text-muted-foreground">Report Type</Label>
                  <Select value={type} onValueChange={setType}>
                    <SelectTrigger className="bg-background border-border"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="daily">Daily Summary</SelectItem>
                      <SelectItem value="weekly">Weekly Analysis</SelectItem>
                      <SelectItem value="incident">Incident Post-Mortem</SelectItem>
                      <SelectItem value="custom">Custom Range</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label className="text-xs uppercase text-muted-foreground">Format</Label>
                  <Select value={formatType} onValueChange={setFormatType}>
                    <SelectTrigger className="bg-background border-border"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="html">HTML Report</SelectItem>
                      <SelectItem value="pdf">PDF (HTML)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="flex items-center gap-2 text-xs text-muted-foreground bg-primary/5 border border-primary/20 rounded p-2">
                <Sparkles className="w-3.5 h-3.5 text-primary flex-shrink-0" />
                <span>AI ကို သုံး၍ report summary ကို auto-generate လုပ်မည်</span>
              </div>
              <div className="flex justify-end pt-2">
                <Button type="submit" disabled={generateReport.isPending}>
                  {generateReport.isPending ? (
                    <><RefreshCcw className="w-4 h-4 mr-2 animate-spin" />AI Compiling...</>
                  ) : (
                    <><Sparkles className="w-4 h-4 mr-2" />Generate with AI</>
                  )}
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {/* ── AI THREAT BRIEFING ─────────────────────────────────── */}
      <Card className="bg-card border-primary/30 shadow-[0_0_20px_rgba(var(--primary-rgb),0.08)]">
        <CardHeader className="pb-3 border-b border-border/50">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded bg-primary/10 flex items-center justify-center">
                <Bot className="w-4 h-4 text-primary" />
              </div>
              <div>
                <CardTitle className="text-sm font-bold uppercase tracking-widest text-primary">AI Threat Briefing</CardTitle>
                <CardDescription className="text-[11px]">
                  {aiData
                    ? `Generated at ${format(new Date(aiData.generatedAt), "HH:mm:ss")} — Groq llama-3.3-70b`
                    : "Current security posture analysis powered by Groq LLM"}
                </CardDescription>
              </div>
            </div>
            <Button
              size="sm"
              variant={aiData ? "outline" : "default"}
              onClick={loadAiBriefing}
              disabled={aiLoading}
              className={aiData ? "border-border" : ""}
            >
              {aiLoading ? (
                <><RefreshCcw className="w-3.5 h-3.5 mr-1.5 animate-spin" />Analyzing...</>
              ) : aiData ? (
                <><RefreshCcw className="w-3.5 h-3.5 mr-1.5" />Refresh</>
              ) : (
                <><Sparkles className="w-3.5 h-3.5 mr-1.5" />Analyze Now</>
              )}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="pt-4">
          {aiError && (
            <div className="flex items-center gap-2 text-sm text-red-400 bg-red-900/20 border border-red-500/30 rounded p-3">
              <AlertTriangle className="w-4 h-4 flex-shrink-0" />
              <span>{aiError}</span>
            </div>
          )}
          {aiLoading && !aiData && (
            <div className="flex items-center justify-center py-8 gap-3 text-muted-foreground">
              <RefreshCcw className="w-4 h-4 animate-spin text-primary" />
              <span className="text-sm">AI မှ security data ကို analyze လုပ်နေသည်...</span>
            </div>
          )}
          {!aiData && !aiLoading && !aiError && (
            <div className="flex flex-col items-center justify-center py-8 gap-2 text-center">
              <Sparkles className="w-8 h-8 text-primary/30" />
              <p className="text-sm text-muted-foreground">
                "Analyze Now" ကို နှိပ်ပါ — AI မှ လက်ရှိ security posture ကို real-time analyze လုပ်မည်
              </p>
            </div>
          )}
          {aiData && (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              {/* Stats */}
              <div className="lg:col-span-1 space-y-3">
                <div className="grid grid-cols-3 lg:grid-cols-1 gap-2">
                  <div className="bg-background border border-border rounded p-3 text-center lg:text-left flex lg:flex-row items-center gap-2">
                    <Zap className="w-4 h-4 text-yellow-400 flex-shrink-0" />
                    <div>
                      <div className="text-xs text-muted-foreground uppercase">Events (24h)</div>
                      <div className="font-mono text-lg font-bold">{aiData.dataPoints.totalEvents}</div>
                    </div>
                  </div>
                  <div className="bg-background border border-border rounded p-3 text-center lg:text-left flex lg:flex-row items-center gap-2">
                    <AlertTriangle className="w-4 h-4 text-orange-400 flex-shrink-0" />
                    <div>
                      <div className="text-xs text-muted-foreground uppercase">Open Incidents</div>
                      <div className="font-mono text-lg font-bold">{aiData.dataPoints.openIncidents}</div>
                    </div>
                  </div>
                  <div className="bg-background border border-border rounded p-3 text-center lg:text-left flex lg:flex-row items-center gap-2">
                    <ShieldCheck className="w-4 h-4 text-red-400 flex-shrink-0" />
                    <div>
                      <div className="text-xs text-muted-foreground uppercase">Unacked Alerts</div>
                      <div className="font-mono text-lg font-bold">{aiData.dataPoints.unackedAlerts}</div>
                    </div>
                  </div>
                </div>
                {aiData.dataPoints.topAttackers.length > 0 && (
                  <div className="bg-background border border-border rounded p-3">
                    <div className="text-xs text-muted-foreground uppercase tracking-wider mb-2">Top Attackers</div>
                    {aiData.dataPoints.topAttackers.map(a => (
                      <div key={a.ip} className="flex justify-between items-center py-0.5">
                        <span className="font-mono text-xs text-red-400">{a.ip}</span>
                        <Badge variant="outline" className="text-[10px] border-border">{a.count}</Badge>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              {/* Analysis Text */}
              <div className="lg:col-span-2 bg-background border border-border rounded p-4 overflow-y-auto max-h-64">
                <AiAnalysisText text={aiData.analysis} />
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Search bar */}
      <div className="flex gap-4 items-center bg-card p-4 border border-border rounded-lg">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search reports..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-9 bg-background border-border"
          />
        </div>
        <span className="text-xs text-muted-foreground">{filtered?.length ?? 0} reports</span>
      </div>

      {/* Report cards */}
      {isLoading ? (
        <div className="text-center py-12 text-muted-foreground border border-border rounded-lg bg-card border-dashed">
          Loading report history...
        </div>
      ) : filtered?.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground border border-border rounded-lg bg-card border-dashed flex flex-col items-center">
          <FileBarChart className="h-8 w-8 mb-4 text-muted-foreground/50" />
          <p>No reports generated yet.</p>
          <p className="text-xs mt-1 text-muted-foreground/60">Click "Generate Report" to create your first AI-powered report.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered?.map((report) => (
            <Card key={report.id} className="bg-card border-border hover:border-primary/50 transition-colors group">
              <CardHeader className="pb-3 border-b border-border/50">
                <div className="flex justify-between items-start mb-2">
                  <Badge variant="outline" className="uppercase text-[10px] tracking-wider text-muted-foreground border-border bg-background">
                    {report.type}
                  </Badge>
                  <div className="flex gap-1">
                    <Badge variant="secondary" className="uppercase text-[10px] tracking-wider font-mono">
                      {report.format}
                    </Badge>
                  </div>
                </div>
                <CardTitle className="text-base font-bold group-hover:text-primary transition-colors">{report.title}</CardTitle>
                <CardDescription className="text-xs font-mono mt-1">
                  {format(new Date(report.generatedAt), "yyyy-MM-dd HH:mm")}
                </CardDescription>
              </CardHeader>
              <CardContent className="pt-4 space-y-4">
                <p className="text-sm text-muted-foreground line-clamp-3">
                  {report.summary}
                </p>

                <div className="grid grid-cols-2 gap-2 py-2 border-y border-border/50">
                  <div className="text-center">
                    <div className="text-xs uppercase text-muted-foreground tracking-wider mb-1">Events</div>
                    <div className="font-mono text-lg font-bold text-foreground">{report.eventsCount}</div>
                  </div>
                  <div className="text-center border-l border-border/50">
                    <div className="text-xs uppercase text-muted-foreground tracking-wider mb-1">Incidents</div>
                    <div className="font-mono text-lg font-bold text-foreground">{report.incidentsCount}</div>
                  </div>
                </div>

                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    className="flex-1 border-border hover:bg-primary/10 hover:text-primary hover:border-primary/50"
                    onClick={() => handleDownload(report.id, report.title, report.type)}
                  >
                    <Download className="w-4 h-4 mr-2" />
                    Download
                  </Button>
                  <Button
                    variant="outline"
                    size="icon"
                    className="border-border text-red-500 hover:text-red-400 hover:bg-red-500/10 hover:border-red-500/30"
                    disabled={deletingId === report.id}
                    onClick={() => setDeleteTarget({ id: report.id, title: report.title })}
                    title="Delete report"
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
    </>
  );
}
