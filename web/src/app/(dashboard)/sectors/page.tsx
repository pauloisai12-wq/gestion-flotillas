'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { SkeletonTable } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/empty-state';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { toast } from '@/components/ui/toast';
import { Building2, Plus, AlertTriangle } from 'lucide-react';

interface Sector {
  id: number;
  code: string;
  name: string;
  isActive: boolean;
}

function useSectors() {
  return useQuery({
    queryKey: ['sectors'],
    queryFn: async () => {
      const res = await api.get('/sectors', { params: { includeInactive: true } });
      return (res.data.data as Sector[]) || [];
    },
  });
}

export default function SectorsPage() {
  const { data: sectors, isLoading } = useSectors();
  const qc = useQueryClient();

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Sector | null>(null);
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState('');

  const saveMut = useMutation({
    mutationFn: async () => {
      if (editing) {
        return (await api.patch(`/sectors/${editing.id}`, { code, name })).data;
      }
      return (await api.post('/sectors', { code, name })).data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sectors'] });
      setOpen(false);
      setEditing(null);
      setCode('');
      setName('');
    },
  });

  const deleteMut = useMutation({
    mutationFn: async (id: number) => (await api.delete(`/sectors/${id}`)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sectors'] }),
  });

  function handleOpen(s?: Sector) {
    if (s) {
      setEditing(s);
      setCode(s.code);
      setName(s.name);
    } else {
      setEditing(null);
      setCode('');
      setName('');
    }
    setError('');
    setOpen(true);
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (!/^[A-Z0-9\-_]{2,30}$/.test(code)) {
      setError('Código: 2-30 caracteres, solo mayúsculas, números, - o _');
      return;
    }
    if (name.trim().length < 2) {
      setError('Nombre: mínimo 2 caracteres');
      return;
    }
    try {
      await saveMut.mutateAsync();
    } catch (err) {
      const e = err as { response?: { data?: { error?: string } } };
      setError(e.response?.data?.error || 'Error al guardar');
    }
  }

  async function handleDelete(s: Sector) {
    if (!confirm(`¿Desactivar sector "${s.name}"?`)) return;
    try { await deleteMut.mutateAsync(s.id); }
    catch (e) { toast.error('Error: ' + (e as Error).message); }
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Sectores"
        description="Catálogo de sectores operativos para clasificación de vehículos"
        actions={
          <Button onClick={() => handleOpen()}>
            <Plus className="size-4" /> Nuevo sector
          </Button>
        }
      />

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-5"><SkeletonTable rows={5} cols={4} /></div>
          ) : !sectors || sectors.length === 0 ? (
            <div className="p-5">
              <EmptyState
                icon={Building2}
                title="Sin sectores"
                description="Agrega sectores operativos para clasificar vehículos por zona."
                action={<Button onClick={() => handleOpen()}>+ Nuevo sector</Button>}
              />
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Código</TableHead>
                  <TableHead>Nombre</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead className="text-right">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sectors.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell className="font-mono font-medium">{s.code}</TableCell>
                    <TableCell>{s.name}</TableCell>
                    <TableCell>
                      <Badge variant={s.isActive ? 'operative' : 'inactive'}>
                        {s.isActive ? 'Activo' : 'Inactivo'}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right space-x-1">
                      <Button size="xs" variant="ghost" onClick={() => handleOpen(s)}>Editar</Button>
                      {s.isActive && (
                        <Button size="xs" variant="ghost" onClick={() => handleDelete(s)} className="hover:text-destructive">
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

      <Dialog open={open} onOpenChange={(isOpen) => !isOpen && setOpen(false)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editing ? 'Editar sector' : 'Nuevo sector'}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSave} className="space-y-4">
            <div>
              <label className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground block mb-1.5">
                Código (único) *
              </label>
              <Input
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                placeholder="CENTRO-01"
                maxLength={30}
                required
                className="font-mono"
                disabled={!!editing}
              />
            </div>
            <div>
              <label className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground block mb-1.5">
                Nombre *
              </label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Zona Centro"
                required
                maxLength={100}
              />
            </div>

            {error && (
              <div className="flex items-start gap-2 rounded-md bg-destructive/10 border border-destructive/20 text-destructive px-3 py-2 text-sm">
                <AlertTriangle className="size-4 mt-0.5 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={saveMut.isPending}>
                Cancelar
              </Button>
              <Button type="submit" disabled={saveMut.isPending}>
                {saveMut.isPending ? 'Guardando…' : editing ? 'Guardar cambios' : 'Crear'}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
