'use client';

import { AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface DashboardErrorAlertProps {
  failedSections: string[];
  isRetrying: boolean;
  onRetry: () => void;
}

export function DashboardErrorAlert({
  failedSections,
  isRetrying,
  onRetry,
}: DashboardErrorAlertProps) {
  if (failedSections.length === 0) return null;

  return (
    <div
      role="alert"
      className="flex flex-col gap-3 rounded-lg border border-destructive/40 bg-destructive/10 p-4 sm:flex-row sm:items-center"
    >
      <AlertTriangle className="size-5 shrink-0 text-destructive" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-foreground">No pudimos actualizar todo el tablero</p>
        <p className="text-xs text-muted-foreground">
          Datos no disponibles: {failedSections.join(', ')}. Los demás datos siguen visibles.
        </p>
      </div>
      <Button type="button" variant="outline" onClick={onRetry} disabled={isRetrying}>
        {isRetrying ? 'Reintentando…' : 'Reintentar datos fallidos'}
      </Button>
    </div>
  );
}
