'use client';

import { useState } from 'react';
import { useWorkshops, useDeleteWorkshop, Workshop } from '@/hooks/useWorkshops';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { SkeletonTable } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import WorkshopFormDialog from '@/components/workshops/WorkshopFormDialog';
import { toast } from '@/components/ui/toast';
import { Building2, Plus } from 'lucide-react';

export default function WorkshopsPage() {
  const { data: workshops, isLoading } = useWorkshops();
  const deleteMut = useDeleteWorkshop();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Workshop | null>(null);

  async function handleDelete(w: Workshop) {
    if (!confirm(`¿Dar de baja "${w.legalName}"?`)) return;
    try { await deleteMut.mutateAsync(w.id); }
    catch (e) {
      const err = e as { response?: { data?: { error?: string } } };
      toast.error(err.response?.data?.error || 'Error');
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Talleres certificados"
        description="Catálogo de talleres con campos fiscales completos"
        actions={
          <Button onClick={() => { setEditing(null); setDialogOpen(true); }}>
            <Plus className="size-4" /> Nuevo taller
          </Button>
        }
      />

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-5"><SkeletonTable rows={5} cols={5} /></div>
          ) : !workshops || workshops.length === 0 ? (
            <div className="p-5">
              <EmptyState
                icon={Building2}
                title="Sin talleres registrados"
                description="Agrega el primer taller para asignar mantenimientos."
                action={<Button onClick={() => { setEditing(null); setDialogOpen(true); }}>+ Nuevo taller</Button>}
              />
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>RFC</TableHead>
                  <TableHead>Razón social</TableHead>
                  <TableHead>Correo</TableHead>
                  <TableHead>Teléfono</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead className="text-right">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {workshops.map((w) => (
                  <TableRow key={w.id}>
                    <TableCell className="font-mono text-xs">{w.rfc}</TableCell>
                    <TableCell>
                      <div className="font-medium">{w.legalName}</div>
                      {w.tradeName && <div className="text-xs text-muted-foreground">{w.tradeName}</div>}
                    </TableCell>
                    <TableCell className="text-xs">{w.email}</TableCell>
                    <TableCell className="font-mono text-xs tabular-nums">{w.phone}</TableCell>
                    <TableCell>
                      <Badge variant={w.isActive ? 'operative' : 'inactive'}>
                        {w.isActive ? 'Activo' : 'Inactivo'}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right space-x-1">
                      <Button size="xs" variant="ghost" onClick={() => { setEditing(w); setDialogOpen(true); }}>
                        Editar
                      </Button>
                      {w.isActive && (
                        <Button size="xs" variant="ghost" onClick={() => handleDelete(w)} className="hover:text-destructive">
                          Baja
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <WorkshopFormDialog
        open={dialogOpen}
        onClose={() => { setDialogOpen(false); setEditing(null); }}
        workshop={editing}
      />
    </div>
  );
}
