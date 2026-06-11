'use client';

// Dashboard para SUPERVISOR_MAINTENANCE
// Storytelling:
// 1. Estado general: vehiculos con OVERDUE, DUE, presupuesto mantto, costos mes
// 2. El problema: servicios OVERDUE y próximos (tabla priorizada)
// 3. Detalle: historial reciente + presupuesto por vehículo

import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';
import { formatCurrency, formatDate, formatNumber } from '@/lib/formatters';
import { DashboardGreeting } from '@/components/dashboard/DashboardGreeting';
import { KpiCard } from '@/components/ui/kpi-card';
import { SkeletonKpi, SkeletonTable } from '@/components/ui/skeleton';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Wrench, AlertTriangle, Wallet, CheckCircle2, Clock } from 'lucide-react';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRec = any;

function usePendingMaintenance() {
  return useQuery({
    queryKey: ['maintenance', 'pending'],
    queryFn: async () => {
      const res = await api.get('/maintenance/pending');
      return (res.data.data as AnyRec[]) || [];
    },
  });
}

function useRecentMaintenance() {
  return useQuery({
    queryKey: ['maintenance', 'recent'],
    queryFn: async () => {
      const res = await api.get('/maintenance/records', { params: { page: 1, limit: 15 } });
      return (res.data.data as AnyRec[]) || [];
    },
  });
}

function useBudgetsMaintenance() {
  const now = new Date();
  return useQuery({
    queryKey: ['budgets', 'MAINTENANCE', now.getFullYear(), now.getMonth() + 1],
    queryFn: async () => {
      const res = await api.get('/budgets', {
        params: { kind: 'MAINTENANCE', year: now.getFullYear(), month: now.getMonth() + 1 },
      });
      return (res.data.data as AnyRec[]) || [];
    },
  });
}

export default function DashboardMantenimiento() {
  const { data: pending, isLoading: loadingPending } = usePendingMaintenance();
  const { data: recent, isLoading: loadingRecent } = useRecentMaintenance();
  const { data: budgets, isLoading: loadingBudgets, dataUpdatedAt, refetch } = useBudgetsMaintenance();

  const overdue = (pending || []).filter((p: AnyRec) => p.status === 'OVERDUE');
  const warning = (pending || []).filter((p: AnyRec) => p.status === 'WARNING');

  const budgetTotal = (budgets || []).reduce(
    (acc: { base: number; spent: number }, b: AnyRec) => ({
      base: acc.base + b.baseAmount + b.rolloverIn,
      spent: acc.spent + b.spentAmount,
    }),
    { base: 0, spent: 0 },
  );
  const pct = budgetTotal.base > 0 ? Math.round((budgetTotal.spent / budgetTotal.base) * 100) : 0;

  return (
    <div className="flex flex-col gap-6">
      <DashboardGreeting
        title="Control de mantenimiento"
        description="Servicios pendientes, talleres y presupuesto"
        updatedAt={dataUpdatedAt}
        onRefresh={() => { refetch(); }}
      />

      {/* Z-TOP */}
      <section>
        <h2 className="text-[10px] font-medium uppercase tracking-[0.1em] text-muted-foreground mb-3">
          Estado de la flota
        </h2>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {loadingPending || loadingBudgets ? (
            Array.from({ length: 4 }).map((_, i) => <SkeletonKpi key={i} />)
          ) : (
            <>
              <KpiCard
                label="Servicios vencidos" value={formatNumber(overdue.length)}
                hint={overdue.length > 0 ? 'Atención inmediata' : 'Al día'}
                icon={AlertTriangle}
                delta={overdue.length > 0 ? { value: String(overdue.length), trend: 'up', meaning: 'bad' } : undefined}
              />
              <KpiCard
                label="Próximos (≥80%)" value={formatNumber(warning.length)}
                hint="a programar" icon={Clock}
                delta={warning.length > 0 ? { value: String(warning.length), trend: 'up', meaning: 'bad' } : undefined}
              />
              <KpiCard
                label="Presupuesto usado" value={pct + '%'}
                hint={`$${(budgetTotal.spent / 1000).toFixed(1)}k de $${(budgetTotal.base / 1000).toFixed(1)}k`}
                icon={Wallet}
              />
              <KpiCard
                label="Servicios del mes" value={(recent?.length ?? 0).toString()}
                hint="realizados" icon={Wrench}
              />
            </>
          )}
        </div>
      </section>

      {/* Z-MID: OVERDUE destacados */}
      <section className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className={overdue.length > 0 ? 'lg:col-span-2 ring-destructive/30' : 'lg:col-span-2'}>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>Servicios vencidos</CardTitle>
              {overdue.length > 0 && <Badge variant="blocked">{overdue.length}</Badge>}
            </div>
          </CardHeader>
          <CardContent>
            {loadingPending ? (
              <SkeletonTable rows={4} cols={4} />
            ) : overdue.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <CheckCircle2 className="size-6 mx-auto mb-2 text-success" />
                <p className="text-sm">Ningún servicio vencido</p>
                <p className="text-xs mt-0.5">Toda la flota al día</p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Unidad</TableHead>
                    <TableHead>Servicio</TableHead>
                    <TableHead>Vencido por</TableHead>
                    <TableHead>Odómetro</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {overdue.slice(0, 8).map((p: AnyRec, i: number) => (
                    <TableRow key={`${p.vehicleId}-${p.serviceId}-${i}`}>
                      <TableCell className="font-mono font-medium">{p.economicNumber}</TableCell>
                      <TableCell className="text-sm">{p.name || p.serviceName}</TableCell>
                      <TableCell className="font-mono tabular-nums text-destructive">
                        {formatNumber(Math.abs(p.remainingKm))} km
                      </TableCell>
                      <TableCell className="font-mono tabular-nums">
                        {formatNumber(p.currentOdometer)} km
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Próximos servicios</CardTitle></CardHeader>
          <CardContent>
            {loadingPending ? (
              <div className="space-y-2">
                {Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-8 bg-muted rounded animate-pulse" />)}
              </div>
            ) : warning.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-6">Sin próximos a vencer</p>
            ) : (
              <ul className="space-y-2.5">
                {warning.slice(0, 6).map((p: AnyRec, i: number) => (
                  <li key={`${p.vehicleId}-${p.serviceId}-${i}`} className="text-sm">
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <span className="font-mono font-medium truncate">{p.economicNumber}</span>
                      <span className="text-xs font-mono tabular-nums text-warning">{p.progressPercent}%</span>
                    </div>
                    <div className="text-xs text-muted-foreground truncate">{p.name || p.serviceName}</div>
                    <div className="h-1 rounded-full bg-muted overflow-hidden mt-1">
                      <div className="h-full bg-warning" style={{ width: `${Math.min(100, p.progressPercent)}%` }} />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </section>

      {/* F-BOTTOM: historial */}
      <section>
        <Card>
          <CardHeader><CardTitle>Historial reciente de mantenimientos</CardTitle></CardHeader>
          <CardContent>
            {loadingRecent ? (
              <SkeletonTable rows={6} cols={5} />
            ) : !recent || recent.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">Sin registros aún</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Fecha</TableHead>
                    <TableHead>Unidad</TableHead>
                    <TableHead>Servicio</TableHead>
                    <TableHead>Taller</TableHead>
                    <TableHead className="text-right">Costo</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {recent.slice(0, 15).map((r: AnyRec) => (
                    <TableRow key={r.id}>
                      <TableCell className="font-mono text-xs">
                        {formatDate(r.serviceDate, { day: '2-digit', month: 'short' })}
                      </TableCell>
                      <TableCell className="font-mono font-medium">{r.vehicle?.economicNumber}</TableCell>
                      <TableCell className="text-sm">{r.service?.name}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {r.workshopRef?.legalName || r.workshopRaw || r.workshop || '—'}
                      </TableCell>
                      <TableCell className="text-right font-mono tabular-nums">
                        {formatCurrency(r.cost)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
