"use client";
import { createContext, useCallback, useContext, useEffect, useState, ReactNode } from "react";
import { useRouter } from "next/navigation";

interface AuthUser {
  username: string;
  userId: string;
}

interface LoginResult {
  success: boolean;
  error?: string;
  /** The password was right, but the account has two-factor login on: ask
   *  for the code next (verifyTwoFactor). No session exists yet. */
  twoFactorRequired?: boolean;
}

interface TwoFactorResult {
  success: boolean;
  error?: string;
  /** The half-finished login expired — go back to the password form. */
  restart?: boolean;
  /** Set when a backup code was spent: how many are left. */
  backupCodesRemaining?: number;
}

interface AuthContextType {
  user: AuthUser | null;
  isLoggedIn: boolean;
  isLoading: boolean;
  login: (username: string, password: string) => Promise<LoginResult>;
  /** Step two of a two-factor login: a code from the app, or a backup code. */
  verifyTwoFactor: (code: string) => Promise<TwoFactorResult>;
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
  verifyTwoFactor: async () => ({ success: false }),
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
      if (res.ok && data.twoFactorRequired) {
        // Password accepted, no session yet — the code comes next.
        return { success: false, twoFactorRequired: true };
      }
      if (res.ok) {
        setUser({ username: data.username, userId: "" });
        return { success: true };
      }
      return { success: false, error: data.error };
    } catch {
      return { success: false, error: "เกิดข้อผิดพลาด กรุณาลองใหม่" };
    }
  }

  async function verifyTwoFactor(code: string) {
    try {
      const res = await fetch("/api/auth/login/2fa", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const data = await res.json().catch(() => null);
      if (res.ok && data?.success) {
        setUser({ username: data.username, userId: "" });
        return {
          success: true,
          ...(typeof data.backupCodesRemaining === "number"
            ? { backupCodesRemaining: data.backupCodesRemaining }
            : {}),
        };
      }
      return {
        success: false,
        error: typeof data?.error === "string" ? data.error : "ยืนยันรหัสไม่สำเร็จ กรุณาลองใหม่",
        restart: data?.restart === true,
      };
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
    <AuthContext.Provider value={{ user, isLoggedIn: !!user, isLoading, login, verifyTwoFactor, logout, refresh }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
