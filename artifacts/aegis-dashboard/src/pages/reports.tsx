import { useState, useEffect, useRef } from "react";
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
import { Download, Plus, Search, FileBarChart, Trash2, Sparkles, RefreshCcw, Bot, AlertTriangle, ShieldCheck, Zap, Volume2, Pause, Play, Square } from "lucide-react";
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

/** Renders AI analysis text with English section headings styled distinctly */
function AiAnalysisText({ text }: { text: string }) {
  const lines = text.split("\n");
  return (
    <div className="space-y-1">
      {lines.map((line, i) => {
        // English uppercase section header: e.g. "THREAT SUMMARY:" or "RECOMMENDATIONS:"
        const isSectionHeader =
          /^[A-Z][A-Z\s]{2,}:/.test(line.trim()) && line.trim().length < 80;
        if (!line.trim()) return <div key={i} className="h-2" />;
        return isSectionHeader ? (
          <div key={i} className="flex items-center gap-2 mt-4 mb-1">
            <span className="w-1 h-3.5 bg-primary rounded-sm flex-shrink-0" />
            <p className="text-[11px] font-bold text-primary uppercase tracking-widest">
              {line.replace(/:$/, "")}
            </p>
          </div>
        ) : (
          <p key={i} className="text-sm text-muted-foreground leading-relaxed pl-3">
            {line}
          </p>
        );
      })}
    </div>
  );
}

/** Clean the raw text before sending to TTS */
function preprocessTts(raw: string): string {
  return raw
    .replace(/_+/g, " ")
    .replace(/ {2,}/g, " ")
    .trim();
}

/**
 * English voice reader.
 *
 * The browser Speech Synthesis API is unreliable in Chrome (it can cancel
 * itself after the first utterance and can produce no audible output). The
 * API already exposes a server-side TTS proxy, so preload its MP3 chunks and
 * play them through a real audio element. Speech Synthesis remains a fallback
 * for when the proxy or the network is unavailable.
 */
function VoiceReader({ text }: { text: string }) {
  const [speaking, setSpeaking] = useState(false);
  const [paused, setPaused]     = useState(false);
  const [voices, setVoices]     = useState<SpeechSynthesisVoice[]>([]);
  const [audioReady, setAudioReady] = useState(false);
  const [audioLoading, setAudioLoading] = useState(true);
  const [audioError, setAudioError] = useState<string | null>(null);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioUrlsRef = useRef<string[]>([]);
  const audioIndexRef = useRef(0);
  const requestRef = useRef<AbortController | null>(null);
  const playbackIdRef = useRef(0);
  const supported = typeof window !== "undefined" && "speechSynthesis" in window;

  useEffect(() => {
    if (!supported) return;
    const load = () => {
      const v = window.speechSynthesis.getVoices();
      if (v.length > 0) setVoices(v);
    };
    load();
    window.speechSynthesis.addEventListener("voiceschanged", load);
    return () => {
      window.speechSynthesis.removeEventListener("voiceschanged", load);
    };
  }, [supported]);

  function releaseAudioUrls() {
    audioUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    audioUrlsRef.current = [];
  }

  function stopPlayback() {
    playbackIdRef.current += 1;
    requestRef.current?.abort();
    requestRef.current = null;
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.removeAttribute("src");
      audioRef.current.load();
    }
    if (supported) {
      window.speechSynthesis.cancel();
    }
    setSpeaking(false);
    setPaused(false);
  }

  // Preload the complete briefing so the click starts a local audio file
  // immediately, avoiding autoplay restrictions after an async fetch.
  useEffect(() => {
    let cancelled = false;
    stopPlayback();
    releaseAudioUrls();
    setAudioReady(false);
    setAudioLoading(true);
    setAudioError(null);

    const controller = new AbortController();
    requestRef.current = controller;

    (async () => {
      try {
        const response = await fetch(`${BASE}/api/tts/speak`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: preprocessTts(text), lang: "en" }),
          signal: controller.signal,
        });
        if (!response.ok) {
          const body = await response.json().catch(() => ({}));
          throw new Error(body.error ?? `TTS request failed (${response.status})`);
        }
        const data = await response.json() as { chunks?: string[] };
        if (!data.chunks?.length) throw new Error("TTS returned no audio");

        const urls = data.chunks.map((chunk) => {
          const binary = atob(chunk);
          const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
          return URL.createObjectURL(new Blob([bytes], { type: "audio/mpeg" }));
        });
        if (cancelled) {
          urls.forEach((url) => URL.revokeObjectURL(url));
          return;
        }
        audioUrlsRef.current = urls;
        setAudioReady(true);
      } catch (error: any) {
        if (!cancelled && error?.name !== "AbortError") {
          setAudioError(error?.message ?? "English audio is unavailable");
          // Keep the control usable even when the API is offline or its TTS
          // provider is unavailable. The browser fallback is still better
          // than disabling the only Listen action.
          setAudioReady(false);
        }
      } finally {
        if (!cancelled) setAudioLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
      stopPlayback();
      releaseAudioUrls();
    };
  }, [text]);

  function pickVoice(lang: string): SpeechSynthesisVoice | undefined {
    if (!voices.length) return undefined;
    const prefix = lang.split("-")[0];
    return (
      voices.find((v) => v.lang === lang) ??
      voices.find((v) => v.lang.startsWith(prefix)) ??
      voices.find((v) => v.default) ??
      voices[0]
    );
  }

  function speakFallback() {
    if (!supported) {
      setAudioError("Audio playback is not supported in this browser");
      return;
    }
    stopPlayback();
    playbackIdRef.current += 1;
    setSpeaking(true);
    const utterance = new SpeechSynthesisUtterance(preprocessTts(text));
    utterance.lang = "en-US";
    const voice = pickVoice("en-US");
    if (voice) utterance.voice = voice;
    utterance.rate = 0.88;
    utterance.onend = () => setSpeaking(false);
    utterance.onerror = () => {
      setSpeaking(false);
      setAudioError("The browser could not play the English briefing");
    };
    window.speechSynthesis.speak(utterance);
  }

  function playNextChunk(playbackId: number) {
    const audio = audioRef.current;
    const url = audioUrlsRef.current[audioIndexRef.current];
    if (!audio || !url || playbackId !== playbackIdRef.current) {
      if (playbackId === playbackIdRef.current) setSpeaking(false);
      return;
    }
    audio.src = url;
    audio.onended = () => {
      if (playbackId !== playbackIdRef.current) return;
      audioIndexRef.current += 1;
      playNextChunk(playbackId);
    };
    audio.onerror = () => {
      if (playbackId === playbackIdRef.current) speakFallback();
    };
    audio.play().catch(() => {
      if (playbackId === playbackIdRef.current) speakFallback();
    });
  }

  function speakAudio() {
    if (!audioReady) {
      if (!audioLoading) speakFallback();
      return;
    }
    stopPlayback();
    const playbackId = ++playbackIdRef.current;
    audioIndexRef.current = 0;
    setSpeaking(true);
    setAudioError(null);
    playNextChunk(playbackId);
  }

  function handleTogglePause() {
    if (paused) {
      audioRef.current?.play();
      if (supported) window.speechSynthesis.resume();
      setPaused(false);
    } else {
      audioRef.current?.pause();
      if (supported) window.speechSynthesis.pause();
      setPaused(true);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <audio ref={audioRef} preload="auto" className="hidden" />
      {!speaking ? (
        <button
          onClick={speakAudio}
          disabled={audioLoading}
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-primary disabled:opacity-50 disabled:cursor-wait transition-colors border border-border hover:border-primary/50 rounded px-2.5 py-1.5"
          title={audioLoading ? "Preparing English audio..." : "Listen in English"}
        >
          <Volume2 className="w-3.5 h-3.5" />
          {audioLoading ? "Preparing..." : "Listen"}
        </button>
      ) : (
        <>
          <div className="flex gap-0.5 items-center h-5">
            {[3, 6, 10, 7, 4, 8, 5].map((h, i) => (
              <span
                key={i}
                className={`w-0.5 rounded-full bg-primary transition-all ${paused ? "" : "animate-pulse"}`}
                style={{ height: paused ? "3px" : `${h}px`, animationDelay: `${i * 80}ms`, animationDuration: "600ms" }}
              />
            ))}
          </div>
          <button onClick={handleTogglePause} title={paused ? "Resume" : "Pause"}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-primary border border-border hover:border-primary/40 rounded px-2 py-1.5">
            {paused ? <Play className="w-3 h-3" /> : <Pause className="w-3 h-3" />}
          </button>
          <button onClick={stopPlayback} title="Stop"
            className="flex items-center gap-1 text-xs text-red-400 border border-red-500/30 hover:border-red-500/60 rounded px-2 py-1.5">
            <Square className="w-3 h-3" />
          </button>
        </>
      )}
      {audioError && !speaking && (
        <span className="text-[10px] text-red-400 max-w-[12rem]" title={audioError}>
          Audio fallback
        </span>
      )}
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
  const briefingLang = "en" as const;

  const queryClient = useQueryClient();
  const { toast } = useToast();

  // Auto-load AI briefing on mount + auto-refresh every 5 minutes (real-time)
  // Language is always English
  useEffect(() => {
    loadAiBriefing();
    const timer = setInterval(() => loadAiBriefing(), 5 * 60 * 1000);
    return () => clearInterval(timer);
  }, []);

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
              ? "Report compiled with Groq AI security analysis."
              : "Security report compiled.",
          });
        }
      }
    );
  };

  async function loadAiBriefing(lang?: "en" | "my") {
    const useLang = lang ?? briefingLang;
    setAiLoading(true);
    setAiError(null);
    try {
      const r = await fetch(`${BASE}/api/ai/threat-analysis?lang=${useLang}`);
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
    toast({ title: "Downloading", description: `Starting download for "${reportTitle}".` });
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
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 min-w-0">
              <div className="w-7 h-7 rounded bg-primary/10 flex items-center justify-center flex-shrink-0">
                <Bot className="w-4 h-4 text-primary" />
              </div>
              <div className="min-w-0">
                <CardTitle className="text-sm font-bold uppercase tracking-widest text-primary">AI Threat Briefing</CardTitle>
                <CardDescription className="text-[11px]">
                  {aiData
                    ? `Generated at ${format(new Date(aiData.generatedAt), "HH:mm:ss")} — Groq llama-3.3-70b`
                    : "Current security posture analysis powered by Groq LLM"}
                </CardDescription>
              </div>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              {/* Voice reader */}
              {aiData && <VoiceReader text={aiData.analysis} />}
              {/* Analyze / Refresh button */}
              <Button
                size="sm"
                variant={aiData ? "outline" : "default"}
                onClick={() => loadAiBriefing()}
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
              <span className="text-sm">AI is analyzing current security data...</span>
            </div>
          )}
          {!aiData && !aiLoading && !aiError && (
            <div className="flex flex-col items-center justify-center py-8 gap-2 text-center">
              <Sparkles className="w-8 h-8 text-primary/30" />
              <p className="text-sm text-muted-foreground">
                Click "Analyze Now" — AI will analyze the current security posture in real-time
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
              <div className="lg:col-span-2 bg-background border border-border rounded p-4 overflow-y-auto max-h-[32rem]">
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

                <div className="py-2 border-y border-border/50">
                  <div className="text-center">
                    <div className="text-xs uppercase text-muted-foreground tracking-wider mb-1">Events</div>
                    <div className="font-mono text-lg font-bold text-foreground">{report.eventsCount}</div>
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
