'use client';

import { useEffect, useState } from 'react';
import {
  descargarPersonasCsv,
  useQaPersonas,
  type QaPersona,
} from '@/hooks/useQaPersonas';
import { type QaPrograma } from '@/hooks/useQaRegistros';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import DataTable from '@/components/ui/data-table';
import ProgramaSwitch from '@/components/revision/ProgramaSwitch';
import { toast } from '@/components/ui/toast';
import { type ColumnDef } from '@tanstack/react-table';

// Retardo del filtro de texto: la búsqueda pega contra la BD con un LIKE sobre
// nombre y teléfono, así que no se dispara en cada tecla.
const BUSQUEDA_DEBOUNCE_MS = 400;

// Tope de filas que la API entrega en una sola exportación. Fuente de verdad:
// MAX_QA_PERSONAS_EXPORT en api/src/services/qaExternaPersonasService.ts:17
// (se aplica en el iterador de lotes, :159-160). Aquí solo se replica para
// poder avisar ANTES de descargar; si allá cambia, cambia también aquí.
const MAX_PERSONAS_CSV = 50_000;

// Rango máximo de la exportación, en días civiles contando ambos extremos.
// Fuente de verdad: el superRefine de
// api/src/validators/qaExternaPersonasValidator.ts:51-58.
const MAX_DIAS_EXPORT = 366;

// Mismo cálculo que hace el validador del servidor (diferencia en UTC + 1), para
// que el guard del cliente no discrepe por un día con el 400 de la API.
function diasDelRango(desde: string, hasta: string): number {
  const from = Date.parse(`${desde}T00:00:00.000Z`);
  const to = Date.parse(`${hasta}T00:00:00.000Z`);
  if (Number.isNaN(from) || Number.isNaN(to)) return 0;
  return Math.floor((to - from) / 86_400_000) + 1;
}

const columns: ColumnDef<QaPersona, unknown>[] = [
  {
    accessorKey: 'nombre',
    header: 'Nombre',
    cell: ({ row }) => row.original.nombre,
  },
  {
    accessorKey: 'telefono',
    header: 'Teléfono',
    // Monoespaciada y tabular: los teléfonos se leen en columna comparándolos
    // entre sí, y con fuente proporcional los dígitos no alinean.
    cell: ({ row }) => (
      <span className="font-mono tabular-nums text-sm">{row.original.telefono}</span>
    ),
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
    accessorKey: 'capturadoAt',
    header: 'Fecha',
    cell: ({ row }) => new Date(row.original.capturadoAt).toLocaleString('es-MX'),
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

export default function RevisionPersonasPage() {
  // El programa es la TABLA activa (no un filtro): siempre hay una seleccionada.
  const [programa, setPrograma] = useState<QaPrograma>('BUFFALO');
  const [page, setPage] = useState(1);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  // Lo que se teclea vs. lo que ya viajó a la API: el segundo va con retardo.
  const [busquedaInput, setBusquedaInput] = useState('');
  const [busqueda, setBusqueda] = useState('');
  const [descargando, setDescargando] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setBusqueda(busquedaInput.trim());
      setPage(1);
    }, BUSQUEDA_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [busquedaInput]);

  const { data, isLoading, isError, refetch } = useQaPersonas({
    page,
    limit: 20,
    programa, // siempre uno: la tabla es de un solo programa
    dateFrom: dateFrom || undefined,
    dateTo: dateTo || undefined,
    q: busqueda || undefined,
  });

  // Cambiar de tabla: reinicia paginación y filtros de la vista anterior.
  const switchPrograma = (p: QaPrograma) => {
    if (p === programa) return;
    setPrograma(p);
    setPage(1);
    setDateFrom('');
    setDateTo('');
    setBusquedaInput('');
    setBusqueda('');
  };

  const limpiarFiltros = () => {
    setDateFrom('');
    setDateTo('');
    setBusquedaInput('');
    setBusqueda('');
    setPage(1);
  };

  // Motivo por el que el rango no sirve para exportar, o null si está bien. Se
  // valida en el cliente igual que en la página hermana (revision/evidencias)
  // porque la validación del servidor viaja en un HEAD y su 400 llega sin
  // cuerpo: sin este guard el revisor solo vería un error genérico y un botón
  // que lo invita a reintentar algo que nunca va a funcionar.
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
      await descargarPersonasCsv({
        programa,
        dateFrom,
        dateTo,
        q: busqueda || undefined,
      });
    } finally {
      setDescargando(false);
    }
  };

  const hasFilters = Boolean(dateFrom || dateTo || busquedaInput);
  const totalPersonas = data?.pagination?.total ?? 0;

  // Con el rango a medio llenar no se avisa nada: el título del botón ya dice
  // que faltan fechas y un segundo mensaje solo sería ruido.
  const avisoRango = dateFrom && dateTo ? motivoRangoInvalido : null;
  // El CSV se corta en seco al llegar al tope y responde 200: sin este aviso el
  // revisor daría el archivo por completo y contaría de menos.
  const avisoTope = !avisoRango && totalPersonas > MAX_PERSONAS_CSV
    ? `El CSV se corta en ${MAX_PERSONAS_CSV.toLocaleString('es-MX')} filas: de las ${totalPersonas.toLocaleString('es-MX')} personas del filtro solo se exportarán las más antiguas. Acorta el rango de fechas para descargarlas todas.`
    : null;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Registro de personas</h1>
        <p className="text-sm text-muted-foreground">
          Registro <span className="font-medium text-foreground">{programa}</span> · {totalPersonas} personas
        </p>
      </div>

      {/* Switch de tabla por programa: dos tablas independientes (BUFFALO / LX). */}
      <ProgramaSwitch value={programa} onChange={switchPrograma} />

      {/* Filtros de la tabla activa: rango de fechas + búsqueda libre. */}
      <div className="flex gap-2 items-end flex-wrap">
        <div>
          <label htmlFor="personas-date-from" className="text-xs text-muted-foreground">Desde</label>
          <Input
            id="personas-date-from"
            type="date"
            value={dateFrom}
            onChange={(e) => { setDateFrom(e.target.value); setPage(1); }}
          />
        </div>
        <div>
          <label htmlFor="personas-date-to" className="text-xs text-muted-foreground">Hasta</label>
          <Input
            id="personas-date-to"
            type="date"
            value={dateTo}
            onChange={(e) => { setDateTo(e.target.value); setPage(1); }}
          />
        </div>
        <div className="min-w-56">
          <label htmlFor="personas-busqueda" className="text-xs text-muted-foreground">Nombre o teléfono</label>
          <Input
            id="personas-busqueda"
            type="search"
            value={busquedaInput}
            onChange={(e) => setBusquedaInput(e.target.value)}
            placeholder="Buscar por nombre o teléfono"
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
        error={isError ? 'No fue posible consultar el registro de personas.' : null}
        onRetry={() => refetch()}
        emptyTitle="No hay personas para estos filtros"
        emptyDescription="Cambia el programa, el rango de fechas o la búsqueda e intenta nuevamente."
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
              onClick={handleDescargarCsv}
              disabled={Boolean(motivoRangoInvalido) || descargando}
              title={motivoRangoInvalido ?? undefined}
            >
              {descargando ? 'Descargando…' : 'Descargar CSV'}
            </Button>
          </div>
        }
      />
    </div>
  );
}
