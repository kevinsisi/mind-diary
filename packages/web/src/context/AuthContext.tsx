import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { apiClient } from '../api/client';

interface AuthUser {
  id: number;
  username: string;
  role: 'admin' | 'user';
  nickname: string;
}

interface AuthContextValue {
  user: AuthUser | null;
  isLoading: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  updateNickname: (nickname: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    apiClient
      .get<AuthUser>('/api/auth/me')
      .then(setUser)
      .catch(() => setUser(null))
      .finally(() => setIsLoading(false));
  }, []);

  async function login(username: string, password: string) {
    const data = await apiClient.post<AuthUser>('/api/auth/login', { username, password });
    setUser(data);
  }

  async function logout() {
    await apiClient.post('/api/auth/logout');
    setUser(null);
  }

  async function updateNickname(nickname: string) {
    const updated = await apiClient.patch<AuthUser>('/api/auth/me', { nickname });
    setUser(updated);
  }

  return <AuthContext.Provider value={{ user, isLoading, login, logout, updateNickname }}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
