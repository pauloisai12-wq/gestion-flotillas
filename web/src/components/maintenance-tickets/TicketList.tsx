// Lista compartida — el backend filtra por rol vía RBAC.
// Aquí solo presentamos lo que el API decida devolver para el usuario actual.

'use client';

import Link from 'next/link';
import { TicketStatusBadge } from './TicketStatusBadge';
import { CATEGORY_LABELS } from '@/hooks/useMaintenanceTickets';
import type { MaintenanceTicket } from '@/hooks/useMaintenanceTickets';
import { formatDate } from '@/lib/formatters';
import { ChevronRight } from 'lucide-react';

export function TicketList({ tickets }: { tickets: MaintenanceTicket[] }) {
  if (tickets.length === 0) {
    return (
      <div className="border border-dashed border-border rounded-md p-8 text-center">
        <p className="text-sm text-muted-foreground">No hay tickets que mostrar.</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {tickets.map((t) => {
        const quotes = t.quotes ?? [];
        const submitted = quotes.filter((q) => q.submittedAt && !q.declinedAt).length;
        const declined = quotes.filter((q) => q.declinedAt).length;

        return (
          <Link
            key={t.id}
            href={`/tickets/${t.id}`}
            className="block rounded-md border border-border bg-card hover:border-primary transition-colors p-4 group"
          >
            <div className="flex items-center gap-3 flex-wrap">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs text-muted-foreground font-mono">#{t.id}</span>
                  <span className="font-semibold">{t.vehicle?.economicNumber ?? `Veh ${t.vehicleId}`}</span>
                  {t.vehicle?.plate && (
                    <span className="text-xs text-muted-foreground">· {t.vehicle.plate}</span>
                  )}
                  <span className="text-xs text-muted-foreground">·</span>
                  <span className="text-xs">{CATEGORY_LABELS[t.failureCategory]}</span>
                </div>
                <p className="text-sm text-muted-foreground line-clamp-1 mt-1">{t.description}</p>
                <div className="flex items-center gap-3 text-[11px] text-muted-foreground mt-1.5">
                  {t.requestedBy && <span>👤 {t.requestedBy.fullName}</span>}
                  <span>📅 {formatDate(t.createdAt, { day: '2-digit', month: 'short' })}</span>
                  {quotes.length > 0 && (
                    <span>
                      💰 {submitted}/{quotes.length} cotizaciones
                      {declined > 0 && <span> ({declined} declinadas)</span>}
                    </span>
                  )}
                </div>
              </div>
              <TicketStatusBadge status={t.status} />
              <ChevronRight className="size-4 text-muted-foreground group-hover:text-foreground transition-colors" />
            </div>
          </Link>
        );
      })}
    </div>
  );
}
