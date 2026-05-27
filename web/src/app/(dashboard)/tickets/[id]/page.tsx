// /web/src/app/(dashboard)/tickets/[id]/page.tsx
// Detalle de ticket — UI cambia según rol del usuario.
//
// ADMIN / SUPERVISOR_MAINTENANCE:
//   - PENDING: botones [Rechazar] [Asignar 3 talleres]
//   - AWAITING: BudgetVsQuotesCard FULL-WIDTH + ApprovePanel + [Rechazar]
//   - APPROVED+: read-only con resumen
//
// EJECUTOR / TALLER: por implementar en siguiente iteración (placeholder por ahora).

'use client';

import { use, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import {
  useTicket,
  useBudgetContext,
  CATEGORY_LABELS,
} from '@/hooks/useMaintenanceTickets';
import { TicketDetailHeader } from '@/components/maintenance-tickets/TicketDetailHeader';
import { TicketTimeline } from '@/components/maintenance-tickets/TicketTimeline';
import { PhotosGallery } from '@/components/maintenance-tickets/PhotosGallery';
import { PhotoUploader } from '@/components/maintenance-tickets/PhotoUploader';
import { QuoteCard } from '@/components/maintenance-tickets/QuoteCard';
import { BudgetVsQuotesCard } from '@/components/maintenance-tickets/BudgetVsQuotesCard';
import { WorkshopPickerDialog } from '@/components/maintenance-tickets/WorkshopPickerDialog';
import { RejectDialog } from '@/components/maintenance-tickets/RejectDialog';
import { ApprovePanel } from '@/components/maintenance-tickets/ApprovePanel';
import { QuoteSubmitForm } from '@/components/maintenance-tickets/QuoteSubmitForm';
import { QuoteDeclineDialog } from '@/components/maintenance-tickets/QuoteDeclineDialog';
import { StartRepairButton, CompleteRepairForm } from '@/components/maintenance-tickets/RepairActions';
import { useVehicle } from '@/hooks/useVehicles';
import { Button } from '@/components/ui/button';
import {
  Loader2,
  XCircle,
  UsersRound,
  AlertTriangle,
  Eye,
  Camera,
  CheckCircle2,
  PackageCheck,
  Clock,
  MinusCircle,
} from 'lucide-react';

// Host del API para servir imágenes/PDFs absolutos.
// En dev y prod next.config rewrites a "/api" proxy al backend; los uploads
// vienen como "/uploads/..." y deben pasar por el mismo host.
const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? '';

export default function TicketDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: idStr } = use(params);
  const id = parseInt(idStr, 10);
  const { user } = useAuth();
  const { data: ticket, isLoading } = useTicket(id);

  // Selección de quote ganadora — lifted state porque ApprovePanel y BudgetVsQuotesCard la comparten.
  const [selectedQuote, setSelectedQuote] = useState<number | null>(null);

  const isAdmin = user?.role === 'ADMIN' || user?.role === 'SUPERVISOR_MAINTENANCE';
  const isAwaitingDecision = ticket?.status === 'AWAITING_QUOTES';

  // Budget context solo cuando el admin está decidiendo
  const { data: budgetCtx } = useBudgetContext(
    isAdmin && isAwaitingDecision ? id : null,
  );

  if (isLoading || !ticket) {
    return (
      <div className="p-6 flex items-center justify-center gap-2 text-muted-foreground text-sm">
        <Loader2 className="size-4 animate-spin" /> Cargando ticket…
      </div>
    );
  }

  // Inicializa selección con la quote ganadora si existe
  const effectiveSelected = selectedQuote ?? ticket.selectedQuoteId;

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <TicketDetailHeader ticket={ticket} />

      <TicketTimeline ticket={ticket} />

      {/* ★ VISUALIZACIÓN PRINCIPAL DEL ADMIN — full width, prominente */}
      {isAdmin && isAwaitingDecision && budgetCtx && (
        <section>
          <BudgetVsQuotesCard
            context={budgetCtx}
            selectedQuoteId={effectiveSelected}
            onSelect={setSelectedQuote}
            apiBase={API_BASE}
          />
        </section>
      )}

      {/* Grid: descripción (izq) + acciones (der) */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_380px] gap-6">
        {/* ─── COLUMNA IZQUIERDA ─── */}
        <div className="space-y-4 min-w-0">
          <section>
            <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-2">
              Descripción del problema
            </h2>
            <div className="bg-card border border-border rounded-md p-4">
              <p className="text-sm whitespace-pre-wrap">{ticket.description}</p>
              <dl className="grid grid-cols-2 gap-2 mt-3 pt-3 border-t border-border text-xs">
                <div>
                  <dt className="text-muted-foreground">Categoría</dt>
                  <dd className="font-medium">{CATEGORY_LABELS[ticket.failureCategory]}</dd>
                </div>
                {ticket.reportedOdometer != null && (
                  <div>
                    <dt className="text-muted-foreground">Odómetro reportado</dt>
                    <dd className="font-medium tabular-nums">
                      {ticket.reportedOdometer.toLocaleString('es-MX')} km
                    </dd>
                  </div>
                )}
                {ticket.odometerStatus === 'NF' && (
                  <div>
                    <dt className="text-muted-foreground">Odómetro</dt>
                    <dd className="font-medium">No funciona</dd>
                  </div>
                )}
              </dl>
            </div>
          </section>

          <section>
            <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-2">
              Fotos adjuntas
            </h2>
            <PhotosGallery attachments={ticket.attachments ?? []} apiBase={API_BASE} />
          </section>

          {/* Cotizaciones con PDFs descargables — siempre cuando hay quotes (admin las ve también en card de arriba, pero PDF link está aquí) */}
          {ticket.quotes && ticket.quotes.length > 0 && (
            <section>
              <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                Cotizaciones detalle (PDFs)
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {ticket.quotes.map((q) => (
                  <QuoteCard key={q.id} quote={q} apiBase={API_BASE} />
                ))}
              </div>
            </section>
          )}

          {(ticket.status === 'REJECTED_BY_ADMIN' || ticket.status === 'REJECTED_FINAL') &&
            ticket.rejectionReason && (
              <section>
                <div className="bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-900 rounded-md p-4">
                  <div className="flex items-start gap-2">
                    <XCircle className="size-4 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />
                    <div>
                      <div className="text-xs font-medium text-rose-900 dark:text-rose-200 uppercase tracking-wider">
                        Motivo del rechazo
                      </div>
                      <p className="text-sm mt-1 text-rose-900 dark:text-rose-100">
                        {ticket.rejectionReason}
                      </p>
                      {ticket.rejectedAt && (
                        <p className="text-xs text-rose-700 dark:text-rose-300 mt-1">
                          {new Date(ticket.rejectedAt).toLocaleString('es-MX', {
                            dateStyle: 'medium',
                            timeStyle: 'short',
                          })}
                          {ticket.rejectedBy && ` · ${ticket.rejectedBy.fullName}`}
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              </section>
            )}

          {ticket.finalConcept && (
            <section>
              <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                Concepto aprobado
              </h2>
              <div className="bg-card border border-border rounded-md p-4">
                <p className="text-sm whitespace-pre-wrap">{ticket.finalConcept}</p>
                {ticket.approvedAt && (
                  <p className="text-xs text-muted-foreground mt-2">
                    Aprobado{' '}
                    {new Date(ticket.approvedAt).toLocaleString('es-MX', {
                      dateStyle: 'medium',
                      timeStyle: 'short',
                    })}
                    {ticket.approvedByAdmin && ` por ${ticket.approvedByAdmin.fullName}`}
                  </p>
                )}
              </div>
            </section>
          )}
        </div>

        {/* ─── COLUMNA DERECHA: acciones específicas por rol ─── */}
        <div className="space-y-4">
          {isAdmin && (
            <AdminActions ticket={ticket} ticketId={id} selectedQuote={effectiveSelected} />
          )}

          {!isAdmin && user?.role === 'EXECUTOR' && (
            <ExecutorActions ticket={ticket} ticketId={id} userId={user.id} />
          )}

          {!isAdmin && user?.role === 'WORKSHOP' && user.workshopId && (
            <WorkshopActions ticket={ticket} ticketId={id} workshopId={user.workshopId} />
          )}
        </div>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════
// Acciones del admin — conmutadas por status
// ════════════════════════════════════════════════════════════════
function AdminActions({
  ticket,
  ticketId,
  selectedQuote,
}: {
  ticket: NonNullable<ReturnType<typeof useTicket>['data']>;
  ticketId: number;
  selectedQuote: number | null;
}) {
  if (ticket.status === 'PENDING_ADMIN_APPROVAL') {
    return (
      <div className="border border-border rounded-lg p-4 bg-card space-y-3">
        <div>
          <h3 className="font-semibold text-sm">Filtro inicial</h3>
          <p className="text-xs text-muted-foreground mt-1">
            Revisa la descripción y fotos. Si procede, asigna 3 talleres para que coticen.
          </p>
        </div>
        <div className="flex flex-col gap-2">
          <WorkshopPickerDialog ticketId={ticketId}>
            <Button className="w-full">
              <UsersRound className="size-4 mr-1.5" />
              Asignar 3 talleres
            </Button>
          </WorkshopPickerDialog>
          <RejectDialog ticketId={ticketId}>
            <Button variant="outline" className="w-full">
              <XCircle className="size-4 mr-1.5" />
              Rechazar
            </Button>
          </RejectDialog>
        </div>
      </div>
    );
  }

  if (ticket.status === 'AWAITING_QUOTES') {
    const anySubmitted = (ticket.quotes ?? []).some((q) => q.submittedAt && !q.declinedAt);
    return (
      <div className="space-y-3">
        {!anySubmitted && (
          <div className="text-xs text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 rounded-md p-2.5 flex items-start gap-2">
            <AlertTriangle className="size-3.5 mt-0.5 shrink-0" />
            <span>Aún no llega ninguna cotización. Puedes esperar o rechazar.</span>
          </div>
        )}
        <ApprovePanel ticketId={ticketId} selectedQuoteId={selectedQuote} />
        <RejectDialog ticketId={ticketId}>
          <Button variant="outline" className="w-full">
            <XCircle className="size-4 mr-1.5" /> Rechazar tras cotizar
          </Button>
        </RejectDialog>
      </div>
    );
  }

  // Estados post-aprobación
  return (
    <div className="border border-border rounded-lg p-4 bg-card text-sm space-y-2">
      <div className="flex items-center gap-2 font-semibold">
        <Eye className="size-4" /> Solo lectura
      </div>
      <p className="text-xs text-muted-foreground">
        El ticket ya no requiere acción del admin. Las próximas transiciones las hace el taller ganador.
      </p>
      {ticket.selectedQuote && (
        <div className="mt-2 pt-2 border-t border-border text-xs">
          <span className="text-muted-foreground">Ganador:</span>{' '}
          <span className="font-medium">{ticket.selectedQuote.workshop?.legalName}</span>
        </div>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════
// Acciones del ejecutor — agregar fotos + leer estado de progreso
// ════════════════════════════════════════════════════════════════
function ExecutorActions({
  ticket,
  ticketId,
  userId,
}: {
  ticket: NonNullable<ReturnType<typeof useTicket>['data']>;
  ticketId: number;
  userId: number;
}) {
  // El ejecutor solo opera sobre tickets que él mismo levantó
  const isOwner = ticket.requestedById === userId;
  if (!isOwner) {
    return (
      <div className="border border-dashed border-border rounded-md p-4 text-xs text-muted-foreground text-center">
        Este ticket no es tuyo.
      </div>
    );
  }

  const canUploadPhotos =
    ticket.status === 'PENDING_ADMIN_APPROVAL' || ticket.status === 'AWAITING_QUOTES';

  return (
    <div className="space-y-3">
      {canUploadPhotos && (
        <div className="border border-border rounded-lg p-4 bg-card space-y-2">
          <div className="flex items-center gap-1.5 font-semibold text-sm">
            <Camera className="size-4" /> Agregar más fotos
          </div>
          <p className="text-xs text-muted-foreground">
            Mientras el admin no apruebe el ticket puedes subir hasta 5 fotos en total.
          </p>
          <PhotoUploader
            mode="upload"
            ticketId={ticketId}
            currentCount={ticket.attachments?.length ?? 0}
          />
        </div>
      )}

      {/* Mini-estado contextual */}
      <ExecutorStatusHint status={ticket.status} />
    </div>
  );
}

function ExecutorStatusHint({ status }: { status: NonNullable<ReturnType<typeof useTicket>['data']>['status'] }) {
  const msg: Record<typeof status, { icon: React.ReactNode; title: string; body: string }> = {
    PENDING_ADMIN_APPROVAL: {
      icon: <Clock className="size-4" />,
      title: 'Esperando aprobación',
      body: 'El admin está revisando tu solicitud. Te notificaremos cuando decida.',
    },
    AWAITING_QUOTES: {
      icon: <UsersRound className="size-4" />,
      title: 'Cotizaciones en curso',
      body: 'El admin asignó talleres y están preparando su cotización.',
    },
    APPROVED_FOR_REPAIR: {
      icon: <CheckCircle2 className="size-4 text-emerald-600" />,
      title: 'Reparación aprobada',
      body: 'El taller ganador iniciará pronto los trabajos.',
    },
    IN_REPAIR: {
      icon: <UsersRound className="size-4 text-violet-600" />,
      title: 'En reparación',
      body: 'El taller está trabajando en tu vehículo.',
    },
    COMPLETED: {
      icon: <PackageCheck className="size-4 text-emerald-600" />,
      title: 'Reparación completada',
      body: 'Tu vehículo está listo. Quedó registrado en el historial.',
    },
    REJECTED_BY_ADMIN: {
      icon: <XCircle className="size-4 text-rose-600" />,
      title: 'Solicitud rechazada',
      body: 'Revisa el motivo del rechazo a la izquierda.',
    },
    REJECTED_FINAL: {
      icon: <XCircle className="size-4 text-rose-600" />,
      title: 'Rechazado tras cotizar',
      body: 'El admin decidió no proceder. Revisa el motivo a la izquierda.',
    },
  };
  const m = msg[status];
  return (
    <div className="border border-border rounded-md p-3 bg-muted/30 flex items-start gap-2">
      <div className="mt-0.5 shrink-0">{m.icon}</div>
      <div className="min-w-0">
        <div className="text-sm font-medium">{m.title}</div>
        <p className="text-xs text-muted-foreground mt-0.5">{m.body}</p>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════
// Acciones del taller — cotizar / declinar / start / complete
// ════════════════════════════════════════════════════════════════
function WorkshopActions({
  ticket,
  ticketId,
  workshopId,
}: {
  ticket: NonNullable<ReturnType<typeof useTicket>['data']>;
  ticketId: number;
  workshopId: number;
}) {
  // Encontrar la quote de ESTE taller
  const myQuote = (ticket.quotes ?? []).find((q) => q.workshopId === workshopId);

  if (!myQuote) {
    return (
      <div className="border border-dashed border-border rounded-md p-4 text-xs text-muted-foreground text-center">
        Tu taller no participa en este ticket.
      </div>
    );
  }

  // Necesitamos vehicleTypeId para el dropdown de servicios al completar.
  // Solo lo pedimos cuando el taller está en posición de completar.
  const needsVehicleType = ticket.selectedQuoteId === myQuote.id && ticket.status === 'IN_REPAIR';
  const { data: vehicle } = useVehicle(needsVehicleType ? ticket.vehicleId : null);

  // ── Estado AWAITING_QUOTES: el taller cotiza o declina ──
  if (ticket.status === 'AWAITING_QUOTES') {
    if (myQuote.declinedAt) {
      return (
        <div className="border border-border rounded-lg p-4 bg-card space-y-2">
          <div className="flex items-center gap-1.5 font-semibold text-sm">
            <MinusCircle className="size-4 text-muted-foreground" /> Declinaste cotizar
          </div>
          {myQuote.declineReason && (
            <p className="text-xs text-muted-foreground italic">"{myQuote.declineReason}"</p>
          )}
        </div>
      );
    }
    if (myQuote.submittedAt) {
      return (
        <div className="border border-border rounded-lg p-4 bg-card space-y-2">
          <div className="flex items-center gap-1.5 font-semibold text-sm">
            <CheckCircle2 className="size-4 text-emerald-600" /> Cotización enviada
          </div>
          <p className="text-xs text-muted-foreground">
            Esperando decisión del admin. No puedes modificar la cotización.
          </p>
        </div>
      );
    }
    // Pendiente — mostrar form de envío + opción de declinar
    return (
      <div className="space-y-3">
        <QuoteSubmitForm quoteId={myQuote.id} />
        <QuoteDeclineDialog quoteId={myQuote.id}>
          <Button variant="outline" className="w-full">
            <MinusCircle className="size-4 mr-1.5" /> No puedo cotizar
          </Button>
        </QuoteDeclineDialog>
      </div>
    );
  }

  // ── Soy el ganador: APPROVED_FOR_REPAIR → start, IN_REPAIR → complete ──
  if (ticket.selectedQuoteId === myQuote.id) {
    if (ticket.status === 'APPROVED_FOR_REPAIR') {
      return <StartRepairButton ticketId={ticketId} />;
    }
    if (ticket.status === 'IN_REPAIR') {
      if (!vehicle) {
        return (
          <div className="text-xs text-muted-foreground flex items-center gap-1.5 p-4">
            <Loader2 className="size-3.5 animate-spin" /> Cargando catálogo…
          </div>
        );
      }
      return <CompleteRepairForm ticketId={ticketId} vehicleTypeId={vehicle.vehicleTypeId} />;
    }
    if (ticket.status === 'COMPLETED') {
      return (
        <div className="border border-emerald-300 dark:border-emerald-700 rounded-lg p-4 bg-emerald-50 dark:bg-emerald-950/30 space-y-2">
          <div className="flex items-center gap-1.5 font-semibold text-sm text-emerald-900 dark:text-emerald-100">
            <PackageCheck className="size-4" /> Reparación entregada
          </div>
          <p className="text-xs text-emerald-800 dark:text-emerald-200">
            Quedó registrada en el historial del vehículo.
          </p>
        </div>
      );
    }
  }

  // ── No soy el ganador (mi quote no fue elegida) ──
  if (
    ['APPROVED_FOR_REPAIR', 'IN_REPAIR', 'COMPLETED'].includes(ticket.status) &&
    ticket.selectedQuoteId !== myQuote.id
  ) {
    return (
      <div className="border border-border rounded-lg p-4 bg-card text-sm space-y-1.5">
        <div className="flex items-center gap-1.5 font-semibold">
          <Eye className="size-4 text-muted-foreground" /> Solo lectura
        </div>
        <p className="text-xs text-muted-foreground">
          El admin eligió otra cotización para este ticket.
        </p>
      </div>
    );
  }

  // Estados rechazados — read-only
  return (
    <div className="border border-border rounded-md p-3 bg-muted/30 text-xs text-muted-foreground">
      Este ticket está cerrado.
    </div>
  );
}
