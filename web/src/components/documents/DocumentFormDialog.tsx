// Archivo: /flotillas/web/src/components/documents/DocumentFormDialog.tsx
// NUEVO: Modal para crear/editar documento vehicular con upload
'use client';

import { useRef } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  useCreateDocument,
  useUpdateDocument,
  VehicleDocument,
} from '@/hooks/useDocuments';

interface Props {
  open: boolean;
  onClose: () => void;
  vehicleId: number;
  document?: VehicleDocument | null;
}

const DOC_TYPES = [
  { value: 'INSURANCE', label: 'Póliza de seguro' },
  { value: 'VERIFICATION', label: 'Verificación vehicular' },
  { value: 'CIRCULATION_CARD', label: 'Tarjeta de circulación' },
  { value: 'SCT_PERMIT', label: 'Permiso SCT' },
];

export default function DocumentFormDialog({ open, onClose, vehicleId, document }: Props) {
  const formRef = useRef<HTMLFormElement>(null);
  const createMutation = useCreateDocument();
  const updateMutation = useUpdateDocument();

  const isEditing = !!document;
  const isLoading = createMutation.isPending || updateMutation.isPending;

  const defaultIssued = document?.issuedAt
    ? new Date(document.issuedAt).toISOString().split('T')[0]
    : '';
  const defaultExpires = document?.expiresAt
    ? new Date(document.expiresAt).toISOString().split('T')[0]
    : '';

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);

    // Agregar vehicleId al FormData
    fd.set('vehicleId', vehicleId.toString());

    // Validaciones básicas
    const type = fd.get('type') as string;
    const issuedAt = fd.get('issuedAt') as string;
    const expiresAt = fd.get('expiresAt') as string;

    if (!type) { alert('Seleccione un tipo de documento'); return; }
    if (!issuedAt) { alert('La fecha de emisión es obligatoria'); return; }
    if (!expiresAt) { alert('La fecha de vencimiento es obligatoria'); return; }

    if (new Date(expiresAt) <= new Date(issuedAt)) {
      alert('La fecha de vencimiento debe ser posterior a la de emisión');
      return;
    }

    // Si no se seleccionó archivo, quitar el campo vacío del FormData
    const file = fd.get('file') as File;
    if (!file || file.size === 0) {
      fd.delete('file');
    }

    try {
      if (isEditing && document) {
        await updateMutation.mutateAsync({ id: document.id, formData: fd });
      } else {
        await createMutation.mutateAsync(fd);
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
            {isEditing ? 'Editar documento' : 'Agregar documento'}
          </DialogTitle>
        </DialogHeader>

        <form ref={formRef} onSubmit={handleSubmit} className="space-y-4">
          {/* Tipo de documento */}
          <div className="space-y-2">
            <Label htmlFor="type">Tipo de documento *</Label>
            <select
              id="type"
              name="type"
              defaultValue={document?.type ?? ''}
              key={`type-${document?.id ?? 'new'}`}
              disabled={isLoading}
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
            >
              <option value="">Seleccionar tipo...</option>
              {DOC_TYPES.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </div>

          {/* Fechas */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="issuedAt">Fecha de emisión *</Label>
              <Input
                id="issuedAt"
                name="issuedAt"
                type="date"
                defaultValue={defaultIssued}
                key={`issued-${document?.id ?? 'new'}`}
                disabled={isLoading}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="expiresAt">Fecha de vencimiento *</Label>
              <Input
                id="expiresAt"
                name="expiresAt"
                type="date"
                defaultValue={defaultExpires}
                key={`expires-${document?.id ?? 'new'}`}
                disabled={isLoading}
              />
            </div>
          </div>

          {/* Archivo */}
          <div className="space-y-2">
            <Label htmlFor="file">
              Archivo (PDF, JPG, PNG — máx 10 MB)
              {isEditing && document?.fileName && (
                <span className="text-muted-foreground ml-2">
                  Actual: {document.fileName}
                </span>
              )}
            </Label>
            <Input
              id="file"
              name="file"
              type="file"
              accept=".pdf,.jpg,.jpeg,.png,.webp"
              key={`file-${document?.id ?? 'new'}`}
              disabled={isLoading}
            />
          </div>

          {/* Notas */}
          <div className="space-y-2">
            <Label htmlFor="notes">Notas</Label>
            <Input
              id="notes"
              name="notes"
              placeholder="Notas adicionales (opcional)"
              defaultValue={document?.notes ?? ''}
              key={`notes-${document?.id ?? 'new'}`}
              disabled={isLoading}
            />
          </div>

          {/* Botones */}
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={onClose} disabled={isLoading}>
              Cancelar
            </Button>
            <Button type="submit" disabled={isLoading}>
              {isLoading ? 'Guardando...' : isEditing ? 'Guardar cambios' : 'Agregar'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}