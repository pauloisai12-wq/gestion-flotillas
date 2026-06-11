// Vista del EJECUTOR — su menú propio.
// 1) Arriba: el estado de sus solicitudes (4 estados: Pendiente / Aceptado / No aceptado / Finalizado).
// 2) Abajo: su flotilla como LISTA; cada fila con datos básicos y el botón de solicitar mantenimiento.

'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/contexts/AuthContext';
import { useVehicles } from '@/hooks/useVehicles';
import {
  useTickets,
  toExecutorStatus,
  EXECUTOR_STATUS_LABELS,
  EXECUTOR_STATUS_COLORS,
  CATEGORY_LABELS,
  type ExecutorStatus,
} from '@/hooks/useMaintenanceTickets';
import { Truck, Plus, Loader2, ChevronRight, Gauge } from 'lucide-react';
import { formatDate, formatNumber } from '@/lib/formatters';

const FILTERS: { value: 'ALL' | ExecutorStatus; label: string }[] = [
  { value: 'ALL', label: 'Todas' },
  { value: 'PENDING', label: EXECUTOR_STATUS_LABELS.PENDING },
  { value: 'ACCEPTED', label: EXECUTOR_STATUS_LABELS.ACCEPTED },
  { value: 'REJECTED', label: EXECUTOR_STATUS_LABELS.REJECTED },
  { value: 'COMPLETED', label: EXECUTOR_STATUS_LABELS.COMPLETED },
];

export function ExecutorTicketsView() {
  const { user } = useAuth();
  const [filter, setFilter] = useState<'ALL' | ExecutorStatus>('ALL');

  const { data: fleet, isLoading: fleetLoading } = useVehicles({
    executorId: user?.id,
    limit: 100,
  });
  const { data: ticketsResp, isLoading: ticketsLoading } = useTickets({});

  const tickets = ticketsResp?.tickets ?? [];
  const filtered =
    filter === 'ALL'
      ? tickets
      : tickets.filter((t) => toExecutorStatus(t.status) === filter);

  return (
    <div className="p-6 space-y-8">
      <div>
        <h1 className="text-2xl font-bold">Mantenimiento de mi flotilla</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Consulta el estado de tus solicitudes y reporta una falla seleccionando una unidad.
        </p>
      </div>

      {/* ── Estado de mis solicitudes (arriba) ────────────────── */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Estado de mis solicitudes
        </h2>

        <div className="flex flex-wrap gap-1.5">
          {FILTERS.map((f) => (
            <button
              key={f.value}
              type="button"
              onClick={() => setFilter(f.value)}
              className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
                filter === f.value
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'border-border hover:border-primary/60 text-muted-foreground'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>

        {ticketsLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground p-6 justify-center">
            <Loader2 className="size-4 animate-spin" /> Cargando solicitudes…
          </div>
        ) : filtered.length === 0 ? (
          <div className="border border-dashed border-border rounded-md p-8 text-center">
            <p className="text-sm text-muted-foreground">
              {tickets.length === 0
                ? 'Aún no has solicitado ningún mantenimiento.'
                : 'No hay solicitudes en este estado.'}
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {filtered.map((t) => {
              const es = toExecutorStatus(t.status);
              return (
                <Link
                  key={t.id}
                  href={`/tickets/${t.id}`}
                  className="block rounded-md border border-border bg-card hover:border-primary transition-colors p-4 group"
                >
                  <div className="flex items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs text-muted-foreground font-mono">#{t.id}</span>
                        <span className="font-semibold">
                          {t.vehicle?.economicNumber ?? `Veh ${t.vehicleId}`}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          · {CATEGORY_LABELS[t.failureCategory]}
                        </span>
                      </div>
                      <p className="text-sm text-muted-foreground line-clamp-1 mt-1">
                        {t.description}
                      </p>
                      <div className="text-[11px] text-muted-foreground mt-1.5">
                        📅{' '}
                        {formatDate(t.createdAt, {
                          day: '2-digit',
                          month: 'short',
                          year: 'numeric',
                        })}
                      </div>
                    </div>
                    <span
                      className={`text-xs font-medium px-2.5 py-1 rounded-full whitespace-nowrap ${EXECUTOR_STATUS_COLORS[es]}`}
                    >
                      {EXECUTOR_STATUS_LABELS[es]}
                    </span>
                    <ChevronRight className="size-4 text-muted-foreground group-hover:text-foreground transition-colors" />
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </section>

      {/* ── Mi flotilla (lista) ───────────────────────────────── */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-2">
          <Truck className="size-4" /> Mi flotilla
        </h2>

        {fleetLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground p-6 justify-center">
            <Loader2 className="size-4 animate-spin" /> Cargando unidades…
          </div>
        ) : (fleet?.data.length ?? 0) === 0 ? (
          <div className="border border-dashed border-border rounded-md p-8 text-center">
            <p className="text-sm text-muted-foreground">
              No tienes vehículos asignados. Contacta al administrador.
            </p>
          </div>
        ) : (
          <div className="rounded-lg border border-border bg-card divide-y divide-border">
            {(fleet?.data ?? []).map((v) => (
              <div key={v.id} className="flex items-center gap-3 px-4 py-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold">{v.economicNumber}</span>
                    <span className="text-xs text-muted-foreground">· {v.plate}</span>
                    <span
                      className={`text-[10px] px-2 py-0.5 rounded-full ${
                        v.status === 'OPERATIVE'
                          ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200'
                          : 'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-200'
                      }`}
                    >
                      {v.status === 'OPERATIVE' ? 'Operativo' : 'Bloqueado'}
                    </span>
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5 flex items-center gap-2 flex-wrap">
                    <span>
                      {v.brand} {v.model} {v.year}
                    </span>
                    <span className="flex items-center gap-1">
                      <Gauge className="size-3" />
                      {formatNumber(v.currentOdometer)} km
                    </span>
                  </div>
                </div>

                <Link
                  href={`/tickets/nuevo?vehicleId=${v.id}`}
                  className="shrink-0 inline-flex items-center justify-center gap-1.5 rounded-md bg-primary text-primary-foreground text-sm font-medium px-3 py-2 hover:opacity-90 transition-opacity"
                >
                  <Plus className="size-4" /> Solicitar mantenimiento
                </Link>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
