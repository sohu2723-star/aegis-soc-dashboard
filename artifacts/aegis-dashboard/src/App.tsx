import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
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

function Router() {
  useSSE();
  useKeepAlive();
  return (
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
        <Route component={NotFound} />
      </Switch>
    </Layout>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <DeviceProvider>
          <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
            <Router />
          </WouterRouter>
        </DeviceProvider>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
