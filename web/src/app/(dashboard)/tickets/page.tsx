// Wrapper RSC: agrega metadata y delega el contenido interactivo al
// componente cliente vecino. Esto permite que Next.js declare la metadata
// SEO en el servidor sin marcar la página entera como 'use client'.
//
// Toda la lógica de estado/efectos vive en ./TicketsPage.tsx.

import type { Metadata } from 'next';
import TicketsPage from './TicketsPage';

export const metadata: Metadata = {
  title: 'Tickets de mantenimiento',
};

export default function Page() {
  return <TicketsPage />;
}
