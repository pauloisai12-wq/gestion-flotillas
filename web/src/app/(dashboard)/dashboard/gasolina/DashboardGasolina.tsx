'use client';

// Dashboard para SUPERVISOR_FUEL
// Storytelling:
// 1. Estado general: gasto mes, litros, cargas, presupuesto global
// 2. El problema: cargas PENDING_REVIEW (portal público), vehículos sobre 80%
// 3. Detalle: últimas cargas + trend + ranking consumidores

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';
import { formatCurrency, formatNumber } from '@/lib/formatters';
import { useDashboardSummaryFiltered, useFuelTrend } from '@/hooks/useDashboardAnalytics';
import { DashboardGreeting } from '@/components/dashboard/DashboardGreeting';
import { KpiCard } from '@/components/ui/kpi-card';
import { SkeletonKpi, SkeletonTable } from '@/components/ui/skeleton';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import FuelTrendChart from '@/components/charts/FuelTrendChart';
import VehicleRankingChart from '@/components/charts/VehicleRankingChart';
import { Fuel, Wallet, Droplet, Gauge, CheckCircle2 } from 'lucide-react';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Budget = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type FuelLoad = any;

function useBudgetsFuel() {
  const now = new Date();
  return useQuery({
    queryKey: ['budgets', 'FUEL', now.getFullYear(), now.getMonth() + 1],
    queryFn: async () => {
      const res = await api.get('/budgets', {
        params: { kind: 'FUEL', year: now.getFullYear(), month: now.getMonth() + 1 },
      });
      return (res.data.data as Budget[]) || [];
    },
  });
}

function usePendingLoads() {
  return useQuery({
    queryKey: ['fuel-loads', 'pending'],
    queryFn: async () => {
      const res = await api.get('/fuel-loads', { params: { status: 'PENDING_REVIEW', limit: 20 } });
      return (res.data.data as FuelLoad[]) || [];
    },
  });
}

export default function DashboardGasolina() {
  const { data: summary, dataUpdatedAt, refetch, isLoading: loadingSum } = useDashboardSummaryFiltered({});
  const { data: budgets, isLoading: loadingBudgets } = useBudgetsFuel();
  const { data: pending, isLoading: loadingPending } = usePendingLoads();
  const { data: trend } = useFuelTrend({});

  const budgetStats = useMemo(() => {
    if (!budgets || budgets.length === 0) return null;
    const total = budgets.reduce((acc: { base: number; rollover: number; spent: number; available: number; cutOff: number; warning: number }, b: Budget) => ({
      base: acc.base + b.baseAmount,
      rollover: acc.rollover + b.rolloverIn,
      spent: acc.spent + b.spentAmount,
      available: acc.available + b.available,
      cutOff: acc.cutOff + (b.isCutOff ? 1 : 0),
      warning: acc.warning + ((b.spentAmount / (b.baseAmount + b.rolloverIn)) > 0.8 && !b.isCutOff ? 1 : 0),
    }), { base: 0, rollover: 0, spent: 0, available: 0, cutOff: 0, warning: 0 });
    return { ...total, units: budgets.length };
  }, [budgets]);

  const pct = budgetStats
    ? Math.round((budgetStats.spent / (budgetStats.base + budgetStats.rollover)) * 100)
    : 0;

  type TrendItem = { totalSpent: number };
  const sparkSpent = (trend as TrendItem[] | undefined)?.map((t) => t.totalSpent) ?? [];

  return (
    <div className="flex flex-col gap-6">
      <DashboardGreeting
        title="Control de combustible"
        description="Gastos, presupuestos y cargas del mes"
        updatedAt={dataUpdatedAt}
        onRefresh={() => { refetch(); }}
      />

      {/* Z-TOP: KPIs */}
      <section>
        <h2 className="text-[10px] font-medium uppercase tracking-[0.1em] text-muted-foreground mb-3">
          Gastos del mes
        </h2>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {loadingSum || !summary ? (
            Array.from({ length: 4 }).map((_, i) => <SkeletonKpi key={i} />)
          ) : (
            <>
              <KpiCard
                label="Gasto del mes"
                value={formatCurrency(Math.round((summary.spentThisMonth || summary.monthlySpent || 0) / 1000))}
                unit="k MXN" hint={pct + '% del presupuesto'}
                icon={Wallet} spark={sparkSpent}
              />
              <KpiCard
                label="Litros" value={formatNumber(summary.litersThisMonth || summary.monthlyLiters || 0, { maximumFractionDigits: 0 })}
                unit="L" hint={`${summary.avgKmPerLiter || summary.monthlyAvgKml || 0} km/l`}
                icon={Droplet}
              />
              <KpiCard
                label="Cargas" value={formatNumber(summary.fuelLoadsThisMonth || summary.monthlyLoads || 0)}
                hint="registradas" icon={Fuel}
              />
              <KpiCard
                label="Rendimiento" value={(summary.avgKmPerLiter || summary.monthlyAvgKml || 0).toString()}
                unit="km/l" hint="promedio flota" icon={Gauge}
              />
            </>
          )}
        </div>
      </section>

      {/* Z-MID: el problema */}
      <section className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Presupuesto global con status */}
        <Card>
          <CardHeader><CardTitle>Presupuesto del mes</CardTitle></CardHeader>
          <CardContent>
            {loadingBudgets ? (
              <div className="h-32 animate-pulse bg-muted rounded" />
            ) : budgetStats ? (
              <div className="space-y-4">
                <div>
                  <div className="flex items-baseline justify-between mb-1">
                    <span className="font-mono text-2xl font-semibold tabular-nums">
                      ${(budgetStats.spent / 1000).toFixed(0)}k
                    </span>
                    <span className="text-xs text-muted-foreground font-mono">
                      de ${((budgetStats.base + budgetStats.rollover) / 1000).toFixed(0)}k
                    </span>
                  </div>
                  <div className="h-2 rounded-full bg-muted overflow-hidden">
                    <div
                      className={`h-full rounded-full ${pct > 90 ? 'bg-destructive' : pct > 80 ? 'bg-warning' : 'bg-primary'}`}
                      style={{ width: `${Math.min(100, pct)}%` }}
                    />
                  </div>
                  <p className="text-xs text-muted-foreground mt-1.5">
                    Rollover aplicado: {formatCurrency(budgetStats.rollover)}
                  </p>
                </div>
                <div className="grid grid-cols-3 gap-2 pt-3 border-t border-border/50">
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground">OK</div>
                    <div className="font-mono text-sm font-semibold text-success tabular-nums">
                      {budgetStats.units - budgetStats.warning - budgetStats.cutOff}
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground">≥80%</div>
                    <div className="font-mono text-sm font-semibold text-warning tabular-nums">
                      {budgetStats.warning}
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Corte</div>
                    <div className="font-mono text-sm font-semibold text-destructive tabular-nums">
                      {budgetStats.cutOff}
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Sin presupuesto configurado</p>
            )}
          </CardContent>
        </Card>

        {/* Cargas PENDING del portal público */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>Cargas pendientes de revisión</CardTitle>
              {pending && pending.length > 0 && (
                <Badge variant="expiring">{pending.length}</Badge>
              )}
            </div>
          </CardHeader>
          <CardContent>
            {loadingPending ? (
              <SkeletonTable rows={4} cols={5} />
            ) : pending && pending.length > 0 ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Folio</TableHead>
                    <TableHead>Unidad</TableHead>
                    <TableHead>Operador</TableHead>
                    <TableHead>Monto</TableHead>
                    <TableHead>Odómetro</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pending.slice(0, 8).map((l: FuelLoad) => (
                    <TableRow key={l.id}>
                      <TableCell className="font-mono">#{l.id}</TableCell>
                      <TableCell className="font-mono font-medium">{l.vehicle?.economicNumber}</TableCell>
                      <TableCell className="text-sm">{l.operatorNameRaw || l.operator?.fullName || l.operatorEmployeeRaw}</TableCell>
                      <TableCell className="font-mono tabular-nums">{formatCurrency(l.amount)}</TableCell>
                      <TableCell className="font-mono tabular-nums">
                        {l.odometerStatus === 'NF'
                          ? <Badge variant="inactive">NF</Badge>
                          : formatNumber(l.odometer) + ' km'}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <div className="text-center py-10 text-muted-foreground">
                <CheckCircle2 className="size-6 mx-auto mb-2 text-success" />
                <p className="text-sm">Sin cargas pendientes</p>
                <p className="text-xs mt-0.5">Todas las cargas del portal han sido revisadas</p>
              </div>
            )}
          </CardContent>
        </Card>
      </section>

      {/* F-BOTTOM: tendencia + ranking */}
      <section className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2"><FuelTrendChart filters={{}} /></div>
        <Card>
          <CardHeader><CardTitle>Vehículos al límite</CardTitle></CardHeader>
          <CardContent>
            {budgets && budgets.length > 0 ? (
              <ul className="space-y-2.5">
                {budgets
                  .filter((b: Budget) => (b.spentAmount / (b.baseAmount + b.rolloverIn)) >= 0.8)
                  .sort((a: Budget, b: Budget) =>
                    (b.spentAmount / (b.baseAmount + b.rolloverIn)) -
                    (a.spentAmount / (a.baseAmount + a.rolloverIn)))
                  .slice(0, 8)
                  .map((b: Budget) => {
                    const usage = Math.round((b.spentAmount / (b.baseAmount + b.rolloverIn)) * 100);
                    return (
                      <li key={b.id} className="flex items-center justify-between gap-3 text-sm">
                        <div className="min-w-0 flex-1">
                          <div className="font-mono font-medium truncate">{b.vehicle?.economicNumber}</div>
                          <div className="h-1 rounded-full bg-muted overflow-hidden mt-1">
                            <div className={`h-full ${usage >= 100 ? 'bg-destructive' : 'bg-warning'}`} style={{ width: `${Math.min(100, usage)}%` }} />
                          </div>
                        </div>
                        <span className={`font-mono text-xs font-semibold tabular-nums ${usage >= 100 ? 'text-destructive' : 'text-warning'}`}>
                          {usage}%
                        </span>
                      </li>
                    );
                  })}
                {budgets.filter((b: Budget) => (b.spentAmount / (b.baseAmount + b.rolloverIn)) >= 0.8).length === 0 && (
                  <li className="text-center py-6 text-muted-foreground text-sm">
                    <CheckCircle2 className="size-5 mx-auto mb-1 text-success" />
                    Ningún vehículo al límite
                  </li>
                )}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">Sin presupuestos asignados</p>
            )}
          </CardContent>
        </Card>
      </section>

      <section>
        <VehicleRankingChart filters={{}} />
      </section>
    </div>
  );
}
