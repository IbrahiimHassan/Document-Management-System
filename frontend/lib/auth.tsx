"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { useRouter } from "next/navigation";
import { ApiError, getMe, logout } from "./api";
import type { User } from "./types";

interface AuthContextValue {
  user: User;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used inside AuthProvider");
  return value;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    getMe()
      .then((result) => {
        if (active) setUser(result.user);
      })
      .catch((err: unknown) => {
        // A 401 already redirected to /login inside the API helper
        if (active && !(err instanceof ApiError && err.status === 401)) {
          setError(err instanceof Error ? err.message : "Could not load your account.");
        }
      });
    return () => {
      active = false;
    };
  }, [attempt]);

  const signOut = useCallback(async () => {
    try {
      await logout();
    } finally {
      router.replace("/login");
    }
  }, [router]);

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center p-6">
        <div role="alert" className="max-w-sm rounded-xl border border-line bg-surface p-6 text-center">
          <p className="font-semibold">Could not load your account</p>
          <p className="mt-1 text-sm text-muted">{error}</p>
          <button
            className="mt-4 rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-hover"
            onClick={() => {
              setError(null);
              setAttempt((n) => n + 1);
            }}
          >
            Try again
          </button>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="flex min-h-screen items-center justify-center" aria-busy="true">
        <p className="text-sm text-muted">Loading your workspace…</p>
      </div>
    );
  }

  return <AuthContext.Provider value={{ user, signOut }}>{children}</AuthContext.Provider>;
}