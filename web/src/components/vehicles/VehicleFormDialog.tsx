'use client';

import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from '@/components/ui/toast';
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
  VehicleUpdateInput,
} from '@/hooks/useVehicles';
import { useVehicleTypes } from '@/hooks/useVehicleTypes';
import { getApiError } from '@/lib/api';

interface Props {
  open: boolean;
  onClose: () => void;
  vehicle?: Vehicle | null;
}

export default function VehicleFormDialog({ open, onClose, vehicle }: Props) {
  const formRef = useRef<HTMLFormElement>(null);
  const queryClient = useQueryClient();
  const [concurrentConflict, setConcurrentConflict] = useState(false);
  const createMutation = useCreateVehicle();
  const updateMutation = useUpdateVehicle();
  const { data: vehicleTypes } = useVehicleTypes();

  const isEditing = !!vehicle;
  const isLoading = createMutation.isPending || updateMutation.isPending;

  function closeDialog() {
    setConcurrentConflict(false);
    onClose();
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);

    const commonInput = {
      plate: (fd.get('plate') as string)?.trim().toUpperCase(),
      economicNumber: (fd.get('economicNumber') as string)?.trim(),
      vehicleTypeId: parseInt(fd.get('vehicleTypeId') as string),
      classification: fd.get('classification') as Vehicle['classification'],
      brand: (fd.get('brand') as string)?.trim(),
      model: (fd.get('model') as string)?.trim(),
      year: parseInt(fd.get('year') as string),
      vin: (fd.get('vin') as string)?.trim() || null,
      color: (fd.get('color') as string)?.trim() || null,
    };

    // Validación básica
    if (!commonInput.plate || !commonInput.economicNumber || !commonInput.brand || !commonInput.model) {
      toast.error('Placa, número económico, marca y modelo son obligatorios');
      return;
    }

    if (isNaN(commonInput.vehicleTypeId) || commonInput.vehicleTypeId <= 0) {
      toast.error('Debe seleccionar un tipo de vehículo');
      return;
    }

    if (isNaN(commonInput.year) || commonInput.year < 1990) {
      toast.error('El año debe ser un número válido (mínimo 1990)');
      return;
    }

    try {
      if (isEditing && vehicle) {
        const input: VehicleUpdateInput = {
          ...commonInput,
          expectedUpdatedAt: vehicle.updatedAt,
        };
        await updateMutation.mutateAsync({ id: vehicle.id, input });
      } else {
        const input: VehicleInput = {
          ...commonInput,
          currentOdometer: parseFloat(fd.get('currentOdometer') as string) || 0,
        };
        await createMutation.mutateAsync(input);
      }
      closeDialog();
    } catch (err: unknown) {
      const error = getApiError(err);
      if (error.status === 409) {
        setConcurrentConflict(true);
        toast.error('Otro usuario actualizó este vehículo. Recarga antes de guardar.');
        return;
      }
      toast.error(error.data?.error || 'Error al guardar');
    }
  }

  async function reloadAfterConflict() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['vehicles'] }),
      vehicle ? queryClient.invalidateQueries({ queryKey: ['vehicle', vehicle.id] }) : Promise.resolve(),
    ]);
    closeDialog();
  }

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && closeDialog()}>
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

          <div className="space-y-2">
            <Label htmlFor="classification">Clasificación *</Label>
            <select
              id="classification"
              name="classification"
              defaultValue={vehicle?.classification ?? 'ESTATAL'}
              key={`classification-${vehicle?.id ?? 'new'}`}
              disabled={isLoading}
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
            >
              <option value="POLICIAL">Policial</option>
              <option value="ESTATAL">Estatal</option>
              <option value="VIAL">Vial</option>
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
                disabled={isLoading || isEditing}
              />
              {isEditing && (
                <p className="text-xs text-muted-foreground">
                  Las correcciones de odómetro requieren una operación administrativa auditada.
                </p>
              )}
            </div>
          </div>

          {concurrentConflict && (
            <div role="alert" className="rounded-md border border-warning/30 bg-warning/10 p-3 text-sm">
              <p>El registro cambió mientras lo editabas. Tus cambios no se guardaron.</p>
              <Button type="button" variant="outline" size="sm" className="mt-2" onClick={reloadAfterConflict}>
                Cerrar y recargar datos
              </Button>
            </div>
          )}

          {/* Botones */}
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={closeDialog} disabled={isLoading}>
              Cancelar
            </Button>
            <Button type="submit" disabled={isLoading || concurrentConflict}>
              {isLoading ? 'Guardando...' : isEditing ? 'Guardar cambios' : 'Crear'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
