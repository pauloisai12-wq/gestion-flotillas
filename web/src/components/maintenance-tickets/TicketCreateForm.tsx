// Formulario del ejecutor — crear ticket.
// El dropdown solo lista vehículos de los que es responsable (filtro server-side).

'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { useVehicles } from '@/hooks/useVehicles';
import {
  useCreateTicket,
  useUploadAttachment,
  CATEGORY_LABELS,
  type FailureCategory,
} from '@/hooks/useMaintenanceTickets';
import { PhotoUploader } from './PhotoUploader';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { AlertCircle, Loader2 } from 'lucide-react';

export function TicketCreateForm({ initialVehicleId }: { initialVehicleId?: number } = {}) {
  const router = useRouter();
  const { user } = useAuth();
  const create = useCreateTicket();
  const upload = useUploadAttachment();

  const { data: vehiclesResp, isLoading: vehiclesLoading } = useVehicles({
    executorId: user?.id,
    limit: 100,
  });

  const [vehicleId, setVehicleId] = useState<number | ''>(initialVehicleId ?? '');
  const [category, setCategory] = useState<FailureCategory>('OTHER');
  const [description, setDescription] = useState('');
  const [reportedOdometer, setReportedOdometer] = useState('');
  const [photos, setPhotos] = useState<File[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!vehicleId || description.trim().length < 10) return;
    setSubmitting(true);
    setSubmitError(null);

    let ticketId: number;
    try {
      const ticket = await create.mutateAsync({
        vehicleId: Number(vehicleId),
        failureCategory: category,
        description: description.trim(),
        reportedOdometer: reportedOdometer ? Number(reportedOdometer) : null,
      });
      ticketId = ticket.id;
    } catch (err) {
      // Falló la CREACIÓN del ticket: es seguro reintentar (no se creó nada).
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setSubmitError(msg ?? 'Error inesperado. Intenta de nuevo.');
      setSubmitting(false);
      return;
    }

    // El ticket YA existe. Las fotos son best-effort: si una falla NO se debe
    // permitir recrear el ticket (sería un duplicado). Navegamos al detalle,
    // donde el ejecutor puede completar las fotos faltantes.
    try {
      for (const f of photos) {
        await upload.mutateAsync({ ticketId, file: f });
      }
    } catch {
      // Ignorado a propósito: el ticket existe; las fotos se reintentan en el detalle.
    }
    router.push(`/tickets/${ticketId}`);
  }

  const noVehicles = !vehiclesLoading && (vehiclesResp?.data.length ?? 0) === 0;
  // Si llegó preseleccionado desde la flotilla, lo fijamos hasta que pulse "Cambiar".
  const fixedVehicle =
    initialVehicleId != null && vehicleId === initialVehicleId
      ? vehiclesResp?.data.find((v) => v.id === initialVehicleId)
      : undefined;

  return (
    <form onSubmit={submit} className="max-w-2xl space-y-5">
      {/* Vehículo */}
      <div>
        <label htmlFor="ticket-vehicle" className="block text-sm font-medium mb-1.5">Vehículo</label>
        {vehiclesLoading ? (
          <div className="text-sm text-muted-foreground flex items-center gap-2">
            <Loader2 className="size-3.5 animate-spin" /> Cargando…
          </div>
        ) : noVehicles ? (
          <div className="text-sm text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 rounded-md p-3">
            No tienes vehículos asignados. Contacta al administrador.
          </div>
        ) : fixedVehicle ? (
          <div className="flex items-center justify-between gap-3 rounded-md border border-border bg-muted/40 px-3 py-2.5">
            <div className="min-w-0">
              <div className="font-semibold text-sm truncate">{fixedVehicle.economicNumber}</div>
              <div className="text-xs text-muted-foreground truncate">
                {fixedVehicle.brand} {fixedVehicle.model} {fixedVehicle.year} · {fixedVehicle.plate}
              </div>
            </div>
            <button
              type="button"
              onClick={() => setVehicleId('')}
              className="text-xs text-primary hover:underline shrink-0"
            >
              Cambiar
            </button>
          </div>
        ) : (
          <select
            id="ticket-vehicle"
            value={vehicleId}
            onChange={(e) => setVehicleId(e.target.value ? Number(e.target.value) : '')}
            required
            className="min-h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          >
            <option value="">— Selecciona —</option>
            {(vehiclesResp?.data ?? []).map((v) => (
              <option key={v.id} value={v.id}>
                {v.economicNumber} · {v.plate} · {v.brand} {v.model}
              </option>
            ))}
          </select>
        )}
      </div>

      {/* Categoría */}
      <fieldset aria-describedby="ticket-category-help">
        <legend className="block text-sm font-medium mb-1.5">¿Qué tipo de problema?</legend>
        <p id="ticket-category-help" className="text-xs text-muted-foreground mb-2">
          Selecciona la categoría más cercana. Si no estás seguro, deja &ldquo;Otro&rdquo;.
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
          {(Object.keys(CATEGORY_LABELS) as FailureCategory[]).map((cat) => (
            <button
              key={cat}
              type="button"
              onClick={() => setCategory(cat)}
              aria-pressed={category === cat}
              className={`min-h-11 rounded-md border px-3 py-2 text-xs transition-colors ${
                category === cat
                  ? 'border-primary bg-primary-subtle/40 text-foreground font-medium'
                  : 'border-border text-muted-foreground hover:border-primary/60'
              }`}
            >
              {CATEGORY_LABELS[cat]}
            </button>
          ))}
        </div>
      </fieldset>

      {/* Descripción */}
      <div>
        <label htmlFor="ticket-description" className="block text-sm font-medium mb-1.5">Descripción del problema</label>
        <p id="ticket-description-help" className="text-xs text-muted-foreground mb-2">
          Cuenta con tus palabras qué pasa. Sé específico (ej: &ldquo;chillan los frenos al frenar a baja velocidad&rdquo;).
        </p>
        <textarea
          id="ticket-description"
          aria-describedby="ticket-description-help ticket-description-count"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={4}
          minLength={10}
          maxLength={2000}
          required
          placeholder="Describe el problema..."
          className="w-full px-3 py-2 text-sm border border-input rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-ring resize-y"
        />
        <p id="ticket-description-count" className="text-[11px] text-muted-foreground mt-1">
          Mínimo 10 caracteres. {description.length}/2000
        </p>
      </div>

      {/* Odómetro */}
      <div>
        <label htmlFor="ticket-odometer" className="block text-sm font-medium mb-1.5">Kilometraje actual (opcional)</label>
        <Input
          id="ticket-odometer"
          type="number"
          min={0}
          step={1}
          value={reportedOdometer}
          onChange={(e) => setReportedOdometer(e.target.value)}
          placeholder="Ej: 45230"
        />
      </div>

      {/* Fotos */}
      <div>
        <p className="block text-sm font-medium mb-1.5">Fotos (opcional)</p>
        <p className="text-xs text-muted-foreground mb-2">
          Sube hasta 5 fotos. Ayudan al taller a evaluar antes de cotizar.
        </p>
        <PhotoUploader mode="collect" files={photos} onFilesChange={setPhotos} />
      </div>

      {submitError && (
        <div role="alert" className="text-sm text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-900 rounded-md p-3 flex items-start gap-2">
          <AlertCircle className="size-4 mt-0.5 shrink-0" />
          {submitError}
        </div>
      )}

      <div className="flex flex-wrap justify-end gap-2 pt-2">
        <Button type="button" variant="ghost" onClick={() => router.back()} disabled={submitting}>
          Cancelar
        </Button>
        <Button type="submit" disabled={!vehicleId || description.trim().length < 10 || submitting || noVehicles}>
          {submitting ? (
            <>
              <Loader2 className="size-4 mr-1.5 animate-spin" />
              Enviando…
            </>
          ) : (
            'Enviar solicitud'
          )}
        </Button>
      </div>
    </form>
  );
}
