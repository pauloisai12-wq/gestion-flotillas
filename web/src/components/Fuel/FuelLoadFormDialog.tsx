'use client';

import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useCreateFuelLoad, FuelLoadInput } from '@/hooks/useFuelLoads';
import { useVehicles } from '@/hooks/useVehicles';
import { useStations } from '@/hooks/useStations';
import { AlertTriangle } from 'lucide-react';

export default function FuelLoadFormDialog({
  open, onClose,
}: { open: boolean; onClose: () => void }) {
  const createMutation = useCreateFuelLoad();
  const vehiclesQuery = useVehicles({ limit: 100 });
  const stationsQuery = useStations();

  const vehicles = vehiclesQuery.data?.data || [];
  const stations = stationsQuery.data || [];

  // Form state controlado (antes era uncontrolled con FormData)
  const [vehicleId, setVehicleId] = useState<string>('');
  const [operatorEmployee, setOperatorEmployee] = useState('');
  const [operatorName, setOperatorName] = useState('');
  const [stationId, setStationId] = useState<string>('');
  const [liters, setLiters] = useState('');
  const [amount, setAmount] = useState('');
  const [odometer, setOdometer] = useState('');
  const [odometerNF, setOdometerNF] = useState(false);
  const [loadDate, setLoadDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [error, setError] = useState('');

  const isLoading = createMutation.isPending;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');

    const input: FuelLoadInput = {
      vehicleId: Number(vehicleId),
      operatorEmployee: operatorEmployee.trim(),
      operatorName: operatorName.trim(),
      stationId: Number(stationId),
      liters: liters ? Number(liters) : null,
      amount: Number(amount),
      odometerStatus: odometerNF ? 'NF' : 'OK',
      odometer: odometerNF ? null : Number(odometer),
      loadDate,
    };

    if (!input.vehicleId) { setError('Seleccione un vehículo'); return; }
    if (!input.operatorEmployee) { setError('No. de empleado del operador es obligatorio'); return; }
    if (!input.operatorName) { setError('Nombre del operador es obligatorio'); return; }
    if (!input.stationId) { setError('Seleccione una gasolinera'); return; }
    if (!input.amount || input.amount <= 0) { setError('Monto debe ser mayor a 0'); return; }
    if (!odometerNF && (!odometer || Number(odometer) < 0)) { setError('Odómetro requerido o marque NF'); return; }

    try {
      await createMutation.mutateAsync(input);
      // Reset form
      setVehicleId(''); setOperatorEmployee(''); setOperatorName('');
      setStationId(''); setLiters(''); setAmount(''); setOdometer(''); setOdometerNF(false);
      onClose();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      setError(e.response?.data?.error || (err as Error).message);
    }
  }

  const selectClass = "h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40";
  const labelClass = "text-[10px] font-medium uppercase tracking-wider text-muted-foreground block mb-1.5";

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Nueva carga de combustible</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className={labelClass}>Vehículo *</label>
            <select value={vehicleId} onChange={(e) => setVehicleId(e.target.value)} required disabled={isLoading} className={selectClass}>
              <option value="">Seleccionar…</option>
              {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
              {vehicles.map((v: any) => (
                <option key={v.id} value={v.id}>{v.economicNumber} · {v.plate}</option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className={labelClass}>No. empleado operador *</label>
              <Input
                value={operatorEmployee}
                onChange={(e) => setOperatorEmployee(e.target.value.toUpperCase())}
                placeholder="EMP-00001"
                required
                disabled={isLoading}
                className="font-mono"
              />
            </div>
            <div>
              <label className={labelClass}>Nombre del operador *</label>
              <Input
                value={operatorName}
                onChange={(e) => setOperatorName(e.target.value)}
                placeholder="Nombre libre"
                required
                disabled={isLoading}
              />
            </div>
          </div>

          <div>
            <label className={labelClass}>Gasolinera *</label>
            <select value={stationId} onChange={(e) => setStationId(e.target.value)} required disabled={isLoading} className={selectClass}>
              <option value="">Seleccionar…</option>
              {stations.map((s) => (
                <option key={s.id} value={s.id}>{s.tradeName || s.legalName}{s.isActive ? '' : ' (INACTIVA)'}</option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelClass}>Litros (opcional)</label>
              <Input type="number" step="0.01" min="0" value={liters} onChange={(e) => setLiters(e.target.value)} disabled={isLoading} className="font-mono tabular-nums" />
            </div>
            <div>
              <label className={labelClass}>Monto *</label>
              <Input type="number" step="0.01" min="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} required disabled={isLoading} className="font-mono tabular-nums" />
            </div>
          </div>

          <div>
            <label className="flex items-center justify-between mb-1.5">
              <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Odómetro</span>
              <label className="flex items-center gap-1.5 text-xs cursor-pointer">
                <input
                  type="checkbox"
                  checked={odometerNF}
                  onChange={(e) => { setOdometerNF(e.target.checked); if (e.target.checked) setOdometer(''); }}
                  className="accent-primary"
                />
                <span>NF (no funciona)</span>
              </label>
            </label>
            <Input
              type="number" min="0"
              value={odometerNF ? '' : odometer}
              onChange={(e) => setOdometer(e.target.value)}
              disabled={odometerNF || isLoading}
              required={!odometerNF}
              placeholder={odometerNF ? 'N/A — marcado NF' : 'km actuales'}
              className="font-mono tabular-nums"
            />
          </div>

          <div>
            <label className={labelClass}>Fecha</label>
            <Input type="date" value={loadDate} onChange={(e) => setLoadDate(e.target.value)} disabled={isLoading} />
          </div>

          {error && (
            <div className="flex items-start gap-2 rounded-md bg-destructive/10 border border-destructive/20 text-destructive px-3 py-2 text-sm">
              <AlertTriangle className="size-4 mt-0.5 shrink-0" /><span>{error}</span>
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={onClose} disabled={isLoading}>Cancelar</Button>
            <Button type="submit" disabled={isLoading}>{isLoading ? 'Guardando…' : 'Registrar carga'}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
