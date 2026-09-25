"use client";
import { createContext, useCallback, useContext, useEffect, useState, ReactNode } from "react";
import { useRouter } from "next/navigation";

interface AuthUser {
  username: string;
  userId: string;
}

interface AuthContextType {
  user: AuthUser | null;
  isLoggedIn: boolean;
  isLoading: boolean;
  login: (username: string, password: string) => Promise<{ success: boolean; error?: string }>;
  logout: () => Promise<void>;
  // Re-ask the server whether the session is still good. `user` is read once,
  // when the app loads, and "log out other devices" can revoke it after that.
  // Resolves true only when the server confirms the session.
  refresh: () => Promise<boolean>;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  isLoggedIn: false,
  isLoading: true,
  login: async () => ({ success: false }),
  logout: async () => {},
  refresh: async () => false,
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const router = useRouter();

  // Check session on mount
  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => r.json())
      .then((data) => {
        setUser(data.user ?? null);
      })
      .catch(() => setUser(null))
      .finally(() => setIsLoading(false));
  }, []);

  const refresh = useCallback(async () => {
    try {
      const data = await (await fetch("/api/auth/me")).json();
      const fresh: AuthUser | null = data.user ?? null;
      setUser(fresh);
      return fresh !== null;
    } catch {
      return false; // network trouble: change nothing, claim nothing
    }
  }, []);

  async function login(username: string, password: string) {
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json();
      if (res.ok) {
        setUser({ username: data.username, userId: "" });
        return { success: true };
      }
      return { success: false, error: data.error };
    } catch {
      return { success: false, error: "เกิดข้อผิดพลาด กรุณาลองใหม่" };
    }
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    setUser(null);
    router.push("/");
  }

  return (
    <AuthContext.Provider value={{ user, isLoggedIn: !!user, isLoading, login, logout, refresh }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
