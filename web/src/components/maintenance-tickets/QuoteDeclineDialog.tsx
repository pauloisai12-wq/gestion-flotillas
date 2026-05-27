// Diálogo para que el taller decline una cotización con motivo.

'use client';

import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useDeclineQuote } from '@/hooks/useMaintenanceTickets';
import { AlertCircle } from 'lucide-react';

export function QuoteDeclineDialog({
  quoteId,
  children,
  onSuccess,
}: {
  quoteId: number;
  children: React.ReactNode;
  onSuccess?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const decline = useDeclineQuote();

  async function submit() {
    if (reason.trim().length < 5) return;
    try {
      await decline.mutateAsync({ quoteId, declineReason: reason.trim() });
      setOpen(false);
      setReason('');
      onSuccess?.();
    } catch {
      /* mostrado abajo */
    }
  }

  const error = decline.error as { response?: { data?: { error?: string } } } | null;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Declinar cotización</DialogTitle>
          <DialogDescription>
            Indica el motivo. No podrás revertir esta acción.
          </DialogDescription>
        </DialogHeader>

        <label className="text-sm font-medium">Motivo</label>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={3}
          minLength={5}
          maxLength={500}
          placeholder="Ej: Sin capacidad actual / fuera de nuestra especialidad"
          className="w-full px-3 py-2 text-sm border border-input rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-ring resize-y"
        />
        <p className="text-[11px] text-muted-foreground">
          Mínimo 5 caracteres. {reason.length}/500
        </p>

        {error?.response?.data?.error && (
          <div className="text-xs text-rose-600 dark:text-rose-400 flex items-center gap-1.5">
            <AlertCircle className="size-3.5" />
            {error.response.data.error}
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Cancelar
          </Button>
          <Button
            variant="destructive"
            onClick={submit}
            disabled={reason.trim().length < 5 || decline.isPending}
          >
            {decline.isPending ? 'Declinando…' : 'Declinar'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
