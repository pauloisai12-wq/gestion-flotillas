'use client';

import { useState, useMemo } from 'react';
import { useDashboardSummaryFiltered, useFuelTrend, type DashboardFilters } from '@/hooks/useDashboardAnalytics';
import DashboardFiltersBar from '@/components/dashboard/DashboardFilters';
import FuelTrendChart from '@/components/charts/FuelTrendChart';
import BudgetGauge from '@/components/charts/BudgetGauge';
import VehicleRankingChart from '@/components/charts/VehicleRankingChart';
import DocsStatusChart from '@/components/charts/DocsStatusChart';
import OperatorRankingChart from '@/components/charts/OperatorRankingChart';
import { DashboardGreeting } from '@/components/dashboard/DashboardGreeting';
import { KpiCard } from '@/components/ui/kpi-card';
import { SkeletonKpi } from '@/components/ui/skeleton';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { AlertTriangle, Truck, ShieldAlert, FileText, Fuel, Wallet } from 'lucide-react';

export default function DashboardGlobal() {
  const [filters, setFilters] = useState<DashboardFilters>({});
  const { data, isLoading, error, refetch, dataUpdatedAt } = useDashboardSummaryFiltered(filters);
  const { data: trendData } = useFuelTrend(filters);

  type TrendItem = { totalSpent: number; totalLiters: number; totalLoads?: number };
  const sparkSpent = useMemo<number[]>(
    () => (trendData as TrendItem[] | undefined)?.map((t) => t.totalSpent) ?? [],
    [trendData],
  );
  const sparkLoads = useMemo<number[]>(
    () => (trendData as TrendItem[] | undefined)?.map((t) => t.totalLoads ?? t.totalLiters) ?? [],
    [trendData],
  );

  return (
    <div className="flex flex-col gap-6">
      <DashboardGreeting
        title="Sala de control"
        description="Resumen operativo de toda la flotilla"
        updatedAt={dataUpdatedAt}
        onRefresh={() => refetch()}
      />

      <DashboardFiltersBar filters={filters} onFiltersChange={setFilters} />

      {error ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <AlertTriangle className="size-10 text-destructive" />
            <div>
              <h3 className="text-base font-medium">Error al cargar datos</h3>
              <p className="text-sm text-muted-foreground mt-1">No pudimos obtener el resumen del dashboard.</p>
            </div>
            <Button variant="outline" size="sm" onClick={() => refetch()}>Reintentar</Button>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Z-top: estado general */}
          <section>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
              {isLoading || !data ? (
                Array.from({ length: 6 }).map((_, i) => <SkeletonKpi key={i} />)
              ) : (
                <>
                  <KpiCard
                    label="Operativos" value={data.operativeVehicles.toLocaleString('es-MX')}
                    unit={`/${data.totalVehicles}`} hint="unidades" icon={Truck} href="/vehicles"
                  />
                  <KpiCard
                    label="Bloqueados" value={data.blockedVehicles.toLocaleString('es-MX')}
                    hint={data.blockedVehicles > 0 ? 'Requieren atención' : 'Todo en orden'} icon={ShieldAlert}
                    delta={data.blockedVehicles > 0 ? { value: '+' + data.blockedVehicles, trend: 'up', meaning: 'bad' } : undefined}
                    href="/vehicles?filter=blocked"
                  />
                  <KpiCard
                    label="Docs. por vencer" value={data.docsExpiring.toLocaleString('es-MX')}
                    hint="< 30 días" icon={FileText} href="/vehicles?filter=expiring"
                  />
                  <KpiCard
                    label="Docs. vencidos" value={data.docsExpired.toLocaleString('es-MX')}
                    hint={data.docsExpired > 0 ? 'Acción inmediata' : 'Ninguno'} icon={AlertTriangle}
                    delta={data.docsExpired > 0 ? { value: '+' + data.docsExpired, trend: 'up', meaning: 'bad' } : undefined}
                    href="/vehicles?filter=expired"
                  />
                  <KpiCard
                    label="Cargas del mes"
                    value={(data.fuelLoadsThisMonth || data.monthlyLoads || 0).toLocaleString('es-MX')}
                    unit={(data.litersThisMonth || data.monthlyLiters || 0).toLocaleString('es-MX', { maximumFractionDigits: 0 }) + ' L'}
                    icon={Fuel} spark={sparkLoads.length > 1 ? sparkLoads : undefined} href="/fuel"
                  />
                  <KpiCard
                    label="Gasto del mes"
                    value={'$' + Math.round((data.spentThisMonth || data.monthlySpent || 0) / 1000).toLocaleString('es-MX')}
                    unit="k MXN"
                    hint={(data.avgKmPerLiter || data.monthlyAvgKml || 0) + ' km/l promedio'}
                    icon={Wallet} spark={sparkSpent}
                    href="/budget/fuel"
                  />
                </>
              )}
            </div>
          </section>

          {/* Mid: tendencia + presupuesto */}
          <section className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className="lg:col-span-2"><FuelTrendChart filters={filters} /></div>
            <BudgetGauge filters={filters} />
          </section>

          {/* Detalle: rankings */}
          <section className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className="lg:col-span-2"><VehicleRankingChart filters={filters} /></div>
            <DocsStatusChart />
          </section>
          <section><OperatorRankingChart filters={filters} /></section>
        </>
      )}
    </div>
  );
}
