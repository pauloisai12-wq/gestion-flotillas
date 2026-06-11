'use client';

import { useState } from 'react';
import { 
  usePendingServices, 
  useMaintenanceRecords, 
  useCreateMaintenance, 
  useServiceCatalog 
} from '@/hooks/useMaintenance';
import { useVehicles } from '@/hooks/useVehicles';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { toast } from '@/components/ui/toast';
import { formatCurrency, formatDate, formatNumber } from '@/lib/formatters';

type TabType = 'pending' | 'history' | 'catalog';

export default function MaintenancePage() {
  const [activeTab, setActiveTab] = useState<TabType>('pending');
  const [showForm, setShowForm] = useState(false);
  const [historyPage, setHistoryPage] = useState(1);

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Mantenimiento Preventivo</h1>
          <p className="text-sm text-muted-foreground">
            Control de servicios por kilometraje
          </p>
        </div>
        <Button onClick={() => setShowForm(!showForm)}>
          {showForm ? 'Cerrar formulario' : '+ Registrar mantenimiento'}
        </Button>
      </div>

      {showForm && (
        <MaintenanceForm onClose={() => setShowForm(false)} />
      )}

      <div className="flex gap-2 border-b pb-2">
        <Button
          variant={activeTab === 'pending' ? 'default' : 'outline'}
          size="sm"
          onClick={() => setActiveTab('pending')}
        >
          Servicios pendientes
        </Button>
        <Button
          variant={activeTab === 'history' ? 'default' : 'outline'}
          size="sm"
          onClick={() => setActiveTab('history')}
        >
          Historial
        </Button>
        <Button
          variant={activeTab === 'catalog' ? 'default' : 'outline'}
          size="sm"
          onClick={() => setActiveTab('catalog')}
        >
          Catálogo de servicios
        </Button>
      </div>

      {activeTab === 'pending' && <PendingTab />}
      {activeTab === 'history' && <HistoryTab page={historyPage} setPage={setHistoryPage} />}
      {activeTab === 'catalog' && <CatalogTab />}
    </div>
  );
}

function PendingTab() {
  const { data: pending, isLoading } = usePendingServices();

  if (isLoading) return <div>Cargando servicios pendientes...</div>;

  const services = pending || [];
  const overdue = services.filter((s) => s.status === 'OVERDUE');
  const warning = services.filter((s) => s.status === 'WARNING');

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4 max-w-md">
        <div className="rounded-md border p-4">
          <p className="text-sm text-muted-foreground">Vencidos</p>
          <p className={`text-2xl font-bold ${overdue.length > 0 ? 'text-destructive' : ''}`}>
            {overdue.length}
          </p>
        </div>
        <div className="rounded-md border p-4">
          <p className="text-sm text-muted-foreground">Próximos (80%+)</p>
          <p className={`text-2xl font-bold ${warning.length > 0 ? 'text-warning' : ''}`}>
            {warning.length}
          </p>
        </div>
      </div>

      {services.length === 0 ? (
        <div className="rounded-md border p-8 text-center text-muted-foreground">
          No hay servicios pendientes. Todos los vehículos están al día.
        </div>
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Vehículo</TableHead>
                <TableHead>Servicio</TableHead>
                <TableHead className="text-right">Intervalo</TableHead>
                <TableHead className="text-right">Próximo a</TableHead>
                <TableHead className="text-right">Odómetro actual</TableHead>
                <TableHead className="text-right">Faltan</TableHead>
                <TableHead className="text-center">Progreso</TableHead>
                <TableHead className="text-center">Estado</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {services.map((s) => (
                <TableRow key={`${s.vehicleId}-${s.serviceId}`}>
                  <TableCell className="font-medium">
                    {s.economicNumber}
                    <span className="text-xs text-muted-foreground ml-1">({s.plate})</span>
                  </TableCell>
                  <TableCell>{s.serviceName}</TableCell>
                  <TableCell className="text-right">{formatNumber(s.intervalKm)} km</TableCell>
                  <TableCell className="text-right">{formatNumber(s.nextServiceKm)} km</TableCell>
                  <TableCell className="text-right">{formatNumber(s.currentOdometer)} km</TableCell>
                  <TableCell className="text-right">
                    <span className={s.remainingKm <= 0 ? 'text-destructive font-bold' : ''}>
                      {formatNumber(s.remainingKm)} km
                    </span>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <div className="flex-1 bg-gray-200 rounded-full h-2 min-w-15">
                        <div
                          className={`h-2 rounded-full ${
                            s.status === 'OVERDUE' ? 'bg-destructive' :
                            s.status === 'WARNING' ? 'bg-warning' : 'bg-success'
                          }`}
                          style={{ width: `${Math.min(s.progressPercent, 100)}%` }}
                        />
                      </div>
                      <span className="text-xs text-muted-foreground w-10 text-right">
                        {s.progressPercent}%
                      </span>
                    </div>
                  </TableCell>
                  <TableCell className="text-center">
                    {s.status === 'OVERDUE' ? (
                      <Badge variant="destructive">Vencido</Badge>
                    ) : (
                      <Badge className="bg-warning text-white">Próximo</Badge>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

// Acepta solo rutas relativas que empiecen por '/' (no '//') o URLs absolutas
// http(s). Cualquier otro esquema (javascript:, data:, etc.) devuelve null.
function safeHref(url: string): string | null {
  if (url.startsWith('/')) {
    return url.startsWith('//') ? null : url;
  }
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? url : null;
  } catch {
    return null;
  }
}

function EvidenceLink({ url }: { url?: string | null }) {
  const href = url ? safeHref(`${process.env.NEXT_PUBLIC_API_URL || ''}${url}`) : null;

  if (!href) {
    return <span className="text-muted-foreground text-sm">-</span>;
  }

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-primary hover:underline text-sm font-medium"
    >
      Ver archivo
    </a>
  );
}

function HistoryTab({ page, setPage }: { page: number; setPage: (p: number) => void }) {
  const { data, isLoading } = useMaintenanceRecords({ page });

  if (isLoading) return <div>Cargando historial...</div>;

  const records = data?.data || [];
  const pagination = data?.pagination;

  return (
    <div className="space-y-4">
      {records.length === 0 ? (
        <div className="rounded-md border p-8 text-center text-muted-foreground">
          Sin registros de mantenimiento
        </div>
      ) : (
        <>
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Fecha</TableHead>
                  <TableHead>Vehículo</TableHead>
                  <TableHead>Servicio</TableHead>
                  <TableHead className="text-right">Odómetro</TableHead>
                  <TableHead className="text-right">Costo</TableHead>
                  <TableHead>Proveedor / Taller</TableHead>
                  <TableHead>Evidencia</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {records.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>{formatDate(r.serviceDate)}</TableCell>
                    <TableCell className="font-medium">{r.vehicle.economicNumber}</TableCell>
                    <TableCell>{r.service.serviceName}</TableCell>
                    <TableCell className="text-right">{formatNumber(r.odometer)} km</TableCell>
                    <TableCell className="text-right">{formatCurrency(r.cost)}</TableCell>
                    <TableCell>
                      <div className="text-sm">{r.provider}</div>
                      <div className="text-xs text-muted-foreground">{r.workshop}</div>
                    </TableCell>
                    <TableCell>
                      <EvidenceLink url={r.evidenceUrl} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {pagination && pagination.totalPages > 1 && (
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">
                Página {pagination.page} de {pagination.totalPages}
              </p>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page <= 1}
                  onClick={() => setPage(page - 1)}
                >
                  Anterior
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page >= pagination.totalPages}
                  onClick={() => setPage(page + 1)}
                >
                  Siguiente
                </Button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function CatalogTab() {
  const { data: services, isLoading } = useServiceCatalog();

  if (isLoading) return <div>Cargando catálogo...</div>;

  const catalog = services || [];
  const grouped: Record<string, typeof catalog> = {};
  
  catalog.forEach(s => {
    const typeName = s.vehicleType.name;
    if (!grouped[typeName]) grouped[typeName] = [];
    grouped[typeName].push(s);
  });

  return (
    <div className="space-y-6">
      {Object.entries(grouped).map(([typeName, items]) => (
        <div key={typeName} className="rounded-md border">
          <div className="p-3 bg-muted/50 border-b">
            <h3 className="font-semibold">{typeName}</h3>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Servicio</TableHead>
                <TableHead className="text-right">Intervalo (km)</TableHead>
                <TableHead>Descripción</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((s) => (
                <TableRow key={s.id}>
                  <TableCell className="font-medium">{s.serviceName}</TableCell>
                  <TableCell className="text-right">{formatNumber(s.intervalKm)} km</TableCell>
                  <TableCell className="text-muted-foreground">{s.description || '-'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ))}
    </div>
  );
}

function MaintenanceForm({ onClose }: { onClose: () => void }) {
  const { data: vehiclesData } = useVehicles({ page: 1, limit: 100 });
  const [selectedVehicleTypeId, setSelectedVehicleTypeId] = useState<number | null>(null);
  const { data: services } = useServiceCatalog(selectedVehicleTypeId || undefined);
  const createMaintenance = useCreateMaintenance();

  const vehicles = vehiclesData?.data || [];

  function handleVehicleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const vId = e.target.value;
    if (!vId) {
      setSelectedVehicleTypeId(null);
      return;
    }
    const vehicle = vehicles.find((v) => v.id === parseInt(vId));
    if (vehicle) {
      const vType = vehicle.vehicleType as { id?: number };
      setSelectedVehicleTypeId(vType?.id || vehicle.vehicleTypeId);
    }
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);

    try {
      await createMaintenance.mutateAsync(formData);
      onClose();
    } catch (error: unknown) {
      const err = error as { response?: { data?: { error?: string } } };
      toast.error(err.response?.data?.error || 'Error al registrar mantenimiento');
    }
  }

  return (
    <div className="rounded-md border p-6 bg-card shadow-sm">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-lg font-semibold">Registrar nuevo mantenimiento</h2>
        <Button variant="ghost" size="sm" onClick={onClose}>Cancelar</Button>
      </div>

      <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="text-sm font-medium">Vehículo</label>
          <select
            name="vehicleId"
            required
            onChange={handleVehicleChange}
            className="w-full mt-1 rounded-md border border-input bg-background p-2 text-sm focus:ring-2 focus:ring-ring"
          >
            <option value="">Seleccionar vehículo...</option>
            {vehicles.map((v) => (
              <option key={v.id} value={v.id}>
                {v.economicNumber} - {v.plate} ({v.vehicleType.name})
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="text-sm font-medium">Servicio</label>
          <select
            name="serviceId"
            required
            disabled={!selectedVehicleTypeId}
            className="w-full mt-1 rounded-md border border-input bg-background p-2 text-sm disabled:opacity-50"
          >
            <option value="">
              {selectedVehicleTypeId ? 'Seleccionar servicio...' : 'Primero seleccione vehículo'}
            </option>
            {(services || []).map((s) => (
              <option key={s.id} value={s.id}>
                {s.serviceName} (cada {formatNumber(s.intervalKm)} km)
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="text-sm font-medium">Odómetro (km)</label>
          <Input type="number" name="odometer" required min="0" />
        </div>

        <div>
          <label className="text-sm font-medium">Costo ($)</label>
          <Input type="number" name="cost" required min="0" step="0.01" />
        </div>

        <div>
          <label className="text-sm font-medium">Proveedor</label>
          <Input type="text" name="provider" required minLength={2} />
        </div>

        <div>
          <label className="text-sm font-medium">Taller</label>
          <Input type="text" name="workshop" required minLength={2} />
        </div>

        <div>
          <label className="text-sm font-medium">Fecha del servicio</label>
          <Input type="date" name="serviceDate" required defaultValue={new Date().toISOString().split('T')[0]} />
        </div>

        <div>
          <label className="text-sm font-medium">Evidencia (foto/PDF)</label>
          <Input type="file" name="evidence" accept="image/*,.pdf" />
        </div>

        <div className="md:col-span-2">
          <label className="text-sm font-medium">Notas (opcional)</label>
          <Input type="text" name="notes" placeholder="Observaciones adicionales..." />
        </div>

        <div className="md:col-span-2 pt-2">
          <Button type="submit" className="w-full md:w-auto" disabled={createMaintenance.isPending}>
            {createMaintenance.isPending ? 'Registrando...' : 'Registrar mantenimiento'}
          </Button>
        </div>
      </form>
    </div>
  );
}