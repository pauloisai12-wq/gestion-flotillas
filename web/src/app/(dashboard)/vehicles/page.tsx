'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useDeleteVehicle, useVehicles, Vehicle } from '@/hooks/useVehicles';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import DataTable from '@/components/ui/data-table';
import VehicleFormDialog from '@/components/vehicles/VehicleFormDialog';
import VehicleImportDialog from '@/components/vehicles/VehicleImportDialog';
import OdometerCorrectionDialog from '@/components/vehicles/OdometerCorrectionDialog';
import { type ColumnDef } from '@tanstack/react-table';
import { exportToCsv } from '@/lib/exportCsv';
import { formatNumber } from '@/lib/formatters';
import { Gauge, Pencil, Trash2, Upload } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from '@/components/ui/toast';
import { getApiError } from '@/lib/api';

function getWorstDocStatus(documents: { expiresAt: string }[]): 'RED' | 'YELLOW' | 'GREEN' | 'NONE' {
  if (documents.length === 0) return 'NONE';
  const now = new Date();
  const thirtyDays = 30 * 24 * 60 * 60 * 1000;
  let worst: 'GREEN' | 'YELLOW' | 'RED' = 'GREEN';
  for (const doc of documents) {
    const expires = new Date(doc.expiresAt);
    const diff = expires.getTime() - now.getTime();
    if (diff <= 0) return 'RED';
    if (diff <= thirtyDays) worst = 'YELLOW';
  }
  return worst;
}

const columns: ColumnDef<Vehicle, unknown>[] = [
  {
    accessorKey: 'economicNumber',
    header: 'Nº Eco',
    cell: ({ row }) => <span className="font-medium">{row.original.economicNumber}</span>,
  },
  {
    accessorKey: 'plate',
    header: 'Placa',
  },
  {
    id: 'vehicleType',
    header: 'Tipo',
    accessorFn: (row) => row.vehicleType?.name ?? '',
    cell: ({ row }) => row.original.vehicleType?.name ?? '—',
  },
  {
    id: 'brandModel',
    header: 'Marca / Modelo',
    accessorFn: (row) => `${row.brand} ${row.model} ${row.year}`,
    cell: ({ row }) => row.original.brand + ' ' + row.original.model + ' (' + row.original.year + ')',
  },
  {
    accessorKey: 'currentOdometer',
    header: 'Odómetro',
    cell: ({ row }) => (
      <span className="text-right block">
        {formatNumber(row.original.currentOdometer)} km
      </span>
    ),
  },
  {
    id: 'docs',
    header: 'Docs',
    enableSorting: false,
    cell: ({ row }) => {
      const status = getWorstDocStatus(row.original.documents);
      if (status === 'RED') return <Badge variant="destructive">Vencido</Badge>;
      if (status === 'YELLOW') return <Badge className="bg-warning text-white">Por vencer</Badge>;
      if (status === 'GREEN') return <Badge className="bg-success text-white">OK</Badge>;
      return <Badge variant="secondary">Sin docs</Badge>;
    },
  },
  {
    accessorKey: 'status',
    header: 'Estado',
    cell: ({ row }) => (
      <Badge variant={row.original.status === 'OPERATIVE' ? 'default' : 'destructive'}>
        {row.original.status === 'OPERATIVE' ? 'Operativo' : 'Bloqueado'}
      </Badge>
    ),
  },
];

export default function VehiclesPage() {
  const router = useRouter();
  const { user } = useAuth();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [editingVehicle, setEditingVehicle] = useState<Vehicle | null>(null);
  const [odometerVehicle, setOdometerVehicle] = useState<Vehicle | null>(null);
  const deleteMutation = useDeleteVehicle();

  const { data, isLoading, isError, refetch } = useVehicles({ page, limit: 20, search });

  async function handleDelete(vehicle: Vehicle) {
    if (!confirm(`¿Dar de baja la unidad ${vehicle.economicNumber}? Su historial se conservará.`)) return;
    try {
      await deleteMutation.mutateAsync(vehicle.id);
      toast.success('Vehículo dado de baja; el historial se conservó');
    } catch (error: unknown) {
      toast.error(getApiError(error).data?.error || 'No se pudo dar de baja el vehículo');
    }
  }

  const tableColumns: ColumnDef<Vehicle, unknown>[] = [
    ...columns,
    {
      id: 'actions',
      header: 'Acciones',
      enableSorting: false,
      cell: ({ row }) => (
        <div className="flex items-center justify-end gap-1">
          <Button
            size="icon-xs"
            variant="ghost"
            aria-label={`Editar ${row.original.economicNumber}`}
            onClick={(event) => {
              event.stopPropagation();
              setEditingVehicle(row.original);
              setDialogOpen(true);
            }}
          >
            <Pencil className="size-3.5" />
          </Button>
          {user?.role === 'ADMIN' && (
            <>
              <Button
                size="icon-xs"
                variant="ghost"
                aria-label={`Corregir odómetro de ${row.original.economicNumber}`}
                onClick={(event) => {
                  event.stopPropagation();
                  setOdometerVehicle(row.original);
                }}
              >
                <Gauge className="size-3.5" />
              </Button>
              <Button
                size="icon-xs"
                variant="ghost"
                aria-label={`Dar de baja ${row.original.economicNumber}`}
                disabled={deleteMutation.isPending}
                onClick={(event) => {
                  event.stopPropagation();
                  void handleDelete(row.original);
                }}
              >
                <Trash2 className="size-3.5 text-destructive" />
              </Button>
            </>
          )}
        </div>
      ),
    },
  ];

  function handleExportCsv() {
    exportToCsv('vehiculos', [
      { header: 'Nº Eco', accessor: (r) => r.economicNumber },
      { header: 'Placa', accessor: (r) => r.plate },
      { header: 'Tipo', accessor: (r) => r.vehicleType.name },
      { header: 'Marca', accessor: (r) => r.brand },
      { header: 'Modelo', accessor: (r) => r.model },
      { header: 'Año', accessor: (r) => r.year },
      { header: 'Odómetro', accessor: (r) => r.currentOdometer },
      { header: 'Estado', accessor: (r) => r.status === 'OPERATIVE' ? 'Operativo' : 'Bloqueado' },
    ], data?.data || []);
  }

  return (
    <div className="space-y-4 p-0 sm:p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Vehículos</h1>
          <p className="text-sm text-muted-foreground">
            {data?.pagination?.total || 0} unidades registradas
          </p>
        </div>
      </div>

   <DataTable
        columns={tableColumns}
        data={data?.data || []}
        pagination={data?.pagination}
        page={page}
        onPageChange={setPage}
        search={search}
        onSearchChange={setSearch}
        searchPlaceholder="Buscar por placa, nº económico, marca..."
        onRowClick={(v) => router.push('/vehicles/' + v.id)}
        rowActionLabel={(v) => `Abrir detalle de la unidad ${v.economicNumber}`}
        isLoading={isLoading}
        error={isError ? 'Verifica tu conexión e intenta nuevamente.' : null}
        onRetry={() => void refetch()}
        emptyTitle={search ? 'No hay vehículos que coincidan' : 'Aún no hay vehículos registrados'}
        emptyDescription={search ? 'Prueba con otra placa, número económico o marca.' : 'Crea una unidad o importa el padrón para comenzar.'}
        onExportCsv={handleExportCsv}
        headerActions={
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button variant="outline" onClick={() => setImportOpen(true)}>
              <Upload className="size-4" /> Importar Excel
            </Button>
            <Button onClick={() => { setEditingVehicle(null); setDialogOpen(true); }}>
              + Nuevo vehículo
            </Button>
          </div>
        }
      />

      <VehicleFormDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        vehicle={editingVehicle}
      />
      <VehicleImportDialog
        open={importOpen}
        onClose={() => setImportOpen(false)}
      />
      <OdometerCorrectionDialog
        open={!!odometerVehicle}
        onClose={() => setOdometerVehicle(null)}
        vehicle={odometerVehicle}
      />
    </div>
  );
}
