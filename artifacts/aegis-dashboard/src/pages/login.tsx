/**
 * Login page — Admin Key or Google SSO
 * Authorised accounts enforced server-side only — no hints in UI.
 */
import { useState } from "react";
import { useLocation } from "wouter";
import { GoogleOAuthProvider, GoogleLogin } from "@react-oauth/google";
import { useAuth } from "@/contexts/auth-context";
import { Shield, Key, AlertCircle, Loader2 } from "lucide-react";

const GOOGLE_CLIENT_ID = "524254578493-9ce8ttte7c63hjo61rn9seo2m6jpfbjb.apps.googleusercontent.com";

/* ─── animated scan-line + grid CSS injected once ───────────────────────── */
const BG_STYLE = `
@keyframes scan {
  0%   { transform: translateY(-100%); }
  100% { transform: translateY(100vh); }
}
@keyframes pulse-ring {
  0%, 100% { opacity: 0.4; }
  50%       { opacity: 0.9; }
}
@keyframes blink {
  0%, 100% { opacity: 1; }
  50%       { opacity: 0; }
}
.aegis-bg {
  background:
    linear-gradient(rgba(0,212,170,.03) 1px, transparent 1px),
    linear-gradient(90deg, rgba(0,212,170,.03) 1px, transparent 1px),
    radial-gradient(ellipse 80% 50% at 50% -10%, rgba(0,212,170,.10) 0%, transparent 70%),
    radial-gradient(ellipse 60% 40% at 80% 110%, rgba(0,90,255,.06) 0%, transparent 60%),
    #070b18;
  background-size: 40px 40px, 40px 40px, 100% 100%, 100% 100%, 100% 100%;
}
.scan-line {
  position: fixed; inset: 0; pointer-events: none; z-index: 0;
  overflow: hidden;
}
.scan-line::after {
  content: '';
  position: absolute; left: 0; right: 0; height: 2px;
  background: linear-gradient(90deg, transparent 0%, rgba(0,212,170,.25) 30%, rgba(0,212,170,.6) 50%, rgba(0,212,170,.25) 70%, transparent 100%);
  animation: scan 6s linear infinite;
  box-shadow: 0 0 18px 4px rgba(0,212,170,.18);
}
.card-glow {
  box-shadow:
    0 0 0 1px rgba(0,212,170,.18),
    0 0 40px rgba(0,212,170,.06),
    0 32px 64px rgba(0,0,0,.6);
}
.shield-ring {
  animation: pulse-ring 3s ease-in-out infinite;
}
.cursor-blink::after {
  content: '▋';
  animation: blink 1s step-end infinite;
  margin-left: 1px;
}
`;

function LoginInner() {
  const { login }         = useAuth();
  const [, setLocation]   = useLocation();
  const [key, setKey]     = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function after(token: string) {
    await login(token);
    setLocation("/");
  }

  /* ── Admin Key ─────────────────────────────────────────────────────────── */
  async function handleAdminKey(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const r    = await fetch("/api/auth/admin-key", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ key }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? "Authentication failed");
      await after(data.token);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  /* ── Google ─────────────────────────────────────────────────────────────── */
  async function handleGoogle(credential: string) {
    setError(null);
    setLoading(true);
    try {
      const r    = await fetch("/api/auth/google", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ credential }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? "Authentication failed");
      await after(data.token);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="aegis-bg min-h-screen flex flex-col items-center justify-center p-4 relative overflow-hidden">
      <style>{BG_STYLE}</style>

      {/* Scan line overlay */}
      <div className="scan-line" />

      {/* Corner brackets decoration */}
      <div className="fixed top-4 left-4 w-8 h-8 border-t-2 border-l-2 border-primary/30 pointer-events-none" />
      <div className="fixed top-4 right-4 w-8 h-8 border-t-2 border-r-2 border-primary/30 pointer-events-none" />
      <div className="fixed bottom-4 left-4 w-8 h-8 border-b-2 border-l-2 border-primary/30 pointer-events-none" />
      <div className="fixed bottom-4 right-4 w-8 h-8 border-b-2 border-r-2 border-primary/30 pointer-events-none" />

      {/* Status bar top */}
      <div className="fixed top-4 left-1/2 -translate-x-1/2 flex items-center gap-2 pointer-events-none">
        <div className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
        <span className="text-[9px] font-mono text-primary/60 tracking-[0.25em] uppercase">System Active</span>
      </div>

      <div className="relative z-10 w-full max-w-[360px] flex flex-col items-center">

        {/* ── Branding ── */}
        <div className="mb-8 text-center">
          {/* Shield with glow rings */}
          <div className="relative w-16 h-16 mx-auto mb-4 flex items-center justify-center">
            <div className="shield-ring absolute inset-0 rounded-full border border-primary/20 scale-150" />
            <div className="shield-ring absolute inset-0 rounded-full border border-primary/10 scale-[2.0]" style={{ animationDelay: ".5s" }} />
            <div className="w-14 h-14 rounded-2xl flex items-center justify-center"
                 style={{ background: "linear-gradient(135deg, rgba(0,212,170,.15) 0%, rgba(0,90,255,.10) 100%)", border: "1px solid rgba(0,212,170,.35)" }}>
              <Shield className="w-6 h-6 text-primary" />
            </div>
          </div>

          <h1 className="text-3xl font-black font-mono tracking-[0.35em] text-white mb-1">AEGIS</h1>
          <div className="flex items-center justify-center gap-2">
            <div className="h-px w-8 bg-primary/30" />
            <p className="text-[9px] font-mono text-primary/50 tracking-[0.3em] uppercase">Security Operations Center</p>
            <div className="h-px w-8 bg-primary/30" />
          </div>
        </div>

        {/* ── Card ── */}
        <div className="w-full rounded-2xl overflow-hidden card-glow"
             style={{ background: "rgba(7,11,24,0.92)", backdropFilter: "blur(20px)", border: "1px solid rgba(0,212,170,.15)" }}>

          {/* Header */}
          <div className="px-6 py-3 flex items-center justify-between"
               style={{ background: "rgba(0,212,170,.04)", borderBottom: "1px solid rgba(0,212,170,.10)" }}>
            <div className="flex items-center gap-1.5">
              <div className="w-1.5 h-1.5 rounded-full bg-red-500/80" />
              <div className="w-1.5 h-1.5 rounded-full bg-yellow-500/80" />
              <div className="w-1.5 h-1.5 rounded-full bg-primary/80" />
            </div>
            <p className="text-[9px] font-mono text-muted-foreground/50 tracking-[0.25em] uppercase cursor-blink">
              Authorised Access Only
            </p>
            <div className="w-9" />
          </div>

          <div className="p-6 space-y-5">

            {/* ── Google SSO ── */}
            <div className="space-y-2.5">
              <p className="text-[9px] font-mono text-muted-foreground/50 uppercase tracking-[0.2em]">
                — Continue With Google —
              </p>
              <div className="flex justify-center">
                <GoogleLogin
                  onSuccess={cred => { if (cred.credential) handleGoogle(cred.credential); }}
                  onError={() => setError("Authentication failed")}
                  theme="filled_black"
                  shape="rectangular"
                  size="large"
                  type="icon"
                  width="320"
                />
              </div>
            </div>

            {/* ── Divider ── */}
            <div className="flex items-center gap-3">
              <div className="flex-1 h-px" style={{ background: "linear-gradient(90deg, transparent, rgba(0,212,170,.2))" }} />
              <span className="text-[9px] font-mono text-muted-foreground/30 uppercase tracking-widest">or</span>
              <div className="flex-1 h-px" style={{ background: "linear-gradient(270deg, transparent, rgba(0,212,170,.2))" }} />
            </div>

            {/* ── Admin Key ── */}
            <form onSubmit={handleAdminKey} className="space-y-3">
              <p className="text-[9px] font-mono text-muted-foreground/50 uppercase tracking-[0.2em]">
                — Access Key —
              </p>
              <div className="relative">
                <Key className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/40" />
                <input
                  type="password"
                  value={key}
                  onChange={e => setKey(e.target.value)}
                  placeholder="••••••••••••"
                  className="w-full rounded-lg pl-9 pr-4 py-2.5 text-sm font-mono text-white
                             placeholder:text-muted-foreground/25
                             focus:outline-none transition-all"
                  style={{
                    background: "rgba(255,255,255,.04)",
                    border: "1px solid rgba(0,212,170,.18)",
                    boxShadow: "inset 0 1px 0 rgba(255,255,255,.03)",
                  }}
                  onFocus={e => { e.currentTarget.style.border = "1px solid rgba(0,212,170,.5)"; e.currentTarget.style.boxShadow = "0 0 0 3px rgba(0,212,170,.08), inset 0 1px 0 rgba(255,255,255,.03)"; }}
                  onBlur={e => { e.currentTarget.style.border = "1px solid rgba(0,212,170,.18)"; e.currentTarget.style.boxShadow = "inset 0 1px 0 rgba(255,255,255,.03)"; }}
                  autoComplete="current-password"
                />
              </div>
              <button
                type="submit"
                disabled={loading || !key}
                className="w-full py-2.5 rounded-lg text-sm font-mono font-bold tracking-widest
                           transition-all disabled:opacity-30 disabled:cursor-not-allowed uppercase"
                style={{
                  background: loading || !key
                    ? "rgba(0,212,170,.08)"
                    : "linear-gradient(135deg, rgba(0,212,170,.2) 0%, rgba(0,160,130,.25) 100%)",
                  border: "1px solid rgba(0,212,170,.35)",
                  color: "#00d4aa",
                  boxShadow: loading || !key ? "none" : "0 0 20px rgba(0,212,170,.1)",
                }}
              >
                {loading ? (
                  <span className="flex items-center justify-center gap-2">
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    Verifying…
                  </span>
                ) : (
                  "Authenticate"
                )}
              </button>
            </form>

            {/* ── Error ── */}
            {error && (
              <div className="flex items-start gap-2 rounded-lg px-3 py-2.5 text-[11px] font-mono"
                   style={{ background: "rgba(239,68,68,.07)", border: "1px solid rgba(239,68,68,.2)", color: "#fca5a5" }}>
                <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0 text-red-400" />
                {error}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="mt-5 flex items-center gap-4">
          <div className="h-px w-12 bg-primary/10" />
          <p className="text-[9px] font-mono text-muted-foreground/20 tracking-[0.2em] uppercase">
            AEGIS · {new Date().getFullYear()}
          </p>
          <div className="h-px w-12 bg-primary/10" />
        </div>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <GoogleOAuthProvider clientId={GOOGLE_CLIENT_ID}>
      <LoginInner />
    </GoogleOAuthProvider>
  );
}
