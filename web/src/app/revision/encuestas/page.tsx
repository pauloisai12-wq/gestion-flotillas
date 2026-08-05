'use client';

import { useState } from 'react';
import {
  descargarEncuestasCsv,
  useEncuestas,
  type Encuesta,
} from '@/hooks/useEncuestas';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import DataTable from '@/components/ui/data-table';
import { toast } from '@/components/ui/toast';
import { Download } from 'lucide-react';
import { type ColumnDef } from '@tanstack/react-table';

// Tope de filas que la API entrega en una sola exportación. Fuente de verdad:
// el iterador de lotes de api/src/services/encuestasRevisionService.ts. Aquí
// solo se replica para poder avisar ANTES de descargar; si allá cambia, cambia
// también aquí.
const MAX_ENCUESTAS_CSV = 50_000;

// Rango máximo de la exportación, en días civiles contando ambos extremos.
// Fuente de verdad: el superRefine de
// api/src/validators/encuestasRevisionValidator.ts.
const MAX_DIAS_EXPORT = 366;

// Mismo cálculo que hace el validador del servidor (diferencia en UTC + 1), para
// que el guard del cliente no discrepe por un día con el 400 de la API.
function diasDelRango(desde: string, hasta: string): number {
  const from = Date.parse(`${desde}T00:00:00.000Z`);
  const to = Date.parse(`${hasta}T00:00:00.000Z`);
  if (Number.isNaN(from) || Number.isNaN(to)) return 0;
  return Math.floor((to - from) / 86_400_000) + 1;
}

// El cronómetro de la app manda segundos; en la tabla se leen comparando entre
// filas, así que se muestran como mm:ss y con cifras tabulares.
function duracionMmSs(segundos: number): string {
  const total = Math.max(0, Math.trunc(segundos));
  const min = Math.floor(total / 60);
  const seg = total % 60;
  return `${min.toString().padStart(2, '0')}:${seg.toString().padStart(2, '0')}`;
}

const columns: ColumnDef<Encuesta, unknown>[] = [
  {
    accessorKey: 'recibidoEn',
    header: 'Recibido',
    cell: ({ row }) => new Date(row.original.recibidoEn).toLocaleString('es-MX'),
  },
  {
    accessorKey: 'folioLocal',
    header: 'Folio',
    // El folio lo escribe el encuestador en el teléfono y puede faltar; no es
    // único entre dispositivos, así que solo se muestra, no identifica.
    cell: ({ row }) => (
      <span className="font-mono text-sm">{row.original.folioLocal ?? '—'}</span>
    ),
  },
  {
    accessorKey: 'encuestador',
    header: 'Encuestador',
    // Quien levantó la encuesta. Opcional en el contrato: las capturadas por
    // una app anterior al campo llegan en null.
    cell: ({ row }) => row.original.encuestador ?? '—',
  },
  {
    accessorKey: 'preferenciaElectoral',
    header: 'Preferencia electoral',
    cell: ({ row }) => row.original.preferenciaElectoral ?? '—',
  },
  {
    accessorKey: 'preferenciaPartido',
    header: 'Preferencia partido',
    cell: ({ row }) => row.original.preferenciaPartido ?? '—',
  },
  {
    accessorKey: 'conoceLalo',
    header: 'Conoce a Lalo',
    // 'si'/'no' del catálogo v3; null = fila v1 residual sin el dato.
    cell: ({ row }) => {
      const v = row.original.conoceLalo;
      if (v === null || v === undefined) return '—';
      return v === 'si' ? 'Sí' : 'No';
    },
  },
  {
    accessorKey: 'duracionSegundos',
    header: 'Duración',
    cell: ({ row }) => (
      <span className="font-mono tabular-nums text-sm">
        {duracionMmSs(row.original.duracionSegundos)}
      </span>
    ),
  },
  {
    accessorKey: 'ubicacionDisponible',
    header: 'Ubicación',
    // Tres estados reales: sí, no, y "el teléfono no mandó el bloque" (null).
    // Las coordenadas no se muestran aquí; salen solo en el CSV.
    cell: ({ row }) => {
      const disponible = row.original.ubicacionDisponible;
      if (disponible === null || disponible === undefined) return '—';
      return disponible ? 'Sí' : 'No';
    },
  },
  {
    id: 'dispositivo',
    header: 'Dispositivo',
    accessorFn: (row) => row.dispositivo?.identificador ?? '',
    cell: ({ row }) => row.original.dispositivo.identificador,
  },
];

export default function RevisionEncuestasPage() {
  const [page, setPage] = useState(1);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [descargando, setDescargando] = useState(false);

  const { data, isLoading, isError, refetch } = useEncuestas({
    page,
    limit: 20,
    dateFrom: dateFrom || undefined,
    dateTo: dateTo || undefined,
  });

  const limpiarFiltros = () => {
    setDateFrom('');
    setDateTo('');
    setPage(1);
  };

  // Motivo por el que el rango no sirve para exportar, o null si está bien. Se
  // valida en el cliente igual que en las páginas hermanas (revision/personas,
  // revision/evidencias) porque la validación del servidor viaja en un HEAD y su
  // 400 llega sin cuerpo: sin este guard el revisor solo vería un error genérico
  // y un botón que lo invita a reintentar algo que nunca va a funcionar.
  const motivoRangoInvalido = (() => {
    if (!dateFrom || !dateTo) return 'Selecciona un rango de fechas para descargar el CSV';
    if (dateFrom > dateTo) return 'La fecha inicial no puede ser posterior a la fecha final';
    if (diasDelRango(dateFrom, dateTo) > MAX_DIAS_EXPORT) {
      return `El rango máximo de exportación es de ${MAX_DIAS_EXPORT} días: acorta el periodo y descarga por partes`;
    }
    return null;
  })();

  const handleDescargarCsv = async () => {
    // Red de seguridad: el botón ya sale deshabilitado con un rango inválido.
    if (motivoRangoInvalido) {
      toast.error(`${motivoRangoInvalido}.`);
      return;
    }
    setDescargando(true);
    try {
      await descargarEncuestasCsv({
        dateFrom,
        dateTo,
      });
    } finally {
      setDescargando(false);
    }
  };

  const hasFilters = Boolean(dateFrom || dateTo);
  const totalEncuestas = data?.pagination?.total ?? 0;

  // Con el rango a medio llenar no se avisa nada: el título del botón ya dice
  // que faltan fechas y un segundo mensaje solo sería ruido.
  const avisoRango = dateFrom && dateTo ? motivoRangoInvalido : null;
  // El CSV se corta en seco al llegar al tope y responde 200: sin este aviso el
  // revisor daría el archivo por completo y contaría de menos.
  const avisoTope = !avisoRango && totalEncuestas > MAX_ENCUESTAS_CSV
    ? `El CSV se corta en ${MAX_ENCUESTAS_CSV.toLocaleString('es-MX')} filas: de las ${totalEncuestas.toLocaleString('es-MX')} encuestas del filtro solo se exportarán las más antiguas. Acorta el rango de fechas para descargarlas todas.`
    : null;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Encuestas</h1>
        <p className="text-sm text-muted-foreground">
          App <span className="font-medium text-foreground">Encuestas Okrean</span> · {totalEncuestas} encuestas
        </p>
      </div>

      {/* Filtros: rango de fechas (sobre la fecha de finalización). */}
      <div className="flex gap-2 items-end flex-wrap">
        <div>
          <label htmlFor="encuestas-date-from" className="text-xs text-muted-foreground">Desde</label>
          <Input
            id="encuestas-date-from"
            type="date"
            value={dateFrom}
            onChange={(e) => { setDateFrom(e.target.value); setPage(1); }}
          />
        </div>
        <div>
          <label htmlFor="encuestas-date-to" className="text-xs text-muted-foreground">Hasta</label>
          <Input
            id="encuestas-date-to"
            type="date"
            value={dateTo}
            onChange={(e) => { setDateTo(e.target.value); setPage(1); }}
          />
        </div>
        {hasFilters && (
          <Button variant="outline" size="sm" onClick={limpiarFiltros}>
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
        error={isError ? 'No fue posible consultar las encuestas.' : null}
        onRetry={() => refetch()}
        emptyTitle="No hay encuestas para estos filtros"
        emptyDescription="Cambia el rango de fechas e intenta nuevamente."
        headerActions={
          <div className="flex flex-wrap items-center justify-end gap-2">
            {avisoRango ? (
              <span className="max-w-sm text-right text-xs text-destructive" role="alert">
                {avisoRango}.
              </span>
            ) : null}
            {avisoTope ? (
              <span className="max-w-sm text-right text-xs text-warning-readable" role="status">
                {avisoTope}
              </span>
            ) : null}
            <Button
              variant="outline"
              size="sm"
              onClick={handleDescargarCsv}
              disabled={Boolean(motivoRangoInvalido) || descargando}
              title={motivoRangoInvalido ?? undefined}
            >
              <Download aria-hidden="true" className="h-4 w-4 mr-1" />
              {descargando ? 'Descargando…' : 'Descargar CSV'}
            </Button>
          </div>
        }
      />
    </div>
  );
}
