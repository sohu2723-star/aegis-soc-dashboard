import { ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { 
  ShieldAlert, 
  Activity, 
  ListTodo, 
  Siren, 
  Server, 
  FileText, 
  BookOpen,
  TerminalSquare,
  Network,
  Shield,
  GitBranch,
} from "lucide-react";
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
} from "@/components/ui/sidebar";

const opsItems = [
  { title: "Command Center", url: "/", icon: Activity },
  { title: "Security Events", url: "/events", icon: ShieldAlert },
  { title: "Incidents", url: "/incidents", icon: ListTodo },
  { title: "Active Alerts", url: "/alerts", icon: Siren },
];

const networkItems = [
  { title: "Network Monitor", url: "/network", icon: Network },
  { title: "Defense Center", url: "/defense", icon: Shield },
  { title: "System Status", url: "/system", icon: Server },
];

const reportItems = [
  { title: "Architecture", url: "/architecture", icon: GitBranch },
  { title: "Reports", url: "/reports", icon: FileText },
  { title: "Setup Guide", url: "/setup", icon: BookOpen },
];

export function Layout({ children }: { children: ReactNode }) {
  const [location] = useLocation();

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
              <SidebarGroupLabel className="text-muted-foreground text-xs uppercase tracking-wider">Operations</SidebarGroupLabel>
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
              <SidebarGroupLabel className="text-muted-foreground text-xs uppercase tracking-wider">Network & Defense</SidebarGroupLabel>
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
              <SidebarGroupLabel className="text-muted-foreground text-xs uppercase tracking-wider">Intelligence</SidebarGroupLabel>
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
        </Sidebar>
        <main className="flex-1 flex flex-col h-screen overflow-hidden">
          <div className="flex-1 overflow-auto p-6">
            {children}
          </div>
        </main>
      </div>
    </SidebarProvider>
  );
}
