// Archivo: /flotillas/web/src/components/vehicle-types/VehicleTypeFormDialog.tsx
// REEMPLAZA: Versión compatible con React 19 (sin setState en useEffect)
'use client';

import { useRef } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  useCreateVehicleType,
  useUpdateVehicleType,
  VehicleType,
  VehicleTypeInput,
} from '@/hooks/useVehicleTypes';

interface Props {
  open: boolean;
  onClose: () => void;
  vehicleType?: VehicleType | null;
}

export default function VehicleTypeFormDialog({ open, onClose, vehicleType }: Props) {
  const formRef = useRef<HTMLFormElement>(null);
  const createMutation = useCreateVehicleType();
  const updateMutation = useUpdateVehicleType();

  const isEditing = !!vehicleType;
  const isLoading = createMutation.isPending || updateMutation.isPending;

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const name = (formData.get('name') as string)?.trim();
    const kmPerLiter = parseFloat(formData.get('expectedKmPerLiter') as string);

    if (!name) {
      alert('El nombre es obligatorio');
      return;
    }

    if (isNaN(kmPerLiter) || kmPerLiter <= 0) {
      alert('El rendimiento debe ser un número mayor a 0');
      return;
    }

    const input: VehicleTypeInput = {
      name,
      expectedKmPerLiter: kmPerLiter,
    };

    try {
      if (isEditing && vehicleType) {
        await updateMutation.mutateAsync({ id: vehicleType.id, input });
      } else {
        await createMutation.mutateAsync(input);
      }
      onClose();
    } catch (err: unknown) {
      const error = err as { response?: { data?: { error?: string; details?: { message: string }[] } } };
      const message =
        error.response?.data?.error || error.response?.data?.details?.[0]?.message || 'Error al guardar';
      alert(message);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {isEditing ? 'Editar tipo de vehículo' : 'Nuevo tipo de vehículo'}
          </DialogTitle>
        </DialogHeader>

        <form ref={formRef} onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">Nombre del tipo</Label>
            <Input
              id="name"
              name="name"
              placeholder="Ej: Camión de carga"
              defaultValue={vehicleType?.name ?? ''}
              key={vehicleType?.id ?? 'new'}
              disabled={isLoading}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="expectedKmPerLiter">Rendimiento esperado (km/l)</Label>
            <Input
              id="expectedKmPerLiter"
              name="expectedKmPerLiter"
              type="number"
              step="0.1"
              min="0.1"
              placeholder="Ej: 8.5"
              defaultValue={vehicleType?.expectedKmPerLiter?.toString() ?? ''}
              key={`km-${vehicleType?.id ?? 'new'}`}
              disabled={isLoading}
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={onClose} disabled={isLoading}>
              Cancelar
            </Button>
            <Button type="submit" disabled={isLoading}>
              {isLoading ? 'Guardando...' : isEditing ? 'Guardar cambios' : 'Crear'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}