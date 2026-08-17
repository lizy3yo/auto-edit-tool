import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Film, Loader2, Eye, EyeOff } from "lucide-react";

export function LoginScreen({ onSuccess }: { onSuccess: () => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email, password }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Login failed");
        return;
      }

      onSuccess();
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    // A flat grey page behind a white card gives the card its edge; on white-on-
    // white the panel would have to lean entirely on its border to be visible.
    <div className="flex items-center justify-center min-h-screen bg-muted/50">
      <div className="flex flex-col items-center gap-6 p-4 w-full max-w-sm">
        {/* Logo */}
        <div className="flex items-center gap-3 mb-2">
          <div className="h-10 w-10 rounded-lg bg-primary flex items-center justify-center">
            <Film className="h-5 w-5 text-primary-foreground" />
          </div>
          <span className="text-2xl font-semibold tracking-tight">
            Longform Studio
          </span>
        </div>

        <Card className="w-full">
          <CardContent className="p-6">
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="text-center mb-2">
                <h1 className="text-lg font-medium text-foreground">Sign in</h1>
                <p className="text-sm text-muted-foreground mt-1">
                  Enter your admin credentials to continue
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="Enter your email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  autoComplete="username"
                  autoFocus
                  required
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    placeholder="Enter your password"
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    autoComplete="current-password"
                    required
                    className="pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                    tabIndex={-1}
                  >
                    {showPassword ? (
                      <EyeOff className="h-4 w-4" />
                    ) : (
                      <Eye className="h-4 w-4" />
                    )}
                  </button>
                </div>
              </div>

              {error && (
                <p
                  role="alert"
                  className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-center text-sm text-destructive"
                >
                  {error}
                </p>
              )}

              <Button
                type="submit"
                size="lg"
                className="w-full"
                disabled={loading || !email || !password}
              >
                {loading ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                    Signing in...
                  </>
                ) : (
                  "Sign in"
                )}
              </Button>
            </form>
          </CardContent>
        </Card>

        <p className="text-xs text-muted-foreground text-center">
          Credentials are set via ADMIN_EMAIL / ADMIN_PASSWORD in .env
        </p>
      </div>
    </div>
  );
}
