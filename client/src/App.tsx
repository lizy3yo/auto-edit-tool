import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch, Link, useLocation } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import LongformPage from "./pages/LongformPage";
import LibraryPage from "./pages/LibraryPage";
import ChannelsPage from "./pages/ChannelsPage";
import AdminPage from "./pages/AdminPage";
import { useAuth } from "./_core/hooks/useAuth";
import { LoginScreen } from "./components/LoginScreen";
import { CreditErrorPopup } from "./components/CreditErrorPopup";
import { Film, LibraryBig, Loader2, LogOut, Settings, Tv } from "lucide-react";
import { Button } from "@/components/ui/button";

function Layout({ children }: { children: React.ReactNode }) {
  const { logout } = useAuth();
  const [location] = useLocation();
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border">
        {/* Wraps below `sm` rather than overflowing. The wordmark, four nav items and
            Logout need ~700px on one line and there is no mobile nav, so on a narrow
            window this row used to push the whole document wider than the viewport —
            which reads as every page being broken, not as the header being too wide. */}
        <div className="mx-auto flex max-w-[1400px] flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2 sm:h-14 sm:flex-nowrap sm:gap-x-6 sm:py-0">
          <Link
            href="/"
            className="flex shrink-0 items-center gap-2 font-semibold"
          >
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-primary/20">
              <Film className="h-4 w-4 text-primary" />
            </div>
            {/* Icon alone carries the home link on phones; the wordmark is the widest
                thing here and the first worth dropping. */}
            <span className="hidden sm:inline">Longform Studio</span>
          </Link>
          {/* Below `sm` this takes a full-width row of its own beneath the logo and
              Logout, and wraps within it — so no nav item is ever unreachable. */}
          <nav className="order-last flex w-full flex-wrap items-center gap-1 text-sm sm:order-none sm:w-auto sm:flex-nowrap">
            <Link
              href="/"
              className={`whitespace-nowrap rounded-md px-3 py-1.5 transition-colors ${
                location === "/"
                  ? "bg-secondary text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Long-form Video
            </Link>
            <Link
              href="/library"
              className={`flex items-center gap-1.5 whitespace-nowrap rounded-md px-3 py-1.5 transition-colors ${
                location.startsWith("/library")
                  ? "bg-secondary text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <LibraryBig className="h-3.5 w-3.5" />
              Library
            </Link>
            <Link
              href="/channels"
              className={`flex items-center gap-1.5 whitespace-nowrap rounded-md px-3 py-1.5 transition-colors ${
                location.startsWith("/channels")
                  ? "bg-secondary text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Tv className="h-3.5 w-3.5" />
              Channels
            </Link>
            <Link
              href="/admin"
              className={`flex items-center gap-1.5 whitespace-nowrap rounded-md px-3 py-1.5 transition-colors ${
                location.startsWith("/admin")
                  ? "bg-secondary text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Settings className="h-3.5 w-3.5" />
              Admin
            </Link>
          </nav>
          <div className="ml-auto shrink-0">
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground"
              onClick={() => {
                void logout().then(() => {
                  window.location.href = "/";
                });
              }}
            >
              <LogOut className="mr-1.5 h-3.5 w-3.5" />
              Logout
            </Button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-[1400px] px-4 py-6">{children}</main>
    </div>
  );
}

function Router() {
  const { isAuthenticated, loading, refresh } = useAuth();

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return <LoginScreen onSuccess={() => void refresh()} />;
  }

  return (
    <Layout>
      <Switch>
        <Route path="/">
          <LongformPage />
        </Route>
        <Route path="/library" component={LibraryPage} />
        <Route path="/channels" component={ChannelsPage} />
        <Route path="/admin" component={AdminPage} />
        <Route component={NotFound} />
      </Switch>
    </Layout>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="dark">
        <TooltipProvider>
          <Toaster
            theme="dark"
            toastOptions={{
              style: {
                background: "oklch(0.19 0.005 260)",
                border: "1px solid oklch(1 0 0 / 8%)",
                color: "oklch(0.93 0.005 260)",
              },
            }}
          />
          <CreditErrorPopup />
          <Router />
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
