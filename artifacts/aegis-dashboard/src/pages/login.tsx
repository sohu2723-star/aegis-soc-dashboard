/**
 * Login page — Admin Key or Google Sign-In
 * Google: only copy2723@gmail.com is accepted (enforced server-side)
 */
import { useState } from "react";
import { useLocation } from "wouter";
import { GoogleOAuthProvider, GoogleLogin } from "@react-oauth/google";
import { useAuth } from "@/contexts/auth-context";
import { Shield, Key, AlertCircle, Loader2 } from "lucide-react";

const GOOGLE_CLIENT_ID = "524254578493-9ce8ttte7c63hjo61rn9seo2m6jpfbjb.apps.googleusercontent.com";

export default function LoginPage() {
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
      if (!r.ok) throw new Error(data.error ?? "Login failed");
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
      if (!r.ok) throw new Error(data.error ?? "Google login failed");
      await after(data.token);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <GoogleOAuthProvider clientId={GOOGLE_CLIENT_ID}>
      <div className="min-h-screen bg-background flex flex-col items-center justify-center p-4"
           style={{ background: "radial-gradient(ellipse at 50% 0%, rgba(0,212,170,0.06) 0%, transparent 65%), #080c1c" }}>

        {/* ── Branding ── */}
        <div className="mb-10 text-center">
          <div className="flex items-center justify-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center"
                 style={{ background: "rgba(0,212,170,0.15)", border: "1px solid rgba(0,212,170,0.3)" }}>
              <Shield className="w-5 h-5 text-primary" />
            </div>
            <span className="text-2xl font-bold font-mono tracking-widest text-white">AEGIS</span>
          </div>
          <p className="text-xs font-mono text-muted-foreground tracking-widest uppercase">
            Tactical SOC · Admin Access
          </p>
        </div>

        {/* ── Card ── */}
        <div className="w-full max-w-sm rounded-2xl border border-border/50 overflow-hidden"
             style={{ background: "rgba(8,12,28,0.9)", backdropFilter: "blur(12px)" }}>

          {/* Header strip */}
          <div className="px-6 py-4 border-b border-border/40"
               style={{ background: "rgba(0,212,170,0.04)" }}>
            <p className="text-[11px] font-mono text-muted-foreground text-center tracking-widest uppercase">
              Authorised Personnel Only
            </p>
          </div>

          <div className="p-6 space-y-6">

            {/* ── Google Sign-In ── */}
            <div className="space-y-2">
              <p className="text-[11px] font-mono text-muted-foreground uppercase tracking-wider">
                Continue with Google
              </p>
              <div className="flex justify-center">
                <GoogleLogin
                  onSuccess={cred => { if (cred.credential) handleGoogle(cred.credential); }}
                  onError={() => setError("Google sign-in was cancelled or failed")}
                  theme="filled_black"
                  shape="rectangular"
                  size="large"
                  text="continue_with"
                  width="320"
                />
              </div>
              <p className="text-[10px] font-mono text-muted-foreground/50 text-center">
                Only copy2723@gmail.com is authorised
              </p>
            </div>

            {/* ── Divider ── */}
            <div className="flex items-center gap-3">
              <div className="flex-1 h-px bg-border/40" />
              <span className="text-[10px] font-mono text-muted-foreground/50 uppercase">or</span>
              <div className="flex-1 h-px bg-border/40" />
            </div>

            {/* ── Admin Key ── */}
            <form onSubmit={handleAdminKey} className="space-y-3">
              <p className="text-[11px] font-mono text-muted-foreground uppercase tracking-wider">
                Admin Key Login
              </p>
              <div className="relative">
                <Key className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground/50" />
                <input
                  type="password"
                  value={key}
                  onChange={e => setKey(e.target.value)}
                  placeholder="Enter admin key…"
                  className="w-full bg-background/60 border border-border/60 rounded-lg pl-9 pr-4 py-2.5
                             text-sm font-mono text-white placeholder:text-muted-foreground/40
                             focus:outline-none focus:border-primary/60 focus:ring-1 focus:ring-primary/30
                             transition-colors"
                  autoComplete="current-password"
                />
              </div>
              <button
                type="submit"
                disabled={loading || !key}
                className="w-full py-2.5 rounded-lg text-sm font-mono font-bold tracking-wide transition-all
                           disabled:opacity-40 disabled:cursor-not-allowed"
                style={{
                  background: loading || !key ? "rgba(0,212,170,0.15)" : "rgba(0,212,170,0.2)",
                  border: "1px solid rgba(0,212,170,0.4)",
                  color: "#00d4aa",
                }}
              >
                {loading ? (
                  <span className="flex items-center justify-center gap-2">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Verifying…
                  </span>
                ) : (
                  "Login with Admin Key"
                )}
              </button>
            </form>

            {/* ── Error ── */}
            {error && (
              <div className="flex items-start gap-2 rounded-lg px-3 py-2.5 text-[11px] font-mono"
                   style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.25)", color: "#fca5a5" }}>
                <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0 text-red-400" />
                {error}
              </div>
            )}
          </div>
        </div>

        <p className="mt-6 text-[10px] font-mono text-muted-foreground/30 text-center">
          AEGIS SOC · Secured Dashboard · {new Date().getFullYear()}
        </p>
      </div>
    </GoogleOAuthProvider>
  );
}
