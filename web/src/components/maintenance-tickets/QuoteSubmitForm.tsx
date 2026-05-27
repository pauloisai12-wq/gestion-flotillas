// Form para que el taller suba su cotización: monto + PDF + notas de diagnóstico.

'use client';

import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useSubmitQuote } from '@/hooks/useMaintenanceTickets';
import { FileText, AlertCircle, Loader2 } from 'lucide-react';

export function QuoteSubmitForm({
  quoteId,
  onSuccess,
}: {
  quoteId: number;
  onSuccess?: () => void;
}) {
  const submit = useSubmitQuote();
  const fileRef = useRef<HTMLInputElement>(null);
  const [amount, setAmount] = useState('');
  const [diagnosisNotes, setDiagnosisNotes] = useState('');
  const [pdf, setPdf] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const amt = Number(amount);
    if (!amt || amt <= 0) {
      setError('Ingresa un monto válido');
      return;
    }
    if (!pdf) {
      setError('Adjunta el PDF de la cotización');
      return;
    }
    if (pdf.type !== 'application/pdf') {
      setError('El archivo debe ser PDF');
      return;
    }
    if (pdf.size > 10 * 1024 * 1024) {
      setError('El PDF debe pesar máximo 10MB');
      return;
    }

    try {
      await submit.mutateAsync({ quoteId, amount: amt, diagnosisNotes: diagnosisNotes.trim() || undefined, pdf });
      onSuccess?.();
    } catch (err) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setError(msg ?? 'No se pudo enviar la cotización');
    }
  }

  return (
    <form onSubmit={handleSubmit} className="border border-border rounded-lg p-4 bg-card space-y-3">
      <div>
        <h3 className="font-semibold text-sm">Enviar cotización</h3>
        <p className="text-xs text-muted-foreground mt-0.5">
          Sube tu propuesta económica con PDF. Los detalles llegan al admin que decidirá.
        </p>
      </div>

      <div>
        <label className="block text-sm font-medium mb-1">Monto total (MXN)</label>
        <Input
          type="number"
          step="0.01"
          min="0.01"
          required
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="Ej: 2750.00"
        />
      </div>

      <div>
        <label className="block text-sm font-medium mb-1">Notas de diagnóstico (opcional)</label>
        <textarea
          value={diagnosisNotes}
          onChange={(e) => setDiagnosisNotes(e.target.value)}
          rows={2}
          maxLength={2000}
          placeholder="Ej: Cambio de balatas + rectificado de discos."
          className="w-full px-3 py-2 text-sm border border-input rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-ring resize-y"
        />
      </div>

      <div>
        <label className="block text-sm font-medium mb-1">PDF de cotización</label>
        <input
          ref={fileRef}
          type="file"
          accept="application/pdf,.pdf"
          required
          onChange={(e) => setPdf(e.target.files?.[0] ?? null)}
          className="hidden"
        />
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className="w-full flex items-center gap-2 px-3 py-2 border border-dashed border-input rounded-md text-sm hover:border-primary transition-colors"
        >
          <FileText className="size-4 text-muted-foreground" />
          {pdf ? (
            <span className="truncate">{pdf.name} ({(pdf.size / 1024).toFixed(0)} KB)</span>
          ) : (
            <span className="text-muted-foreground">Adjuntar PDF (máx 10MB)</span>
          )}
        </button>
      </div>

      {error && (
        <div className="text-xs text-rose-600 dark:text-rose-400 flex items-center gap-1.5">
          <AlertCircle className="size-3.5" />
          {error}
        </div>
      )}

      <Button type="submit" disabled={submit.isPending} className="w-full">
        {submit.isPending ? (
          <>
            <Loader2 className="size-4 mr-1.5 animate-spin" />
            Enviando…
          </>
        ) : (
          'Enviar cotización'
        )}
      </Button>
    </form>
  );
}
