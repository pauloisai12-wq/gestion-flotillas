// Acciones del taller GANADOR: iniciar reparación y completarla.
// El backend valida que el usuario sea del taller con quote ganadora.

'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useStartRepair, useCompleteRepair } from '@/hooks/useMaintenanceTickets';
import { useServiceCatalog } from '@/hooks/useMaintenance';
import { formatNumber } from '@/lib/formatters';
import { Wrench, CheckCircle2, AlertCircle, Loader2, PackageCheck } from 'lucide-react';

export function StartRepairButton({ ticketId }: { ticketId: number }) {
  const start = useStartRepair();
  const error = start.error as { response?: { data?: { error?: string } } } | null;

  return (
    <div className="border border-border rounded-lg p-4 bg-card space-y-3">
      <div>
        <h3 className="font-semibold text-sm flex items-center gap-1.5">
          <Wrench className="size-4" /> Reparación aprobada
        </h3>
        <p className="text-xs text-muted-foreground mt-1">
          Cuando empieces los trabajos, marca el inicio para que admin y ejecutor sepan que está en proceso.
        </p>
      </div>

      {error?.response?.data?.error && (
        <div className="text-xs text-rose-600 dark:text-rose-400 flex items-center gap-1.5">
          <AlertCircle className="size-3.5" />
          {error.response.data.error}
        </div>
      )}

      <Button
        className="w-full"
        onClick={() => start.mutate(ticketId)}
        disabled={start.isPending}
      >
        {start.isPending ? (
          <>
            <Loader2 className="size-4 mr-1.5 animate-spin" /> Iniciando…
          </>
        ) : (
          <>
            <Wrench className="size-4 mr-1.5" /> Iniciar reparación
          </>
        )}
      </Button>
    </div>
  );
}

export function CompleteRepairForm({
  ticketId,
  vehicleTypeId,
}: {
  ticketId: number;
  vehicleTypeId: number;
}) {
  const complete = useCompleteRepair();
  const { data: services, isLoading: servicesLoading } = useServiceCatalog(vehicleTypeId);

  const [serviceId, setServiceId] = useState<number | ''>('');
  const [finalOdometer, setFinalOdometer] = useState('');
  const [odometerStatus, setOdometerStatus] = useState<'OK' | 'NF'>('OK');
  const [evidenceNotes, setEvidenceNotes] = useState('');

  const error = complete.error as { response?: { data?: { error?: string } } } | null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!serviceId) return;
    try {
      await complete.mutateAsync({
        ticketId,
        serviceId: Number(serviceId),
        finalOdometer: odometerStatus === 'NF' ? null : finalOdometer ? Number(finalOdometer) : null,
        finalOdometerStatus: odometerStatus,
        evidenceNotes: evidenceNotes.trim() || undefined,
      });
    } catch {
      /* mostrado abajo */
    }
  }

  return (
    <form onSubmit={submit} className="border border-border rounded-lg p-4 bg-card space-y-3">
      <div>
        <h3 className="font-semibold text-sm flex items-center gap-1.5">
          <PackageCheck className="size-4" /> Finalizar reparación
        </h3>
        <p className="text-xs text-muted-foreground mt-1">
          Indica el servicio que aplicaste y opcionalmente el odómetro final. Quedará registrado en el historial del vehículo.
        </p>
      </div>

      <div>
        <label className="block text-sm font-medium mb-1">Tipo de servicio aplicado</label>
        {servicesLoading ? (
          <div className="text-xs text-muted-foreground flex items-center gap-1.5">
            <Loader2 className="size-3 animate-spin" /> Cargando catálogo…
          </div>
        ) : (services?.length ?? 0) === 0 ? (
          <div className="text-xs text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 rounded-md p-2">
            No hay servicios catalogados para este tipo de vehículo. Contacta al admin.
          </div>
        ) : (
          <select
            value={serviceId}
            onChange={(e) => setServiceId(e.target.value ? Number(e.target.value) : '')}
            required
            className="w-full px-3 py-2 text-sm border border-input rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-ring"
          >
            <option value="">— Selecciona —</option>
            {(services ?? []).map((s) => (
              <option key={s.id} value={s.id}>
                {s.serviceName} {s.intervalKm ? `· cada ${formatNumber(s.intervalKm)} km` : ''}
              </option>
            ))}
          </select>
        )}
      </div>

      <div>
        <label className="block text-sm font-medium mb-1">Odómetro final</label>
        <div className="flex gap-2 mb-1.5">
          <button
            type="button"
            onClick={() => setOdometerStatus('OK')}
            className={`text-xs px-3 py-1 rounded-full border transition-colors ${
              odometerStatus === 'OK'
                ? 'bg-primary text-primary-foreground border-primary'
                : 'border-border text-muted-foreground'
            }`}
          >
            Funcional
          </button>
          <button
            type="button"
            onClick={() => setOdometerStatus('NF')}
            className={`text-xs px-3 py-1 rounded-full border transition-colors ${
              odometerStatus === 'NF'
                ? 'bg-primary text-primary-foreground border-primary'
                : 'border-border text-muted-foreground'
            }`}
          >
            No funciona
          </button>
        </div>
        {odometerStatus === 'OK' && (
          <Input
            type="number"
            min={0}
            step={1}
            value={finalOdometer}
            onChange={(e) => setFinalOdometer(e.target.value)}
            placeholder="Km al cierre (opcional)"
          />
        )}
      </div>

      <div>
        <label className="block text-sm font-medium mb-1">Notas de cierre (opcional)</label>
        <textarea
          value={evidenceNotes}
          onChange={(e) => setEvidenceNotes(e.target.value)}
          rows={2}
          maxLength={1000}
          placeholder="Ej: Balatas Ferodo instaladas, discos rectificados."
          className="w-full px-3 py-2 text-sm border border-input rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-ring resize-y"
        />
      </div>

      {error?.response?.data?.error && (
        <div className="text-xs text-rose-600 dark:text-rose-400 flex items-start gap-1.5">
          <AlertCircle className="size-3.5 mt-0.5" />
          {error.response.data.error}
        </div>
      )}

      <Button type="submit" disabled={!serviceId || complete.isPending} className="w-full">
        {complete.isPending ? (
          <>
            <Loader2 className="size-4 mr-1.5 animate-spin" /> Finalizando…
          </>
        ) : (
          <>
            <CheckCircle2 className="size-4 mr-1.5" /> Marcar como completado
          </>
        )}
      </Button>
    </form>
  );
}
