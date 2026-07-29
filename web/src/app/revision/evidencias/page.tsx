'use client';

import { useEffect, useState } from 'react';
import {
  createQaExport,
  downloadQaZip,
  getActiveQaExport,
  useActiveQaExport,
  useQaExportJob,
  useQaRegistros,
  type QaRegistro,
  type QaPrograma,
} from '@/hooks/useQaRegistros';
import { getApiError } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import DataTable from '@/components/ui/data-table';
import ProgramaSwitch from '@/components/revision/ProgramaSwitch';
import { toast } from '@/components/ui/toast';
import { type ColumnDef } from '@tanstack/react-table';

// Base de la API: misma lógica que el cliente axios. Vacío → ruta relativa,
// que el rewrite /api/* de next.config.ts envía al backend (same-origin).
const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? '';
const PENDING_QA_EXPORT_STORAGE_KEY = 'flotillas.pendingQaExport';

interface StoredQaExport {
  id: number;
  programa?: QaPrograma;
  dateFrom?: string;
  dateTo?: string;
}

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
      const originalUrl = `${API_BASE}/api/qa-externa-registros/imagenes/${first.programa}/${first.sha256}`;
      const thumbnailUrl = `${API_BASE}${first.thumbnailUrl}`;
      return (
        <div className="relative h-14 w-14">
          {/* eslint-disable-next-line @next/next/no-img-element -- thumbnails de evidencia dinámica servidos por la API */}
          <img
            src={thumbnailUrl}
            alt="Evidencia"
            className="h-14 w-14 object-cover rounded border border-border"
            loading="lazy"
            onError={(event) => {
              const image = event.currentTarget;
              const attempts = Number(image.dataset.thumbnailAttempts || 0);
              if (attempts < 2) {
                image.dataset.thumbnailAttempts = String(attempts + 1);
                window.setTimeout(() => {
                  image.src = `${thumbnailUrl}?retry=${Date.now()}`;
                }, 3_000);
              } else if (image.dataset.originalFallback !== 'true') {
                image.dataset.originalFallback = 'true';
                image.src = originalUrl;
              }
            }}
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
  {
    // Nombre que el operador le pone al celular en la app GeoCampo (campo
    // identificador_app de cada registro). Es distinto de 'Dispositivo', que es
    // el identificador de la API key fijado por el admin al registrar el equipo.
    accessorKey: 'identificadorApp',
    header: 'Celular',
    cell: ({ row }) => row.original.identificadorApp,
  },
];

export default function RevisionPage() {
  // El programa es la TABLA activa (no un filtro): siempre hay una seleccionada.
  const [programa, setPrograma] = useState<QaPrograma>('BUFFALO');
  const [page, setPage] = useState(1);
  const [tipo, setTipo] = useState<string>('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [exportJobId, setExportJobId] = useState<number | null>(null);
  const [exportContextKnown, setExportContextKnown] = useState(false);
  const [localExportRestoreComplete, setLocalExportRestoreComplete] = useState(false);
  const [creatingExport, setCreatingExport] = useState(false);
  const [downloading, setDownloading] = useState(false);

  const { data, isLoading, isError, refetch } = useQaRegistros({
    page,
    limit: 20,
    programa, // siempre uno: la tabla es de un solo programa
    tipo: tipo || undefined,
    dateFrom: dateFrom || undefined,
    dateTo: dateTo || undefined,
  });
  const {
    data: exportJob,
    isError: exportJobQueryFailed,
    refetch: refetchExportJob,
  } = useQaExportJob(exportJobId);
  const activeExportQuery = useActiveQaExport(
    localExportRestoreComplete && exportJobId === null,
  );

  useEffect(() => {
    const raw = window.sessionStorage.getItem(PENDING_QA_EXPORT_STORAGE_KEY);
    let stored: StoredQaExport | null = null;
    if (raw) {
      try {
        const candidate = JSON.parse(raw) as Partial<StoredQaExport>;
        if (Number.isInteger(candidate.id) && Number(candidate.id) > 0) {
          const hasContext =
            (candidate.programa === 'BUFFALO' || candidate.programa === 'LX')
            && typeof candidate.dateFrom === 'string'
            && typeof candidate.dateTo === 'string';
          stored = hasContext
            ? candidate as StoredQaExport
            : { id: Number(candidate.id) };
        }
      } catch {
        // Un valor corrupto no debe impedir usar la pantalla.
      }
      if (!stored) window.sessionStorage.removeItem(PENDING_QA_EXPORT_STORAGE_KEY);
    }

    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      if (stored) {
        if (stored.programa && stored.dateFrom != null && stored.dateTo != null) {
          setPrograma(stored.programa);
          setDateFrom(stored.dateFrom);
          setDateTo(stored.dateTo);
          setExportContextKnown(true);
        }
        setExportJobId(stored.id);
      }
      setLocalExportRestoreComplete(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const activeExport = activeExportQuery.data;
    if (activeExportQuery.isFetching || !activeExport || exportJobId !== null) return;
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      setExportJobId(activeExport.id);
      setExportContextKnown(false);
      window.sessionStorage.setItem(
        PENDING_QA_EXPORT_STORAGE_KEY,
        JSON.stringify({ id: activeExport.id } satisfies StoredQaExport),
      );
    });
    return () => {
      cancelled = true;
    };
  }, [activeExportQuery.data, activeExportQuery.isFetching, exportJobId]);

  const clearExportJob = () => {
    setExportJobId(null);
    setExportContextKnown(false);
    window.sessionStorage.removeItem(PENDING_QA_EXPORT_STORAGE_KEY);
  };

  // Cambiar de tabla: reinicia paginación y filtros de la vista anterior.
  const switchPrograma = (p: QaPrograma) => {
    if (p === programa) return;
    setPrograma(p);
    setPage(1);
    setTipo('');
    setDateFrom('');
    setDateTo('');
    clearExportJob();
  };

  const handleCreateExport = async () => {
    if (!dateFrom || !dateTo) return;
    if (dateFrom > dateTo) {
      toast.error('La fecha inicial no puede ser posterior a la fecha final.');
      return;
    }
    setCreatingExport(true);
    try {
      const job = await createQaExport(programa, dateFrom, dateTo);
      setExportJobId(job.id);
      setExportContextKnown(true);
      window.sessionStorage.setItem(PENDING_QA_EXPORT_STORAGE_KEY, JSON.stringify({
        id: job.id,
        programa,
        dateFrom,
        dateTo,
      } satisfies StoredQaExport));
    } catch (err) {
      if (getApiError(err).status === 409) {
        try {
          const activeExport = await getActiveQaExport();
          if (activeExport) {
            setExportJobId(activeExport.id);
            setExportContextKnown(false);
            window.sessionStorage.setItem(
              PENDING_QA_EXPORT_STORAGE_KEY,
              JSON.stringify({ id: activeExport.id } satisfies StoredQaExport),
            );
            toast.info('Se recuperó la exportación que ya estaba en proceso.');
            return;
          }
        } catch {
          // El mensaje general cubre también un fallo al recuperar el job activo.
        }
      }
      toast.error('No se pudo iniciar la exportación. Intenta nuevamente.');
    } finally {
      setCreatingExport(false);
    }
  };

  const handleDownload = async () => {
    if (!exportJob || exportJob.status !== 'COMPLETED') return;
    setDownloading(true);
    try {
      await downloadQaZip(exportJob);
    } finally {
      setDownloading(false);
    }
  };

  const hasFilters = Boolean(tipo || dateFrom || dateTo);
  const discoveringActiveExport =
    exportJobId === null
    && (!localExportRestoreComplete || activeExportQuery.isFetching);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Evidencias de campo</h1>
        <p className="text-sm text-muted-foreground">
          Registro <span className="font-medium text-foreground">{programa}</span> · {data?.pagination?.total || 0} evidencias
        </p>
      </div>

      {/* Switch de tabla por programa: dos tablas independientes (BUFFALO / LX). */}
      <ProgramaSwitch value={programa} onChange={switchPrograma} />

      {/* Filtros de la tabla activa: tipo + rango de fechas. */}
      <div className="flex gap-2 items-end flex-wrap">
        <div>
          <label htmlFor="qa-tipo" className="text-xs text-muted-foreground">Tipo</label>
          <select
            id="qa-tipo"
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
          <label htmlFor="qa-date-from" className="text-xs text-muted-foreground">Desde</label>
          <Input id="qa-date-from" type="date" value={dateFrom} onChange={(e) => { setDateFrom(e.target.value); setPage(1); clearExportJob(); }} />
        </div>
        <div>
          <label htmlFor="qa-date-to" className="text-xs text-muted-foreground">Hasta</label>
          <Input id="qa-date-to" type="date" value={dateTo} onChange={(e) => { setDateTo(e.target.value); setPage(1); clearExportJob(); }} />
        </div>
        {hasFilters && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => { setTipo(''); setDateFrom(''); setDateTo(''); setPage(1); clearExportJob(); }}
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
        error={isError ? 'No fue posible consultar las evidencias de campo.' : null}
        onRetry={() => refetch()}
        emptyTitle="No hay evidencias para estos filtros"
        emptyDescription="Cambia el programa, tipo o rango de fechas e intenta nuevamente."
        headerActions={
          <div className="flex flex-wrap items-center justify-end gap-2">
            {exportJobQueryFailed ? (
              <>
                <span className="text-xs text-destructive" role="alert">
                  No se pudo recuperar el estado de la exportación.
                </span>
                <Button type="button" onClick={() => void refetchExportJob()}>
                  Reintentar consulta
                </Button>
                <Button type="button" variant="outline" onClick={clearExportJob}>
                  Descartar trabajo
                </Button>
              </>
            ) : (
              <>
                {discoveringActiveExport ? (
                  <span className="text-xs text-muted-foreground" role="status">
                    Buscando exportación activa…
                  </span>
                ) : null}
                {exportJob ? (
                  <span className="text-xs text-muted-foreground" role="status" aria-live="polite">
                    {exportJob.status === 'QUEUED' && 'Exportación en cola'}
                    {exportJob.status === 'PROCESSING' && `Generando… ${exportJob.progress}%`}
                    {exportJob.status === 'COMPLETED' && 'Exportación lista'}
                    {exportJob.status === 'FAILED' && (exportJob.errorMessage || 'Falló la exportación')}
                  </span>
                ) : null}
                {exportJob?.status === 'COMPLETED' ? (
                  <Button onClick={handleDownload} disabled={downloading}>
                    {downloading
                      ? 'Descargando…'
                      : exportContextKnown
                        ? `Descargar ${programa} (ZIP)`
                        : 'Descargar exportación (ZIP)'}
                  </Button>
                ) : (
                  <Button
                    onClick={handleCreateExport}
                    disabled={
                      discoveringActiveExport
                      || !dateFrom
                      || !dateTo
                      || creatingExport
                      || exportJob?.status === 'QUEUED'
                      || exportJob?.status === 'PROCESSING'
                    }
                    title={!dateFrom || !dateTo
                      ? 'Selecciona un rango de fechas para exportar'
                      : undefined}
                  >
                    {creatingExport
                      ? 'Encolando…'
                      : exportJob?.status === 'FAILED'
                        ? 'Reintentar exportación'
                        : 'Generar ZIP'}
                  </Button>
                )}
              </>
            )}
          </div>
        }
      />
    </div>
  );
}
