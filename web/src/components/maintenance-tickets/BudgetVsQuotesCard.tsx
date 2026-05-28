// ★ Visualización principal del Admin al decidir aprobar una reparación.
//
// Estructura:
//   ┌─────────────────────────────────────────────────────┐
//   │  Presupuesto mantto · ECO-0001 · Mayo 2026          │
//   │  Disponible $4,017.65 ───────────── █████████░░░    │
//   │  Asignado $5,000  ·  Rollover $0  ·  Gastado $982   │
//   ├─────────────────────────────────────────────────────┤
//   │  Cotizaciones                                       │
//   │  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐    │
//   │  │ Taller 1    │ │ Taller 2 ★  │ │ Taller 3 ⚠  │    │
//   │  │ $3,200      │ │ $2,750      │ │ $4,100      │    │
//   │  │ ✓ Entra     │ │ ✓ Entra     │ │ ✗ Excede    │    │
//   │  │ ◯ Elegir    │ │ ● Elegir    │ │ ◯ Elegir    │    │
//   │  └─────────────┘ └─────────────┘ └─────────────┘    │
//   └─────────────────────────────────────────────────────┘
//
// El admin elige una con radio buttons; ApprovePanel toma el selectedQuoteId.

'use client';

import { Check, X, FileText, AlertTriangle, Loader2, MinusCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { BudgetContext } from '@/hooks/useMaintenanceTickets';

interface Props {
  context: BudgetContext;
  selectedQuoteId: number | null;
  onSelect: (quoteId: number) => void;
}

function fmtCurrency(n: number): string {
  return n.toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });
}

export function BudgetVsQuotesCard({ context, selectedQuoteId, onSelect }: Props) {
  const { budget, quotes } = context;

  // ── Calcular el meter del presupuesto ──
  const totalPool = budget ? budget.baseAmount + budget.rolloverIn : 0;
  const spentPct = totalPool > 0 && budget ? (budget.spentAmount / totalPool) * 100 : 0;

  return (
    <div className="border border-border rounded-lg overflow-hidden bg-card">
      {/* ─── Bloque presupuesto ──────────────────────────────── */}
      <div className="p-4 border-b border-border bg-muted/30">
        <div className="flex items-baseline justify-between mb-2">
          <div>
            <div className="text-xs uppercase tracking-wider text-muted-foreground">
              Presupuesto mantenimiento
            </div>
            <div className="font-semibold mt-0.5">
              {context.ticket.vehicle.economicNumber} ·{' '}
              <span className="text-muted-foreground font-normal text-sm">
                {new Date().toLocaleDateString('es-MX', { month: 'long', year: 'numeric' })}
              </span>
            </div>
          </div>
          {budget ? (
            <div className="text-right">
              <div className="text-xs text-muted-foreground">Disponible</div>
              <div
                className={cn(
                  'text-2xl font-bold tabular-nums',
                  budget.available <= 0
                    ? 'text-rose-600 dark:text-rose-400'
                    : 'text-emerald-600 dark:text-emerald-400',
                )}
              >
                {fmtCurrency(budget.available)}
              </div>
            </div>
          ) : (
            <span className="inline-flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-400 font-medium">
              <AlertTriangle className="size-3.5" />
              Sin presupuesto asignado
            </span>
          )}
        </div>

        {budget && (
          <>
            {/* Barra de gastado vs disponible */}
            <div className="h-2 rounded-full bg-muted overflow-hidden flex" role="img" aria-label={`Gastado ${spentPct.toFixed(0)}% del presupuesto`}>
              <div
                className={cn(
                  'transition-all',
                  spentPct >= 100 ? 'bg-rose-500' : spentPct >= 80 ? 'bg-amber-500' : 'bg-emerald-500',
                )}
                style={{ width: `${Math.min(100, spentPct)}%` }}
              />
            </div>

            <div className="flex justify-between text-[11px] text-muted-foreground mt-1.5 tabular-nums">
              <span>
                Asignado <span className="font-medium text-foreground">{fmtCurrency(budget.baseAmount)}</span>
              </span>
              <span>
                Rollover <span className="font-medium text-foreground">{fmtCurrency(budget.rolloverIn)}</span>
              </span>
              <span>
                Gastado <span className="font-medium text-foreground">{fmtCurrency(budget.spentAmount)}</span>
              </span>
            </div>

            {budget.isCutOff && (
              <div className="mt-2 text-xs text-rose-600 dark:text-rose-400 flex items-center gap-1.5">
                <AlertTriangle className="size-3.5" />
                Presupuesto del mes agotado — aprobaciones futuras requieren reasignación.
              </div>
            )}
          </>
        )}
      </div>

      {/* ─── Bloque cotizaciones ─────────────────────────────── */}
      <div className="p-4">
        <div className="text-xs uppercase tracking-wider text-muted-foreground mb-3">
          Cotizaciones recibidas
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {quotes.map((q) => {
            const isSelected = selectedQuoteId === q.id;
            const isSubmitted = q.status === 'SUBMITTED' && q.amount != null;
            const isDeclined = q.status === 'DECLINED';
            const fitsBudget = q.fits === true;

            // Estados de selección
            const selectable = isSubmitted && fitsBudget;

            return (
              <button
                key={q.id}
                type="button"
                onClick={() => selectable && onSelect(q.id)}
                disabled={!selectable}
                className={cn(
                  'text-left border-2 rounded-md p-3 transition-all relative',
                  isSelected
                    ? 'border-primary bg-primary-subtle/40 ring-1 ring-primary'
                    : selectable
                      ? 'border-border hover:border-primary/60 cursor-pointer bg-card'
                      : 'border-border opacity-60 cursor-not-allowed bg-muted/20',
                )}
                aria-pressed={isSelected}
              >
                {/* Radio visual en esquina */}
                <div
                  className={cn(
                    'absolute top-2.5 right-2.5 size-4 rounded-full border-2 flex items-center justify-center',
                    isSelected ? 'border-primary bg-primary' : 'border-border',
                  )}
                >
                  {isSelected && <Check className="size-2.5 text-primary-foreground" />}
                </div>

                {/* Nombre del taller */}
                <div className="font-medium text-sm pr-6 line-clamp-2 mb-2 min-h-[2.5rem]">{q.workshop}</div>

                {/* Monto grande */}
                {isSubmitted ? (
                  <div
                    className={cn(
                      'text-2xl font-bold tabular-nums mb-2',
                      !fitsBudget && 'text-rose-600 dark:text-rose-400',
                    )}
                  >
                    {fmtCurrency(Number(q.amount))}
                  </div>
                ) : (
                  <div className="text-sm text-muted-foreground mb-2 inline-flex items-center gap-1.5">
                    {isDeclined ? (
                      <>
                        <MinusCircle className="size-3.5" />
                        Declinó cotizar
                      </>
                    ) : (
                      <>
                        <Loader2 className="size-3.5 animate-spin" />
                        Esperando…
                      </>
                    )}
                  </div>
                )}

                {/* Indicador presupuestal */}
                {isSubmitted && (
                  <div
                    className={cn(
                      'inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full',
                      fitsBudget
                        ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                        : 'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300',
                    )}
                  >
                    {fitsBudget ? (
                      <>
                        <Check className="size-3" /> Entra
                      </>
                    ) : (
                      <>
                        <X className="size-3" />
                        Excede en {fmtCurrency(Number(q.amount) - (budget?.available ?? 0))}
                      </>
                    )}
                  </div>
                )}

                {/* Link al PDF — buscamos en la lista completa porque budget context no trae pdfUrl */}
                {isSubmitted && (
                  <div className="mt-2">
                    <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                      <FileText className="size-3" /> PDF de cotización disponible en el detalle
                    </span>
                  </div>
                )}
              </button>
            );
          })}
        </div>

        {/* Ayuda */}
        {budget && quotes.some((q) => q.status === 'SUBMITTED' && q.fits === false) && (
          <p className="text-xs text-muted-foreground mt-3 leading-relaxed">
            ⚠ Las cotizaciones que exceden el presupuesto disponible no se pueden seleccionar. Si todas exceden,
            aumenta el presupuesto del mes desde <span className="font-medium">Presupuesto mantto.</span> o rechaza el ticket.
          </p>
        )}
      </div>
    </div>
  );
}
