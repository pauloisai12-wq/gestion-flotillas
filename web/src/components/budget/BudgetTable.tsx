// Tabla reutilizable para ver/editar presupuestos (FUEL o MAINTENANCE) del mes actual

'use client';

import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';
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
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useVehicles } from '@/hooks/useVehicles';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Budget = any;

export interface BudgetTableProps {
  kind: 'FUEL' | 'MAINTENANCE';
  title: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
}

export function BudgetTable({ kind, title, description, icon: Icon }: BudgetTableProps) {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [search, setSearch] = useState('');
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editValue, setEditValue] = useState('');
  const [massOpen, setMassOpen] = useState(false);
  const [massAmount, setMassAmount] = useState('');
  const [massMode, setMassMode] = useState<'ALL' | 'MISSING'>('ALL');
  const [massDistribution, setMassDistribution] = useState<'TOTAL' | 'PER_UNIT'>('TOTAL');
  const [massError, setMassError] = useState('');
  const qc = useQueryClient();

  const { data: vehiclesResp } = useVehicles({ page: 1, limit: 500 });

  const { data: budgets, isLoading } = useQuery({
    queryKey: ['budgets', kind, year, month],
    queryFn: async () => {
      const res = await api.get('/budgets', { params: { kind, year, month } });
      return (res.data.data as Budget[]) || [];
    },
  });

  // Pote mensual total declarado por el admin
  type PoolInfo = {
    totalPool: number; assigned: number; rollover: number; spent: number;
    unassigned: number; pctAssigned: number; unitsCount: number; notes: string | null; hasPool: boolean;
  };
  const { data: pool } = useQuery({
    queryKey: ['budgets', 'pool', kind, year, month],
    queryFn: async () => {
      const res = await api.get('/budgets/monthly-pool', { params: { kind, year, month } });
      return res.data.data as PoolInfo;
    },
  });

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
    onSuccess: () => qc.invalidateQueries({ queryKey: ['budgets', kind, year, month] }),
  });

  const distributeMut = useMutation({
    mutationFn: async (payload: { distributions: { vehicleId: number; baseAmount: number }[] }) => {
      const res = await api.post('/budgets/distribute', { kind, year, month, ...payload });
      return res.data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['budgets', kind, year, month] });
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const allVehicles = (vehiclesResp?.data as any[]) || [];
    const withBudget = new Set((budgets || []).map((b: Budget) => b.vehicleId));
    const targetVehicles = massMode === 'ALL'
      ? allVehicles
      : allVehicles.filter((v) => !withBudget.has(v.id));

    if (targetVehicles.length === 0) {
      setMassError(
        massMode === 'MISSING'
          ? 'Todos los vehículos ya tienen presupuesto para este periodo.'
          : 'No hay vehículos en la flota.',
      );
      return;
    }

    // Distribución: TOTAL divide equitativo, PER_UNIT asigna igual a cada uno
    const perVehicle = massDistribution === 'TOTAL'
      ? Math.round((amount / targetVehicles.length) * 100) / 100
      : amount;

    try {
      await distributeMut.mutateAsync({
        distributions: targetVehicles.map((v: { id: number }) => ({ vehicleId: v.id, baseAmount: perVehicle })),
      });
    } catch (err) {
      setMassError((err as Error).message);
    }
  }

  const stats = useMemo(() => {
    if (!budgets || budgets.length === 0) return null;
    const totals = budgets.reduce((acc: { base: number; rollover: number; spent: number; cutOff: number; warning: number }, b: Budget) => {
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
    return { ...totals, units: budgets.length };
  }, [budgets]);

  const filtered = useMemo(() => {
    if (!budgets) return [];
    if (!search) return budgets;
    const q = search.toLowerCase();
    return budgets.filter((b: Budget) =>
      b.vehicle?.economicNumber?.toLowerCase().includes(q) ||
      b.vehicle?.plate?.toLowerCase().includes(q));
  }, [budgets, search]);

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
    } catch (e) {
      alert('Error: ' + (e as Error).message);
    }
  }

  const monthName = new Date(year, month - 1).toLocaleDateString('es-MX', { month: 'long', year: 'numeric' });
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
                      ${pool.totalPool.toLocaleString('es-MX')}
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
                    title={`Asignado: $${pool.assigned.toLocaleString('es-MX')}`}
                  />
                </div>
                <div className="grid grid-cols-3 gap-3 pt-2">
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Asignado</div>
                    <div className="font-mono text-sm font-semibold tabular-nums text-primary">
                      ${pool.assigned.toLocaleString('es-MX')}
                    </div>
                    <div className="text-[10px] text-muted-foreground">
                      {pool.pctAssigned}% del pote · {pool.unitsCount} unidades
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Sin asignar</div>
                    <div className={`font-mono text-sm font-semibold tabular-nums ${pool.unassigned > 0 ? 'text-warning' : 'text-success'}`}>
                      ${pool.unassigned.toLocaleString('es-MX')}
                    </div>
                    <div className="text-[10px] text-muted-foreground">
                      {pool.unassigned > 0 ? 'Pendiente de repartir' : 'Todo repartido'}
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Gastado</div>
                    <div className="font-mono text-sm font-semibold tabular-nums text-foreground">
                      ${pool.spent.toLocaleString('es-MX')}
                    </div>
                    <div className="text-[10px] text-muted-foreground">
                      + ${pool.rollover.toLocaleString('es-MX')} rollover
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
          value={month} onChange={(e) => setMonth(Number(e.target.value))}
          className="h-8 rounded-md border border-input bg-card px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
        >
          {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
            <option key={m} value={m}>
              {new Date(2000, m - 1).toLocaleDateString('es-MX', { month: 'long' })}
            </option>
          ))}
        </select>
        <select
          value={year} onChange={(e) => setYear(Number(e.target.value))}
          className="h-8 rounded-md border border-input bg-card px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
        >
          {[now.getFullYear() - 1, now.getFullYear(), now.getFullYear() + 1].map((y) => (
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
          hint="unidades"
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
              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar unidad…" className="pl-8" />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <SkeletonTable rows={8} cols={6} />
          ) : filtered.length === 0 ? (
            <EmptyState
              icon={Icon}
              title="Sin presupuestos para este periodo"
              description={`No hay registros de ${kind === 'FUEL' ? 'combustible' : 'mantenimiento'} para ${monthName}.`}
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
                            type="number" step="0.01" min="0"
                            value={editValue}
                            onChange={(e) => setEditValue(e.target.value)}
                            className="w-28 ml-auto font-mono tabular-nums text-right"
                            autoFocus
                          />
                        ) : (
                          '$' + b.baseAmount.toLocaleString('es-MX')
                        )}
                      </TableCell>
                      <TableCell className="text-right font-mono tabular-nums text-muted-foreground">
                        {b.rolloverIn > 0 ? '+$' + b.rolloverIn.toLocaleString('es-MX') : '—'}
                      </TableCell>
                      <TableCell className="text-right font-mono tabular-nums">
                        ${b.spentAmount.toLocaleString('es-MX')}
                      </TableCell>
                      <TableCell className={`text-right font-mono tabular-nums font-semibold ${b.available < 0 ? 'text-destructive' : ''}`}>
                        ${b.available.toLocaleString('es-MX')}
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
                            <Button size="icon-xs" variant="ghost" onClick={() => { setEditingId(null); setEditValue(''); }}>
                              <X className="size-3" />
                            </Button>
                            <Button size="icon-xs" onClick={() => saveEdit(b.vehicleId)} disabled={updateMut.isPending}>
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
        </CardContent>
      </Card>

      {/* Dialog: asignación masiva */}
      <Dialog open={massOpen} onOpenChange={(o) => !o && setMassOpen(false)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Asignar presupuesto · {monthName}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleMassAssign} className="space-y-4">
            <p className="text-sm text-muted-foreground">
              El rollover del mes anterior (si existe) se preserva automáticamente.
            </p>

            {/* 1. A quién */}
            <div>
              <label className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground block mb-2">
                1. A qué vehículos
              </label>
              <div className="flex flex-col gap-2">
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input type="radio" name="massMode" checked={massMode === 'ALL'} onChange={() => setMassMode('ALL')} className="accent-primary" />
                  <span>Todos los vehículos activos <span className="text-muted-foreground">(sobreescribe)</span></span>
                </label>
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input type="radio" name="massMode" checked={massMode === 'MISSING'} onChange={() => setMassMode('MISSING')} className="accent-primary" />
                  <span>Solo los que aún no tienen presupuesto este mes</span>
                </label>
              </div>
            </div>

            {/* 2. Modo de distribución */}
            <div>
              <label className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground block mb-2">
                2. Cómo distribuir
              </label>
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
            </div>

            {/* 3. Monto */}
            <div>
              <label className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground block mb-1.5">
                3. {massDistribution === 'TOTAL' ? 'Monto total del mes' : 'Monto por vehículo'} *
              </label>
              <Input
                type="number" step="0.01" min="0"
                value={massAmount}
                onChange={(e) => setMassAmount(e.target.value)}
                placeholder={massDistribution === 'TOTAL' ? '500000' : '10000'}
                required
                className="font-mono tabular-nums"
                autoFocus
              />
              {massAmount && Number(massAmount) > 0 && (() => {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const all = (vehiclesResp?.data as any[]) || [];
                const withB = new Set((budgets || []).map((b: Budget) => b.vehicleId));
                const count = massMode === 'ALL' ? all.length : all.filter((v) => !withB.has(v.id)).length;
                if (count === 0) return null;
                const amt = Number(massAmount);
                const perVeh = massDistribution === 'TOTAL' ? amt / count : amt;
                const total = massDistribution === 'TOTAL' ? amt : amt * count;
                return (
                  <div className="mt-2 rounded-md bg-primary-subtle border border-primary/20 px-3 py-2 text-xs space-y-0.5">
                    <div className="flex justify-between font-mono tabular-nums">
                      <span className="text-muted-foreground">Por vehículo:</span>
                      <span className="font-semibold">${perVeh.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                    </div>
                    <div className="flex justify-between font-mono tabular-nums">
                      <span className="text-muted-foreground">Total ({count} veh.):</span>
                      <span className="font-semibold">${total.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
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
              <Button type="submit" disabled={distributeMut.isPending}>
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
          </DialogHeader>
          <form onSubmit={savePool} className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Declara el presupuesto total del mes. Después lo distribuyes a las unidades de forma personalizada.
            </p>

            <div>
              <label className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground block mb-1.5">
                Monto total del mes *
              </label>
              <Input
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
                  <span className="font-mono tabular-nums font-medium">${pool.assigned.toLocaleString('es-MX')}</span>
                  {Number(poolAmount) < pool.assigned && Number(poolAmount) > 0 && (
                    <span className="text-destructive ml-2">⚠ El nuevo pote es menor que lo ya asignado</span>
                  )}
                </p>
              )}
            </div>

            <div>
              <label className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground block mb-1.5">
                Notas (opcional)
              </label>
              <textarea
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
