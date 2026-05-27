// Crear nuevo ticket — solo accesible para EXECUTOR.
// Puede llegar con ?vehicleId=X desde la grilla de flotilla (queda preseleccionado).

'use client';

import { Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { TicketCreateForm } from '@/components/maintenance-tickets/TicketCreateForm';

function CreateFormWithParams() {
  const params = useSearchParams();
  const raw = params.get('vehicleId');
  const vehicleId = raw && /^\d+$/.test(raw) ? Number(raw) : undefined;
  return <TicketCreateForm initialVehicleId={vehicleId} />;
}

export default function NewTicketPage() {
  const { user } = useAuth();

  if (user && user.role !== 'EXECUTOR') {
    return (
      <div className="p-6">
        <h1 className="text-xl font-bold">No disponible</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Solo los usuarios con rol Ejecutor pueden crear tickets de reparación.
        </p>
        <Link href="/tickets" className="text-sm text-primary hover:underline inline-block mt-3">
          Volver a tickets
        </Link>
      </div>
    );
  }

  return (
    <div className="p-6">
      <Link
        href="/tickets"
        className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground mb-3"
      >
        <ArrowLeft className="size-3.5" /> Volver a tickets
      </Link>
      <h1 className="text-2xl font-bold mb-1">Nueva solicitud de reparación</h1>
      <p className="text-sm text-muted-foreground mb-6">
        El administrador revisará tu solicitud y, si procede, pedirá cotización a 3 talleres.
      </p>
      <Suspense fallback={null}>
        <CreateFormWithParams />
      </Suspense>
    </div>
  );
}
