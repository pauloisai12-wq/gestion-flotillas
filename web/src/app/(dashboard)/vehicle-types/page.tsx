'use client';

import { useState } from 'react';
import {
  useVehicleTypes,
  useDeleteVehicleType,
  VehicleType,
} from '@/hooks/useVehicleTypes';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { toast } from '@/components/ui/toast';
import VehicleTypeFormDialog from '@/components/vehicle-types/VehicleTypeFormDialog';

export default function VehicleTypesPage() {
  const { data: types, isLoading, error } = useVehicleTypes();
  const deleteMutation = useDeleteVehicleType();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingType, setEditingType] = useState<VehicleType | null>(null);

  function handleCreate() {
    setEditingType(null);
    setDialogOpen(true);
  }

  function handleEdit(type: VehicleType) {
    setEditingType(type);
    setDialogOpen(true);
  }

  async function handleDelete(type: VehicleType) {
    if (!confirm(`¿Eliminar "${type.name}"? Esta acción no se puede deshacer.`)) {
      return;
    }
    try {
      await deleteMutation.mutateAsync(type.id);
    } catch (err: unknown) {
      const error = err as { response?: { data?: { error?: string } } };
      toast.error(error.response?.data?.error || 'Error al eliminar');
    }
  }

  if (isLoading) {
    return <div className="p-6">Cargando tipos de vehículo...</div>;
  }

  if (error) {
    return <div className="p-6 text-destructive">Error al cargar: {error.message}</div>;
  }

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Tipos de Vehículo</h1>
          <p className="text-sm text-muted-foreground">
            Catálogo de tipos con rendimiento esperado en km/l
          </p>
        </div>
        <Button onClick={handleCreate}>+ Nuevo tipo</Button>
      </div>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nombre</TableHead>
              <TableHead className="text-right">Rendimiento (km/l)</TableHead>
              <TableHead className="text-center">Vehículos</TableHead>
              <TableHead className="text-center">Estado</TableHead>
              <TableHead className="text-right">Acciones</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {types && types.length > 0 ? (
              types.map((type) => (
                <TableRow key={type.id}>
                  <TableCell className="font-medium">{type.name}</TableCell>
                  <TableCell className="text-right">
                    {type.expectedKmPerLiter} km/l
                  </TableCell>
                  <TableCell className="text-center">
                    {type._count.vehicles}
                  </TableCell>
                  <TableCell className="text-center">
                    <Badge variant={type.isActive ? 'default' : 'secondary'}>
                      {type.isActive ? 'Activo' : 'Inactivo'}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right space-x-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleEdit(type)}
                    >
                      Editar
                    </Button>
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() => handleDelete(type)}
                      disabled={type._count.vehicles > 0}
                    >
                      Eliminar
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                  No hay tipos de vehículo registrados
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <VehicleTypeFormDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        vehicleType={editingType}
      />
    </div>
  );
}