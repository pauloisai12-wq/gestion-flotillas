// Wrapper RSC: agrega metadata y delega el contenido interactivo al
// componente cliente vecino. Esto permite que Next.js declare la metadata
// SEO en el servidor sin marcar la página entera como 'use client'.
//
// Toda la lógica de estado/efectos vive en ./DashboardGasolina.tsx.

import type { Metadata } from 'next';
import DashboardGasolina from './DashboardGasolina';

export const metadata: Metadata = {
  title: 'Dashboard de combustible',
};

export default function Page() {
  return <DashboardGasolina />;
}
