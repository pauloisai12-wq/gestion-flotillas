// Badge dedicado al ciclo de vida del ticket — 7 estados con su color.
// Vive separado de StatusBadge global porque su semántica es propia del flujo.

import { cn } from '@/lib/utils';
import {
  Clock,
  XCircle,
  Inbox,
  CheckCircle2,
  Wrench,
  PackageCheck,
} from 'lucide-react';
import type { MaintenanceTicketStatus } from '@/hooks/useMaintenanceTickets';
import { STATUS_LABELS, STATUS_COLORS } from '@/hooks/useMaintenanceTickets';

const ICONS: Record<MaintenanceTicketStatus, React.ComponentType<{ className?: string }>> = {
  PENDING_ADMIN_APPROVAL: Clock,
  REJECTED_BY_ADMIN: XCircle,
  AWAITING_QUOTES: Inbox,
  REJECTED_FINAL: XCircle,
  APPROVED_FOR_REPAIR: CheckCircle2,
  IN_REPAIR: Wrench,
  COMPLETED: PackageCheck,
};

export function TicketStatusBadge({
  status,
  className,
}: {
  status: MaintenanceTicketStatus;
  className?: string;
}) {
  const Icon = ICONS[status];
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium',
        STATUS_COLORS[status],
        className,
      )}
    >
      <Icon className="size-3.5" />
      <span>{STATUS_LABELS[status]}</span>
    </span>
  );
}
