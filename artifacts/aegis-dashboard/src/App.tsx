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
import { DeviceProvider } from "@/lib/device-context";

import Dashboard from "@/pages/dashboard";
import Events from "@/pages/events";
import Incidents from "@/pages/incidents";
import IncidentDetail from "@/pages/incident-detail";
import Alerts from "@/pages/alerts";
import SystemStatus from "@/pages/system";
import Reports from "@/pages/reports";
import Network from "@/pages/network";
import Defense from "@/pages/defense";
import Architecture from "@/pages/architecture";
import Connections from "@/pages/connections";
import DefenseRules from "@/pages/defense-rules";
import SettingsPage from "@/pages/settings";
import AttackFlow from "@/pages/attack-flow";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: true,
      staleTime: 5000,
      retry: 1,
      retryDelay: 3000,
    },
  },
});

function ProtectedRouter() {
  useSSE();
  useKeepAlive();
  return (
    <AuthGuard>
      <Layout>
        <Switch>
          <Route path="/" component={Dashboard} />
          <Route path="/events" component={Events} />
          <Route path="/incidents" component={Incidents} />
          <Route path="/incidents/:id" component={IncidentDetail} />
          <Route path="/alerts" component={Alerts} />
          <Route path="/system" component={SystemStatus} />
          <Route path="/network" component={Network} />
          <Route path="/defense" component={Defense} />
          <Route path="/architecture" component={Architecture} />
          <Route path="/reports" component={Reports} />
          <Route path="/connections" component={Connections} />
          <Route path="/defense-rules" component={DefenseRules} />
          <Route path="/settings" component={SettingsPage} />
          <Route path="/attack-flow" component={AttackFlow} />
          <Route component={NotFound} />
        </Switch>
      </Layout>
    </AuthGuard>
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
