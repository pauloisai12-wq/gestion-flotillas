'use client';

import { use, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useVehicle } from '@/hooks/useVehicles';
import { useVehicleDocuments, useDeleteDocument, VehicleDocument } from '@/hooks/useDocuments';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import DocumentFormDialog from '@/components/documents/DocumentFormDialog';
import { VehicleNotesSection } from '@/components/vehicles/VehicleNotesSection';
import { toast } from '@/components/ui/toast';
import { formatDate, formatNumber } from '@/lib/formatters';

function getDocTrafficLight(expiresAt: string) {
  const now = new Date();
  const expires = new Date(expiresAt);
  const diffMs = expires.getTime() - now.getTime();
  const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays <= 0) return { label: 'Vencido (' + Math.abs(diffDays) + ' dias)', color: 'bg-destructive' };
  if (diffDays <= 30) return { label: diffDays + ' dias restantes', color: 'bg-warning' };
  return { label: diffDays + ' dias restantes', color: 'bg-success' };
}

export default function VehicleDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const vehicleId = parseInt(id);
  const { data: vehicle, isLoading, error } = useVehicle(isNaN(vehicleId) ? null : vehicleId);
  const { data: documents } = useVehicleDocuments(isNaN(vehicleId) ? null : vehicleId);
  const deleteMutation = useDeleteDocument();

  const [docDialogOpen, setDocDialogOpen] = useState(false);
  const [editingDoc, setEditingDoc] = useState<VehicleDocument | null>(null);

  function handleAddDoc() {
    setEditingDoc(null);
    setDocDialogOpen(true);
  }

  function handleEditDoc(doc: VehicleDocument) {
    setEditingDoc(doc);
    setDocDialogOpen(true);
  }

  async function handleDeleteDoc(doc: VehicleDocument) {
    if (!confirm('Eliminar documento ' + doc.typeLabel + '?')) return;
    try {
      await deleteMutation.mutateAsync(doc.id);
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      toast.error(e.response?.data?.error || 'Error al eliminar');
    }
  }

  if (isLoading) return <div className="p-6">Cargando vehiculo...</div>;
  if (error) return <div className="p-6 text-destructive">Error: {error.message}</div>;
  if (!vehicle) return <div className="p-6">Vehiculo no encontrado</div>;

  const apiUrl = process.env.NEXT_PUBLIC_API_URL || '';

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="outline" size="sm" onClick={() => router.push('/vehicles')}>
          Regresar
        </Button>
        <div className="flex-1">
          <h1 className="text-2xl font-bold">
            {vehicle.economicNumber} - {vehicle.plate}
          </h1>
          <p className="text-sm text-muted-foreground">
            {vehicle.brand} {vehicle.model} ({vehicle.year}) - {vehicle.vehicleType?.name}
          </p>
        </div>
        <Badge
          variant={vehicle.status === 'OPERATIVE' ? 'default' : 'destructive'}
          className="text-sm px-3 py-1"
        >
          {vehicle.status === 'OPERATIVE' ? 'Operativo' : 'Bloqueado'}
        </Badge>
      </div>

{vehicle.status === 'BLOCKED' && (
        <div className="rounded-md bg-destructive/10 border border-destructive/30 p-4 text-destructive">
          <p className="font-bold text-lg">⛔ UNIDAD BLOQUEADA</p>
          <p className="mt-1">
            {vehicle.blockReason
              ? vehicle.blockReason
              : 'Esta unidad tiene documentos vencidos. Renuévelos para desbloquear.'}
          </p>
          <p className="mt-2 text-sm text-destructive">
            No se permiten cargas de combustible ni nuevas asignaciones hasta regularizar.
          </p>
        </div>
      )}

      <div className="rounded-md border p-4">
        <h2 className="text-lg font-semibold mb-3">Informacion General</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
          <div>
            <span className="text-muted-foreground">Placa</span>
            <p className="font-medium">{vehicle.plate}</p>
          </div>
          <div>
            <span className="text-muted-foreground">No. Economico</span>
            <p className="font-medium">{vehicle.economicNumber}</p>
          </div>
          <div>
            <span className="text-muted-foreground">Tipo</span>
            <p className="font-medium">{vehicle.vehicleType?.name}</p>
          </div>
          <div>
            <span className="text-muted-foreground">Rendimiento esperado</span>
            <p className="font-medium">{vehicle.vehicleType?.expectedKmPerLiter} km/l</p>
          </div>
          <div>
            <span className="text-muted-foreground">Marca / Modelo</span>
            <p className="font-medium">{vehicle.brand} {vehicle.model}</p>
          </div>
          <div>
            <span className="text-muted-foreground">Año</span>
            <p className="font-medium">{vehicle.year}</p>
          </div>
          <div>
            <span className="text-muted-foreground">Odometro</span>
            <p className="font-medium">{formatNumber(vehicle.currentOdometer)} km</p>
          </div>
          <div>
            <span className="text-muted-foreground">VIN</span>
            <p className="font-medium">{vehicle.vin || '-'}</p>
          </div>
          <div>
            <span className="text-muted-foreground">Color</span>
            <p className="font-medium">{vehicle.color || '-'}</p>
          </div>
        </div>
      </div>

      <div className="rounded-md border p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold">
            Documentos ({documents?.length || 0})
          </h2>
          <Button size="sm" onClick={handleAddDoc}>+ Agregar documento</Button>
        </div>

        {documents && documents.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {documents.map((doc) => {
              const light = getDocTrafficLight(doc.expiresAt);
              return (
                <div
                  key={doc.id}
                  className="flex items-center justify-between rounded-md border p-3"
                >
                  <div className="flex-1">
                    <p className="font-medium">{doc.typeLabel}</p>
                    <p className="text-xs text-muted-foreground">
                      Vence: {formatDate(doc.expiresAt)}
                    </p>
                    {doc.fileName && (
                      <a 
                        href={apiUrl + doc.fileUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-primary hover:underline"
                      >
                        Archivo: {doc.fileName}
                      </a>
                    )}
                  </div>
                  <div className="flex items-center gap-2 ml-2">
                    <Badge className={light.color + ' text-white'}>
                      {light.label}
                    </Badge>
                    <Button variant="outline" size="sm" onClick={() => handleEditDoc(doc)}>
                      Editar
                    </Button>
                    <Button variant="destructive" size="sm" onClick={() => handleDeleteDoc(doc)}>
                      X
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="text-muted-foreground text-sm">Sin documentos registrados</p>
        )}
      </div>

      <div className="rounded-md border p-4">
        <h2 className="text-lg font-semibold mb-3">Resguardantes (asignaciones)</h2>
        {vehicle.assignments && vehicle.assignments.length > 0 ? (
          <div className="space-y-2">
            {vehicle.assignments.map((a: {
              id: number;
              operator?: { fullName?: string; licenseNumber?: string };
              startDate: string;
              endDate?: string | null;
            }) => (
              <div key={a.id} className="flex items-center justify-between text-sm border-b pb-2">
                <div>
                  <p className="font-medium">{a.operator?.fullName}</p>
                  <p className="text-xs text-muted-foreground">Licencia: {a.operator?.licenseNumber}</p>
                </div>
                <div className="text-right text-xs text-muted-foreground">
                  <p>{formatDate(a.startDate)}</p>
                  <p>{a.endDate ? 'Finalizada' : 'Vigente'}</p>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-muted-foreground text-sm">Sin asignaciones</p>
        )}
      </div>

      {/* Bitácora de notas (append-log editable) */}
      <VehicleNotesSection vehicleId={vehicleId} />

      <DocumentFormDialog
        open={docDialogOpen}
        onClose={() => setDocDialogOpen(false)}
        vehicleId={vehicleId}
        document={editingDoc}
      />
    </div>
  );
}