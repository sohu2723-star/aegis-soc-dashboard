/**
 * Demo entry page — /demo
 * Shows QR code + "Enter Demo" button. Auto-login only on button press.
 */
import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { QRCodeSVG } from "qrcode.react";
import { useAuth } from "@/contexts/auth-context";
import { TerminalSquare, Shield, Eye, Loader2, ArrowRight } from "lucide-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export default function DemoEntry() {
  const { login, isAuthenticated } = useAuth();
  const [, setLocation] = useLocation();
  const [demoUrl, setDemoUrl] = useState("");
  const [entering, setEntering] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    setDemoUrl(window.location.origin + BASE + "/demo");
  }, []);

  async function enterDemo() {
    setEntering(true);
    setError(false);
    try {
      const r = await fetch(`${BASE}/api/auth/demo`, { method: "POST" });
      if (!r.ok) throw new Error();
      const data = await r.json();
      await login(data.token);
      setLocation("/");
    } catch {
      setError(true);
      setEntering(false);
    }
  }

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center p-6 font-mono dark">
      {/* Header */}
      <div className="flex flex-col items-center gap-3 mb-8">
        <div className="relative">
          <div className="w-20 h-20 rounded-full border-2 border-primary/40 flex items-center justify-center bg-primary/5">
            <TerminalSquare className="w-10 h-10 text-primary" />
          </div>
          <span className="absolute -bottom-1 -right-1 w-6 h-6 bg-cyan-500/20 border border-cyan-500/40 rounded-full flex items-center justify-center">
            <Eye className="w-3 h-3 text-cyan-400" />
          </span>
        </div>
        <div className="text-center">
          <h1 className="text-3xl font-bold tracking-widest text-primary">AEGIS</h1>
          <p className="text-xs text-muted-foreground uppercase tracking-wider mt-1">Security Operations Center</p>
        </div>
      </div>

      {/* QR + Enter button */}
      <div className="flex flex-col items-center gap-5 border border-cyan-500/25 rounded-2xl p-7 bg-card/70 mb-6 w-full max-w-sm shadow-[0_0_40px_rgba(6,182,212,0.08)]">
        <p className="text-xs text-cyan-100/80 uppercase tracking-[0.2em] font-semibold">Demo Access — Scan or Click</p>

        {demoUrl && (
          <div className="bg-white p-4 rounded-xl shadow-[0_0_28px_rgba(255,255,255,0.16)]" aria-label="Scannable demo access QR code">
            <QRCodeSVG value={demoUrl} size={224} level="H" marginSize={1} shapeRendering="crispEdges" />
          </div>
        )}

        <p className="text-xs leading-relaxed text-slate-300 text-center break-all select-all">{demoUrl}</p>

        {error && (
          <p className="text-red-400 text-xs text-center">Failed to connect. Check API server.</p>
        )}

        <button
          onClick={enterDemo}
          disabled={entering}
          className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg
                     bg-primary/10 border border-primary/40 text-primary text-sm font-bold
                     hover:bg-primary/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {entering
            ? <><Loader2 className="w-4 h-4 animate-spin" /> Entering...</>
            : <><ArrowRight className="w-4 h-4" /> Enter Demo</>}
        </button>
      </div>

      <div className="flex items-center gap-2 text-[10px] text-muted-foreground/50 uppercase tracking-wider">
        <Shield className="w-3 h-3" />
        <span>Read-only · Real data · No input allowed</span>
      </div>
    </div>
  );
}
