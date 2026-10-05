import { type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import { AtlasShell } from '@/components/atlas-shell';
import {
  ClientsPage,
  EmployeesPage,
  FinancePage,
  LeaderboardPage,
  SettingsPage,
  VisibilityPage,
} from '@/pages/atlas-pages';
import { CommandCenterPage } from '@/pages/command-center-page';
import { CrmPage } from '@/pages/crm-page';
import { MissionQueuePage } from '@/pages/mission-queue-page';
import { ScoutPage } from '@/pages/scout-page';
import NotFound from '@/pages/not-found';
import {
  Route,
  Switch,
  useLocation,
  Router as WouterRouter,
} from 'wouter';

const queryClient = new QueryClient();

function Router() {
  return (
    <AtlasShell>
      <RoutedErrorBoundary>
        <Switch>
          <Route path="/" component={CommandCenterPage} />
          <Route path="/employees" component={EmployeesPage} />
          <Route path="/crm" component={CrmPage} />
          <Route path="/mission-queue" component={MissionQueuePage} />
          <Route path="/scout" component={ScoutPage} />
          <Route path="/clients" component={ClientsPage} />
          <Route path="/visibility" component={VisibilityPage} />
          <Route path="/atlas-leaderboard" component={LeaderboardPage} />
          <Route path="/finance" component={FinancePage} />
          <Route path="/settings" component={SettingsPage} />
          <Route component={NotFound} />
        </Switch>
      </RoutedErrorBoundary>
    </AtlasShell>
  );
}

function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
