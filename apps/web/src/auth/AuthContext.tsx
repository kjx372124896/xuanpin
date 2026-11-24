import axios from "axios";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { SafeUser } from "@selection/shared";
import { api } from "../api";
import { clearSessionQueries } from "./session-cache";

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
  const queryClient = useQueryClient();
  const authEpoch = useRef(0);
  const userId = useRef<string | null>(null);

  const updateUser = useCallback(async (nextUser: SafeUser | null, epoch: number) => {
    if (epoch !== authEpoch.current) return;
    if (userId.current !== (nextUser?.id ?? null)) {
      await clearSessionQueries(queryClient);
      if (epoch !== authEpoch.current) return;
      userId.current = nextUser?.id ?? null;
    }
    setUser(nextUser);
  }, [queryClient]);

  const refresh = useCallback(async () => {
    const epoch = authEpoch.current;
    try {
      for (let attempt = 0; ; attempt += 1) {
        try {
          const response = await api.get("/auth/me");
          await updateUser(response.data.user as SafeUser, epoch);
          return;
        } catch (error) {
          const retryDelay = AUTH_STARTUP_RETRY_DELAYS[attempt];
          if (!isTransientNetworkError(error) || retryDelay === undefined) {
            await updateUser(null, epoch);
            return;
          }
          await new Promise((resolve) => window.setTimeout(resolve, retryDelay));
        }
      }
    } finally {
      setLoading(false);
    }
  }, [updateUser]);

  useEffect(() => { void refresh(); }, [refresh]);

  const login = useCallback(async (username: string, password: string) => {
    const epoch = ++authEpoch.current;
    setUser(null);
    userId.current = null;
    await clearSessionQueries(queryClient);
    const response = await api.post("/auth/login", { username, password });
    const result = response.data as LoginResult;
    await updateUser(result.status === "AUTHENTICATED" ? result.user : null, epoch);
    return result;
  }, [queryClient, updateUser]);

  const logout = useCallback(async () => {
    const epoch = ++authEpoch.current;
    await clearSessionQueries(queryClient);
    try { await api.post("/auth/logout"); } finally { await updateUser(null, epoch); }
  }, [queryClient, updateUser]);

  const value = useMemo(() => ({ user, loading, login, logout, refresh }), [user, loading, login, logout, refresh]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth 必须在 AuthProvider 内使用。");
  return context;
}
