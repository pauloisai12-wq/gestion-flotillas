'use client';

import { useState } from 'react';
import {
  useFuelLoads,
  useReviewFuelLoad,
  useReconcileLegacyFuelLoad,
  type FuelLoad,
  type LegacyFuelBudgetEffect,
  type LegacyFuelOdometerEffect,
} from '@/hooks/useFuelLoads';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import DataTable from '@/components/ui/data-table';
import FuelLoadFormDialog from '@/components/Fuel/FuelLoadFormDialog';
import { formatCurrency, formatDate, formatNumber } from '@/lib/formatters';
import { type ColumnDef } from '@tanstack/react-table';

function buildColumns(
  onReview: (load: FuelLoad, decision: 'APPROVE' | 'REJECT') => void,
  onReconcile: (load: FuelLoad) => void,
  isAdmin: boolean,
): ColumnDef<FuelLoad, unknown>[] {
  return [
  {
    accessorKey: 'loadDate',
    header: 'Fecha',
    cell: ({ row }) => formatDate(row.original.loadDate),
  },
  {
    id: 'vehicle',
    header: 'Vehículo',
    accessorFn: (row) => row.vehicle?.economicNumber ?? '',
    cell: ({ row }) => <span className="font-medium">{row.original.vehicle.economicNumber}</span>,
  },
  {
    id: 'operator',
    header: 'Operador',
    accessorFn: (row) => row.operator?.fullName || row.operatorNameRaw || row.operatorEmployeeRaw || '',
    cell: ({ row }) => row.original.operator?.fullName || row.original.operatorNameRaw || row.original.operatorEmployeeRaw || '—',
  },
  {
    id: 'station',
    header: 'Gasolinera',
    accessorFn: (row) => row.station?.tradeName || row.station?.legalName || '',
    cell: ({ row }) => row.original.station.tradeName || row.original.station.legalName,
  },
  {
    accessorKey: 'liters',
    header: 'Litros',
    cell: ({ row }) => <span className="text-right block font-mono tabular-nums">{row.original.liters?.toFixed(1) ?? '—'}</span>,
  },
  {
    accessorKey: 'amount',
    header: 'Monto',
    cell: ({ row }) => (
      <span className="text-right block font-mono tabular-nums">
        {formatCurrency(row.original.amount, { minimumFractionDigits: 2 })}
      </span>
    ),
  },
  {
    accessorKey: 'odometer',
    header: 'Odómetro',
    cell: ({ row }) => (
      <span className="text-right block font-mono tabular-nums">
        {row.original.odometerStatus === 'NF' ? 'NF' : formatNumber(row.original.odometer) + ' km'}
      </span>
    ),
  },
  {
    accessorKey: 'kmPerLiter',
    header: 'km/l',
    cell: ({ row }) => {
      const kml = row.original.kmPerLiter;
      if (!kml) return <span className="text-right block">-</span>;
      const expected = row.original.vehicle.vehicleType?.expectedKmPerLiter || 0;
      const isLow = kml < expected * 0.8;
      return (
        <span className={'text-right block font-medium ' + (isLow ? 'text-destructive' : 'text-success')}>
          {kml.toFixed(1)}
        </span>
      );
    },
  },
    {
      accessorKey: 'status',
      header: 'Estado',
      cell: ({ row }) => {
        const status = row.original.status;
        if (status === 'APPROVED') return <Badge className="bg-success text-white">Aprobada</Badge>;
        if (status === 'REJECTED') return <Badge variant="destructive">Rechazada</Badge>;
        return <Badge variant="secondary">Pendiente</Badge>;
      },
    },
    {
      id: 'reviewActions',
      header: 'Revisión',
      enableSorting: false,
      cell: ({ row }) => {
        const load = row.original;
        if (load.status !== 'PENDING_REVIEW') {
          return load.reviewReason ? (
            <span className="text-xs text-muted-foreground" title={load.reviewReason}>
              Revisada
            </span>
          ) : null;
        }
        if (load.requiresReconciliation) {
          return isAdmin ? (
            <Button size="sm" variant="outline" onClick={() => onReconcile(load)}>
              Reconciliar
            </Button>
          ) : (
            <Badge variant="outline">Reconciliación ADMIN</Badge>
          );
        }
        return (
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => onReview(load, 'APPROVE')}>
              Aprobar
            </Button>
            <Button size="sm" variant="destructive" onClick={() => onReview(load, 'REJECT')}>
              Rechazar
            </Button>
          </div>
        );
      },
    },
  ];
}

export default function FuelPage() {
  const { user } = useAuth();
  const [page, setPage] = useState(1);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [status, setStatus] = useState<FuelLoad['status'] | ''>('');
  const [review, setReview] = useState<{
    load: FuelLoad;
    decision: 'APPROVE' | 'REJECT';
  } | null>(null);
  const [reviewReason, setReviewReason] = useState('');
  const [reviewError, setReviewError] = useState('');
  const reviewMutation = useReviewFuelLoad();
  const [reconciliation, setReconciliation] = useState<{
    load: FuelLoad;
    decision: 'APPROVE' | 'REJECT';
    budgetEffect: LegacyFuelBudgetEffect;
    odometerEffect: LegacyFuelOdometerEffect;
    correctedOdometer: string;
    reason: string;
  } | null>(null);
  const [reconciliationError, setReconciliationError] = useState('');
  const reconciliationMutation = useReconcileLegacyFuelLoad();

  const { data, isLoading, isError, refetch } = useFuelLoads({
    page,
    limit: 20,
    status: status || undefined,
    dateFrom: dateFrom || undefined,
    dateTo: dateTo || undefined,
  });

  const columns = buildColumns(
    (load, decision) => {
      reviewMutation.reset();
      setReviewError('');
      setReviewReason('');
      setReview({ load, decision });
    },
    (load) => {
      reconciliationMutation.reset();
      setReconciliationError('');
      setReconciliation({
        load,
        decision: 'APPROVE',
        budgetEffect: 'NOT_APPLIED',
        odometerEffect: 'NOT_APPLIED',
        correctedOdometer: '',
        reason: '',
      });
    },
    user?.role === 'ADMIN',
  );

  async function submitReview() {
    if (!review) return;
    if (reviewReason.trim().length < 5) {
      setReviewError('Escriba un motivo de al menos 5 caracteres.');
      return;
    }
    setReviewError('');
    try {
      await reviewMutation.mutateAsync({
        id: review.load.id,
        decision: review.decision,
        reason: reviewReason.trim(),
      });
      setReview(null);
      setReviewReason('');
    } catch (error: unknown) {
      const apiError = error as { response?: { data?: { error?: string } } };
      setReviewError(apiError.response?.data?.error ?? 'No se pudo completar la revisión.');
    }
  }

  async function submitReconciliation() {
    if (!reconciliation) return;
    if (reconciliation.reason.trim().length < 5) {
      setReconciliationError('Escriba un motivo de al menos 5 caracteres.');
      return;
    }

    const correctionRequired =
      reconciliation.decision === 'REJECT' && reconciliation.odometerEffect === 'APPLIED';
    let correctedOdometer: number | undefined;
    if (correctionRequired) {
      correctedOdometer = Number(reconciliation.correctedOdometer);
      if (
        reconciliation.correctedOdometer.trim() === '' ||
        !Number.isFinite(correctedOdometer) ||
        correctedOdometer < 0
      ) {
        setReconciliationError('Capture un odómetro corregido válido.');
        return;
      }
    }

    setReconciliationError('');
    try {
      await reconciliationMutation.mutateAsync({
        id: reconciliation.load.id,
        decision: reconciliation.decision,
        budgetEffect: reconciliation.budgetEffect,
        odometerEffect: reconciliation.odometerEffect,
        ...(correctedOdometer != null ? { correctedOdometer } : {}),
        reason: reconciliation.reason.trim(),
      });
      setReconciliation(null);
    } catch (error: unknown) {
      const apiError = error as { response?: { data?: { error?: string } } };
      setReconciliationError(
        apiError.response?.data?.error ?? 'No se pudo completar la reconciliación.',
      );
    }
  }

  return (
    <div className="p-4 sm:p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Cargas de Combustible</h1>
          <p className="text-sm text-muted-foreground">{data?.pagination?.total || 0} cargas registradas</p>
        </div>
      </div>

      {/* Filtros de fecha */}
      <div className="flex flex-wrap gap-2 items-end">
        <div>
          <label htmlFor="fuel-date-from" className="block text-xs text-muted-foreground">Desde</label>
          <Input id="fuel-date-from" type="date" value={dateFrom} onChange={function (e) { setDateFrom(e.target.value); setPage(1); }} />
        </div>
        <div>
          <label htmlFor="fuel-date-to" className="block text-xs text-muted-foreground">Hasta</label>
          <Input id="fuel-date-to" type="date" value={dateTo} onChange={function (e) { setDateTo(e.target.value); setPage(1); }} />
        </div>
        <div>
          <label htmlFor="fuel-status-filter" className="text-xs text-muted-foreground">Estado</label>
          <select
            id="fuel-status-filter"
            className="block h-11 rounded-md border border-input bg-background px-3 text-sm sm:h-9"
            value={status}
            onChange={(event) => {
              setStatus(event.target.value as FuelLoad['status'] | '');
              setPage(1);
            }}
          >
            <option value="">Todos</option>
            <option value="PENDING_REVIEW">Pendientes</option>
            <option value="APPROVED">Aprobadas</option>
            <option value="REJECTED">Rechazadas</option>
          </select>
        </div>
        {(dateFrom || dateTo || status) && (
          <Button variant="outline" size="sm" onClick={function () { setDateFrom(''); setDateTo(''); setStatus(''); setPage(1); }}>Limpiar</Button>
        )}
      </div>

      <DataTable
        columns={columns}
        data={data?.data || []}
        pagination={data?.pagination}
        page={page}
        onPageChange={setPage}
        isLoading={isLoading}
        error={isError ? 'No fue posible obtener las cargas de combustible.' : null}
        onRetry={() => void refetch()}
        emptyTitle="No hay cargas con estos filtros"
        emptyDescription="Ajusta las fechas o el estado, o registra una nueva carga."
        headerActions={
          <Button onClick={function () { setDialogOpen(true); }}>+ Nueva carga</Button>
        }
      />

      <FuelLoadFormDialog open={dialogOpen} onClose={function () { setDialogOpen(false); }} />

      <Dialog open={review != null} onOpenChange={(open) => !open && setReview(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {review?.decision === 'APPROVE' ? 'Aprobar carga' : 'Rechazar carga'}
            </DialogTitle>
            <DialogDescription>
              Carga #{review?.load.id} · vehículo {review?.load.vehicle.economicNumber} ·{' '}
              {review ? formatCurrency(review.load.amount) : ''}.
              {review?.decision === 'APPROVE'
                ? ' La aprobación aplicará presupuesto y odómetro en una sola transacción.'
                : ' El rechazo conservará la captura como evidencia sin aplicar efectos.'}
            </DialogDescription>
          </DialogHeader>
          <div>
            <label htmlFor="fuel-review-reason" className="text-sm font-medium">
              Motivo de la decisión
            </label>
            <textarea
              id="fuel-review-reason"
              value={reviewReason}
              onChange={(event) => setReviewReason(event.target.value)}
              rows={4}
              maxLength={500}
              disabled={reviewMutation.isPending}
              className="mt-2 w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
            />
          </div>
          {reviewError && (
            <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {reviewError}
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setReview(null)} disabled={reviewMutation.isPending}>
              Cancelar
            </Button>
            <Button
              variant={review?.decision === 'REJECT' ? 'destructive' : 'default'}
              onClick={() => void submitReview()}
              disabled={reviewMutation.isPending}
            >
              {reviewMutation.isPending ? 'Procesando…' : 'Confirmar decisión'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={reconciliation != null}
        onOpenChange={(open) => !open && setReconciliation(null)}
      >
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Reconciliar carga histórica</DialogTitle>
            <DialogDescription>
              Carga #{reconciliation?.load.id} · vehículo{' '}
              {reconciliation?.load.vehicle.economicNumber}. Verifique en los registros si la captura
              ya afectó presupuesto y odómetro antes de confirmar.
            </DialogDescription>
          </DialogHeader>

          {reconciliation && (
            <div className="space-y-4">
              <div>
                <label htmlFor="fuel-reconciliation-decision" className="text-sm font-medium">
                  Decisión final
                </label>
                <select
                  id="fuel-reconciliation-decision"
                  className="mt-2 block h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                  value={reconciliation.decision}
                  disabled={reconciliationMutation.isPending}
                  onChange={(event) =>
                    setReconciliation((current) =>
                      current
                        ? { ...current, decision: event.target.value as 'APPROVE' | 'REJECT' }
                        : current,
                    )
                  }
                >
                  <option value="APPROVE">Aprobar la carga</option>
                  <option value="REJECT">Rechazar la carga</option>
                </select>
              </div>

              <div>
                <label htmlFor="fuel-reconciliation-budget" className="text-sm font-medium">
                  Efecto histórico en presupuesto
                </label>
                <select
                  id="fuel-reconciliation-budget"
                  className="mt-2 block h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                  value={reconciliation.budgetEffect}
                  disabled={reconciliationMutation.isPending}
                  onChange={(event) =>
                    setReconciliation((current) =>
                      current
                        ? { ...current, budgetEffect: event.target.value as LegacyFuelBudgetEffect }
                        : current,
                    )
                  }
                >
                  <option value="NOT_APPLIED">No se descontó</option>
                  <option value="APPLIED">Ya se descontó</option>
                  <option value="NO_BUDGET">No existía presupuesto</option>
                </select>
              </div>

              <div>
                <label htmlFor="fuel-reconciliation-odometer" className="text-sm font-medium">
                  Efecto histórico en odómetro
                </label>
                <select
                  id="fuel-reconciliation-odometer"
                  className="mt-2 block h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                  value={reconciliation.odometerEffect}
                  disabled={reconciliationMutation.isPending}
                  onChange={(event) =>
                    setReconciliation((current) =>
                      current
                        ? { ...current, odometerEffect: event.target.value as LegacyFuelOdometerEffect }
                        : current,
                    )
                  }
                >
                  <option value="NOT_APPLIED">No se aplicó</option>
                  <option value="APPLIED">Ya se aplicó</option>
                </select>
              </div>

              {reconciliation.decision === 'REJECT' &&
                reconciliation.odometerEffect === 'APPLIED' && (
                  <div>
                    <label htmlFor="fuel-reconciliation-corrected-odometer" className="text-sm font-medium">
                      Odómetro maestro corregido
                    </label>
                    <Input
                      id="fuel-reconciliation-corrected-odometer"
                      type="number"
                      min="0"
                      step="0.1"
                      value={reconciliation.correctedOdometer}
                      disabled={reconciliationMutation.isPending}
                      onChange={(event) =>
                        setReconciliation((current) =>
                          current ? { ...current, correctedOdometer: event.target.value } : current,
                        )
                      }
                    />
                    <p className="mt-1 text-xs text-muted-foreground">
                      Se aplicará atómicamente y no puede quedar debajo de otra lectura aprobada.
                    </p>
                  </div>
                )}

              <div>
                <label htmlFor="fuel-reconciliation-reason" className="text-sm font-medium">
                  Evidencia y motivo
                </label>
                <textarea
                  id="fuel-reconciliation-reason"
                  rows={4}
                  maxLength={500}
                  className="mt-2 w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                  value={reconciliation.reason}
                  disabled={reconciliationMutation.isPending}
                  onChange={(event) =>
                    setReconciliation((current) =>
                      current ? { ...current, reason: event.target.value } : current,
                    )
                  }
                />
              </div>
            </div>
          )}

          {reconciliationError && (
            <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {reconciliationError}
            </p>
          )}

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setReconciliation(null)}
              disabled={reconciliationMutation.isPending}
            >
              Cancelar
            </Button>
            <Button
              onClick={() => void submitReconciliation()}
              disabled={reconciliationMutation.isPending}
            >
              {reconciliationMutation.isPending ? 'Reconciliando…' : 'Confirmar reconciliación'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
