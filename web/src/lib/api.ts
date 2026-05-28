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

// Redirigir al login si la API responde 401. La cookie es httpOnly y solo
// el backend puede limpiarla — aquí basta con sacar al usuario de la sesión.
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401 && typeof window !== 'undefined') {
      window.location.href = '/login';
    }
    return Promise.reject(error);
  },
);

export default api;
