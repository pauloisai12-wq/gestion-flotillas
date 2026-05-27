// Línea de tiempo visual del ciclo de vida del ticket.
// Marca cada hito con su fecha; los pendientes se muestran apagados.

import { cn } from '@/lib/utils';
import { Clock, CheckCircle2, XCircle, Inbox, Wrench, PackageCheck } from 'lucide-react';
import type { MaintenanceTicket } from '@/hooks/useMaintenanceTickets';

interface Step {
  label: string;
  Icon: React.ComponentType<{ className?: string }>;
  reached: boolean;
  date: string | null;
  isRejection?: boolean;
}

export function TicketTimeline({ ticket }: { ticket: MaintenanceTicket }) {
  const wasRejected = ticket.status === 'REJECTED_BY_ADMIN' || ticket.status === 'REJECTED_FINAL';

  const steps: Step[] = [
    {
      label: 'Solicitado',
      Icon: Clock,
      reached: true,
      date: ticket.createdAt,
    },
    {
      label: 'Cotizando',
      Icon: Inbox,
      reached: ['AWAITING_QUOTES', 'APPROVED_FOR_REPAIR', 'IN_REPAIR', 'COMPLETED', 'REJECTED_FINAL'].includes(ticket.status),
      date: null,
    },
    {
      label: 'Aprobado',
      Icon: CheckCircle2,
      reached: ['APPROVED_FOR_REPAIR', 'IN_REPAIR', 'COMPLETED'].includes(ticket.status),
      date: ticket.approvedAt,
    },
    {
      label: 'En reparación',
      Icon: Wrench,
      reached: ['IN_REPAIR', 'COMPLETED'].includes(ticket.status),
      date: ticket.repairStartedAt,
    },
    {
      label: 'Completado',
      Icon: PackageCheck,
      reached: ticket.status === 'COMPLETED',
      date: ticket.repairCompletedAt,
    },
  ];

  // Si fue rechazado, agregamos un paso rojo al final
  if (wasRejected) {
    steps.push({
      label: ticket.status === 'REJECTED_BY_ADMIN' ? 'Rechazado' : 'Rechazado tras cotizar',
      Icon: XCircle,
      reached: true,
      date: ticket.rejectedAt,
      isRejection: true,
    });
  }

  return (
    <div className="flex items-start gap-2 overflow-x-auto pb-2">
      {steps.map((step, i) => {
        const Icon = step.Icon;
        const isLast = i === steps.length - 1;
        return (
          <div key={step.label} className="flex items-start gap-2 shrink-0">
            <div className="flex flex-col items-center min-w-[80px]">
              <div
                className={cn(
                  'size-9 rounded-full flex items-center justify-center border-2 transition-colors',
                  step.isRejection
                    ? 'bg-rose-100 border-rose-400 text-rose-700 dark:bg-rose-950 dark:border-rose-500 dark:text-rose-300'
                    : step.reached
                      ? 'bg-primary-subtle border-primary text-primary'
                      : 'bg-muted/30 border-border text-muted-foreground',
                )}
              >
                <Icon className="size-4" />
              </div>
              <div className="mt-1.5 text-xs text-center leading-tight">
                <div className={cn('font-medium', step.reached ? 'text-foreground' : 'text-muted-foreground')}>
                  {step.label}
                </div>
                {step.date && (
                  <div className="text-[10px] text-muted-foreground mt-0.5">
                    {new Date(step.date).toLocaleDateString('es-MX', { day: '2-digit', month: 'short' })}
                  </div>
                )}
              </div>
            </div>
            {!isLast && (
              <div
                className={cn(
                  'h-[2px] mt-[18px] w-8 shrink-0 rounded-full',
                  step.reached && steps[i + 1].reached ? 'bg-primary' : 'bg-border',
                )}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
