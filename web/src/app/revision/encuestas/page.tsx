'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  descargarEncuestasCsv,
  useEncuestas,
  type Encuesta,
} from '@/hooks/useEncuestas';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
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

// Tri-estado del filtro de audio. No es un booleano porque "todas" no es ni
// true ni false: solo con 'con'/'sin' se manda `conAudio` a la API.
type FiltroAudio = 'todas' | 'con' | 'sin';

const OPCIONES_AUDIO: { valor: FiltroAudio; etiqueta: string }[] = [
  { valor: 'todas', etiqueta: 'Todas' },
  { valor: 'con', etiqueta: 'Con audio' },
  { valor: 'sin', etiqueta: 'Sin audio' },
];

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
    accessorKey: 'versionCuestionario',
    header: 'Versión',
    // Las dos versiones del cuestionario conviven en la tabla: sin esta columna
    // no se sabe por qué unas filas traen unos campos y otras no.
    cell: ({ row }) => (
      <span className="font-mono text-sm">v{row.original.versionCuestionario}</span>
    ),
  },
  {
    id: 'preferenciaElectoral',
    header: 'Preferencia electoral',
    // v3 manda preferenciaElectoral; una fila v1 trae su equivalente candidatoPreferido.
    // El accessorFn fusiona ambos (como la columna 'dispositivo') para que el
    // orden client-side no agrupe las filas v1 como vacías.
    accessorFn: (row) => row.preferenciaElectoral ?? row.candidatoPreferido ?? '',
    cell: ({ row }) => row.original.preferenciaElectoral ?? row.original.candidatoPreferido ?? '—',
  },
  {
    id: 'preferenciaPartido',
    header: 'Preferencia partido',
    // v3 manda preferenciaPartido; una fila v1 trae su equivalente partidoPreferido.
    accessorFn: (row) => row.preferenciaPartido ?? row.partidoPreferido ?? '',
    cell: ({ row }) => row.original.preferenciaPartido ?? row.original.partidoPreferido ?? '—',
  },
  {
    id: 'preferenciaElectoralOtro',
    header: 'Preferencia electoral (texto)',
    // v4 con preferenciaElectoral='otro': texto libre de la preferencia.
    // NULL = v1/v3 o v4 sin el código 'otro'.
    cell: ({ row }) => row.original.preferenciaElectoralOtro ?? '—',
  },
  {
    id: 'preferenciaPartidoOtro',
    header: 'Preferencia partido (texto)',
    // v4 con preferenciaPartido='otro': texto libre de la preferencia.
    // NULL = v1/v3 o v4 sin el código 'otro'.
    cell: ({ row }) => row.original.preferenciaPartidoOtro ?? '—',
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
    accessorKey: 'audiosCount',
    header: 'Audio',
    // Solo el conteo: los segmentos y su reproductor viven en el detalle. Se
    // distingue "3 segmentos" de "Sin audio" con dos variantes de Badge porque
    // un 0 suelto en la columna se lee como dato faltante, no como ausencia.
    cell: ({ row }) =>
      row.original.audiosCount > 0 ? (
        <Badge variant="info">
          {row.original.audiosCount} {row.original.audiosCount === 1 ? 'segmento' : 'segmentos'}
        </Badge>
      ) : (
        <Badge variant="inactive">Sin audio</Badge>
      ),
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
  const [filtroAudio, setFiltroAudio] = useState<FiltroAudio>('todas');
  const router = useRouter();

  // 'todas' => `undefined` (el parámetro no viaja y la API no filtra). Se
  // calcula una sola vez para que el listado y el CSV exporten exactamente el
  // mismo recorte.
  const conAudio = filtroAudio === 'todas' ? undefined : filtroAudio === 'con';

  const { data, isLoading, isError, refetch } = useEncuestas({
    page,
    limit: 20,
    dateFrom: dateFrom || undefined,
    dateTo: dateTo || undefined,
    conAudio,
  });

  const limpiarFiltros = () => {
    setDateFrom('');
    setDateTo('');
    setFiltroAudio('todas');
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
        conAudio,
      });
    } finally {
      setDescargando(false);
    }
  };

  const hasFilters = Boolean(dateFrom || dateTo || filtroAudio !== 'todas');
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
        {/* Tres botones en vez de un select: son pocas opciones y así el estado
            activo se ve sin abrir nada. No hay componente segmentado en ui/. */}
        <div role="group" aria-label="Filtrar por audio" className="flex gap-1">
          {OPCIONES_AUDIO.map((opcion) => (
            <Button
              key={opcion.valor}
              size="sm"
              variant={filtroAudio === opcion.valor ? 'default' : 'outline'}
              aria-pressed={filtroAudio === opcion.valor}
              onClick={() => { setFiltroAudio(opcion.valor); setPage(1); }}
            >
              {opcion.etiqueta}
            </Button>
          ))}
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
        onRowClick={(row) => router.push(`/revision/encuestas/${row.id}`)}
        // El folio lo escribe el encuestador y puede faltar; el id de la fila es
        // el único identificador siempre presente para nombrar la acción.
        rowActionLabel={(row) => `Ver encuesta ${row.folioLocal ?? row.id}`}
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
