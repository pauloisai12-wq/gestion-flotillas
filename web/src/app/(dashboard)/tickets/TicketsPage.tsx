// /tickets — punto de entrada único. El contenido cambia según el rol:
//  · ADMIN / Sup. mantenimiento → lista completa de toda la flota.
//  · EJECUTOR → su flotilla + sus solicitudes (4 estados).
//  · TALLER → solo las unidades que se le asignaron, por acción.

'use client';

import { useAuth } from '@/contexts/AuthContext';
import { AdminTicketsView } from '@/components/maintenance-tickets/AdminTicketsView';
import { ExecutorTicketsView } from '@/components/maintenance-tickets/ExecutorTicketsView';
import { WorkshopTicketsView } from '@/components/maintenance-tickets/WorkshopTicketsView';
import { Loader2 } from 'lucide-react';

export default function TicketsPage() {
  const { user, loading } = useAuth();

  if (loading || !user) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground p-8 justify-center">
        <Loader2 className="size-4 animate-spin" /> Cargando…
      </div>
    );
  }

  switch (user.role) {
    case 'EXECUTOR':
      return <ExecutorTicketsView />;
    case 'WORKSHOP':
      return <WorkshopTicketsView />;
    default:
      // ADMIN y SUPERVISOR_MAINTENANCE
      return <AdminTicketsView />;
  }
}
