// Vista de ADMIN / Supervisor de mantenimiento — ve toda la flota.
// Lista completa con los 7 estados internos y conteo de cotizaciones.

'use client';

import { useState } from 'react';
import {
  useTickets,
  STATUS_LABELS,
  type MaintenanceTicketStatus,
} from '@/hooks/useMaintenanceTickets';
import { TicketList } from '@/components/maintenance-tickets/TicketList';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';

const STATUS_FILTERS: { value: 'ALL' | MaintenanceTicketStatus; label: string }[] = [
  { value: 'ALL', label: 'Todos' },
  { value: 'PENDING_ADMIN_APPROVAL', label: STATUS_LABELS.PENDING_ADMIN_APPROVAL },
  { value: 'AWAITING_QUOTES', label: STATUS_LABELS.AWAITING_QUOTES },
  { value: 'APPROVED_FOR_REPAIR', label: STATUS_LABELS.APPROVED_FOR_REPAIR },
  { value: 'IN_REPAIR', label: STATUS_LABELS.IN_REPAIR },
  { value: 'COMPLETED', label: STATUS_LABELS.COMPLETED },
  { value: 'REJECTED_BY_ADMIN', label: STATUS_LABELS.REJECTED_BY_ADMIN },
];

export function AdminTicketsView() {
  const [statusFilter, setStatusFilter] = useState<'ALL' | MaintenanceTicketStatus>('ALL');

  const { data, isLoading, error, refetch } = useTickets(
    statusFilter === 'ALL' ? {} : { status: statusFilter },
  );

  return (
    <div className="space-y-6 p-0 sm:p-6">
      <div>
        <h1 className="text-2xl font-bold">Tickets de reparación</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Solicitudes de mantenimiento correctivo de toda la flota.
        </p>
      </div>

      <div className="flex flex-wrap gap-1.5 border-b border-border pb-3">
        {STATUS_FILTERS.map((f) => (
          <button
            key={f.value}
            type="button"
            onClick={() => setStatusFilter(f.value)}
            aria-pressed={statusFilter === f.value}
            className={`min-h-11 rounded-full border px-3 py-2 text-xs transition-colors sm:min-h-0 sm:py-1.5 ${
              statusFilter === f.value
                ? 'bg-primary text-primary-foreground border-primary'
                : 'border-border hover:border-primary/60 text-muted-foreground'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {isLoading && (
        <div role="status" className="flex items-center gap-2 text-sm text-muted-foreground p-8 justify-center">
          <Loader2 className="size-4 animate-spin" /> Cargando tickets…
        </div>
      )}

      {error && (
        <div role="alert" className="flex flex-col items-center gap-3 rounded-md border border-destructive/30 bg-destructive/5 p-6 text-center text-sm">
          <AlertTriangle className="size-7 text-destructive" aria-hidden="true" />
          <p>Error al cargar tickets. Revisa tu conexión e intenta de nuevo.</p>
          <Button type="button" variant="outline" onClick={() => void refetch()}>Reintentar</Button>
        </div>
      )}

      {data && (
        <>
          <div className="text-xs text-muted-foreground tabular-nums">
            {data.total} ticket{data.total !== 1 ? 's' : ''} encontrado
            {data.total !== 1 ? 's' : ''}
          </div>
          <TicketList tickets={data.tickets} />
        </>
      )}
    </div>
  );
}
