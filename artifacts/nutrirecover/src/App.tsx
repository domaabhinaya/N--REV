import { Suspense, lazy } from "react";
import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Skeleton } from "@/components/ui/skeleton";
import NotFound from "@/pages/not-found";

// Route-level code splitting: every page is loaded on demand so the current
// route never pays for the other pages' JavaScript (recharts, framer-motion,
// html2pdf and page-level logic all stay out of the initial bundle).
const Home = lazy(() =>
  import("./pages/Home").then((m) => ({ default: m.Home })),
);
const Assessment = lazy(() =>
  import("./pages/Assessment").then((m) => ({ default: m.Assessment })),
);
const RecoveryPlanPage = lazy(() =>
  import("./pages/RecoveryPlan").then((m) => ({ default: m.RecoveryPlanPage })),
);
const Tracking = lazy(() =>
  import("./pages/Tracking").then((m) => ({ default: m.Tracking })),
);
const Suggestions = lazy(() =>
  import("./pages/Suggestions").then((m) => ({ default: m.Suggestions })),
);
const Dashboard = lazy(() =>
  import("./pages/Dashboard").then((m) => ({ default: m.Dashboard })),
);
const Labs = lazy(() =>
  import("./pages/Labs").then((m) => ({ default: m.Labs })),
);
const Report = lazy(() =>
  import("./pages/Report").then((m) => ({ default: m.Report })),
);
const AiAssistant = lazy(() =>
  import("./pages/AiAssistant").then((m) => ({ default: m.AiAssistant })),
);
const AdminPanel = lazy(() =>
  import("./pages/AdminPanel").then((m) => ({ default: m.AdminPanel })),
);

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Data stays fresh for 60s so navigating between routes does not
      // trigger a refetch storm on every mount. Without defaults,
      // staleTime=0 refires every query on each navigation.
      staleTime: 60_000,
      gcTime: 5 * 60_000,
      refetchOnWindowFocus: false,
      refetchOnMount: false,
    },
  },
});

function RouteFallback() {
  return (
    <div className="min-h-[100dvh] flex flex-col items-center justify-center gap-4 bg-background">
      <Skeleton className="h-10 w-64" />
      <Skeleton className="h-40 w-full max-w-3xl" />
      <Skeleton className="h-40 w-full max-w-3xl" />
    </div>
  );
}

function Router() {
  return (
    <Switch>
      <Route path="/" component={Home} />
      <Route path="/assessment" component={Assessment} />
      <Route path="/recovery-plan" component={RecoveryPlanPage} />
      <Route path="/tracking" component={Tracking} />
      <Route path="/suggestions" component={Suggestions} />
      <Route path="/dashboard" component={Dashboard} />
      <Route path="/labs" component={Labs} />
      <Route path="/report" component={Report} />
      <Route path="/ai-assistant" component={AiAssistant} />
      <Route path="/admin" component={AdminPanel} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Suspense fallback={<RouteFallback />}>
          <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
            <Router />
          </WouterRouter>
        </Suspense>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;

