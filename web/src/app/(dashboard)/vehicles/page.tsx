'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useVehicles, Vehicle } from '@/hooks/useVehicles';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import DataTable from '@/components/ui/data-table';
import VehicleFormDialog from '@/components/vehicles/VehicleFormDialog';
import VehicleImportDialog from '@/components/vehicles/VehicleImportDialog';
import { type ColumnDef } from '@tanstack/react-table';
import { exportToCsv } from '@/lib/exportCsv';
import { Upload } from 'lucide-react';

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
        {row.original.currentOdometer.toLocaleString()} km
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
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [editingVehicle, setEditingVehicle] = useState<Vehicle | null>(null);

  const { data, isLoading } = useVehicles({ page, limit: 20, search });

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
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Vehículos</h1>
          <p className="text-sm text-muted-foreground">
            {data?.pagination?.total || 0} unidades registradas
          </p>
        </div>
      </div>

   <DataTable
        columns={columns}
        data={data?.data || []}
        pagination={data?.pagination}
        page={page}
        onPageChange={setPage}
        search={search}
        onSearchChange={setSearch}
        searchPlaceholder="Buscar por placa, nº económico, marca..."
        onRowClick={(v) => router.push('/vehicles/' + v.id)}
        isLoading={isLoading}
        onExportCsv={handleExportCsv}
        headerActions={
          <div className="flex items-center gap-2">
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
    </div>
  );
}