import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import {
  Clock, Send, RefreshCcw, CheckCircle2, XCircle, Bot,
  Sparkles, AlertTriangle, Settings2, Zap,
} from "lucide-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

const PRESETS = [
  { label: "1 min",  value: 1 },
  { label: "5 min",  value: 5 },
  { label: "30 min", value: 30 },
  { label: "1 hr",   value: 60 },
  { label: "6 hr",   value: 360 },
  { label: "24 hr",  value: 1440 },
];

interface Settings {
  reportIntervalMinutes: number;
  telegramEnabled: boolean;
  telegramConfigured: boolean;
}

async function apiGet<T>(path: string): Promise<T> {
  const r = await fetch(`${BASE}/api${path}`);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

async function apiPost<T>(path: string, body?: unknown): Promise<T> {
  const r = await fetch(`${BASE}/api${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) {
    const e = await r.json().catch(() => ({}));
    throw new Error((e as any).error ?? `HTTP ${r.status}`);
  }
  return r.json();
}

export default function SettingsPage() {
  const { toast } = useToast();

  const [settings, setSettings] = useState<Settings | null>(null);
  const [loading,  setLoading]  = useState(true);

  // Interval state
  const [customMinutes, setCustomMinutes] = useState("");
  const [savingInterval, setSavingInterval] = useState(false);

  // Telegram state
  const [savingTelegram, setSavingTelegram] = useState(false);
  const [testingTelegram, setTestingTelegram] = useState(false);
  const [telegramTestResult, setTelegramTestResult] = useState<{ ok: boolean; botName?: string; error?: string } | null>(null);

  // Send now
  const [sendingNow, setSendingNow] = useState(false);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    setLoading(true);
    try {
      const s = await apiGet<Settings>("/settings");
      setSettings(s);
    } catch (err: any) {
      toast({ title: "Failed to load settings", description: err.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  async function setInterval(minutes: number) {
    if (!settings) return;
    setSavingInterval(true);
    try {
      await apiPost("/settings/report-interval", { minutes });
      setSettings(s => s ? { ...s, reportIntervalMinutes: minutes } : s);
      setCustomMinutes("");
      toast({
        title: "Interval Updated",
        description: `Auto-report ကို ${formatInterval(minutes)} တစ်ကြိမ် generate လုပ်မည်`,
      });
    } catch (err: any) {
      toast({ title: "Failed", description: err.message, variant: "destructive" });
    } finally {
      setSavingInterval(false);
    }
  }

  async function applyCustomInterval() {
    const n = Number(customMinutes);
    if (isNaN(n) || n < 1) {
      toast({ title: "Invalid", description: "အနည်းဆုံး 1 minute ဖြစ်ရမည်", variant: "destructive" });
      return;
    }
    await setInterval(n);
  }

  async function toggleTelegram(enabled: boolean) {
    if (!settings) return;
    setSavingTelegram(true);
    try {
      await apiPost("/settings/telegram", { enabled });
      setSettings(s => s ? { ...s, telegramEnabled: enabled } : s);
      toast({ title: enabled ? "Telegram Enabled" : "Telegram Disabled" });
    } catch (err: any) {
      toast({ title: "Failed", description: err.message, variant: "destructive" });
    } finally {
      setSavingTelegram(false);
    }
  }

  async function testTelegram() {
    setTestingTelegram(true);
    setTelegramTestResult(null);
    try {
      const result = await apiPost<{ ok: boolean; botName?: string; error?: string }>("/settings/test-telegram");
      setTelegramTestResult(result);
      if (result.ok) {
        toast({ title: "✅ Telegram Connected", description: `Bot: @${result.botName}` });
      } else {
        toast({ title: "❌ Telegram Failed", description: result.error, variant: "destructive" });
      }
    } catch (err: any) {
      toast({ title: "Test Failed", description: err.message, variant: "destructive" });
    } finally {
      setTestingTelegram(false);
    }
  }

  async function sendReportNow() {
    setSendingNow(true);
    try {
      await apiPost("/settings/send-report-now");
      toast({
        title: "✅ Report Sent",
        description: "Report generate ပြီး Telegram ပို့ပြီးပြီ (configured ဆိုရင်)။ Reports page မှာ ကြည့်နိုင်သည်။",
      });
    } catch (err: any) {
      toast({ title: "Failed", description: err.message, variant: "destructive" });
    } finally {
      setSendingNow(false);
    }
  }

  function formatInterval(mins: number): string {
    if (mins < 60) return `${mins} min`;
    if (mins < 1440) return `${mins / 60} hr`;
    return `${mins / 1440} day`;
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24 text-muted-foreground gap-3">
        <RefreshCcw className="w-4 h-4 animate-spin text-primary" />
        <span className="text-sm">Loading settings...</span>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-3xl">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-primary uppercase flex items-center gap-2">
          <Settings2 className="w-6 h-6" /> System Settings
        </h1>
        <p className="text-sm text-muted-foreground">Auto-report schedule, Telegram notifications, and system preferences.</p>
      </div>

      {/* ── AUTO-REPORT SCHEDULE ─────────────────────────────────────────────── */}
      <Card className="bg-card border-border">
        <CardHeader className="border-b border-border/50 pb-4">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded bg-primary/10 flex items-center justify-center">
              <Clock className="w-4 h-4 text-primary" />
            </div>
            <div>
              <CardTitle className="text-sm uppercase tracking-widest text-primary">Auto-Report Schedule</CardTitle>
              <CardDescription className="text-xs">
                လက်ရှိ interval —{" "}
                <span className="font-mono text-foreground font-bold">
                  {settings ? formatInterval(settings.reportIntervalMinutes) : "—"}
                </span>
                {" "}တစ်ကြိမ် auto-report generate မည်
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="pt-5 space-y-5">
          {/* Preset buttons */}
          <div>
            <Label className="text-xs uppercase text-muted-foreground tracking-wider mb-3 block">Preset Intervals</Label>
            <div className="flex flex-wrap gap-2">
              {PRESETS.map(p => {
                const isActive = settings?.reportIntervalMinutes === p.value;
                return (
                  <Button
                    key={p.value}
                    size="sm"
                    variant={isActive ? "default" : "outline"}
                    className={isActive ? "" : "border-border text-muted-foreground hover:text-primary hover:border-primary/50"}
                    disabled={savingInterval}
                    onClick={() => setInterval(p.value)}
                  >
                    {isActive && <Zap className="w-3 h-3 mr-1" />}
                    {p.label}
                  </Button>
                );
              })}
            </div>
          </div>

          {/* Custom interval */}
          <div>
            <Label className="text-xs uppercase text-muted-foreground tracking-wider mb-2 block">Custom Interval (minutes)</Label>
            <div className="flex gap-2 max-w-xs">
              <Input
                type="number"
                min={1}
                max={10080}
                placeholder="e.g. 120"
                value={customMinutes}
                onChange={e => setCustomMinutes(e.target.value)}
                className="bg-background border-border font-mono"
                onKeyDown={e => e.key === "Enter" && applyCustomInterval()}
              />
              <Button
                onClick={applyCustomInterval}
                disabled={savingInterval || !customMinutes}
                className="shrink-0"
              >
                {savingInterval ? <RefreshCcw className="w-4 h-4 animate-spin" /> : "Apply"}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground mt-1">1–10080 minutes (max 7 days). Server restart မလိုဘဲ ချက်ချင်း သက်ရောက်မည်။</p>
          </div>

          {/* Send now */}
          <div className="pt-2 border-t border-border/50">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">Send Report Now</p>
                <p className="text-xs text-muted-foreground">Schedule မဆိုင်ဘဲ ချက်ချင်း report generate ပြီး Telegram ပို့မည်</p>
              </div>
              <Button
                onClick={sendReportNow}
                disabled={sendingNow}
                variant="outline"
                className="border-primary/50 text-primary hover:bg-primary/10"
              >
                {sendingNow ? (
                  <><RefreshCcw className="w-4 h-4 mr-2 animate-spin" />Generating...</>
                ) : (
                  <><Sparkles className="w-4 h-4 mr-2" />Generate & Send Now</>
                )}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ── TELEGRAM NOTIFICATIONS ───────────────────────────────────────────── */}
      <Card className="bg-card border-border">
        <CardHeader className="border-b border-border/50 pb-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded bg-primary/10 flex items-center justify-center">
                <Bot className="w-4 h-4 text-primary" />
              </div>
              <div>
                <CardTitle className="text-sm uppercase tracking-widest text-primary">Telegram Notifications</CardTitle>
                <CardDescription className="text-xs">Auto-report နဲ့ critical alert တွေကို Telegram bot မှတဆင့် ပို့မည်</CardDescription>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {settings?.telegramConfigured ? (
                <Badge className="bg-green-500/20 text-green-400 border-green-500/30 text-[10px]">Configured</Badge>
              ) : (
                <Badge variant="outline" className="border-border text-muted-foreground text-[10px]">Not Configured</Badge>
              )}
              <Switch
                checked={settings?.telegramEnabled ?? false}
                onCheckedChange={toggleTelegram}
                disabled={savingTelegram || !settings?.telegramConfigured}
              />
            </div>
          </div>
        </CardHeader>
        <CardContent className="pt-5 space-y-4">
          {!settings?.telegramConfigured && (
            <div className="flex gap-2 items-start bg-yellow-500/10 border border-yellow-500/30 rounded p-3 text-sm text-yellow-300">
              <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
              <div>
                <p className="font-medium">Telegram not configured</p>
                <p className="text-xs mt-1 text-yellow-300/70">
                  Render Dashboard → Environment Variables မှာ ထည့်ပါ—
                </p>
                <div className="mt-2 space-y-1 font-mono text-xs bg-black/30 rounded p-2">
                  <div><span className="text-primary">TELEGRAM_BOT_TOKEN</span> = [BotFather မှ token]</div>
                  <div><span className="text-primary">TELEGRAM_CHAT_ID</span>   = [သင့် chat/group ID]</div>
                </div>
                <p className="text-xs mt-2 text-yellow-300/70">ထည့်ပြီးရင် Render မှာ Redeploy လုပ်ပါ။</p>
              </div>
            </div>
          )}

          {/* Test connection */}
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">Test Connection</p>
              <p className="text-xs text-muted-foreground">Bot token ကို verify လုပ်မည်</p>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="border-border"
              onClick={testTelegram}
              disabled={testingTelegram || !settings?.telegramConfigured}
            >
              {testingTelegram ? (
                <RefreshCcw className="w-4 h-4 animate-spin" />
              ) : (
                <><Send className="w-4 h-4 mr-1.5" />Test</>
              )}
            </Button>
          </div>

          {telegramTestResult && (
            <div className={`flex items-center gap-2 rounded p-2 text-sm ${telegramTestResult.ok ? "bg-green-500/10 text-green-400" : "bg-red-500/10 text-red-400"}`}>
              {telegramTestResult.ok ? (
                <><CheckCircle2 className="w-4 h-4" /> Connected — <span className="font-mono">@{telegramTestResult.botName}</span></>
              ) : (
                <><XCircle className="w-4 h-4" /> {telegramTestResult.error}</>
              )}
            </div>
          )}

        </CardContent>
      </Card>

      {/* ── GROQ AI STATUS ───────────────────────────────────────────────────── */}
      <Card className="bg-card border-border">
        <CardHeader className="border-b border-border/50 pb-4">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded bg-primary/10 flex items-center justify-center">
              <Sparkles className="w-4 h-4 text-primary" />
            </div>
            <div>
              <CardTitle className="text-sm uppercase tracking-widest text-primary">Groq AI</CardTitle>
              <CardDescription className="text-xs">AI threat analysis နဲ့ report generation အတွက် Groq API</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="pt-5">
          <GroqStatus />
        </CardContent>
      </Card>
    </div>
  );
}

function GroqStatus() {
  const [status, setStatus] = useState<{ available: boolean; model: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const BASE2 = import.meta.env.BASE_URL.replace(/\/$/, "");

  useEffect(() => {
    fetch(`${BASE2}/api/ai/status`)
      .then(r => r.json())
      .then(setStatus)
      .catch(() => setStatus({ available: false, model: "unknown" }))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="text-xs text-muted-foreground">Checking...</div>;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        {status?.available ? (
          <><CheckCircle2 className="w-4 h-4 text-green-400" /><span className="text-sm text-green-400">Configured — {status.model}</span></>
        ) : (
          <><XCircle className="w-4 h-4 text-red-400" /><span className="text-sm text-red-400">GROQ_API_KEY not configured</span></>
        )}
      </div>
    </div>
  );
}
