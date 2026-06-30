// Búsqueda de solicitudes de mantenimiento (revisor: ADMIN / SUPERVISOR_MAINTENANCE).
// Filtros: CIV, placa, serie (VIN) y folio. Folio y CIV exactos; placa y serie parciales.
// El RBAC real lo aplica el API (GET /maintenance-tickets/search, MAINT_MANAGERS).

'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/contexts/AuthContext';
import {
  useSearchTickets,
  STATUS_LABELS,
  STATUS_COLORS,
  type SearchTicketFilters,
} from '@/hooks/useMaintenanceTickets';
import { PageHeader } from '@/components/ui/page-header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { EmptyState } from '@/components/ui/empty-state';
import { cn } from '@/lib/utils';
import { formatDate } from '@/lib/formatters';
import { Search, SearchX, FileText, Loader2 } from 'lucide-react';

// Mismo patrón que el resto de la app para servir archivos auth-gated del API.
const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? '';

export default function BuscarSolicitudesPage() {
  const { user } = useAuth();
  const canSearch = user?.role === 'ADMIN' || user?.role === 'SUPERVISOR_MAINTENANCE';

  const [form, setForm] = useState({ civ: '', placa: '', serie: '', folio: '' });
  const [applied, setApplied] = useState<SearchTicketFilters | null>(null);

  const { data, isFetching, isError } = useSearchTickets(
    applied ?? {},
    applied !== null && canSearch,
  );

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const f: SearchTicketFilters = {};
    if (form.civ.trim()) f.civ = form.civ.trim();
    if (form.placa.trim()) f.placa = form.placa.trim();
    if (form.serie.trim()) f.serie = form.serie.trim();
    if (form.folio.trim()) f.folio = form.folio.trim();
    setApplied(f);
  }

  function onClear() {
    setForm({ civ: '', placa: '', serie: '', folio: '' });
    setApplied(null);
  }

  if (!canSearch) {
    return (
      <div className="p-6">
        <EmptyState
          icon={SearchX}
          title="Sin acceso"
          description="Esta búsqueda es solo para administradores y supervisores de mantenimiento."
        />
      </div>
    );
  }

  const tickets = data?.tickets ?? [];

  return (
    <div className="p-6 space-y-6">
      <PageHeader
        title="Buscar solicitudes de mantenimiento"
        description="Consulta solicitudes por CIV, placa, serie (VIN) o folio."
      />

      <form
        onSubmit={onSubmit}
        className="bg-card border border-border rounded-lg p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4"
      >
        <div className="space-y-1.5">
          <Label>Folio</Label>
          <Input
            placeholder="SM-2026-00042"
            value={form.folio}
            onChange={(e) => setForm((s) => ({ ...s, folio: e.target.value }))}
          />
        </div>
        <div className="space-y-1.5">
          <Label>CIV</Label>
          <Input
            placeholder="Clave de identificación"
            value={form.civ}
            onChange={(e) => setForm((s) => ({ ...s, civ: e.target.value }))}
          />
        </div>
        <div className="space-y-1.5">
          <Label>Placa</Label>
          <Input
            placeholder="ABC-12-34"
            value={form.placa}
            onChange={(e) => setForm((s) => ({ ...s, placa: e.target.value }))}
          />
        </div>
        <div className="space-y-1.5">
          <Label>Serie (VIN)</Label>
          <Input
            placeholder="3VWFE21C…"
            value={form.serie}
            onChange={(e) => setForm((s) => ({ ...s, serie: e.target.value }))}
          />
        </div>
        <div className="sm:col-span-2 lg:col-span-4 flex items-center justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClear}>
            Limpiar
          </Button>
          <Button type="submit">
            <Search className="size-4 mr-1.5" /> Buscar
          </Button>
        </div>
      </form>

      {applied === null ? (
        <EmptyState
          icon={Search}
          title="Realiza una búsqueda"
          description="Folio y CIV se buscan exactos; placa y serie aceptan coincidencias parciales."
        />
      ) : isFetching ? (
        <div className="flex items-center justify-center gap-2 p-6 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Buscando…
        </div>
      ) : isError ? (
        <div className="p-6 text-center text-sm text-destructive">
          No se pudo realizar la búsqueda. Intenta de nuevo.
        </div>
      ) : tickets.length === 0 ? (
        <EmptyState
          icon={SearchX}
          title="Sin resultados"
          description="Ninguna solicitud coincide con los criterios."
        />
      ) : (
        <div className="space-y-2">
          <div className="border border-border rounded-lg overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Folio</TableHead>
                  <TableHead>Vehículo</TableHead>
                  <TableHead>Placa / Serie / CIV</TableHead>
                  <TableHead>Estatus</TableHead>
                  <TableHead>Fecha</TableHead>
                  <TableHead className="text-right">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {tickets.map((t) => (
                  <TableRow key={t.id}>
                    <TableCell className="font-medium tabular-nums">{t.folio ?? '—'}</TableCell>
                    <TableCell>
                      <div className="text-sm">{t.vehicle?.economicNumber ?? '—'}</div>
                      <div className="text-xs text-muted-foreground">
                        {[t.vehicle?.brand, t.vehicle?.model, t.vehicle?.year]
                          .filter(Boolean)
                          .join(' ')}
                      </div>
                    </TableCell>
                    <TableCell className="text-xs">
                      <div>{t.vehicle?.plate ?? '—'}</div>
                      <div className="text-muted-foreground">{t.vehicle?.vin ?? '—'}</div>
                      <div className="text-muted-foreground">{t.vehicle?.civ ?? '—'}</div>
                    </TableCell>
                    <TableCell>
                      <span
                        className={cn(
                          'inline-block rounded-full px-2 py-0.5 text-xs font-medium',
                          STATUS_COLORS[t.status],
                        )}
                      >
                        {STATUS_LABELS[t.status]}
                      </span>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {formatDate(t.createdAt)}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-3">
                        <Link
                          href={`/tickets/${t.id}`}
                          className="text-xs text-primary hover:underline"
                        >
                          Ver detalle
                        </Link>
                        <a
                          href={`${API_BASE}/api/maintenance-tickets/${t.id}/solicitud.pdf`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-muted-foreground hover:text-foreground"
                          title="PDF de la solicitud"
                        >
                          <FileText className="size-4" />
                        </a>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <p className="text-xs text-muted-foreground">{data?.total ?? tickets.length} resultado(s).</p>
        </div>
      )}
    </div>
  );
}
