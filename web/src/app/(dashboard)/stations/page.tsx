'use client';

import { useState } from 'react';
import { useStations, useDeleteStation, Station } from '@/hooks/useStations';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import DataTable from '@/components/ui/data-table';
import StationFormDialog from '@/components/stations/StationFormDialog';
import { toast } from '@/components/ui/toast';
import { type ColumnDef } from '@tanstack/react-table';

export default function StationsPage() {
  const { data: stations, isLoading } = useStations();
  const deleteMutation = useDeleteStation();
  const [page, setPage] = useState(1);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingStation, setEditingStation] = useState<Station | null>(null);

  async function handleDelete(s: Station) {
    if (!confirm('¿Eliminar "' + s.legalName + '"?')) return;
    try {
      await deleteMutation.mutateAsync(s.id);
    } catch (err: unknown) {
      const error = err as { response?: { data?: { error?: string } } };
      toast.error(error.response?.data?.error || 'Error al eliminar');
    }
  }

  const columns: ColumnDef<Station, unknown>[] = [
    {
      accessorKey: 'rfc',
      header: 'RFC',
      cell: ({ row }) => <span className="font-mono text-xs">{row.original.rfc}</span>,
    },
    {
      accessorKey: 'legalName',
      header: 'Razón Social',
      cell: ({ row }) => (
        <div>
          <div className="font-medium">{row.original.legalName}</div>
          {row.original.tradeName && (
            <div className="text-xs text-muted-foreground">{row.original.tradeName}</div>
          )}
        </div>
      ),
    },
    {
      accessorKey: 'email',
      header: 'Correo',
      cell: ({ row }) => <span className="text-xs">{row.original.email}</span>,
    },
    {
      accessorKey: 'phone',
      header: 'Teléfono',
      cell: ({ row }) => <span className="font-mono text-xs tabular-nums">{row.original.phone}</span>,
    },
    {
      id: 'fuelLoads',
      header: 'Cargas registradas',
      enableSorting: false,
      cell: ({ row }) => <span className="text-center block">{row.original._count.fuelLoads}</span>,
    },
    {
      accessorKey: 'isActive',
      header: 'Estado',
      cell: ({ row }) => (
        <Badge variant={row.original.isActive ? 'default' : 'secondary'}>
          {row.original.isActive ? 'Activa' : 'Inactiva'}
        </Badge>
      ),
    },
    {
      id: 'actions',
      header: 'Acciones',
      enableSorting: false,
      cell: ({ row }) => (
        <div className="text-right space-x-2">
          <Button
            variant="outline"
            size="sm"
            onClick={(e) => { e.stopPropagation(); setEditingStation(row.original); setDialogOpen(true); }}
          >
            Editar
          </Button>
          <Button
            variant="destructive"
            size="sm"
            onClick={(e) => { e.stopPropagation(); handleDelete(row.original); }}
            disabled={row.original._count.fuelLoads > 0}
          >
            Eliminar
          </Button>
        </div>
      ),
    },
  ];

  const allStations = stations || [];

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Gasolineras Aprobadas</h1>
          <p className="text-sm text-muted-foreground">
            Catálogo de estaciones autorizadas para carga de combustible
          </p>
        </div>
      </div>

      <DataTable
        columns={columns}
        data={allStations}
        page={page}
        onPageChange={setPage}
        isLoading={isLoading}
        headerActions={
          <Button onClick={() => { setEditingStation(null); setDialogOpen(true); }}>
            + Nueva gasolinera
          </Button>
        }
      />

      <StationFormDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        station={editingStation}
      />
    </div>
  );
}