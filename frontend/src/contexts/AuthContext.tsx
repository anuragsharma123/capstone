import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { login as apiLogin, signup as apiSignup, getCurrentUser, setAuthToken, onUnauthorized, type AuthUser } from "../lib/api";

const TOKEN_STORAGE_KEY = "auth-token";

interface AuthContextValue {
  user: AuthUser | null;
  /** True only while bootstrapping the stored token on first load — never true again after, so a route guard doesn't flash a login redirect before the stored session has had a chance to validate. */
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  signup: (email: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    onUnauthorized(() => {
      localStorage.removeItem(TOKEN_STORAGE_KEY);
      setAuthToken(null);
      setUser(null);
    });

    const stored = localStorage.getItem(TOKEN_STORAGE_KEY);
    if (!stored) {
      setLoading(false);
      return;
    }
    setAuthToken(stored);
    getCurrentUser()
      .then(setUser)
      .catch(() => {
        // Stored token is expired/invalid — onUnauthorized already cleared it above.
      })
      .finally(() => setLoading(false));
  }, []);

  function applySession(token: string, authedUser: AuthUser) {
    localStorage.setItem(TOKEN_STORAGE_KEY, token);
    setAuthToken(token);
    setUser(authedUser);
  }

  async function login(email: string, password: string) {
    const result = await apiLogin(email, password);
    applySession(result.token, result.user);
  }

  async function signup(email: string, password: string) {
    const result = await apiSignup(email, password);
    applySession(result.token, result.user);
  }

  function logout() {
    localStorage.removeItem(TOKEN_STORAGE_KEY);
    setAuthToken(null);
    setUser(null);
  }

  return <AuthContext.Provider value={{ user, loading, login, signup, logout }}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth() must be used inside <AuthProvider>.");
  return ctx;
}
