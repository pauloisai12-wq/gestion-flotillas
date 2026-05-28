'use client';

// Dashboard para SUPERVISOR_VEHICLES
// Storytelling:
// 1. Estado general (KPIs arriba — Z top)
// 2. El Problema: Unidades con documentos críticos (centro — Z mid)
// 3. Detalle: Tabla con filtros de clasificación + sector (F bottom)

import { useState } from 'react';
import { useDashboardSummaryFiltered } from '@/hooks/useDashboardAnalytics';
import { useVehicles } from '@/hooks/useVehicles';
import { DashboardGreeting } from '@/components/dashboard/DashboardGreeting';
import { KpiCard } from '@/components/ui/kpi-card';
import { SkeletonKpi, SkeletonTable } from '@/components/ui/skeleton';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/ui/status-badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import DocsStatusChart from '@/components/charts/DocsStatusChart';
import { Truck, ShieldAlert, FileText, CheckCircle2, Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import Link from 'next/link';

const classificationLabel: Record<string, string> = {
  POLICIAL: 'Policial', ESTATAL: 'Estatal', VIAL: 'Vial',
};

export default function DashboardVehicles() {
  const { data: summary, isLoading: loadingSum, dataUpdatedAt, refetch } = useDashboardSummaryFiltered({});
  const [search, setSearch] = useState('');
  const [classFilter, setClassFilter] = useState<string>('ALL');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');

  const { data: vehiclesResp, isLoading: loadingVehicles } = useVehicles({
    page: 1, limit: 100, search: search || undefined,
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const vehicles = ((vehiclesResp?.data as any[]) || []).filter((v: any) => {
    if (classFilter !== 'ALL' && v.classification !== classFilter) return false;
    if (statusFilter !== 'ALL' && v.status !== statusFilter) return false;
    return true;
  });

  return (
    <div className="flex flex-col gap-6">
      <DashboardGreeting
        title="Centro de control · Vehículos"
        description="Estado documental y operativo de la flota"
        updatedAt={dataUpdatedAt}
        onRefresh={() => refetch()}
      />

      {/* ═══ 1. ESTADO GENERAL (Z-top) ═══ */}
      <section>
        <h2 className="text-[10px] font-medium uppercase tracking-[0.1em] text-muted-foreground mb-3">
          Estado general
        </h2>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {loadingSum || !summary ? (
            Array.from({ length: 4 }).map((_, i) => <SkeletonKpi key={i} />)
          ) : (
            <>
              <KpiCard
                label="Total unidades" value={summary.totalVehicles.toLocaleString('es-MX')}
                hint="registradas" icon={Truck} href="/vehicles"
              />
              <KpiCard
                label="Operativas"
                value={summary.operativeVehicles.toLocaleString('es-MX')}
                unit={`${Math.round((summary.operativeVehicles / summary.totalVehicles) * 100)}%`}
                hint="de la flota" icon={CheckCircle2}
              />
              <KpiCard
                label="Bloqueadas" value={summary.blockedVehicles.toLocaleString('es-MX')}
                hint={summary.blockedVehicles > 0 ? 'Requieren atención' : 'Ninguna'}
                icon={ShieldAlert}
                delta={summary.blockedVehicles > 0 ? { value: String(summary.blockedVehicles), trend: 'up', meaning: 'bad' } : undefined}
                href="/vehicles?filter=blocked"
              />
              <KpiCard
                label="Docs. con alerta"
                value={(summary.docsExpired + summary.docsExpiring).toLocaleString('es-MX')}
                hint={`${summary.docsExpired} venc. · ${summary.docsExpiring} próx.`}
                icon={FileText}
                delta={summary.docsExpired > 0 ? { value: String(summary.docsExpired), trend: 'up', meaning: 'bad' } : undefined}
              />
            </>
          )}
        </div>
      </section>

      {/* ═══ 2. EL PROBLEMA — documentos críticos (Z-mid) ═══ */}
      <section className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Unidades que requieren atención inmediata</CardTitle>
          </CardHeader>
          <CardContent>
            {loadingVehicles ? (
              <SkeletonTable rows={4} cols={4} />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Unidad</TableHead>
                    <TableHead>Clasificación</TableHead>
                    <TableHead>Estado</TableHead>
                    <TableHead className="text-right">Acción</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                  {vehicles.filter((v: any) => v.status === 'BLOCKED').slice(0, 5).map((v: any) => (
                    <TableRow key={v.id}>
                      <TableCell className="font-mono font-medium">
                        {v.economicNumber} · <span className="text-muted-foreground">{v.plate}</span>
                      </TableCell>
                      <TableCell>
                        <span className="text-xs uppercase tracking-wider text-muted-foreground">
                          {classificationLabel[v.classification] || v.classification}
                        </span>
                      </TableCell>
                      <TableCell>
                        <StatusBadge status="blocked" label={v.blockReason || 'Bloqueado'} />
                      </TableCell>
                      <TableCell className="text-right">
                        <Link href={`/vehicles/${v.id}`}>
                          <Button variant="ghost" size="xs">Revisar →</Button>
                        </Link>
                      </TableCell>
                    </TableRow>
                  ))}
                  {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                  {vehicles.filter((v: any) => v.status === 'BLOCKED').length === 0 && (
                    <TableRow>
                      <TableCell colSpan={4} className="text-center py-8 text-muted-foreground">
                        <CheckCircle2 className="size-5 mx-auto mb-1 text-success" />
                        Ninguna unidad requiere atención inmediata
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <DocsStatusChart />
      </section>

      {/* ═══ 3. DETALLE CON FILTROS (F-bottom) ═══ */}
      <section>
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <CardTitle>Inventario completo</CardTitle>
              <div className="flex items-center gap-2 flex-wrap">
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
                  <Input
                    value={search} onChange={(e) => setSearch(e.target.value)}
                    placeholder="Buscar placa o económico…" className="pl-8 w-64"
                  />
                </div>
                <select
                  value={classFilter} onChange={(e) => setClassFilter(e.target.value)}
                  className="h-9 rounded-md border border-input bg-transparent px-3 text-sm outline-none"
                >
                  <option value="ALL">Todas las clasificaciones</option>
                  <option value="POLICIAL">Policial</option>
                  <option value="ESTATAL">Estatal</option>
                  <option value="VIAL">Vial</option>
                </select>
                <select
                  value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}
                  className="h-9 rounded-md border border-input bg-transparent px-3 text-sm outline-none"
                >
                  <option value="ALL">Todos los estados</option>
                  <option value="OPERATIVE">Operativos</option>
                  <option value="BLOCKED">Bloqueados</option>
                </select>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {loadingVehicles ? (
              <SkeletonTable rows={6} cols={5} />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Unidad</TableHead>
                    <TableHead>Tipo</TableHead>
                    <TableHead>Clasificación</TableHead>
                    <TableHead>Odómetro</TableHead>
                    <TableHead>Estado</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                  {vehicles.slice(0, 50).map((v: any) => (
                    <TableRow key={v.id} className="cursor-pointer" onClick={() => (window.location.href = `/vehicles/${v.id}`)}>
                      <TableCell className="font-mono font-medium">
                        {v.economicNumber} · <span className="text-muted-foreground">{v.plate}</span>
                      </TableCell>
                      <TableCell>{v.vehicleType?.name || '—'}</TableCell>
                      <TableCell className="text-xs uppercase tracking-wider text-muted-foreground">
                        {classificationLabel[v.classification] || v.classification}
                      </TableCell>
                      <TableCell className="font-mono tabular-nums">
                        {Number(v.currentOdometer || 0).toLocaleString('es-MX')} km
                      </TableCell>
                      <TableCell>
                        {v.status === 'BLOCKED'
                          ? <StatusBadge status="blocked" />
                          : <StatusBadge status="operative" />}
                      </TableCell>
                    </TableRow>
                  ))}
                  {vehicles.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center py-8 text-muted-foreground text-sm">
                        Sin resultados con los filtros actuales
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
