'use client';

import { useState } from 'react';
import { useQaRegistros, downloadQaZip, type QaRegistro } from '@/hooks/useQaRegistros';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import DataTable from '@/components/ui/data-table';
import { type ColumnDef } from '@tanstack/react-table';

// Base de la API: misma lógica que el cliente axios. Vacío → ruta relativa,
// que el rewrite /api/* de next.config.ts envía al backend (same-origin).
const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? '';

const TIPO_OPTIONS: { value: string; label: string }[] = [
  { value: '', label: 'Todos' },
  { value: 'lona', label: 'Lona' },
  { value: 'reunion', label: 'Reunión' },
  { value: 'barda', label: 'Barda' },
  { value: 'otro', label: 'Otro' },
];

const columns: ColumnDef<QaRegistro, unknown>[] = [
  {
    id: 'foto',
    header: 'Foto',
    enableSorting: false,
    cell: ({ row }) => {
      const imagenes = row.original.imagenes;
      const first = imagenes[0];
      if (!first) {
        return (
          <div className="h-14 w-14 rounded bg-muted flex items-center justify-center text-[10px] text-muted-foreground">
            Sin foto
          </div>
        );
      }
      return (
        <div className="relative h-14 w-14">
          {/* eslint-disable-next-line @next/next/no-img-element -- thumbnails de evidencia dinámica servidos por la API */}
          <img
            src={`${API_BASE}/api/qa-externa-registros/imagenes/${first.sha256}`}
            alt="Evidencia"
            className="h-14 w-14 object-cover rounded border border-border"
            loading="lazy"
          />
          {imagenes.length > 1 && (
            <Badge variant="secondary" className="absolute -right-1.5 -top-1.5">
              +{imagenes.length - 1}
            </Badge>
          )}
        </div>
      );
    },
  },
  {
    accessorKey: 'tipo',
    header: 'Tipo',
    cell: ({ row }) => <Badge variant="info">{row.original.tipo}</Badge>,
  },
  {
    accessorKey: 'capturadoAt',
    header: 'Fecha',
    cell: ({ row }) => new Date(row.original.capturadoAt).toLocaleString('es-MX'),
  },
  {
    id: 'ubicacion',
    header: 'Ubicación',
    enableSorting: false,
    cell: ({ row }) => (
      <span className="font-mono tabular-nums text-sm">
        {row.original.lat.toFixed(5)}, {row.original.lng.toFixed(5)}
      </span>
    ),
  },
  {
    id: 'dispositivo',
    header: 'Dispositivo',
    accessorFn: (row) => row.dispositivo?.identificador ?? '',
    cell: ({ row }) => row.original.dispositivo.identificador,
  },
];

export default function RevisionPage() {
  const [page, setPage] = useState(1);
  const [tipo, setTipo] = useState<string>('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [downloading, setDownloading] = useState(false);

  const { data, isLoading } = useQaRegistros({
    page,
    limit: 20,
    tipo: tipo || undefined,
    dateFrom: dateFrom || undefined,
    dateTo: dateTo || undefined,
  });

  const handleDownload = async () => {
    setDownloading(true);
    try {
      await downloadQaZip();
    } finally {
      setDownloading(false);
    }
  };

  const hasFilters = Boolean(tipo || dateFrom || dateTo);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Evidencias de campo</h1>
          <p className="text-sm text-muted-foreground">{data?.pagination?.total || 0} evidencias registradas</p>
        </div>
      </div>

      {/* Filtros: tipo + rango de fechas */}
      <div className="flex gap-2 items-end flex-wrap">
        <div>
          <label className="text-xs text-muted-foreground">Tipo</label>
          <select
            value={tipo}
            onChange={(e) => { setTipo(e.target.value); setPage(1); }}
            className="h-9 w-full min-w-0 rounded-md border border-input bg-transparent px-3 py-1 text-sm transition-colors outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
          >
            {TIPO_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-xs text-muted-foreground">Desde</label>
          <Input type="date" value={dateFrom} onChange={(e) => { setDateFrom(e.target.value); setPage(1); }} />
        </div>
        <div>
          <label className="text-xs text-muted-foreground">Hasta</label>
          <Input type="date" value={dateTo} onChange={(e) => { setDateTo(e.target.value); setPage(1); }} />
        </div>
        {hasFilters && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => { setTipo(''); setDateFrom(''); setDateTo(''); setPage(1); }}
          >
            Limpiar
          </Button>
        )}
      </div>

      <DataTable
        columns={columns}
        data={data?.data || []}
        pagination={data?.pagination}
        page={page}
        onPageChange={setPage}
        isLoading={isLoading}
        headerActions={
          <Button onClick={handleDownload} disabled={downloading}>
            {downloading ? 'Generando…' : 'Descargar todo (ZIP)'}
          </Button>
        }
      />
    </div>
  );
}
