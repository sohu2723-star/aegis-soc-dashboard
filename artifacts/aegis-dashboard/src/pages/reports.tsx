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

/** Detect if a string is predominantly Burmese (used for display styling only) */
function isBurmeseText(text: string): boolean {
  const burmese = (text.match(/[\u1000-\u109F\uAA60-\uAA7F]/g) ?? []).length;
  return burmese > text.length * 0.15;
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

// ── TTS text preprocessing & language segmentation ──────────────────────────

const MY_CHAR_RE = /[\u1000-\u109F\uAA60-\uAA7F]/;
const MY_DIGITS = ["၀","၁","၂","၃","၄","၅","၆","၇","၈","၉"];
const IP_PATTERN = /^\s*\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}(?::\d+)?\s*$/;

function toMyanmarDigits(s: string): string {
  return s.replace(/\d/g, (d) => MY_DIGITS[+d]);
}

/** Clean the raw text before sending to TTS */
function preprocessTts(raw: string): string {
  return raw
    .replace(/_+/g, " ")       // remove underscores
    .replace(/ {2,}/g, " ")    // collapse spaces
    .trim();
}

type LangChunk = { text: string; lang: "en" | "my" };

/** Split one line into contiguous Myanmar / English character runs */
function segmentLine(line: string): LangChunk[] {
  const raw: LangChunk[] = [];
  let buf = "";
  let curLang: "en" | "my" = "en";

  for (const ch of line) {
    const chLang: "en" | "my" = MY_CHAR_RE.test(ch) ? "my" : "en";
    if (chLang !== curLang && buf) {
      raw.push({ text: buf, lang: curLang });
      buf = "";
    }
    curLang = chLang;
    buf += ch;
  }
  if (buf) raw.push({ text: buf, lang: curLang });

  // Convert standalone numbers surrounded by Myanmar text → Myanmar digits
  // Keep IPs, port numbers, and English-context numbers as English
  return raw.map((chunk, i) => {
    if (chunk.lang === "en") {
      const prevLang = i > 0 ? raw[i - 1].lang : null;
      const nextLang = i < raw.length - 1 ? raw[i + 1].lang : null;
      const surroundedByMyanmar = prevLang === "my" || nextLang === "my";
      const isOnlyDigits = /^\s*[\d\s,]+\s*$/.test(chunk.text);
      const isIp = IP_PATTERN.test(chunk.text);
      if (surroundedByMyanmar && isOnlyDigits && !isIp) {
        return { text: toMyanmarDigits(chunk.text), lang: "my" as const };
      }
    }
    return chunk;
  });
}

/** Segment full text into ordered Myanmar / English chunks for mixed TTS playback */
function segmentForTts(text: string): LangChunk[] {
  const result: LangChunk[] = [];

  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // ALL-CAPS section header → speak in English (title-cased for natural TTS)
    if (/^[A-Z][A-Z ]{2,}:/.test(trimmed) && trimmed.length < 80) {
      const title = trimmed
        .replace(/:$/, "")
        .toLowerCase()
        .replace(/\b\w/g, (c) => c.toUpperCase());
      result.push({ text: title + ". ", lang: "en" });
      continue;
    }

    const lineChunks = segmentLine(trimmed);
    result.push(...lineChunks);
  }

  return result.filter((c) => c.text.trim().length > 0);
}

/**
 * Voice reader — speaks AI analysis with mixed Myanmar / English TTS.
 *
 * language="en":
 *   • Web Speech API only (English voice). Reads all 4 sections completely.
 *   • Section headers spoken slower + 350 ms pause after for broadcast feel.
 *   • Safety timeout per utterance prevents silent hang if browser drops onend.
 *
 * language="my":
 *   • Segments text: Myanmar chunks → Google TTS backend, English chunks
 *     (IPs, technical terms, section headers) → Web Speech API English voice.
 *   • Pause/resume works for both audio types.
 *   • Standalone numbers in Myanmar context → Myanmar digits; IPs kept English.
 *
 * ROOT FIX: onerror always resolves (never skips) unless user pressed Stop.
 * Removed the keepAlive pause/resume loop — it was firing "interrupted" errors
 * that caused the old handler to silently hang and drop the rest of the text.
 */
function VoiceReader({ text, language }: { text: string; language: "en" | "my" }) {
  const [speaking, setSpeaking] = useState(false);
  const [paused, setPaused]     = useState(false);
  const [voices, setVoices]     = useState<SpeechSynthesisVoice[]>([]);

  const stopRef        = useRef(false);
  const pausedRef      = useRef(false);
  const audioRef       = useRef<HTMLAudioElement | null>(null);
  const currentLangRef = useRef<"en" | "my">("en"); // which engine is active

  const supported = typeof window !== "undefined" && "speechSynthesis" in window;

  // Load Web Speech voices
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
      hardStop();
    };
  }, [supported]);

  useEffect(() => { hardStop(); }, [text, language]);

  // ── Helpers ────────────────────────────────────────────────────────────────

  function hardStop() {
    stopRef.current   = true;
    pausedRef.current = false;
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.src = "";
      audioRef.current = null;
    }
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
    setSpeaking(false);
    setPaused(false);
  }

  function base64ToBlobUrl(b64: string): string {
    const binary = atob(b64);
    const bytes  = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return URL.createObjectURL(new Blob([bytes], { type: "audio/mpeg" }));
  }

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

  const waitMs = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

  // ── Myanmar chunk via Google TTS backend ───────────────────────────────────

  async function playMyChunkAsync(chunkText: string): Promise<void> {
    return new Promise<void>(async (resolve) => {
      if (stopRef.current) { resolve(); return; }
      currentLangRef.current = "my";
      try {
        const r = await fetch(`${BASE}/api/tts/speak`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: chunkText, lang: "my" }),
        });
        if (!r.ok || stopRef.current) { resolve(); return; }
        const data = await r.json();

        let blobUrls: string[] = [];
        if (data.chunks?.length)    blobUrls = (data.chunks as string[]).map(base64ToBlobUrl);
        else if (data.urls?.length) blobUrls = data.urls as string[];

        if (!blobUrls.length || stopRef.current) {
          blobUrls.forEach((u) => { try { URL.revokeObjectURL(u); } catch {} });
          resolve(); return;
        }

        const playNext = () => {
          if (stopRef.current) {
            blobUrls.forEach((u) => { try { URL.revokeObjectURL(u); } catch {} });
            resolve(); return;
          }
          if (pausedRef.current) {
            // Poll until unpaused or stopped
            const poll = setInterval(() => {
              if (stopRef.current) { clearInterval(poll); resolve(); return; }
              if (!pausedRef.current) { clearInterval(poll); playNext(); }
            }, 120);
            return;
          }
          const url = blobUrls.shift();
          if (!url) { resolve(); return; }
          const audio = new Audio(url);
          audioRef.current = audio;
          const onDone = () => { try { URL.revokeObjectURL(url); } catch {} playNext(); };
          audio.onended = onDone;
          audio.onerror = onDone;
          audio.play().catch(onDone);
        };
        playNext();
      } catch { resolve(); }
    });
  }

  // ── English chunk via Web Speech API ──────────────────────────────────────
  // KEY FIX: onerror always resolves (unless user stopped) so the chain never
  // hangs. Previously "interrupted"/"canceled" returned without resolving →
  // the entire playback chain froze silently after any browser hiccup.

  async function playEnChunkAsync(chunkText: string): Promise<void> {
    const t = chunkText.trim();
    if (!supported || !t) return;
    return new Promise<void>((resolve) => {
      if (stopRef.current) { resolve(); return; }
      currentLangRef.current = "en";

      const utter  = new SpeechSynthesisUtterance(t);
      utter.lang   = "en-US";
      const voice  = pickVoice("en-US");
      if (voice) utter.voice = voice;
      utter.rate   = 0.90;

      let done = false;
      // Safety timeout: if browser silently drops onend, force-resolve
      const safety = setTimeout(
        () => { if (!done) { done = true; resolve(); } },
        Math.max(t.length * 200, 3500),
      );
      const finish = () => {
        if (done) return;
        done = true;
        clearTimeout(safety);
        resolve();
      };
      utter.onend   = finish;
      // Always finish on ANY error type — this is the root fix.
      // Old code returned early on "interrupted"/"canceled" which caused hangs.
      utter.onerror = () => { if (!stopRef.current) finish(); };
      window.speechSynthesis.speak(utter);
    });
  }

  // ── Mixed-language playback (Myanmar mode) ─────────────────────────────────

  async function speakMixed() {
    stopRef.current   = false;
    pausedRef.current = false;
    setSpeaking(true);
    setPaused(false);

    const chunks = segmentForTts(preprocessTts(text));

    for (const chunk of chunks) {
      if (stopRef.current) break;
      // Wait while paused (Myanmar audio pause is handled inside playMyChunkAsync)
      while (pausedRef.current && !stopRef.current) {
        await waitMs(120);
      }
      if (stopRef.current) break;
      try {
        if (chunk.lang === "my") await playMyChunkAsync(chunk.text);
        else                      await playEnChunkAsync(chunk.text);
      } catch { /* continue on error */ }
    }

    if (!stopRef.current) { setSpeaking(false); setPaused(false); }
  }

  // ── English-only playback (broadcast news presenter style) ─────────────────
  // No keepAlive interval — that was causing "interrupted" errors → hangs.
  // Each utterance has its own safety timeout as a fallback.

  function speakWeb() {
    if (!supported) return;
    window.speechSynthesis.cancel();
    stopRef.current   = false;
    pausedRef.current = false;
    currentLangRef.current = "en";
    setSpeaking(true);
    setPaused(false);

    const lines = preprocessTts(text).split("\n").filter((l) => l.trim());
    // Brief broadcast-style intro
    lines.unshift("Security briefing. Stand by.");
    let idx = 0;

    const speakNext = () => {
      if (stopRef.current) return;
      if (pausedRef.current) {
        // Poll until unpaused
        const poll = setInterval(() => {
          if (stopRef.current) { clearInterval(poll); return; }
          if (!pausedRef.current) { clearInterval(poll); speakNext(); }
        }, 120);
        return;
      }
      if (idx >= lines.length) { setSpeaking(false); return; }

      const line          = lines[idx++];
      const isSectionHead = /^[A-Z][A-Z ]{2,}:/.test(line.trim()) && line.trim().length < 80;
      // Section headers → title-cased for natural TTS ("Threat Summary")
      const spoken        = isSectionHead
        ? line.replace(/:$/, "").toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase())
        : line;

      const utter   = new SpeechSynthesisUtterance(spoken);
      utter.lang    = "en-US";
      const voice   = pickVoice("en-US");
      if (voice) utter.voice = voice;
      // Headers slower + slight gravitas; body slightly deliberate
      utter.rate    = isSectionHead ? 0.80 : 0.88;

      let fired = false;
      // Safety timeout — forces advance if browser drops onend silently
      const safety  = setTimeout(
        () => { if (!fired) { fired = true; speakNext(); } },
        Math.max(spoken.length * 220, 5000),
      );
      const advance = () => {
        if (fired) return;
        fired = true;
        clearTimeout(safety);
        // Always yield to event loop before next utterance.
        // Chrome bug: calling speechSynthesis.speak() synchronously inside
        // onend/onerror causes the next utterance to immediately error →
        // cascade-fail all remaining lines → setSpeaking(false) instantly.
        // 350 ms pause after section headers; 50 ms minimum gap otherwise.
        const delay = isSectionHead ? 350 : 50;
        setTimeout(speakNext, delay);
      };
      utter.onend   = advance;
      // Always advance on ANY error — root fix, never skip remaining text
      utter.onerror = () => { if (!stopRef.current) advance(); };
      window.speechSynthesis.speak(utter);
    };

    speakNext();
  }

  // ── Controls ───────────────────────────────────────────────────────────────

  function handleSpeak() {
    if (language === "my") speakMixed();
    else speakWeb();
  }

  function handleStop() { hardStop(); }

  function handleTogglePause() {
    if (paused) {
      pausedRef.current = false;
      if (currentLangRef.current === "my" && audioRef.current) {
        audioRef.current.play().catch(() => {});
      } else {
        window.speechSynthesis.resume();
      }
      setPaused(false);
    } else {
      pausedRef.current = true;
      if (currentLangRef.current === "my" && audioRef.current) {
        audioRef.current.pause();
      } else {
        window.speechSynthesis.pause();
      }
      setPaused(true);
    }
  }

  return (
    <div className="flex items-center gap-2">
      {!speaking ? (
        <button
          onClick={handleSpeak}
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-primary transition-colors border border-border hover:border-primary/50 rounded px-2.5 py-1.5"
          title={language === "my" ? "Mixed TTS — မြန်မာ + English segments" : "Web Speech API — English"}
        >
          <Volume2 className="w-3.5 h-3.5" />
          {language === "en" ? "Listen" : "နားထောင်"}
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
          <button onClick={handleStop} title="Stop"
            className="flex items-center gap-1 text-xs text-red-400 border border-red-500/30 hover:border-red-500/60 rounded px-2 py-1.5">
            <Square className="w-3 h-3" />
          </button>
        </>
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
              {aiData && <VoiceReader text={aiData.analysis} language="en" />}
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
