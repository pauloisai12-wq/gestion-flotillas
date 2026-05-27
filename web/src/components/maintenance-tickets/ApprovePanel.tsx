// Panel inline para aprobar — incluye textarea de "concepto" + botón aprobar.
// La quote ganadora se elige en BudgetVsQuotesCard (selectedQuoteId va por prop).

'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { AlertCircle, CheckCircle2 } from 'lucide-react';
import { useApproveTicket } from '@/hooks/useMaintenanceTickets';

export function ApprovePanel({
  ticketId,
  selectedQuoteId,
  onSuccess,
}: {
  ticketId: number;
  selectedQuoteId: number | null;
  onSuccess?: () => void;
}) {
  const [finalConcept, setFinalConcept] = useState('');
  const approve = useApproveTicket();
  const error = approve.error as { response?: { data?: { error?: string; code?: string } } } | null;

  async function submit() {
    if (!selectedQuoteId || finalConcept.trim().length < 10) return;
    try {
      await approve.mutateAsync({ ticketId, selectedQuoteId, finalConcept: finalConcept.trim() });
      setFinalConcept('');
      onSuccess?.();
    } catch {
      /* el error se muestra abajo */
    }
  }

  return (
    <div className="border border-border rounded-lg p-4 bg-card space-y-3">
      <div>
        <label className="text-sm font-medium block mb-1">Concepto final de la reparación</label>
        <p className="text-xs text-muted-foreground mb-2">
          Texto definitivo que quedará en el historial del vehículo. El ejecutor y el taller ganador lo verán.
        </p>
        <textarea
          value={finalConcept}
          onChange={(e) => setFinalConcept(e.target.value)}
          rows={3}
          minLength={10}
          maxLength={2000}
          placeholder="Ej: Cambio completo de balatas delanteras y rectificado de discos."
          className="w-full px-3 py-2 text-sm border border-input rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-ring resize-y"
        />
        <p className="text-[11px] text-muted-foreground mt-1">
          Mínimo 10 caracteres. {finalConcept.length}/2000
        </p>
      </div>

      {error?.response?.data?.error && (
        <div className="text-sm text-rose-600 dark:text-rose-400 flex items-start gap-1.5 bg-rose-50 dark:bg-rose-950/30 p-2.5 rounded-md">
          <AlertCircle className="size-4 mt-0.5 shrink-0" />
          <div>
            <div className="font-medium">{error.response.data.error}</div>
            {error.response.data.code === 'BUDGET_EXCEEDED' && (
              <div className="text-xs mt-1 text-muted-foreground">
                Aumenta el presupuesto del mes o elige otra cotización.
              </div>
            )}
          </div>
        </div>
      )}

      <div className="flex justify-end">
        <Button
          onClick={submit}
          disabled={!selectedQuoteId || finalConcept.trim().length < 10 || approve.isPending}
          className="gap-2"
        >
          <CheckCircle2 className="size-4" />
          {approve.isPending ? 'Aprobando…' : 'Aprobar reparación'}
        </Button>
      </div>

      {!selectedQuoteId && (
        <p className="text-xs text-muted-foreground text-center">
          Selecciona una cotización en el panel de arriba para habilitar.
        </p>
      )}
    </div>
  );
}
