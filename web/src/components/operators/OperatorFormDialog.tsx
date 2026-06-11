'use client';

import { useRef } from 'react';
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
  useCreateOperator,
  useUpdateOperator,
  Operator,
  OperatorInput,
} from '@/hooks/useOperators';

interface Props {
  open: boolean;
  onClose: () => void;
  operator?: Operator | null;
}

export default function OperatorFormDialog({ open, onClose, operator }: Props) {
  const formRef = useRef<HTMLFormElement>(null);
  const createMutation = useCreateOperator();
  const updateMutation = useUpdateOperator();

  const isEditing = !!operator;
  const isLoading = createMutation.isPending || updateMutation.isPending;

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);

    const input: OperatorInput = {
      fullName: (fd.get('fullName') as string)?.trim(),
      licenseNumber: (fd.get('licenseNumber') as string)?.trim(),
      licenseType: (fd.get('licenseType') as string)?.trim(),
      licenseExpiresAt: fd.get('licenseExpiresAt') as string,
      phone: (fd.get('phone') as string)?.trim() || null,
      email: (fd.get('email') as string)?.trim() || null,
    };

    if (!input.fullName || !input.licenseNumber || !input.licenseType || !input.licenseExpiresAt) {
      toast.error('Nombre, licencia, tipo y vigencia son obligatorios');
      return;
    }

    try {
      if (isEditing && operator) {
        await updateMutation.mutateAsync({ id: operator.id, input });
      } else {
        await createMutation.mutateAsync(input);
      }
      onClose();
    } catch (err: unknown) {
      const error = err as { response?: { data?: { error?: string } } };
      toast.error(error.response?.data?.error || 'Error al guardar');
    }
  }

  // Formatear fecha para el input type="date"
  const defaultExpires = operator?.licenseExpiresAt
    ? new Date(operator.licenseExpiresAt).toISOString().split('T')[0]
    : '';

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {isEditing ? 'Editar operador' : 'Nuevo operador'}
          </DialogTitle>
        </DialogHeader>

        <form ref={formRef} onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="fullName">Nombre completo *</Label>
            <Input
              id="fullName"
              name="fullName"
              placeholder="Juan Pérez López"
              defaultValue={operator?.fullName ?? ''}
              key={`name-${operator?.id ?? 'new'}`}
              disabled={isLoading}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="licenseNumber">Nº Licencia *</Label>
              <Input
                id="licenseNumber"
                name="licenseNumber"
                placeholder="LIC-000001"
                defaultValue={operator?.licenseNumber ?? ''}
                key={`lic-${operator?.id ?? 'new'}`}
                disabled={isLoading}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="licenseType">Tipo licencia *</Label>
              <select
                id="licenseType"
                name="licenseType"
                defaultValue={operator?.licenseType ?? ''}
                key={`lictype-${operator?.id ?? 'new'}`}
                disabled={isLoading}
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
              >
                <option value="">Seleccionar...</option>
                <option value="A">A — Automóvil</option>
                <option value="B">B — Camión</option>
                <option value="C">C — Tractocamión</option>
                <option value="D">D — Pasajeros</option>
                <option value="E">E — Especial</option>
              </select>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="licenseExpiresAt">Vigencia de licencia *</Label>
            <Input
              id="licenseExpiresAt"
              name="licenseExpiresAt"
              type="date"
              defaultValue={defaultExpires}
              key={`exp-${operator?.id ?? 'new'}`}
              disabled={isLoading}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="phone">Teléfono</Label>
              <Input
                id="phone"
                name="phone"
                placeholder="55 1234 5678"
                defaultValue={operator?.phone ?? ''}
                key={`phone-${operator?.id ?? 'new'}`}
                disabled={isLoading}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                name="email"
                type="email"
                placeholder="juan@ejemplo.com"
                defaultValue={operator?.email ?? ''}
                key={`email-${operator?.id ?? 'new'}`}
                disabled={isLoading}
              />
            </div>
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