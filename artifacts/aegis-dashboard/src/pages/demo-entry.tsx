/**
 * Demo entry page — /demo
 * Anyone who visits this URL gets a read-only demo token automatically.
 * Shows a QR code so others can scan and enter demo mode on their device.
 */
import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { QRCodeSVG } from "qrcode.react";
import { useAuth } from "@/contexts/auth-context";
import { TerminalSquare, Shield, Eye, Loader2 } from "lucide-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export default function DemoEntry() {
  const { login, isAuthenticated, isDemo } = useAuth();
  const [, setLocation] = useLocation();
  const [status, setStatus] = useState<"loading" | "error">("loading");
  const [demoUrl, setDemoUrl] = useState("");

  useEffect(() => {
    setDemoUrl(window.location.origin + BASE + "/demo");
  }, []);

  useEffect(() => {
    // If already logged in as demo, redirect straight to dashboard
    if (isAuthenticated && isDemo) {
      setLocation("/");
      return;
    }
    // If already logged in as admin, redirect too
    if (isAuthenticated && !isDemo) {
      setLocation("/");
      return;
    }

    // Fetch demo token
    fetch(`${BASE}/api/auth/demo`, { method: "POST" })
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(async data => {
        await login(data.token);
        setLocation("/");
      })
      .catch(() => setStatus("error"));
  }, []);

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center p-6 font-mono dark">
      {/* Header */}
      <div className="flex flex-col items-center gap-3 mb-10">
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
          <p className="text-xs text-muted-foreground uppercase tracking-wider mt-1">Security Operations Center — Demo</p>
        </div>
      </div>

      {/* Status */}
      <div className="flex flex-col items-center gap-2 mb-10">
        {status === "loading" ? (
          <>
            <Loader2 className="w-6 h-6 text-primary animate-spin" />
            <p className="text-sm text-muted-foreground">Entering demo mode...</p>
          </>
        ) : (
          <div className="text-center space-y-2">
            <p className="text-red-400 text-sm">Failed to load demo.</p>
            <button
              onClick={() => window.location.reload()}
              className="text-xs text-primary underline"
            >
              Try again
            </button>
          </div>
        )}
      </div>

      {/* QR Code — for sharing */}
      {demoUrl && (
        <div className="flex flex-col items-center gap-3 border border-border rounded-xl p-6 bg-card/40">
          <p className="text-[10px] text-muted-foreground uppercase tracking-widest">Share Demo Access</p>
          <div className="bg-white p-3 rounded-lg">
            <QRCodeSVG value={demoUrl} size={160} />
          </div>
          <p className="text-[10px] text-muted-foreground max-w-[200px] text-center break-all">{demoUrl}</p>
        </div>
      )}

      {/* Demo mode disclaimer */}
      <div className="mt-8 flex items-center gap-2 text-[10px] text-muted-foreground/50 uppercase tracking-wider">
        <Shield className="w-3 h-3" />
        <span>Read-only · Real data · No input allowed</span>
      </div>
    </div>
  );
}
