// Archivo: /flotillas/web/src/contexts/AuthContext.tsx
// REEMPLAZA: Archivo existente completo

'use client';

import { createContext, useContext, useCallback, ReactNode, useSyncExternalStore } from 'react';
import { useRouter } from 'next/navigation';
import Cookies from 'js-cookie';
import api from '@/lib/api';

export type UserRole =
  | 'ADMIN'
  | 'SUPERVISOR_VEHICLES'
  | 'SUPERVISOR_FUEL'
  | 'SUPERVISOR_MAINTENANCE'
  | 'EXECUTOR'
  | 'WORKSHOP';

interface User {
  id: number;
  email: string;
  fullName: string;
  role: UserRole;
  isActive: boolean;
  /** Solo presente cuando role=WORKSHOP. */
  workshopId?: number | null;
}

interface AuthContextType {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

// Almacén externo para evitar setState dentro de effects
let externalUser: User | null = null;
let externalLoading = true;
let listeners: Array<() => void> = [];

function emitChange() {
  for (const listener of listeners) {
    listener();
  }
}

function subscribe(listener: () => void) {
  listeners.push(listener);
  return () => {
    listeners = listeners.filter((l) => l !== listener);
  };
}

// Verificar token al cargar (una sola vez)
let initialized = false;
function initAuth() {
  if (initialized) return;
  initialized = true;

  const token = Cookies.get('token');
  if (token) {
    api.get('/auth/me')
      .then((res) => {
        externalUser = res.data.data;
      })
      .catch(() => {
        Cookies.remove('token');
        externalUser = null;
      })
      .finally(() => {
        externalLoading = false;
        emitChange();
      });
  } else {
    externalLoading = false;
    emitChange();
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  initAuth();

  const user = useSyncExternalStore(subscribe, () => externalUser, () => null);
  const loading = useSyncExternalStore(subscribe, () => externalLoading, () => true);
  const router = useRouter();

  const login = useCallback(async (email: string, password: string) => {
    const res = await api.post('/auth/login', { email, password });
    const { token, user: userData } = res.data.data;
    Cookies.set('token', token, { expires: 1 / 3 });
    externalUser = userData;
    emitChange();
    router.push('/dashboard');
  }, [router]);

  const logout = useCallback(() => {
    Cookies.remove('token');
    externalUser = null;
    emitChange();
    router.push('/login');
  }, [router]);

  return (
    <AuthContext.Provider value={{ user, loading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth debe usarse dentro de AuthProvider');
  }
  return context;
}