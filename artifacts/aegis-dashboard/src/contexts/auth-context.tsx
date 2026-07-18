/**
 * Auth context — stores JWT session in localStorage ("aegis_session").
 * Exposes: user, login(), logout(), isLoading, isAuthenticated
 */
import { createContext, useContext, useEffect, useState, useCallback } from "react";

const TOKEN_KEY = "aegis_session";

export interface AuthUser {
  role:   "admin";
  method: "admin-key" | "google";
  email?: string;
}

interface AuthState {
  user:            AuthUser | null;
  isLoading:       boolean;
  isAuthenticated: boolean;
  login:           (token: string) => Promise<void>;
  logout:          () => void;
  getToken:        () => string | null;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser]         = useState<AuthUser | null>(null);
  const [isLoading, setLoading] = useState(true);

  /* ── Verify stored token on mount ─────────────────────────────────────── */
  useEffect(() => {
    const stored = localStorage.getItem(TOKEN_KEY);
    if (!stored) { setLoading(false); return; }

    fetch("/api/auth/me", {
      headers: { Authorization: `Bearer ${stored}` },
    })
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(data => setUser(data.user))
      .catch(() => localStorage.removeItem(TOKEN_KEY))
      .finally(() => setLoading(false));
  }, []);

  const login = useCallback(async (token: string) => {
    localStorage.setItem(TOKEN_KEY, token);
    const r    = await fetch("/api/auth/me", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await r.json();
    setUser(data.user);
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY);
    setUser(null);
    fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
  }, []);

  const getToken = useCallback(() => localStorage.getItem(TOKEN_KEY), []);

  return (
    <AuthContext.Provider value={{
      user, isLoading,
      isAuthenticated: user !== null,
      login, logout, getToken,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be inside AuthProvider");
  return ctx;
}
