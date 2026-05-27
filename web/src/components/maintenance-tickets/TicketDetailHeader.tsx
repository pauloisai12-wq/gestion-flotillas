// Cabecera reusable del detalle de ticket — datos básicos del vehículo, ejecutor, estado.

import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { TicketStatusBadge } from './TicketStatusBadge';
import type { MaintenanceTicket } from '@/hooks/useMaintenanceTickets';
import { CATEGORY_LABELS } from '@/hooks/useMaintenanceTickets';

export function TicketDetailHeader({ ticket }: { ticket: MaintenanceTicket }) {
  return (
    <div className="border-b border-border pb-4 mb-6">
      <Link
        href="/tickets"
        className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground mb-3"
      >
        <ArrowLeft className="size-3.5" /> Volver a tickets
      </Link>
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <div className="text-xs uppercase tracking-wider text-muted-foreground mb-1">
            Ticket #{ticket.id} · {CATEGORY_LABELS[ticket.failureCategory]}
          </div>
          <h1 className="text-2xl font-bold truncate">
            {ticket.vehicle?.economicNumber ?? `Vehículo ${ticket.vehicleId}`}
            {ticket.vehicle?.plate && (
              <span className="text-muted-foreground font-normal"> · {ticket.vehicle.plate}</span>
            )}
          </h1>
          {(ticket.vehicle?.brand || ticket.vehicle?.model) && (
            <p className="text-sm text-muted-foreground">
              {[ticket.vehicle?.brand, ticket.vehicle?.model, ticket.vehicle?.year].filter(Boolean).join(' ')}
            </p>
          )}
          {ticket.requestedBy && (
            <p className="text-xs text-muted-foreground mt-1">
              Levantado por <span className="font-medium">{ticket.requestedBy.fullName}</span> ·{' '}
              {new Date(ticket.createdAt).toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' })}
            </p>
          )}
        </div>
        <TicketStatusBadge status={ticket.status} className="text-sm px-3 py-1" />
      </div>
    </div>
  );
}
