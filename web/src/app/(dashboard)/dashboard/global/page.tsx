// Wrapper RSC: agrega metadata y delega el contenido interactivo al
// componente cliente vecino. Esto permite que Next.js declare la metadata
// SEO en el servidor sin marcar la página entera como 'use client'.
//
// Toda la lógica de estado/efectos vive en ./DashboardGlobal.tsx.

import type { Metadata } from 'next';
import DashboardGlobal from './DashboardGlobal';

export const metadata: Metadata = {
  title: 'Dashboard global',
};

export default function Page() {
  return <DashboardGlobal />;
}
