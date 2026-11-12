import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { SafeUser } from "@selection/shared";
import { api } from "../api";

interface AuthContextValue {
  user: SafeUser | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<SafeUser>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SafeUser | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const response = await api.get("/auth/me");
      setUser(response.data.user as SafeUser);
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const login = useCallback(async (username: string, password: string) => {
    const response = await api.post("/auth/login", { username, password });
    const nextUser = response.data.user as SafeUser;
    setUser(nextUser);
    return nextUser;
  }, []);

  const logout = useCallback(async () => {
    try { await api.post("/auth/logout"); } finally { setUser(null); }
  }, []);

  const value = useMemo(() => ({ user, loading, login, logout, refresh }), [user, loading, login, logout, refresh]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth 必须在 AuthProvider 内使用。");
  return context;
}
