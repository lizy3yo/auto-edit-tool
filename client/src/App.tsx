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
import {
  Film,
  LibraryBig,
  Loader2,
  LogOut,
  Menu,
  Settings,
  Tv,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useEffect, useState } from "react";

/**
 * The nav, declared once. It used to be four near-identical `<Link>` blocks with
 * the active-state ternary copy-pasted into each — which is how "Long-form Video"
 * ended up as the only item without an icon, and how the mobile row drifted out of
 * sync with the desktop one.
 */
const NAV = [
  { href: "/", label: "Long-form video", icon: Film },
  { href: "/library", label: "Library", icon: LibraryBig },
  { href: "/channels", label: "Channels", icon: Tv },
  { href: "/admin", label: "Admin", icon: Settings },
] as const;

/** `/` must match exactly — every path starts with it. */
const isActive = (location: string, href: string) =>
  href === "/" ? location === "/" : location.startsWith(href);

function DesktopNav({ location }: { location: string }) {
  return (
    <nav
      aria-label="Main"
      className="hidden h-full items-center gap-0.5 sm:flex"
    >
      {NAV.map(({ href, label, icon: Icon }) => {
        const active = isActive(location, href);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            // The active state is an inset bottom border rather than a filled pill:
            // on white, a `bg-secondary` pill is a grey lozenge that reads as a
            // disabled button. The rule ties the tab to the header edge instead.
            className={`flex h-full items-center gap-2 whitespace-nowrap px-3 text-sm transition-colors ${
              active
                ? "font-medium text-primary shadow-[inset_0_-2px_0_0_var(--primary)]"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Icon className="h-4 w-4" />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}

/**
 * Below `sm` the four links used to wrap onto a full-width second row, which made
 * the header two-and-a-bit lines tall and pushed the page content down on every
 * screen. A menu keeps the header one 56px line at every width.
 */
function MobileNav({ location }: { location: string }) {
  const [open, setOpen] = useState(false);

  // Navigating closes it — wouter swaps the route in place, so without this the
  // menu stays open over the page you just asked for.
  useEffect(() => setOpen(false), [location]);

  const current = NAV.find(n => isActive(location, n.href));

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild className="sm:hidden">
        <Button variant="outline" size="sm" className="gap-2">
          <Menu className="h-4 w-4" />
          <span className="max-w-32 truncate">{current?.label ?? "Menu"}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-56 p-1.5">
        <nav aria-label="Main">
          {NAV.map(({ href, label, icon: Icon }) => {
            const active = isActive(location, href);
            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? "page" : undefined}
                className={`flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm transition-colors ${
                  active
                    ? "bg-primary/10 font-medium text-primary"
                    : "text-foreground hover:bg-muted"
                }`}
              >
                <Icon className="h-4 w-4 shrink-0" />
                {label}
              </Link>
            );
          })}
        </nav>
      </PopoverContent>
    </Popover>
  );
}

/**
 * Sign-out behind an account menu.
 *
 * It was a bare "Logout" button pinned to the top-right — the single most
 * destructive control in the app, sitting in its most clickable slot, one stray
 * click away from ending a render session. Behind a menu it takes two deliberate
 * clicks, and the slot now shows who you are signed in as instead.
 */
function AccountMenu() {
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);

  const name = user?.name || user?.email || "Account";
  const initials = name
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(part => part[0]?.toUpperCase() ?? "")
    .join("");

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Account menu"
          className="flex h-8 w-8 items-center justify-center rounded-full border border-border bg-muted text-xs font-medium text-muted-foreground transition-colors hover:border-border hover:bg-secondary hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
        >
          {initials || "?"}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-60 p-1.5">
        <div className="border-b border-border px-2.5 pb-2.5 pt-1.5">
          <p className="truncate text-sm font-medium">{name}</p>
          {user?.email && (
            <p className="truncate text-xs text-muted-foreground">
              {user.email}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            void logout().then(() => {
              window.location.href = "/";
            });
          }}
          className="mt-1 flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-sm text-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
        >
          <LogOut className="h-4 w-4 shrink-0" />
          Sign out
        </button>
      </PopoverContent>
    </Popover>
  );
}

function Layout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* The generator page runs to several thousand pixels, so a header that
          scrolls away leaves every other page unreachable mid-job without a trip
          back to the top. */}
      <header className="sticky top-0 z-50 h-[var(--app-header-h)] border-b border-border bg-background/85 backdrop-blur-md supports-[backdrop-filter]:bg-background/75">
        <div className="mx-auto flex h-full max-w-[1400px] items-center gap-3 px-4 sm:gap-5">
          <Link
            href="/"
            className="flex shrink-0 items-center gap-2 font-semibold"
          >
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-primary">
              <Film className="h-4 w-4 text-primary-foreground" />
            </div>
            {/* The icon alone carries the home link on phones; the wordmark is the
                widest thing in the row and the first worth dropping. */}
            <span className="hidden text-sm sm:inline">Longform Studio</span>
          </Link>

          <MobileNav location={location} />
          <DesktopNav location={location} />

          <div className="ml-auto flex shrink-0 items-center gap-2">
            <AccountMenu />
          </div>
        </div>
      </header>

      <main id="main" className="mx-auto max-w-[1400px] px-4 py-6">
        {children}
      </main>
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
      <ThemeProvider defaultTheme="light">
        <TooltipProvider>
          {/* Off-screen until focused: the header is four links deep, and a
              keyboard user otherwise tabs through all of them on every page. */}
          <a
            href="#main"
            className="sr-only rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100]"
          >
            Skip to content
          </a>
          {/* No inline colours — `sonner.tsx` already maps the toast surface onto
              `--popover` / `--border`, so the toast follows the theme by itself. */}
          <Toaster theme="light" position="bottom-right" />
          <CreditErrorPopup />
          <Router />
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
