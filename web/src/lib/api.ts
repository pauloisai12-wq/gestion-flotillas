// Cliente Axios — usa NEXT_PUBLIC_API_URL desde env

import axios from 'axios';

// Base URL desde env. Si NEXT_PUBLIC_API_URL está ausente o vacío se usa
// ruta relativa /api (caso ngrok con proxy interno: el rewrite de
// next.config.ts envía /api al backend).
const apiOrigin = process.env.NEXT_PUBLIC_API_URL;
const baseURL = apiOrigin ? `${apiOrigin}/api` : '/api';

const api = axios.create({
  baseURL,
  headers: { 'Content-Type': 'application/json' },
  timeout: 30_000,
  // El navegador envía la cookie httpOnly de sesión automáticamente.
  // withCredentials la incluye también en requests cross-origin.
  withCredentials: true,
});

// Redirigir al login si la API responde 401 (sesión expirada en una página
// protegida). La cookie es httpOnly y solo el backend puede limpiarla.
//
// IMPORTANTE: NO redirigir si ya estamos en una ruta PÚBLICA (/login, /cargas).
// El AuthProvider sondea /auth/me al cargar y, sin sesión, ese probe responde
// 401 de forma esperada; redirigir aquí provoca un BUCLE de recargas
// (window.location.href recarga -> vuelve a sondear -> 401 -> recarga -> ...).
function isPublicPath(pathname: string): boolean {
  return (
    pathname === '/login' ||
    pathname.startsWith('/login/') ||
    pathname === '/cargas' ||
    pathname.startsWith('/cargas/')
  );
}

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (
      error.response?.status === 401 &&
      typeof window !== 'undefined' &&
      !isPublicPath(window.location.pathname)
    ) {
      window.location.href = '/login';
    }
    return Promise.reject(error);
  },
);

export default api;

// Forma estándar del payload de error que devuelve la API.
export interface ApiErrorData {
  message?: string;
  error?: string;
  retryAfter?: number;
}

// Extrae status/payload/código de un error desconocido usando el type guard
// real de axios, en vez de castings manuales repetidos en cada componente.
export function getApiError(err: unknown): {
  status?: number;
  data?: ApiErrorData;
  code?: string;
} {
  if (axios.isAxiosError(err)) {
    return {
      status: err.response?.status,
      data: err.response?.data as ApiErrorData | undefined,
      code: err.code,
    };
  }
  return {};
}
