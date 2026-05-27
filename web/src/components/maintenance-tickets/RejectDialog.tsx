// Diálogo para rechazar un ticket (filtro inicial o final).
// El backend decide a qué estado mover (REJECTED_BY_ADMIN o REJECTED_FINAL) según status actual.

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
import { AlertCircle } from 'lucide-react';
import { useRejectTicket } from '@/hooks/useMaintenanceTickets';

export function RejectDialog({
  ticketId,
  children,
  onSuccess,
}: {
  ticketId: number;
  children: React.ReactNode;
  onSuccess?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const reject = useRejectTicket();

  async function submit() {
    if (reason.trim().length < 5) return;
    try {
      await reject.mutateAsync({ ticketId, rejectionReason: reason.trim() });
      setOpen(false);
      setReason('');
      onSuccess?.();
    } catch {
      /* mostrado abajo */
    }
  }

  const error = reject.error as { response?: { data?: { error?: string } } } | null;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Rechazar ticket</DialogTitle>
          <DialogDescription>
            El ejecutor recibirá una notificación con el motivo. Esta acción no se puede deshacer.
          </DialogDescription>
        </DialogHeader>

        <label className="text-sm font-medium">Motivo del rechazo</label>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={4}
          minLength={5}
          maxLength={1000}
          placeholder="Ej: El daño es estético y no afecta operación. Programar para próximo servicio preventivo."
          className="w-full px-3 py-2 text-sm border border-input rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-ring resize-y"
        />
        <p className="text-[11px] text-muted-foreground">
          Mínimo 5 caracteres. {reason.length}/1000
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
            disabled={reason.trim().length < 5 || reject.isPending}
          >
            {reject.isPending ? 'Rechazando…' : 'Rechazar ticket'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
