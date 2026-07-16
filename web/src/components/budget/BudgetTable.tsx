// Tabla reutilizable para ver/editar presupuestos (FUEL o MAINTENANCE) del mes actual

'use client';

import { useDeferredValue, useEffect, useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { PageHeader } from '@/components/ui/page-header';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { SkeletonTable } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/empty-state';
import { KpiCard } from '@/components/ui/kpi-card';
import { Wallet, TrendingUp, Search, Save, X, Zap } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { toast } from '@/components/ui/toast';
import { formatCurrency, formatDate } from '@/lib/formatters';
import api, { getApiError } from '@/lib/api';
import { businessPeriodForDate } from '@/lib/businessTime';

type VehicleClassification = 'POLICIAL' | 'ESTATAL' | 'VIAL';
type MassMode = 'ALL' | 'UNASSIGNED' | 'CLASSIFICATION';

interface Budget {
  id: number;
  vehicleId: number;
  baseAmount: number;
  rolloverIn: number;
  spentAmount: number;
  available: number;
  isCutOff: boolean;
  vehicle: {
    id: number;
    plate: string;
    economicNumber: string;
    classification: VehicleClassification;
  };
}

interface PoolInfo {
  totalPool: number;
  assigned: number;
  rollover: number;
  spent: number;
  unassigned: number;
  pctAssigned: number;
  unitsCount: number;
  notes: string | null;
  hasPool: boolean;
}

interface DistributionTargetCounts {
  all: number;
  unassigned: number;
  byClassification: Record<VehicleClassification, number>;
}

interface DistributionResult {
  count: number;
  totalAmount: number;
}

interface BudgetPagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

interface BudgetListResponse {
  data: Budget[];
  pagination: BudgetPagination;
}

export interface BudgetTableProps {
  kind: 'FUEL' | 'MAINTENANCE';
  title: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
}

export function BudgetTable({ kind, title, description, icon: Icon }: BudgetTableProps) {
  const currentPeriod = businessPeriodForDate();
  const [year, setYear] = useState(currentPeriod.year);
  const [month, setMonth] = useState(currentPeriod.month);
  const [search, setSearch] = useState('');
  const deferredSearch = useDeferredValue(search.trim());
  const [page, setPage] = useState(1);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editValue, setEditValue] = useState('');
  const [massOpen, setMassOpen] = useState(false);
  const [massAmount, setMassAmount] = useState('');
  const [massMode, setMassMode] = useState<MassMode>('ALL');
  const [massClassification, setMassClassification] = useState<VehicleClassification>('ESTATAL');
  const [massDistribution, setMassDistribution] = useState<'TOTAL' | 'PER_UNIT'>('TOTAL');
  const [massError, setMassError] = useState('');
  const qc = useQueryClient();

  const {
    data: budgetResponse,
    isLoading,
    isFetching,
    isError,
    refetch,
  } = useQuery<BudgetListResponse>({
    queryKey: ['budgets', kind, year, month, page, deferredSearch],
    queryFn: async () => {
      const res = await api.get('/budgets', {
        params: {
          kind,
          year,
          month,
          page,
          limit: 50,
          search: deferredSearch || undefined,
        },
      });
      const data = (res.data.data as Budget[]) || [];
      return {
        data,
        pagination: res.data.pagination || {
          page: 1,
          limit: data.length || 50,
          total: data.length,
          totalPages: data.length > 0 ? 1 : 0,
        },
      };
    },
    // Conserva la página anterior solo dentro del mismo periodo. Reutilizar
    // filas de otro mes permite editar una unidad vieja usando year/month del
    // periodo nuevo mientras llega la respuesta.
    placeholderData: (previous, previousQuery) => {
      const previousKey = previousQuery?.queryKey;
      return previousKey?.[1] === kind
        && previousKey?.[2] === year
        && previousKey?.[3] === month
        ? previous
        : undefined;
    },
  });
  const budgets = budgetResponse?.data;
  const pagination = budgetResponse?.pagination;

  useEffect(() => {
    if (pagination && pagination.totalPages > 0 && page > pagination.totalPages) {
      setPage(pagination.totalPages);
    }
  }, [page, pagination]);

  // Pote mensual total declarado por el admin
  const { data: pool } = useQuery<PoolInfo>({
    queryKey: ['budgets', 'pool', kind, year, month],
    queryFn: async () => {
      const res = await api.get('/budgets/monthly-pool', { params: { kind, year, month } });
      return res.data.data as PoolInfo;
    },
  });

  const { data: targetCounts, isLoading: targetCountsLoading } = useQuery<DistributionTargetCounts>({
    queryKey: ['budgets', 'distribution-targets', kind, year, month],
    queryFn: async () => {
      const res = await api.get('/budgets/distribution-targets', {
        params: { kind, year, month },
      });
      return res.data.data as DistributionTargetCounts;
    },
  });

  const targetCount = useMemo(() => {
    if (!targetCounts) return 0;
    if (massMode === 'ALL') return targetCounts.all;
    if (massMode === 'UNASSIGNED') return targetCounts.unassigned;
    return targetCounts.byClassification[massClassification];
  }, [massClassification, massMode, targetCounts]);

  const [poolOpen, setPoolOpen] = useState(false);
  const [poolAmount, setPoolAmount] = useState('');
  const [poolNotes, setPoolNotes] = useState('');
  const [poolError, setPoolError] = useState('');

  const poolMut = useMutation({
    mutationFn: async () => {
      const res = await api.put('/budgets/monthly-pool', {
        kind, year, month, totalAmount: Number(poolAmount), notes: poolNotes || null,
      });
      return res.data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['budgets', 'pool', kind, year, month] });
      setPoolOpen(false);
    },
  });

  function openPoolDialog() {
    setPoolAmount(pool?.totalPool ? String(pool.totalPool) : '');
    setPoolNotes(pool?.notes ?? '');
    setPoolError('');
    setPoolOpen(true);
  }

  async function savePool(e: React.FormEvent) {
    e.preventDefault();
    setPoolError('');
    const amt = Number(poolAmount);
    if (!Number.isFinite(amt) || amt < 0) { setPoolError('Monto inválido'); return; }
    try { await poolMut.mutateAsync(); }
    catch (err) {
      const e = err as { response?: { data?: { message?: string; error?: string } } };
      setPoolError(e.response?.data?.message || e.response?.data?.error || 'Error');
    }
  }

  const updateMut = useMutation({
    mutationFn: async ({ vehicleId, baseAmount }: { vehicleId: number; baseAmount: number }) => {
      const res = await api.post('/budgets/assign', { vehicleId, kind, year, month, baseAmount });
      return res.data;
    },
    onSuccess: () => {
      // Invalida listas + pote mensual (['budgets', 'pool', …]) y el progreso del dashboard
      qc.invalidateQueries({ queryKey: ['budgets'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });

  const distributeMut = useMutation<DistributionResult, unknown, {
    target: { mode: 'ALL' | 'UNASSIGNED' } | { mode: 'CLASSIFICATION'; classification: VehicleClassification };
    allocation: { mode: 'TOTAL' | 'PER_UNIT'; amount: number };
  }>({
    mutationFn: async (payload) => {
      const res = await api.post('/budgets/distribute-target', { kind, year, month, ...payload });
      return res.data.data as DistributionResult;
    },
    onSuccess: (result) => {
      // Invalida listas + pote mensual (['budgets', 'pool', …]) y el progreso del dashboard
      qc.invalidateQueries({ queryKey: ['budgets'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      toast.success(`Presupuesto asignado a ${result.count} vehículos`);
      setMassOpen(false);
      setMassAmount('');
    },
  });

  async function handleMassAssign(e: React.FormEvent) {
    e.preventDefault();
    setMassError('');
    const amount = Number(massAmount);
    if (!Number.isFinite(amount) || amount < 0) {
      setMassError('Ingresa un monto válido');
      return;
    }
    if (targetCountsLoading) {
      setMassError('Espera a que termine de calcularse el universo de vehículos.');
      return;
    }
    if (targetCount === 0) {
      setMassError(
        massMode === 'UNASSIGNED'
          ? 'Todos los vehículos ya tienen presupuesto para este periodo.'
          : 'No hay vehículos activos para el criterio seleccionado.',
      );
      return;
    }

    try {
      await distributeMut.mutateAsync({
        target: massMode === 'CLASSIFICATION'
          ? { mode: massMode, classification: massClassification }
          : { mode: massMode },
        allocation: { mode: massDistribution, amount },
      });
    } catch (err: unknown) {
      const apiError = getApiError(err);
      setMassError(apiError.data?.message || apiError.data?.error || 'No se pudo asignar el presupuesto');
    }
  }

  const stats = useMemo(() => {
    if ((!budgets || budgets.length === 0) && !pool) return null;
    const pageTotals = (budgets ?? []).reduce((acc: { base: number; rollover: number; spent: number; cutOff: number; warning: number }, b: Budget) => {
      const total = b.baseAmount + b.rolloverIn;
      const pct = total > 0 ? (b.spentAmount / total) : 0;
      return {
        base: acc.base + b.baseAmount,
        rollover: acc.rollover + b.rolloverIn,
        spent: acc.spent + b.spentAmount,
        cutOff: acc.cutOff + (b.isCutOff ? 1 : 0),
        warning: acc.warning + (pct >= 0.8 && !b.isCutOff ? 1 : 0),
      };
    }, { base: 0, rollover: 0, spent: 0, cutOff: 0, warning: 0 });
    return {
      base: pool?.assigned ?? pageTotals.base,
      rollover: pool?.rollover ?? pageTotals.rollover,
      spent: pool?.spent ?? pageTotals.spent,
      units: pool?.unitsCount ?? budgets?.length ?? 0,
      cutOff: pageTotals.cutOff,
      warning: pageTotals.warning,
    };
  }, [budgets, pool]);

  const filtered = budgets ?? [];

  function startEdit(b: Budget) {
    setEditingId(b.id);
    setEditValue(String(b.baseAmount));
  }

  async function saveEdit(vehicleId: number) {
    const value = Number(editValue);
    if (!Number.isFinite(value) || value < 0) return;
    try {
      await updateMut.mutateAsync({ vehicleId, baseAmount: value });
      setEditingId(null);
      setEditValue('');
    } catch (error: unknown) {
      const apiError = getApiError(error);
      toast.error(apiError.data?.error || 'No se pudo actualizar el presupuesto');
    }
  }

  const monthName = formatDate(new Date(year, month - 1), { month: 'long', year: 'numeric' });
  const pct = stats && (stats.base + stats.rollover) > 0
    ? Math.round((stats.spent / (stats.base + stats.rollover)) * 100)
    : 0;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={title}
        description={description}
        actions={
          <Button onClick={() => { setMassOpen(true); setMassError(''); }}>
            <Zap className="size-4" /> Asignar a todos
          </Button>
        }
      />

      {/* ═══ POTE MENSUAL TOTAL ═══ */}
      <Card className="border-primary/30 ring-1 ring-primary/10">
        <CardContent className="p-5">
          {pool?.hasPool ? (
            <div className="space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-[10px] font-medium uppercase tracking-wider text-primary">
                    Presupuesto del mes · {monthName}
                  </div>
                  <div className="flex items-baseline gap-2 mt-1">
                    <span className="font-mono text-3xl font-semibold tabular-nums text-foreground">
                      {formatCurrency(pool.totalPool)}
                    </span>
                    <span className="text-sm text-muted-foreground">pote total</span>
                  </div>
                  {pool.notes && (
                    <p className="text-xs text-muted-foreground mt-1 italic">{pool.notes}</p>
                  )}
                </div>
                <Button variant="outline" size="sm" onClick={openPoolDialog}>
                  Editar pote
                </Button>
              </div>

              {/* Barra de progreso con 3 segmentos: asignado, sin asignar, gastado */}
              <div className="space-y-2">
                <div className="h-2.5 rounded-full bg-muted overflow-hidden flex">
                  <div
                    className="bg-primary transition-all"
                    style={{ width: `${pool.pctAssigned}%` }}
                    title={`Asignado: ${formatCurrency(pool.assigned)}`}
                  />
                </div>
                <div className="grid grid-cols-3 gap-3 pt-2">
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Asignado</div>
                    <div className="font-mono text-sm font-semibold tabular-nums text-primary">
                      {formatCurrency(pool.assigned)}
                    </div>
                    <div className="text-[10px] text-muted-foreground">
                      {pool.pctAssigned}% del pote · {pool.unitsCount} unidades
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Sin asignar</div>
                    <div className={`font-mono text-sm font-semibold tabular-nums ${pool.unassigned > 0 ? 'text-warning' : 'text-success'}`}>
                      {formatCurrency(pool.unassigned)}
                    </div>
                    <div className="text-[10px] text-muted-foreground">
                      {pool.unassigned > 0 ? 'Pendiente de repartir' : 'Todo repartido'}
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Gastado</div>
                    <div className="font-mono text-sm font-semibold tabular-nums text-foreground">
                      {formatCurrency(pool.spent)}
                    </div>
                    <div className="text-[10px] text-muted-foreground">
                      + {formatCurrency(pool.rollover)} rollover
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-between gap-4">
              <div>
                <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                  Presupuesto del mes · {monthName}
                </div>
                <div className="text-sm text-foreground mt-1">
                  Aún no has declarado el pote total para este mes.
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Al declararlo, el sistema validará que las asignaciones por vehículo no excedan ese total.
                </p>
              </div>
              <Button onClick={openPoolDialog}>
                <Wallet className="size-4" /> Declarar pote
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Barra de periodo — separada del header para que no se aprete */}
      <div className="flex flex-wrap items-center gap-2 rounded-md bg-muted/30 border border-border/50 px-3 py-2">
        <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Periodo:</span>
        <select
          aria-label="Mes del presupuesto"
          value={month} onChange={(e) => {
            setMonth(Number(e.target.value));
            setPage(1);
            setEditingId(null);
            setEditValue('');
          }}
          className="h-8 rounded-md border border-input bg-card px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
        >
          {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
            <option key={m} value={m}>
              {formatDate(new Date(2000, m - 1), { month: 'long' })}
            </option>
          ))}
        </select>
        <select
          aria-label="Año del presupuesto"
          value={year} onChange={(e) => {
            setYear(Number(e.target.value));
            setPage(1);
            setEditingId(null);
            setEditValue('');
          }}
          className="h-8 rounded-md border border-input bg-card px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
        >
          {[currentPeriod.year - 1, currentPeriod.year, currentPeriod.year + 1].map((y) => (
            <option key={y} value={y}>{y}</option>
          ))}
        </select>
        <span className="text-xs text-muted-foreground ml-auto">{monthName}</span>
      </div>

      {/* KPIs */}
      <section className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard
          label={`Asignado ${monthName}`}
          value={'$' + ((stats?.base ?? 0) / 1000).toFixed(0)}
          unit="k MXN"
          hint={`${stats?.units ?? 0} unidades`}
          icon={Icon}
        />
        <KpiCard
          label="Rollover aplicado"
          value={'$' + ((stats?.rollover ?? 0) / 1000).toFixed(1)}
          unit="k MXN"
          hint="mes anterior"
          icon={TrendingUp}
        />
        <KpiCard
          label="Gastado"
          value={'$' + ((stats?.spent ?? 0) / 1000).toFixed(1)}
          unit="k MXN"
          hint={pct + '% del total'}
          icon={Wallet}
        />
        <KpiCard
          label="Cortados / Al límite"
          value={`${stats?.cutOff ?? 0} / ${stats?.warning ?? 0}`}
          hint={pagination && pagination.totalPages > 1 ? 'en esta página' : 'unidades'}
          icon={Wallet}
          delta={(stats?.cutOff ?? 0) > 0 ? { value: String(stats?.cutOff), trend: 'up', meaning: 'bad' } : undefined}
        />
      </section>

      {/* Tabla */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-2">
            <CardTitle>Asignación por unidad</CardTitle>
            <div className="relative w-64">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
              <Input
                aria-label="Buscar unidad por número económico o placa"
                value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(1); }}
                placeholder="Buscar unidad…"
                className="pl-8"
              />
            </div>
          </div>
          {isFetching && !isLoading ? (
            <p className="text-xs text-muted-foreground" role="status" aria-live="polite">
              Actualizando resultados…
            </p>
          ) : null}
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <SkeletonTable rows={8} cols={6} />
          ) : isError ? (
            <EmptyState
              icon={Icon}
              title="No se pudieron cargar los presupuestos"
              description="Revisa tu conexión e intenta nuevamente."
              action={<Button type="button" onClick={() => refetch()}>Reintentar</Button>}
            />
          ) : filtered.length === 0 ? (
            <EmptyState
              icon={Icon}
              title={deferredSearch ? 'Sin coincidencias' : 'Sin presupuestos para este periodo'}
              description={deferredSearch
                ? `No hay unidades que coincidan con “${deferredSearch}”.`
                : `No hay registros de ${kind === 'FUEL' ? 'combustible' : 'mantenimiento'} para ${monthName}.`}
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Unidad</TableHead>
                  <TableHead className="text-right">Base</TableHead>
                  <TableHead className="text-right">Rollover</TableHead>
                  <TableHead className="text-right">Gastado</TableHead>
                  <TableHead className="text-right">Disponible</TableHead>
                  <TableHead>Uso</TableHead>
                  <TableHead className="text-right">Acción</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((b: Budget) => {
                  const total = b.baseAmount + b.rolloverIn;
                  const usage = total > 0 ? Math.round((b.spentAmount / total) * 100) : 0;
                  return (
                    <TableRow key={b.id}>
                      <TableCell className="font-mono font-medium">
                        {b.vehicle?.economicNumber}
                        <span className="text-muted-foreground"> · {b.vehicle?.plate}</span>
                      </TableCell>
                      <TableCell className="text-right font-mono tabular-nums">
                        {editingId === b.id ? (
                          <Input
                            aria-label={`Monto base de la unidad ${b.vehicle?.economicNumber}`}
                            type="number" step="0.01" min="0"
                            value={editValue}
                            onChange={(e) => setEditValue(e.target.value)}
                            className="w-28 ml-auto font-mono tabular-nums text-right"
                            autoFocus
                          />
                        ) : (
                          formatCurrency(b.baseAmount)
                        )}
                      </TableCell>
                      <TableCell className="text-right font-mono tabular-nums text-muted-foreground">
                        {b.rolloverIn > 0 ? '+' + formatCurrency(b.rolloverIn) : '—'}
                      </TableCell>
                      <TableCell className="text-right font-mono tabular-nums">
                        {formatCurrency(b.spentAmount)}
                      </TableCell>
                      <TableCell className={`text-right font-mono tabular-nums font-semibold ${b.available < 0 ? 'text-destructive' : ''}`}>
                        {formatCurrency(b.available)}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden min-w-16">
                            <div
                              className={`h-full rounded-full ${usage >= 100 ? 'bg-destructive' : usage >= 80 ? 'bg-warning' : 'bg-primary'}`}
                              style={{ width: `${Math.min(100, usage)}%` }}
                            />
                          </div>
                          <span className={`text-xs font-mono tabular-nums ${usage >= 100 ? 'text-destructive' : usage >= 80 ? 'text-warning' : 'text-muted-foreground'}`}>
                            {usage}%
                          </span>
                        </div>
                        {b.isCutOff && <Badge variant="blocked" className="mt-1 text-[10px]">Corte</Badge>}
                      </TableCell>
                      <TableCell className="text-right">
                        {editingId === b.id ? (
                          <div className="flex items-center justify-end gap-1">
                            <Button
                              size="icon-xs"
                              variant="ghost"
                              aria-label={`Cancelar edición de ${b.vehicle?.economicNumber}`}
                              onClick={() => { setEditingId(null); setEditValue(''); }}
                            >
                              <X className="size-3" />
                            </Button>
                            <Button
                              size="icon-xs"
                              aria-label={`Guardar presupuesto de ${b.vehicle?.economicNumber}`}
                              onClick={() => saveEdit(b.vehicleId)}
                              disabled={updateMut.isPending}
                            >
                              <Save className="size-3" />
                            </Button>
                          </div>
                        ) : (
                          <Button size="xs" variant="ghost" onClick={() => startEdit(b)}>
                            Editar base
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
          {pagination && pagination.totalPages > 1 ? (
            <nav
              className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t pt-4"
              aria-label="Paginación de presupuestos"
            >
              <p className="text-sm text-muted-foreground" aria-live="polite">
                Página {pagination.page} de {pagination.totalPages} · {pagination.total} unidades
              </p>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  disabled={pagination.page <= 1 || isFetching}
                  onClick={() => setPage((current) => Math.max(1, current - 1))}
                >
                  Anterior
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  disabled={pagination.page >= pagination.totalPages || isFetching}
                  onClick={() => setPage((current) => current + 1)}
                >
                  Siguiente
                </Button>
              </div>
            </nav>
          ) : null}
        </CardContent>
      </Card>

      {/* Dialog: asignación masiva */}
      <Dialog open={massOpen} onOpenChange={(o) => !o && setMassOpen(false)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Asignar presupuesto · {monthName}</DialogTitle>
            <DialogDescription className="sr-only">
              Selecciona el universo de vehículos, el método de distribución y el monto.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleMassAssign} className="space-y-4">
            <p className="text-sm text-muted-foreground">
              El rollover del mes anterior (si existe) se preserva automáticamente.
            </p>

            {/* 1. A quién */}
            <fieldset>
              <legend className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground block mb-2">
                1. A qué vehículos
              </legend>
              <div className="flex flex-col gap-2">
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input type="radio" name="massMode" checked={massMode === 'ALL'} onChange={() => setMassMode('ALL')} className="accent-primary" />
                  <span>Todos los vehículos activos <span className="text-muted-foreground">(sobreescribe)</span></span>
                </label>
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input type="radio" name="massMode" checked={massMode === 'UNASSIGNED'} onChange={() => setMassMode('UNASSIGNED')} className="accent-primary" />
                  <span>Solo sin presupuesto este mes</span>
                </label>
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input type="radio" name="massMode" checked={massMode === 'CLASSIFICATION'} onChange={() => setMassMode('CLASSIFICATION')} className="accent-primary" />
                  <span>Por clasificación</span>
                </label>
                {massMode === 'CLASSIFICATION' && (
                  <select
                    aria-label="Clasificación de vehículos"
                    value={massClassification}
                    onChange={(event) => setMassClassification(event.target.value as VehicleClassification)}
                    className="ml-5 flex h-9 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
                  >
                    <option value="POLICIAL">Policial</option>
                    <option value="ESTATAL">Estatal</option>
                    <option value="VIAL">Vial</option>
                  </select>
                )}
                <p className="ml-5 text-xs text-muted-foreground">
                  {targetCountsLoading
                    ? 'Calculando universo…'
                    : `${targetCount} vehículos activos seleccionados`}
                </p>
              </div>
            </fieldset>

            {/* 2. Modo de distribución */}
            <fieldset>
              <legend className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground block mb-2">
                2. Cómo distribuir
              </legend>
              <div className="grid grid-cols-2 gap-2">
                <label className={`flex flex-col gap-0.5 rounded-md border cursor-pointer p-2.5 transition-colors ${massDistribution === 'TOTAL' ? 'border-primary bg-primary-subtle' : 'border-input hover:bg-muted/50'}`}>
                  <div className="flex items-center gap-1.5">
                    <input type="radio" name="dist" checked={massDistribution === 'TOTAL'} onChange={() => setMassDistribution('TOTAL')} className="accent-primary" />
                    <span className="text-sm font-medium">Total del mes</span>
                  </div>
                  <span className="text-[11px] text-muted-foreground ml-5">Se divide equitativo</span>
                </label>
                <label className={`flex flex-col gap-0.5 rounded-md border cursor-pointer p-2.5 transition-colors ${massDistribution === 'PER_UNIT' ? 'border-primary bg-primary-subtle' : 'border-input hover:bg-muted/50'}`}>
                  <div className="flex items-center gap-1.5">
                    <input type="radio" name="dist" checked={massDistribution === 'PER_UNIT'} onChange={() => setMassDistribution('PER_UNIT')} className="accent-primary" />
                    <span className="text-sm font-medium">Por vehículo</span>
                  </div>
                  <span className="text-[11px] text-muted-foreground ml-5">Igual a cada uno</span>
                </label>
              </div>
            </fieldset>

            {/* 3. Monto */}
            <div>
              <label htmlFor="mass-budget-amount" className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground block mb-1.5">
                3. {massDistribution === 'TOTAL' ? 'Monto total del mes' : 'Monto por vehículo'} *
              </label>
              <Input
                id="mass-budget-amount"
                type="number" step="0.01" min="0"
                value={massAmount}
                onChange={(e) => setMassAmount(e.target.value)}
                placeholder={massDistribution === 'TOTAL' ? '500000' : '10000'}
                required
                className="font-mono tabular-nums"
                autoFocus
              />
              {massAmount && Number(massAmount) > 0 && (() => {
                if (targetCount === 0) return null;
                const amt = Number(massAmount);
                const perVeh = massDistribution === 'TOTAL' ? amt / targetCount : amt;
                const total = massDistribution === 'TOTAL' ? amt : amt * targetCount;
                return (
                  <div className="mt-2 rounded-md bg-primary-subtle border border-primary/20 px-3 py-2 text-xs space-y-0.5">
                    <div className="flex justify-between font-mono tabular-nums">
                      <span className="text-muted-foreground">Por vehículo:</span>
                      <span className="font-semibold">{formatCurrency(perVeh, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                    </div>
                    <div className="flex justify-between font-mono tabular-nums">
                      <span className="text-muted-foreground">Total ({targetCount} veh.):</span>
                      <span className="font-semibold">{formatCurrency(total, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                    </div>
                  </div>
                );
              })()}
            </div>

            {massError && (
              <div className="rounded-md bg-destructive/10 border border-destructive/20 text-destructive px-3 py-2 text-sm">
                {massError}
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={() => setMassOpen(false)} disabled={distributeMut.isPending}>
                Cancelar
              </Button>
              <Button type="submit" disabled={distributeMut.isPending || targetCountsLoading || targetCount === 0}>
                {distributeMut.isPending ? 'Asignando…' : 'Confirmar asignación'}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Dialog: declarar/editar pote total del mes */}
      <Dialog open={poolOpen} onOpenChange={(o) => !o && setPoolOpen(false)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {pool?.hasPool ? 'Editar pote mensual' : 'Declarar pote mensual'} · {monthName}
            </DialogTitle>
            <DialogDescription className="sr-only">
              Define el monto total disponible para el periodo seleccionado.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={savePool} className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Declara el presupuesto total del mes. Después lo distribuyes a las unidades de forma personalizada.
            </p>

            <div>
              <label htmlFor="monthly-pool-amount" className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground block mb-1.5">
                Monto total del mes *
              </label>
              <Input
                id="monthly-pool-amount"
                type="number" step="0.01" min="0"
                value={poolAmount}
                onChange={(e) => setPoolAmount(e.target.value)}
                placeholder="500000"
                required
                autoFocus
                className="font-mono tabular-nums text-lg"
              />
              {pool?.assigned && pool.assigned > 0 && (
                <p className="text-xs mt-1.5">
                  <span className="text-muted-foreground">Ya asignado: </span>
                  <span className="font-mono tabular-nums font-medium">{formatCurrency(pool.assigned)}</span>
                  {Number(poolAmount) < pool.assigned && Number(poolAmount) > 0 && (
                    <span className="text-destructive ml-2">⚠ El nuevo pote es menor que lo ya asignado</span>
                  )}
                </p>
              )}
            </div>

            <div>
              <label htmlFor="monthly-pool-notes" className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground block mb-1.5">
                Notas (opcional)
              </label>
              <textarea
                id="monthly-pool-notes"
                value={poolNotes}
                onChange={(e) => setPoolNotes(e.target.value)}
                placeholder="Comentarios del presupuesto del mes…"
                className="min-h-16 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40 resize-none"
                maxLength={500}
              />
            </div>

            {poolError && (
              <div className="rounded-md bg-destructive/10 border border-destructive/20 text-destructive px-3 py-2 text-sm">
                {poolError}
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={() => setPoolOpen(false)} disabled={poolMut.isPending}>
                Cancelar
              </Button>
              <Button type="submit" disabled={poolMut.isPending}>
                {poolMut.isPending ? 'Guardando…' : pool?.hasPool ? 'Guardar cambios' : 'Declarar pote'}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
