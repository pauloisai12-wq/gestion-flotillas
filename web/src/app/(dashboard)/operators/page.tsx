'use client';

import { useState } from 'react';
import {
  useOperators,
  useDeleteOperator,
  Operator,
} from '@/hooks/useOperators';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import DataTable from '@/components/ui/data-table';
import OperatorFormDialog from '@/components/operators/OperatorFormDialog';
import { type ColumnDef } from '@tanstack/react-table';

function getLicenseStatus(expiresAt: string): { label: string; variant: 'default' | 'destructive' | 'secondary' } {
  const diff = new Date(expiresAt).getTime() - Date.now();
  const days = Math.ceil(diff / (1000 * 60 * 60 * 24));
  if (days <= 0) return { label: 'Vencida', variant: 'destructive' };
  if (days <= 30) return { label: days + 'd', variant: 'secondary' };
  return { label: 'Vigente', variant: 'default' };
}

export default function OperatorsPage() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingOp, setEditingOp] = useState<Operator | null>(null);
  const deleteMutation = useDeleteOperator();

  const { data, isLoading } = useOperators({ page, limit: 20, search });

  async function handleDelete(op: Operator) {
    if (!confirm('¿Eliminar al operador "' + op.fullName + '"?')) return;
    try {
      await deleteMutation.mutateAsync(op.id);
    } catch (err: unknown) {
      const error = err as { response?: { data?: { error?: string } } };
      alert(error.response?.data?.error || 'Error al eliminar');
    }
  }

  const columns: ColumnDef<Operator, unknown>[] = [
    {
      accessorKey: 'fullName',
      header: 'Nombre',
      cell: ({ row }) => <span className="font-medium">{row.original.fullName}</span>,
    },
    {
      accessorKey: 'licenseNumber',
      header: 'Licencia',
    },
    {
      accessorKey: 'licenseType',
      header: 'Tipo',
    },
    {
      accessorKey: 'licenseExpiresAt',
      header: 'Vigencia',
      cell: ({ row }) => {
        const licStatus = getLicenseStatus(row.original.licenseExpiresAt);
        return (
          <div className="flex items-center gap-2">
            {new Date(row.original.licenseExpiresAt).toLocaleDateString('es-MX')}
            <Badge variant={licStatus.variant}>{licStatus.label}</Badge>
          </div>
        );
      },
    },
    {
      accessorKey: 'phone',
      header: 'Teléfono',
      enableSorting: false,
      cell: ({ row }) => row.original.phone || '—',
    },
    {
      accessorKey: 'isActive',
      header: 'Estado',
      cell: ({ row }) => (
        <Badge variant={row.original.isActive ? 'default' : 'secondary'}>
          {row.original.isActive ? 'Activo' : 'Inactivo'}
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
            onClick={(e) => { e.stopPropagation(); setEditingOp(row.original); setDialogOpen(true); }}
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

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Operadores</h1>
          <p className="text-sm text-muted-foreground">
            {data?.pagination?.total || 0} operadores registrados
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
        searchPlaceholder="Buscar por nombre, licencia, teléfono..."
        isLoading={isLoading}
        headerActions={
          <Button onClick={() => { setEditingOp(null); setDialogOpen(true); }}>
            + Nuevo operador
          </Button>
        }
      />

      <OperatorFormDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        operator={editingOp}
      />
    </div>
  );
}