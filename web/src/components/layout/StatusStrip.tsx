// Live status strip — semáforo agregado siempre visible en el header.
// Comunica salud de toda la flota en un vistazo.

'use client';

import { useDashboardSummary } from '@/hooks/useDashboard';
import { formatNumber } from '@/lib/formatters';
import { cn } from '@/lib/utils';

interface PillProps {
  count: number | undefined;
  label: string;
  color: 'success' | 'warning' | 'destructive' | 'maintenance';
  pulse?: boolean;
}

const colorClasses: Record<PillProps['color'], { dot: string; text: string }> = {
  success: { dot: 'bg-success', text: 'text-success' },
  warning: { dot: 'bg-warning', text: 'text-warning' },
  destructive: { dot: 'bg-destructive', text: 'text-destructive' },
  maintenance: { dot: 'bg-maintenance', text: 'text-maintenance' },
};

function Pill({ count, label, color, pulse }: PillProps) {
  const c = colorClasses[color];
  if (count === undefined) {
    return (
      <div className="flex items-center gap-1.5">
        <span className="size-1.5 rounded-full bg-muted" />
        <span className="text-xs font-mono tabular-nums text-muted-foreground">—</span>
        <span className="text-xs text-muted-foreground hidden md:inline">{label}</span>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-1.5">
      <span className={cn('size-1.5 rounded-full', c.dot, pulse && count > 0 && 'animate-pulse')} />
      <span className={cn('text-xs font-mono tabular-nums font-medium', count > 0 ? c.text : 'text-muted-foreground')}>
        {formatNumber(count)}
      </span>
      <span className="text-xs text-muted-foreground hidden md:inline">{label}</span>
    </div>
  );
}

export default function StatusStrip() {
  const { data, isLoading } = useDashboardSummary();

  if (isLoading || !data) {
    return (
      <div className="hidden lg:flex items-center gap-4 px-3 py-1 rounded-md bg-muted/30 border border-border/40">
        <div className="size-1.5 rounded-full bg-muted animate-pulse" />
        <span className="text-xs text-muted-foreground">Cargando estado…</span>
      </div>
    );
  }

  return (
    <div className="hidden lg:flex items-center gap-4 px-3 py-1 rounded-md bg-muted/30 border border-border/40">
      <Pill count={data.operativeVehicles} label="operativos" color="success" />
      <span className="size-px h-3 bg-border/60" />
      <Pill count={data.docsExpiring} label="por vencer" color="warning" pulse />
      <span className="size-px h-3 bg-border/60" />
      <Pill count={data.blockedVehicles} label="bloqueados" color="destructive" pulse />
    </div>
  );
}
