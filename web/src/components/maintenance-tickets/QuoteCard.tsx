// Tarjeta de cotización individual — usada en el detalle de ticket.
// Difiere de BudgetVsQuotesCard en que aquí mostramos el PDF descargable + notas.

import { FileText, Download, Award, MinusCircle, Clock } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { TicketQuote } from '@/hooks/useMaintenanceTickets';

function fmtCurrency(n: number): string {
  return n.toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });
}

export function QuoteCard({
  quote,
  apiBase,
  highlight = false,
}: {
  quote: TicketQuote;
  apiBase?: string;
  highlight?: boolean;
}) {
  const isSubmitted = !!quote.submittedAt && !!quote.amount;
  const isDeclined = !!quote.declinedAt;
  const isPending = !isSubmitted && !isDeclined;

  return (
    <div
      className={cn(
        'border rounded-md p-3 bg-card relative',
        highlight || quote.isWinner
          ? 'border-emerald-500 ring-1 ring-emerald-500/40'
          : 'border-border',
      )}
    >
      {quote.isWinner && (
        <div className="absolute -top-2 -right-2 bg-emerald-500 text-white text-[10px] font-bold uppercase px-2 py-0.5 rounded-full flex items-center gap-1">
          <Award className="size-3" /> Ganadora
        </div>
      )}

      <div className="font-medium text-sm mb-2 line-clamp-2 min-h-[2.5rem]">
        {quote.workshop?.legalName ?? `Workshop ${quote.workshopId}`}
      </div>

      {isSubmitted && (
        <>
          <div className="text-xl font-bold tabular-nums mb-1">{fmtCurrency(Number(quote.amount))}</div>
          {quote.diagnosisNotes && (
            <p className="text-xs text-muted-foreground line-clamp-3 mb-2">{quote.diagnosisNotes}</p>
          )}
          {quote.pdfUrl && (
            <a
              href={apiBase ? `${apiBase}${quote.pdfUrl}` : quote.pdfUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-xs text-primary hover:underline"
            >
              <FileText className="size-3.5" />
              {quote.pdfFileName ?? 'cotizacion.pdf'}
              <Download className="size-3" />
            </a>
          )}
          <div className="text-[10px] text-muted-foreground mt-2">
            Enviada{' '}
            {new Date(quote.submittedAt!).toLocaleString('es-MX', {
              dateStyle: 'short',
              timeStyle: 'short',
            })}
          </div>
        </>
      )}

      {isDeclined && (
        <div className="text-sm text-muted-foreground space-y-1">
          <div className="inline-flex items-center gap-1.5">
            <MinusCircle className="size-3.5" /> Declinó
          </div>
          {quote.declineReason && (
            <p className="text-xs italic">"{quote.declineReason}"</p>
          )}
        </div>
      )}

      {isPending && (
        <div className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
          <Clock className="size-3.5 animate-pulse" /> Esperando cotización…
        </div>
      )}
    </div>
  );
}
