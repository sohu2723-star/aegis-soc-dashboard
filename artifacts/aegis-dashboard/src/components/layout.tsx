import { ReactNode, useContext, useEffect, useRef, useCallback } from "react";
import { Link, useLocation } from "wouter";
import { SoundAlertContext } from "@/App";
import { 
  ShieldAlert, 
  Activity, 
  Siren, 
  Server, 
  FileText, 
  TerminalSquare,
  Network,
  Shield,
  Cable,
  BookCheck,
  Settings2,
  Workflow,
  LogOut,
  KeyRound,
  Chrome,
  Volume2,
  VolumeX,
  Eye,
  QrCode,
  AlertTriangle,
} from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { DeviceSelector } from "@/components/device-selector";
import { QRCodeSVG } from "qrcode.react";
import { useState } from "react";

// ── Viewing-bar alert state ───────────────────────────────────────────────────
interface AlertFlash {
  severity: "critical" | "high" | "medium";
  evType: string;
  srcIp: string;
  target: string;
}

const SEV_FLASH: Record<string, {
  bg: string; border: string; text: string; dot: string; label: string;
}> = {
  // Keep all values very subtle — just a soft tint, not a solid fill
  critical: {
    bg:     "rgba(239,68,68,0.07)",
    border: "rgba(239,68,68,0.30)",
    text:   "#fca5a5",
    dot:    "#ef4444",
    label:  "CRITICAL",
  },
  high: {
    bg:     "rgba(249,115,22,0.07)",
    border: "rgba(249,115,22,0.28)",
    text:   "#fdba74",
    dot:    "#f97316",
    label:  "HIGH",
  },
  medium: {
    bg:     "rgba(234,179,8,0.06)",
    border: "rgba(234,179,8,0.25)",
    text:   "#fde047",
    dot:    "#eab308",
    label:  "MEDIUM",
  },
};

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

const opsItems = [
  { title: "Command Center", url: "/", icon: Activity },
  { title: "Security Events", url: "/events", icon: ShieldAlert },
  { title: "Active Alerts", url: "/alerts", icon: Siren },
  { title: "Connection Logs", url: "/connections", icon: Cable },
];

const networkItems = [
  { title: "Network Monitor", url: "/network", icon: Network },
  { title: "Defense Center", url: "/defense", icon: Shield },
  { title: "Defense Rules", url: "/defense-rules", icon: BookCheck },
  { title: "System Status", url: "/system", icon: Server },
  { title: "Threat Map", url: "/attack-flow", icon: Workflow },
];

const reportItems = [
  { title: "Reports", url: "/reports", icon: FileText },
  { title: "Settings", url: "/settings", icon: Settings2 },
];

function DemoQRModal({ onClose }: { onClose: () => void }) {
  const demoUrl = window.location.origin + BASE + "/demo";
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-card border border-border rounded-xl p-6 flex flex-col items-center gap-4 shadow-2xl" onClick={e => e.stopPropagation()}>
        <p className="text-xs text-cyan-100/80 font-semibold uppercase tracking-widest">Demo Access QR</p>
        <div className="bg-white p-4 rounded-xl shadow-[0_0_28px_rgba(255,255,255,0.16)]" aria-label="Scannable demo access QR code">
          <QRCodeSVG value={demoUrl} size={224} level="H" marginSize={1} shapeRendering="crispEdges" />
        </div>
        <p className="text-xs text-slate-300 max-w-[280px] text-center break-all font-mono select-all">{demoUrl}</p>
        <p className="text-xs text-muted-foreground">Anyone who scans this can view the dashboard (read-only)</p>
        <button onClick={onClose} className="text-xs text-primary hover:underline">Close</button>
      </div>
    </div>
  );
}

export function Layout({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const { user, logout, isDemo } = useAuth();
  const { enabled: soundEnabled, toggle: toggleSound } = useContext(SoundAlertContext);
  const [showQR, setShowQR] = useState(false);

  // ── Viewing-bar attack flash ─────────────────────────────────────────────
  const [flash, setFlash] = useState<AlertFlash | null>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearFlash = useCallback(() => {
    setFlash(null);
    if (flashTimer.current) { clearTimeout(flashTimer.current); flashTimer.current = null; }
  }, []);

  useEffect(() => {
    let es: EventSource;
    let reconnect: ReturnType<typeof setTimeout>;

    function connect() {
      es = new EventSource(`${BASE}/api/events/stream`);
      es.addEventListener("security_event", (e) => {
        try {
          const ev = JSON.parse(e.data);
          const sev = (ev.severity ?? "").toLowerCase();
          if (sev !== "critical" && sev !== "high" && sev !== "medium") return;
          if (flashTimer.current) clearTimeout(flashTimer.current);
          setFlash({
            severity: sev as AlertFlash["severity"],
            evType:   ev.type ?? "attack",
            srcIp:    ev.sourceIp ?? "?",
            target:   ev.targetHost ?? "?",
          });
          flashTimer.current = setTimeout(clearFlash, 5000);
        } catch { /* skip */ }
      });
      es.onerror = () => { es.close(); reconnect = setTimeout(connect, 6000); };
    }

    connect();
    return () => {
      es?.close();
      clearTimeout(reconnect);
      if (flashTimer.current) clearTimeout(flashTimer.current);
    };
  }, [clearFlash]);

  const fs = flash ? SEV_FLASH[flash.severity] : null;
  const flashLabel = flash
    ? flash.evType.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase())
    : "";

  return (
    <SidebarProvider>
      {showQR && <DemoQRModal onClose={() => setShowQR(false)} />}
      <div className="flex min-h-screen w-full bg-background dark text-foreground font-mono">
        <Sidebar variant="sidebar" className="border-r border-border bg-card">
          <SidebarHeader className="p-4 border-b border-border flex items-center flex-row gap-2">
            <TerminalSquare className="w-6 h-6 text-primary" />
            <div className="flex flex-col">
              <span className="font-bold text-primary tracking-widest text-lg leading-tight">AEGIS</span>
              <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Tactical SOC</span>
            </div>
            {isDemo && (
              <span className="ml-auto flex items-center gap-1 px-1.5 py-0.5 rounded bg-yellow-500/10 border border-yellow-500/30 text-yellow-400 text-[9px] uppercase tracking-wider">
                <Eye className="w-2.5 h-2.5" />
                Demo
              </span>
            )}
          </SidebarHeader>
          <SidebarContent>
            <SidebarGroup>
              <SidebarGroupLabel className="text-[15px] font-bold tracking-widest text-muted-foreground px-3 pt-3 pb-1">
                OPERATIONS
              </SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {opsItems.map((item) => (
                    <SidebarMenuItem key={item.title}>
                      <SidebarMenuButton asChild isActive={location === item.url}>
                        <Link href={item.url} className="flex items-center gap-3 px-3 py-2 text-sm transition-colors hover:text-primary hover:bg-primary/10">
                          <item.icon className="w-4 h-4" />
                          <span>{item.title}</span>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>

            <SidebarGroup>
              <SidebarGroupLabel className="text-[15px] font-bold tracking-widest text-muted-foreground px-3 pt-3 pb-1">
                NETWORK &amp; DEFENSE
              </SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {networkItems.map((item) => (
                    <SidebarMenuItem key={item.title}>
                      <SidebarMenuButton asChild isActive={location === item.url}>
                        <Link href={item.url} className="flex items-center gap-3 px-3 py-2 text-sm transition-colors hover:text-primary hover:bg-primary/10">
                          <item.icon className="w-4 h-4" />
                          <span>{item.title}</span>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>

            <SidebarGroup>
              <SidebarGroupLabel className="text-[15px] font-bold tracking-widest text-muted-foreground px-3 pt-3 pb-1">
                INTELLIGENCE
              </SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {reportItems.map((item) => (
                    <SidebarMenuItem key={item.title}>
                      <SidebarMenuButton asChild isActive={location === item.url}>
                        <Link href={item.url} className="flex items-center gap-3 px-3 py-2 text-sm transition-colors hover:text-primary hover:bg-primary/10">
                          <item.icon className="w-4 h-4" />
                          <span>{item.title}</span>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          </SidebarContent>

          {/* ── Session info + actions ── */}
          <div className="mt-auto p-3 border-t border-border/40 space-y-2">
            {/* Session badge — hide sensitive info in demo */}
            {user && !isDemo && (
              <div className="flex items-center gap-2 px-2 py-1.5 rounded text-[10px] font-mono text-muted-foreground/60"
                   style={{ background: "rgba(0,212,170,0.04)" }}>
                {user.method === "google"
                  ? <Chrome className="w-3 h-3 shrink-0 text-primary/50" />
                  : <KeyRound className="w-3 h-3 shrink-0 text-primary/50" />}
                <span className="truncate">
                  {user.method === "google" ? "Google Auth" : "Admin Key"}
                </span>
              </div>
            )}
            {isDemo && (
              <div className="flex items-center gap-2 px-2 py-1.5 rounded text-[10px] font-mono text-yellow-500/60"
                   style={{ background: "rgba(234,179,8,0.04)" }}>
                <Eye className="w-3 h-3 shrink-0" />
                <span>Read-only Demo</span>
              </div>
            )}

            {/* Sound toggle */}
            <button
              onClick={toggleSound}
              title={soundEnabled ? "Mute sound alerts" : "Enable sound alerts"}
              className="w-full flex items-center gap-2 px-3 py-2 rounded text-xs font-mono
                         text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors"
            >
              {soundEnabled
                ? <Volume2 className="w-3.5 h-3.5 text-primary" />
                : <VolumeX className="w-3.5 h-3.5" />}
              <span>{soundEnabled ? "Sound: ON" : "Sound: OFF"}</span>
            </button>

            {/* Admin: show QR code button */}
            {!isDemo && (
              <button
                onClick={() => setShowQR(true)}
                className="w-full flex items-center gap-2 px-3 py-2 rounded text-xs font-mono
                           text-muted-foreground hover:text-cyan-400 hover:bg-cyan-500/10 transition-colors"
              >
                <QrCode className="w-3.5 h-3.5" />
                <span>Share Demo QR</span>
              </button>
            )}

            {/* Logout / Exit demo */}
            <button
              onClick={logout}
              className="w-full flex items-center gap-2 px-3 py-2 rounded text-xs font-mono
                         text-muted-foreground hover:text-red-400 hover:bg-red-500/10 transition-colors"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>{isDemo ? "Exit Demo" : "Logout"}</span>
            </button>
          </div>
        </Sidebar>

        <main className="flex-1 flex flex-col h-screen overflow-hidden min-w-0">
          {/* Demo mode banner */}
          {isDemo && (
            <div className="flex items-center justify-center gap-2 px-4 py-1.5 bg-yellow-500/10 border-b border-yellow-500/20 shrink-0">
              <Eye className="w-3 h-3 text-yellow-400" />
              <span className="text-[10px] font-mono text-yellow-400 uppercase tracking-widest">
                Demo Mode — Read Only · Real Data
              </span>
            </div>
          )}
          {/* ── Viewing bar — soft tint on attack, normal otherwise ── */}
          <div
            className={`flex items-center justify-between gap-3 px-6 py-3 border-b shrink-0 transition-colors duration-500 ${!fs ? "bg-card/60" : ""}`}
            style={fs ? { background: fs.bg, borderBottomColor: fs.border } : undefined}
          >

            <div className="relative flex items-center gap-2 min-w-0">
              <SidebarTrigger />
              {fs && flash ? (
                <>
                  {/* Blinking dot */}
                  <span
                    className="shrink-0 w-2 h-2 rounded-full animate-pulse"
                    style={{ background: fs.dot, boxShadow: `0 0 7px ${fs.dot}` }}
                  />
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0" style={{ color: fs.dot }} />
                  <span className="text-xs font-bold tracking-widest" style={{ color: fs.dot }}>
                    {fs.label}
                  </span>
                  <span className="text-xs opacity-40 mx-0.5">·</span>
                  <span className="text-xs font-mono font-bold truncate max-w-[120px]" style={{ color: fs.text }}>
                    {flashLabel}
                  </span>
                  <span className="text-xs opacity-40 hidden sm:inline">from</span>
                  <span className="text-xs font-mono font-bold truncate max-w-[100px] hidden sm:inline" style={{ color: fs.text }}>
                    {flash.srcIp}
                  </span>
                  <span className="text-xs opacity-30 hidden sm:inline">→</span>
                  <span className="text-xs font-mono opacity-60 truncate max-w-[80px] hidden md:inline">
                    {flash.target}
                  </span>
                </>
              ) : (
                <span className="text-xs text-muted-foreground uppercase tracking-wider">Viewing</span>
              )}
            </div>
            <DeviceSelector />
          </div>
          <div className="flex-1 overflow-auto p-4 sm:p-6">
            {children}
          </div>
        </main>
      </div>
    </SidebarProvider>
  );
}
