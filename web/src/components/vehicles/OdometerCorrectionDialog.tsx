'use client';

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from '@/components/ui/toast';
import { getApiError } from '@/lib/api';
import { formatNumber } from '@/lib/formatters';
import { useCorrectVehicleOdometer, Vehicle } from '@/hooks/useVehicles';

interface Props {
  open: boolean;
  onClose: () => void;
  vehicle: Vehicle | null;
}

export default function OdometerCorrectionDialog({ open, onClose, vehicle }: Props) {
  const queryClient = useQueryClient();
  const correction = useCorrectVehicleOdometer();
  const [conflict, setConflict] = useState(false);

  function close() {
    setConflict(false);
    correction.reset();
    onClose();
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!vehicle) return;

    const form = new FormData(event.currentTarget);
    const newOdometer = Number(form.get('newOdometer'));
    const reason = String(form.get('reason') ?? '').trim();
    const confirmed = form.get('confirmed') === 'on';
    if (!Number.isFinite(newOdometer) || newOdometer < 0) {
      toast.error('Ingresa un odómetro válido');
      return;
    }
    if (reason.length < 10) {
      toast.error('Explica el motivo con al menos 10 caracteres');
      return;
    }
    if (!confirmed) {
      toast.error('Confirma que verificaste la lectura y el motivo');
      return;
    }

    try {
      await correction.mutateAsync({
        id: vehicle.id,
        input: { newOdometer, reason, expectedUpdatedAt: vehicle.updatedAt },
      });
      toast.success('Odómetro corregido y registrado en auditoría');
      close();
    } catch (error: unknown) {
      const apiError = getApiError(error);
      if (apiError.status === 409) {
        setConflict(true);
        toast.error('La unidad cambió mientras confirmabas. Recarga los datos.');
        return;
      }
      toast.error(apiError.data?.error || 'No se pudo corregir el odómetro');
    }
  }

  async function reload() {
    if (vehicle) {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['vehicles'] }),
        queryClient.invalidateQueries({ queryKey: ['vehicle', vehicle.id] }),
      ]);
    }
    close();
  }

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && close()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Corrección administrativa de odómetro</DialogTitle>
          <DialogDescription>
            Esta operación queda auditada con el valor anterior, el nuevo valor y tu motivo.
          </DialogDescription>
        </DialogHeader>

        {vehicle && (
          <form key={`${vehicle.id}-${vehicle.updatedAt}`} onSubmit={submit} className="space-y-4">
            <div className="rounded-md border bg-muted/40 p-3 text-sm">
              <p className="font-medium">Unidad {vehicle.economicNumber} · {vehicle.plate}</p>
              <p className="text-muted-foreground">
                Odómetro actual: {formatNumber(vehicle.currentOdometer)} km
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="correction-new-odometer">Nuevo odómetro (km)</Label>
              <Input
                id="correction-new-odometer"
                name="newOdometer"
                type="number"
                min="0"
                step="0.1"
                defaultValue={vehicle.currentOdometer}
                disabled={correction.isPending || conflict}
                required
                autoFocus
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="correction-reason">Motivo de la corrección</Label>
              <textarea
                id="correction-reason"
                name="reason"
                minLength={10}
                maxLength={500}
                rows={4}
                disabled={correction.isPending || conflict}
                required
                className="flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                placeholder="Ej. La lectura anterior se capturó con un dígito adicional."
              />
            </div>

            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                name="confirmed"
                className="mt-1 accent-primary"
                disabled={correction.isPending || conflict}
                required
              />
              <span>Confirmo que verifiqué la lectura y que el motivo es correcto.</span>
            </label>

            {conflict && (
              <div role="alert" className="rounded-md border border-warning/30 bg-warning/10 p-3 text-sm">
                <p>Otro proceso cambió esta unidad. No se guardó la corrección.</p>
                <Button type="button" variant="outline" size="sm" className="mt-2" onClick={reload}>
                  Cerrar y recargar datos
                </Button>
              </div>
            )}

            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={close} disabled={correction.isPending}>
                Cancelar
              </Button>
              <Button type="submit" disabled={correction.isPending || conflict}>
                {correction.isPending ? 'Guardando…' : 'Confirmar corrección'}
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
