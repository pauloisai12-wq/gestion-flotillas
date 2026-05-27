// Vista del TALLER — su menú propio.
// Solo ve las unidades que se le asignaron, agrupadas por la acción que le toca:
// valorizar → subir cotización → (si gana) iniciar reparación → finalizar servicio.
// Cada tarjeta abre el detalle, donde viven los formularios (cotizar / iniciar / finalizar).

'use client';

import Link from 'next/link';
import {
  useMyQuotes,
  CATEGORY_LABELS,
  type TicketQuote,
} from '@/hooks/useMaintenanceTickets';
import { Loader2, ChevronRight, FileUp, Hourglass, Wrench, PackageCheck, Ban } from 'lucide-react';

type Bucket =
  | 'TO_QUOTE'
  | 'AWAITING_DECISION'
  | 'TO_START'
  | 'IN_REPAIR'
  | 'COMPLETED'
  | 'NOT_SELECTED';

function classify(q: TicketQuote): Bucket {
  const st = q.ticket?.status;
  if (q.declinedAt) return 'NOT_SELECTED';
  if (st === 'AWAITING_QUOTES') return q.submittedAt ? 'AWAITING_DECISION' : 'TO_QUOTE';
  if (q.isWinner) {
    if (st === 'APPROVED_FOR_REPAIR') return 'TO_START';
    if (st === 'IN_REPAIR') return 'IN_REPAIR';
    if (st === 'COMPLETED') return 'COMPLETED';
  }
  return 'NOT_SELECTED';
}

interface SectionMeta {
  key: Bucket;
  title: string;
  hint: string;
  icon: React.ComponentType<{ className?: string }>;
  accent: boolean;
  /** Etiqueta del botón de acción que se muestra en cada tarjeta (solo secciones accionables). */
  cta?: string;
}

const SECTIONS: SectionMeta[] = [
  { key: 'TO_QUOTE', title: 'Por valorizar', hint: 'Sube tu cotización (PDF + monto + diagnóstico) o declina la invitación.', icon: FileUp, accent: true, cta: 'Subir cotización' },
  { key: 'TO_START', title: 'Por iniciar reparación', hint: 'Ganaste la cotización. Inicia los trabajos cuando empieces.', icon: Wrench, accent: true, cta: 'Iniciar reparación' },
  { key: 'IN_REPAIR', title: 'En reparación', hint: 'Marca el servicio como finalizado al terminar.', icon: PackageCheck, accent: true, cta: 'Finalizar servicio' },
  { key: 'AWAITING_DECISION', title: 'En espera de decisión', hint: 'Cotización enviada. El administrador está evaluando.', icon: Hourglass, accent: false },
  { key: 'COMPLETED', title: 'Finalizadas', hint: 'Servicios cerrados.', icon: PackageCheck, accent: false },
  { key: 'NOT_SELECTED', title: 'No seleccionadas / declinadas', hint: 'Sin acción pendiente.', icon: Ban, accent: false },
];

function money(amount: TicketQuote['amount']): string | null {
  if (amount == null) return null;
  return Number(amount).toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });
}

export function WorkshopTicketsView() {
  const { data: quotes, isLoading, error } = useMyQuotes();

  const grouped = (quotes ?? []).reduce<Record<Bucket, TicketQuote[]>>(
    (acc, q) => {
      (acc[classify(q)] ??= []).push(q);
      return acc;
    },
    {} as Record<Bucket, TicketQuote[]>,
  );

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Unidades asignadas a mi taller</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Valoriza, cotiza y da seguimiento a las reparaciones que se te asignaron.
        </p>
      </div>

      {isLoading && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground p-8 justify-center">
          <Loader2 className="size-4 animate-spin" /> Cargando unidades…
        </div>
      )}

      {error && (
        <div className="text-sm text-rose-600 dark:text-rose-400 p-4 bg-rose-50 dark:bg-rose-950/30 rounded-md">
          Error al cargar tus unidades. Recarga la página o vuelve a iniciar sesión.
        </div>
      )}

      {quotes && quotes.length === 0 && (
        <div className="border border-dashed border-border rounded-md p-8 text-center">
          <p className="text-sm text-muted-foreground">
            Todavía no tienes unidades asignadas para cotizar.
          </p>
        </div>
      )}

      {quotes &&
        SECTIONS.map((section) => {
          const items = grouped[section.key] ?? [];
          if (items.length === 0) return null;
          const Icon = section.icon;
          return (
            <section key={section.key} className="space-y-2">
              <div className="flex items-center gap-2">
                <Icon className={`size-4 ${section.accent ? 'text-primary' : 'text-muted-foreground'}`} />
                <h2 className="text-sm font-semibold">
                  {section.title}
                  <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                    ({items.length})
                  </span>
                </h2>
              </div>
              <p className="text-xs text-muted-foreground -mt-1">{section.hint}</p>

              <div className="space-y-2">
                {items.map((q) => {
                  const t = q.ticket;
                  const amount = money(q.amount);
                  return (
                    <Link
                      key={q.id}
                      href={`/tickets/${q.ticketId}`}
                      className={`block rounded-md border bg-card p-4 group transition-colors ${
                        section.accent
                          ? 'border-primary/40 hover:border-primary'
                          : 'border-border hover:border-primary/60'
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-xs text-muted-foreground font-mono">
                              #{q.ticketId}
                            </span>
                            <span className="font-semibold">
                              {t?.vehicle?.economicNumber ?? `Veh ${q.ticketId}`}
                            </span>
                            {t?.vehicle?.plate && (
                              <span className="text-xs text-muted-foreground">
                                · {t.vehicle.plate}
                              </span>
                            )}
                            {t && (
                              <span className="text-xs text-muted-foreground">
                                · {CATEGORY_LABELS[t.failureCategory]}
                              </span>
                            )}
                          </div>
                          {t?.description && (
                            <p className="text-sm text-muted-foreground line-clamp-1 mt-1">
                              {t.description}
                            </p>
                          )}
                          <div className="flex items-center gap-3 text-[11px] text-muted-foreground mt-1.5">
                            {t?.vehicle?.brand && (
                              <span>
                                {t.vehicle.brand} {t.vehicle.model}
                              </span>
                            )}
                            {amount && <span className="tabular-nums">💰 {amount}</span>}
                            {q.isWinner && (
                              <span className="text-emerald-700 dark:text-emerald-400 font-medium">
                                ★ Ganadora
                              </span>
                            )}
                          </div>
                        </div>
                        {section.cta ? (
                          <span className="shrink-0 inline-flex items-center gap-1.5 rounded-md bg-primary text-primary-foreground text-sm font-medium px-3 py-2 group-hover:opacity-90 transition-opacity">
                            {section.cta}
                            <ChevronRight className="size-4" />
                          </span>
                        ) : (
                          <ChevronRight className="size-4 text-muted-foreground group-hover:text-foreground transition-colors" />
                        )}
                      </div>
                    </Link>
                  );
                })}
              </div>
            </section>
          );
        })}
    </div>
  );
}
