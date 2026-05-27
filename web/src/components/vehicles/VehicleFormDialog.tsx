// Archivo: /flotillas/web/src/components/vehicles/VehicleFormDialog.tsx
// NUEVO: Modal para crear/editar vehículo
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
  useCreateVehicle,
  useUpdateVehicle,
  Vehicle,
  VehicleInput,
} from '@/hooks/useVehicles';
import { useVehicleTypes } from '@/hooks/useVehicleTypes';

interface Props {
  open: boolean;
  onClose: () => void;
  vehicle?: Vehicle | null;
}

export default function VehicleFormDialog({ open, onClose, vehicle }: Props) {
  const formRef = useRef<HTMLFormElement>(null);
  const createMutation = useCreateVehicle();
  const updateMutation = useUpdateVehicle();
  const { data: vehicleTypes } = useVehicleTypes();

  const isEditing = !!vehicle;
  const isLoading = createMutation.isPending || updateMutation.isPending;

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);

    const input: VehicleInput = {
      plate: (fd.get('plate') as string)?.trim().toUpperCase(),
      economicNumber: (fd.get('economicNumber') as string)?.trim(),
      vehicleTypeId: parseInt(fd.get('vehicleTypeId') as string),
      brand: (fd.get('brand') as string)?.trim(),
      model: (fd.get('model') as string)?.trim(),
      year: parseInt(fd.get('year') as string),
      vin: (fd.get('vin') as string)?.trim() || null,
      color: (fd.get('color') as string)?.trim() || null,
      currentOdometer: parseFloat(fd.get('currentOdometer') as string) || 0,
    };

    // Validación básica
    if (!input.plate || !input.economicNumber || !input.brand || !input.model) {
      alert('Placa, número económico, marca y modelo son obligatorios');
      return;
    }

    if (isNaN(input.vehicleTypeId) || input.vehicleTypeId <= 0) {
      alert('Debe seleccionar un tipo de vehículo');
      return;
    }

    if (isNaN(input.year) || input.year < 1990) {
      alert('El año debe ser un número válido (mínimo 1990)');
      return;
    }

    try {
      if (isEditing && vehicle) {
        await updateMutation.mutateAsync({ id: vehicle.id, input });
      } else {
        await createMutation.mutateAsync(input);
      }
      onClose();
    } catch (err: unknown) {
      const error = err as { response?: { data?: { error?: string } } };
      alert(error.response?.data?.error || 'Error al guardar');
    }
  }

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {isEditing ? 'Editar vehículo' : 'Nuevo vehículo'}
          </DialogTitle>
        </DialogHeader>

        <form ref={formRef} onSubmit={handleSubmit} className="space-y-4">
          {/* Fila 1: Placa y Número económico */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="plate">Placa *</Label>
              <Input
                id="plate"
                name="plate"
                placeholder="ABC-123-D"
                defaultValue={vehicle?.plate ?? ''}
                key={`plate-${vehicle?.id ?? 'new'}`}
                disabled={isLoading}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="economicNumber">Nº Económico *</Label>
              <Input
                id="economicNumber"
                name="economicNumber"
                placeholder="ECO-001"
                defaultValue={vehicle?.economicNumber ?? ''}
                key={`eco-${vehicle?.id ?? 'new'}`}
                disabled={isLoading}
              />
            </div>
          </div>

          {/* Fila 2: Tipo de vehículo */}
          <div className="space-y-2">
            <Label htmlFor="vehicleTypeId">Tipo de vehículo *</Label>
            <select
              id="vehicleTypeId"
              name="vehicleTypeId"
              defaultValue={vehicle?.vehicleTypeId?.toString() ?? ''}
              key={`type-${vehicle?.id ?? 'new'}`}
              disabled={isLoading}
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
            >
              <option value="">Seleccionar tipo...</option>
              {vehicleTypes?.map((type) => (
                <option key={type.id} value={type.id}>
                  {type.name} ({type.expectedKmPerLiter} km/l)
                </option>
              ))}
            </select>
          </div>

          {/* Fila 3: Marca y Modelo */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="brand">Marca *</Label>
              <Input
                id="brand"
                name="brand"
                placeholder="Kenworth"
                defaultValue={vehicle?.brand ?? ''}
                key={`brand-${vehicle?.id ?? 'new'}`}
                disabled={isLoading}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="model">Modelo *</Label>
              <Input
                id="model"
                name="model"
                placeholder="T680"
                defaultValue={vehicle?.model ?? ''}
                key={`model-${vehicle?.id ?? 'new'}`}
                disabled={isLoading}
              />
            </div>
          </div>

          {/* Fila 4: Año y Color */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="year">Año *</Label>
              <Input
                id="year"
                name="year"
                type="number"
                min="1990"
                max={new Date().getFullYear() + 1}
                defaultValue={vehicle?.year?.toString() ?? ''}
                key={`year-${vehicle?.id ?? 'new'}`}
                disabled={isLoading}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="color">Color</Label>
              <Input
                id="color"
                name="color"
                placeholder="Blanco"
                defaultValue={vehicle?.color ?? ''}
                key={`color-${vehicle?.id ?? 'new'}`}
                disabled={isLoading}
              />
            </div>
          </div>

          {/* Fila 5: VIN y Odómetro */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="vin">VIN</Label>
              <Input
                id="vin"
                name="vin"
                placeholder="Opcional"
                defaultValue={vehicle?.vin ?? ''}
                key={`vin-${vehicle?.id ?? 'new'}`}
                disabled={isLoading}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="currentOdometer">Odómetro (km)</Label>
              <Input
                id="currentOdometer"
                name="currentOdometer"
                type="number"
                min="0"
                defaultValue={vehicle?.currentOdometer?.toString() ?? '0'}
                key={`odo-${vehicle?.id ?? 'new'}`}
                disabled={isLoading}
              />
            </div>
          </div>

          {/* Botones */}
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