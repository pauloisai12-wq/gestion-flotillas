// Wrapper RSC: agrega metadata y delega el contenido interactivo al
// componente cliente vecino. Esto permite que Next.js declare la metadata
// SEO en el servidor sin marcar la página entera como 'use client'.
//
// Toda la lógica de estado/efectos vive en ./DashboardVehicles.tsx.

import type { Metadata } from 'next';
import DashboardVehicles from './DashboardVehicles';

export const metadata: Metadata = {
  title: 'Dashboard de vehículos',
};

export default function Page() {
  return <DashboardVehicles />;
}
