import React, { createContext } from "react";
import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/contexts/auth-context";
import { AuthGuard } from "@/components/auth-guard";
import NotFound from "@/pages/not-found";
import LoginPage from "@/pages/login";
import { Layout } from "@/components/layout";
import { useSSE } from "@/hooks/use-sse";
import { useKeepAlive } from "@/hooks/use-keep-alive";
import { useSoundAlert } from "@/hooks/use-sound-alert";
import { DeviceProvider } from "@/lib/device-context";

import Dashboard from "@/pages/dashboard";
import Events from "@/pages/events";
import Alerts from "@/pages/alerts";
import SystemStatus from "@/pages/system";
import Reports from "@/pages/reports";
import Network from "@/pages/network";
import Defense from "@/pages/defense";
import Connections from "@/pages/connections";
import DefenseRules from "@/pages/defense-rules";
import SettingsPage from "@/pages/settings";
import AttackFlow from "@/pages/attack-flow";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // SSE (useSSE hook) already pushes live events via broadcaster — no need
      // to hammer the API on every window focus. Disable focus-refetch to avoid
      // a burst of 8+ parallel DB queries every time the user alt-tabs back.
      refetchOnWindowFocus: false,
      // 10 s stale window: data is considered fresh for 10 s after the last
      // successful fetch. Prevents duplicate requests when the dashboard's
      // own refetchInterval fires alongside a component remount.
      staleTime: 10_000,
      gcTime: 60_000,        // keep cache 1 min before garbage collecting
      retry: 2,
      retryDelay: 2000,
    },
  },
});

export const SoundAlertContext = createContext<{ enabled: boolean; toggle: () => void }>({ enabled: true, toggle: () => {} });

function ProtectedRouter() {
  useSSE();
  useKeepAlive();
  const sound = useSoundAlert();
  return (
    <SoundAlertContext.Provider value={sound}>
    <AuthGuard>
      <Layout>
        <Switch>
          <Route path="/" component={Dashboard} />
          <Route path="/events" component={Events} />
          <Route path="/alerts" component={Alerts} />
          <Route path="/system" component={SystemStatus} />
          <Route path="/network" component={Network} />
          <Route path="/defense" component={Defense} />
          <Route path="/reports" component={Reports} />
          <Route path="/connections" component={Connections} />
          <Route path="/defense-rules" component={DefenseRules} />
          <Route path="/settings" component={SettingsPage} />
          <Route path="/attack-flow" component={AttackFlow} />
          <Route component={NotFound} />
        </Switch>
      </Layout>
    </AuthGuard>
    </SoundAlertContext.Provider>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <AuthProvider>
          <DeviceProvider>
            <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
              <Switch>
                <Route path="/login" component={LoginPage} />
                <Route component={ProtectedRouter} />
              </Switch>
            </WouterRouter>
          </DeviceProvider>
        </AuthProvider>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
