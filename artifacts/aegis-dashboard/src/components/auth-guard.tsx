/**
 * AuthGuard — redirects unauthenticated users to /login.
 * Shows a loading spinner while the session is being verified.
 */
import { useEffect } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/contexts/auth-context";
import { Shield, Loader2 } from "lucide-react";

export function AuthGuard({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading } = useAuth();
  const [location, setLocation]        = useLocation();

  useEffect(() => {
    if (!isLoading && !isAuthenticated && location !== "/login") {
      setLocation("/login");
    }
  }, [isLoading, isAuthenticated, location, setLocation]);

  if (isLoading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4"
           style={{ background: "#080c1c" }}>
        <div className="flex items-center gap-3">
          <Shield className="w-6 h-6 text-primary animate-pulse" />
          <span className="font-mono text-primary text-sm tracking-widest">AEGIS</span>
        </div>
        <Loader2 className="w-5 h-5 text-muted-foreground animate-spin" />
      </div>
    );
  }

  if (!isAuthenticated) return null;

  return <>{children}</>;
}
