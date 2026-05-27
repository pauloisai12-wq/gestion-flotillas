'use client';

import { useState, useEffect } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  useCreateStation, useUpdateStation, Station, StationInput,
} from '@/hooks/useStations';
import { AlertTriangle } from 'lucide-react';

interface Props {
  open: boolean;
  onClose: () => void;
  station?: Station | null;
}

const rfcRegex = /^[A-ZÑ&]{3,4}\d{6}[A-Z\d]{3}$/;

export default function StationFormDialog({ open, onClose, station }: Props) {
  const createMutation = useCreateStation();
  const updateMutation = useUpdateStation();
  const isEditing = !!station;
  const isLoading = createMutation.isPending || updateMutation.isPending;

  const [rfc, setRfc] = useState('');
  const [legalName, setLegalName] = useState('');
  const [tradeName, setTradeName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [error, setError] = useState('');

  // Poblar al editar
  useEffect(() => {
    if (station) {
      setRfc(station.rfc ?? '');
      setLegalName(station.legalName ?? '');
      setTradeName(station.tradeName ?? '');
      setEmail(station.email ?? '');
      setPhone(station.phone ?? '');
      setAddress(station.address ?? '');
    } else {
      setRfc(''); setLegalName(''); setTradeName('');
      setEmail(''); setPhone(''); setAddress('');
    }
    setError('');
  }, [station, open]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');

    const rfcUp = rfc.trim().toUpperCase();
    if (!rfcRegex.test(rfcUp)) { setError('RFC inválido (formato MX: 3-4 letras + 6 dígitos + 3 alfanuméricos)'); return; }
    if (legalName.trim().length < 3) { setError('Razón social requerida'); return; }
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) { setError('Correo inválido'); return; }
    if (!/^\d{7,15}$/.test(phone.trim())) { setError('Teléfono inválido (7-15 dígitos)'); return; }
    if (address.trim().length < 5) { setError('Dirección requerida'); return; }

    const input: StationInput = {
      rfc: rfcUp,
      legalName: legalName.trim(),
      tradeName: tradeName.trim() || null,
      email: email.trim(),
      phone: phone.trim(),
      address: address.trim(),
    };

    try {
      if (isEditing && station) {
        await updateMutation.mutateAsync({ id: station.id, input });
      } else {
        await createMutation.mutateAsync(input);
      }
      onClose();
    } catch (err: unknown) {
      const error = err as { response?: { data?: { error?: string } } };
      setError(error.response?.data?.error || 'Error al guardar');
    }
  }

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEditing ? 'Editar gasolinera' : 'Nueva gasolinera'}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground block mb-1.5">
                RFC *
              </label>
              <Input
                value={rfc}
                onChange={(e) => setRfc(e.target.value.toUpperCase())}
                placeholder="ABC100101XYZ"
                maxLength={13}
                required
                disabled={isLoading}
                className="font-mono"
              />
            </div>
            <div>
              <label className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground block mb-1.5">
                Nombre comercial (opcional)
              </label>
              <Input
                value={tradeName}
                onChange={(e) => setTradeName(e.target.value)}
                placeholder="Gasolinera del Norte"
                disabled={isLoading}
              />
            </div>
          </div>

          <div>
            <label className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground block mb-1.5">
              Razón social *
            </label>
            <Input
              value={legalName}
              onChange={(e) => setLegalName(e.target.value)}
              placeholder="Gasolinera del Norte S.A. de C.V."
              required
              disabled={isLoading}
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground block mb-1.5">
                Correo *
              </label>
              <Input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="facturacion@gasolinera.mx"
                required
                disabled={isLoading}
              />
            </div>
            <div>
              <label className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground block mb-1.5">
                Teléfono *
              </label>
              <Input
                value={phone}
                onChange={(e) => setPhone(e.target.value.replace(/\D/g, ''))}
                placeholder="5512345678"
                maxLength={15}
                required
                disabled={isLoading}
                className="font-mono"
              />
            </div>
          </div>

          <div>
            <label className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground block mb-1.5">
              Dirección *
            </label>
            <textarea
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="Av. Insurgentes 123, Col. Centro, CDMX"
              required
              disabled={isLoading}
              className="min-h-16 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40 resize-none"
              maxLength={300}
            />
          </div>

          {error && (
            <div className="flex items-start gap-2 rounded-md bg-destructive/10 border border-destructive/20 text-destructive px-3 py-2 text-sm">
              <AlertTriangle className="size-4 mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}

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
