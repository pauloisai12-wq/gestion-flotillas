
'use client';

import { createContext, useContext, useCallback, useEffect, ReactNode, useSyncExternalStore } from 'react';
import { useRouter } from 'next/navigation';
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
  logout: () => Promise<void>;
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

// Verificar sesión al cargar (una sola vez). La cookie es httpOnly, no
// podemos detectarla desde JS — preguntamos al backend con /auth/me y
// decidimos por la respuesta.
let initialized = false;
function initAuth() {
  if (initialized) return;
  initialized = true;

  api.get('/auth/me')
    .then((res) => {
      externalUser = res.data.data;
    })
    .catch(() => {
      externalUser = null;
    })
    .finally(() => {
      externalLoading = false;
      emitChange();
    });
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const user = useSyncExternalStore(subscribe, () => externalUser, () => null);
  const loading = useSyncExternalStore(subscribe, () => externalLoading, () => true);
  const router = useRouter();

  // Verificar la sesión en un efecto (no durante el render): evita side-effects
  // en render. initAuth() es idempotente (guardado por `initialized`).
  useEffect(() => {
    initAuth();
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    // El backend emite Set-Cookie httpOnly con el token. El cliente solo
    // consume el user de la respuesta — el token no se almacena en JS.
    const res = await api.post('/auth/login', { email, password });
    externalUser = res.data.data.user;
    emitChange();
    router.push('/dashboard');
  }, [router]);

  const logout = useCallback(async () => {
    // El backend borra la cookie httpOnly; aquí solo limpiamos el estado.
    try {
      await api.post('/auth/logout');
    } catch {
      /* aun si falla, salimos del cliente */
    }
    externalUser = null;
    initialized = false; // permite re-verificar /auth/me si el provider se remonta
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