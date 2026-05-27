// Cliente Axios — usa NEXT_PUBLIC_API_URL desde env

import axios from 'axios';
import Cookies from 'js-cookie';

// Base URL desde env. Si NEXT_PUBLIC_API_URL está ausente o vacío se usa
// ruta relativa /api (caso ngrok con proxy interno: el rewrite de
// next.config.ts envía /api al backend).
const apiOrigin = process.env.NEXT_PUBLIC_API_URL;
const baseURL = apiOrigin ? `${apiOrigin}/api` : '/api';

const api = axios.create({
  baseURL,
  headers: { 'Content-Type': 'application/json' },
  timeout: 30_000,
});

// Adjuntar JWT en cada request
api.interceptors.request.use((config) => {
  const token = Cookies.get('token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// Redirigir al login si la API responde 401
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      Cookies.remove('token');
      if (typeof window !== 'undefined') window.location.href = '/login';
    }
    return Promise.reject(error);
  },
);

export default api;
