import axios from "axios";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { SafeUser } from "@selection/shared";
import { api } from "../api";

const AUTH_STARTUP_RETRY_DELAYS = [500, 1000, 1500];

function isTransientNetworkError(error: unknown) {
  if (!axios.isAxiosError(error)) return false;
  if (error.response) return error.response.status >= 500;
  return error.code === "ERR_NETWORK" || error.code === "ECONNREFUSED";
}

interface AuthContextValue {
  user: SafeUser | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<LoginResult>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
}

export type LoginResult =
  | { status: "AUTHENTICATED"; user: SafeUser }
  | { status: "PENDING_APPROVAL"; requestId: string };

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SafeUser | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      for (let attempt = 0; ; attempt += 1) {
        try {
          const response = await api.get("/auth/me");
          setUser(response.data.user as SafeUser);
          return;
        } catch (error) {
          const retryDelay = AUTH_STARTUP_RETRY_DELAYS[attempt];
          if (!isTransientNetworkError(error) || retryDelay === undefined) {
            setUser(null);
            return;
          }
          await new Promise((resolve) => window.setTimeout(resolve, retryDelay));
        }
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const login = useCallback(async (username: string, password: string) => {
    const response = await api.post("/auth/login", { username, password });
    const result = response.data as LoginResult;
    if (result.status === "AUTHENTICATED") setUser(result.user);
    else setUser(null);
    return result;
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
