import { ReactNode, useContext } from "react";
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
} from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
 
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { DeviceSelector } from "@/components/device-selector";

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

export function Layout({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const { user, logout } = useAuth();
  const { enabled: soundEnabled, toggle: toggleSound } = useContext(SoundAlertContext);

  return (
    <SidebarProvider>
      <div className="flex min-h-screen w-full bg-background dark text-foreground font-mono">
        <Sidebar variant="sidebar" className="border-r border-border bg-card">
          <SidebarHeader className="p-4 border-b border-border flex items-center flex-row gap-2">
            <TerminalSquare className="w-6 h-6 text-primary" />
            <div className="flex flex-col">
              <span className="font-bold text-primary tracking-widest text-lg leading-tight">AEGIS</span>
              <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Tactical SOC</span>
            </div>
          </SidebarHeader>
          <SidebarContent>
            <SidebarGroup>
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

          {/* ── Session info + logout ── */}
          <div className="mt-auto p-3 border-t border-border/40 space-y-2">
            {user && (
              <div className="flex items-center gap-2 px-2 py-1.5 rounded text-[10px] font-mono text-muted-foreground/60"
                   style={{ background: "rgba(0,212,170,0.04)" }}>
                {user.method === "google"
                  ? <Chrome className="w-3 h-3 shrink-0 text-primary/50" />
                  : <KeyRound className="w-3 h-3 shrink-0 text-primary/50" />}
                <span className="truncate">
                  {user.method === "google" ? user.email : "Admin Key"}
                </span>
              </div>
            )}
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
            <button
              onClick={logout}
              className="w-full flex items-center gap-2 px-3 py-2 rounded text-xs font-mono
                         text-muted-foreground hover:text-red-400 hover:bg-red-500/10 transition-colors"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>Logout</span>
            </button>
          </div>
        </Sidebar>
        <main className="flex-1 flex flex-col h-screen overflow-hidden">
          <div className="flex items-center justify-between gap-3 px-6 py-3 border-b border-border bg-card/60 shrink-0">
            <div className="flex items-center gap-2">
              <SidebarTrigger />
              <span className="text-xs text-muted-foreground uppercase tracking-wider">Viewing</span>
            </div>
            <DeviceSelector />
          </div>
          <div className="flex-1 overflow-auto p-6">
            {children}
          </div>
        </main>
      </div>
    </SidebarProvider>
  );
}
