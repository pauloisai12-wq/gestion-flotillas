// Detalle de una encuesta del portal de revisión (rol REVISOR_QA): los datos que
// el listado no cabe en columnas más los segmentos de audio con reproductor.
// Es la única pantalla del portal que reproduce media: el <audio> apunta a una
// ruta same-origin del API para que la cookie httpOnly de sesión viaje sola (un
// host absoluto la perdería tras el proxy de Caddy).

'use client';

import { use, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useEncuesta, type EncuestaAudio } from '@/hooks/useEncuestas';
import { getApiError } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Download, Loader2 } from 'lucide-react';

// Base de la API: misma lógica que el cliente axios. Vacío → ruta relativa,
// que el rewrite /api/* de next.config.ts envía al backend (same-origin, así la
// cookie httpOnly viaja con el <audio> y con la descarga).
const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? '';

function mmss(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const min = Math.floor(total / 60);
  const seg = total % 60;
  return `${min.toString().padStart(2, '0')}:${seg.toString().padStart(2, '0')}`;
}

function tamanoLegible(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function Dato({ etiqueta, children }: { etiqueta: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{etiqueta}</dt>
      <dd className="text-sm text-foreground">{children}</dd>
    </div>
  );
}

/**
 * Insignia de audio de la cabecera, con el mismo criterio que la columna del
 * listado: el conteo cuando hay segmentos y un "Sin audio" explícito cuando no,
 * porque un 0 suelto se lee como dato faltante y no como ausencia.
 */
function BadgeAudio({ total }: { total: number }) {
  if (total === 0) return <Badge variant="inactive">Sin audio</Badge>;
  return (
    <Badge variant="info">
      {total} {total === 1 ? 'segmento' : 'segmentos'}
    </Badge>
  );
}

/**
 * Un segmento: metadatos + reproductor nativo + descarga. La duración la manda
 * el servidor cuando pudo leerla del contenedor; si no, la mide el navegador al
 * cargar los metadatos (preload="metadata" solo trae la cabecera, no el audio).
 */
function SegmentoAudio({ audio }: { audio: EncuestaAudio }) {
  const [duracionMedida, setDuracionMedida] = useState<number | null>(null);
  // El <audio> falla en silencio: si la petición devuelve 401 (sesión vencida),
  // 404 (blob ausente en disco) o el códec no se puede decodificar, el
  // reproductor se queda inerte sin decir nada y el revisor concluye que la
  // encuesta no tiene audio. El fallback de texto entre las etiquetas tampoco
  // se pinta: solo aparece en navegadores sin <audio>.
  const [fallo, setFallo] = useState(false);
  const src = `${API_BASE}${audio.url}`;
  const duracionMs = audio.duracionMs ?? duracionMedida;
  return (
    <li className="space-y-2 py-3 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
        <span className="font-mono font-medium text-foreground">{audio.segmento}</span>
        <span className="font-mono tabular-nums text-muted-foreground">
          {duracionMs === null ? 'Duración —' : mmss(duracionMs)}
        </span>
        <span className="text-muted-foreground">{tamanoLegible(audio.tamanoBytes)}</span>
        <span className="text-muted-foreground">
          Recibido {new Date(audio.recibidoEn).toLocaleString('es-MX')}
        </span>
        <a
          href={`${src}?download=1`}
          className="inline-flex items-center gap-1 text-primary underline-offset-4 hover:underline"
        >
          <Download aria-hidden="true" className="size-4" />
          Descargar
        </a>
      </div>
      <audio
        controls
        preload="metadata"
        src={src}
        className="w-full"
        aria-label={`Audio ${audio.segmento}`}
        onLoadedMetadata={(event) => {
          const d = event.currentTarget.duration;
          if (Number.isFinite(d)) setDuracionMedida(Math.round(d * 1000));
          setFallo(false);
        }}
        onError={() => setFallo(true)}
      >
        Tu navegador no puede reproducir este audio; descárgalo para escucharlo.
      </audio>
      {fallo && (
        <p className="text-xs text-destructive" role="alert">
          No se pudo cargar el audio. Si tu sesión venció, vuelve a iniciar sesión; si el problema
          sigue, intenta descargarlo.
        </p>
      )}
    </li>
  );
}

export default function RevisionEncuestaDetallePage({ params }: { params: Promise<{ id: string }> }) {
  const { id: idStr } = use(params);
  // Un id no numérico jamás va a existir en la BD: se corta aquí en vez de
  // gastar una petición que devolvería 404. Se valida la cadena ENTERA con la
  // expresión regular y no con `Number.parseInt`, que se queda con el prefijo:
  // /revision/encuestas/12abc abriría la encuesta 12 y el revisor creería estar
  // viendo lo que pidió.
  const validId = /^[1-9]\d*$/.test(idStr) ? Number(idStr) : null;
  const router = useRouter();
  const { data: encuesta, isLoading, isError, error, refetch } = useEncuesta(validId);

  const volver = (
    <Button variant="outline" size="sm" onClick={() => router.push('/revision/encuestas')}>
      Volver
    </Button>
  );

  if (validId === null) {
    return (
      <div className="space-y-4">
        {volver}
        <p className="text-sm text-destructive" role="alert">
          Encuesta inválida: la dirección no trae un identificador de encuesta.
        </p>
      </div>
    );
  }

  if (isError) {
    // El 404 no es un fallo transitorio: reintentar nunca la va a encontrar, así
    // que ese caso no ofrece botón de reintento y el resto sí.
    const { status } = getApiError(error);
    return (
      <div className="space-y-4">
        {volver}
        <p className="text-sm text-destructive" role="alert">
          {status === 404
            ? 'Esta encuesta no existe o ya no está disponible.'
            : 'No fue posible consultar la encuesta.'}
        </p>
        {status !== 404 && (
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            Reintentar
          </Button>
        )}
      </div>
    );
  }

  if (isLoading || !encuesta) {
    return (
      <div
        role="status"
        aria-live="polite"
        className="flex min-h-40 items-center justify-center gap-2 rounded-md border border-dashed p-6 text-sm text-muted-foreground"
      >
        <Loader2 aria-hidden="true" className="size-4 animate-spin" />
        Cargando encuesta…
      </div>
    );
  }

  // Mismas fusiones v1/v3-v4 que el listado: una fila vieja llena
  // candidatoPreferido/partidoPreferido y deja en NULL los campos nuevos.
  const preferenciaElectoral = encuesta.preferenciaElectoral ?? encuesta.candidatoPreferido ?? '—';
  const preferenciaPartido = encuesta.preferenciaPartido ?? encuesta.partidoPreferido ?? '—';
  const conoceLalo =
    encuesta.conoceLalo === null || encuesta.conoceLalo === undefined
      ? '—'
      : encuesta.conoceLalo === 'si'
        ? 'Sí'
        : 'No';
  const ubicacion =
    encuesta.ubicacionDisponible === null || encuesta.ubicacionDisponible === undefined
      ? '—'
      : encuesta.ubicacionDisponible
        ? 'Sí'
        : 'No';

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        {volver}
        <div className="flex-1 min-w-0">
          <h1 className="text-2xl font-bold">
            {/* El folio lo escribe el encuestador y puede faltar; el respaldo es
                el UUID remoto recortado, suficiente para identificarla a ojo. */}
            {encuesta.folioLocal ?? `Encuesta ${encuesta.idRemoto.slice(0, 8)}`}
          </h1>
          <p className="text-sm text-muted-foreground">{encuesta.encuestador ?? 'Sin encuestador'}</p>
        </div>
        <Badge variant="outline">v{encuesta.versionCuestionario}</Badge>
        <BadgeAudio total={encuesta.audios.length} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Encuesta</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Dato etiqueta="Folio">
              <span className="font-mono">{encuesta.folioLocal ?? '—'}</span>
            </Dato>
            <Dato etiqueta="Encuestador">{encuesta.encuestador ?? '—'}</Dato>
            <Dato etiqueta="Versión">
              <span className="font-mono">v{encuesta.versionCuestionario}</span>
            </Dato>
            <Dato etiqueta="Preferencia electoral">
              {preferenciaElectoral}
              {/* El texto libre solo existe cuando el código es "otro" (v4). */}
              {encuesta.preferenciaElectoralOtro ? ` · ${encuesta.preferenciaElectoralOtro}` : null}
            </Dato>
            <Dato etiqueta="Preferencia partido">
              {preferenciaPartido}
              {encuesta.preferenciaPartidoOtro ? ` · ${encuesta.preferenciaPartidoOtro}` : null}
            </Dato>
            <Dato etiqueta="Conoce a Lalo">{conoceLalo}</Dato>
            <Dato etiqueta="Duración">
              {/* El cronómetro de la app manda segundos; mmss trabaja en ms. */}
              <span className="font-mono tabular-nums">{mmss(encuesta.duracionSegundos * 1000)}</span>
            </Dato>
            <Dato etiqueta="Finalizada">
              {new Date(encuesta.fechaHoraFinalizacion).toLocaleString('es-MX')}
            </Dato>
            <Dato etiqueta="Recibida">{new Date(encuesta.recibidoEn).toLocaleString('es-MX')}</Dato>
            {/* Tres estados: sí, no y "el teléfono no mandó el bloque" (—). Las
                coordenadas siguen saliendo solo en el CSV. */}
            <Dato etiqueta="Ubicación">{ubicacion}</Dato>
            <Dato etiqueta="Dispositivo">{encuesta.dispositivo.identificador}</Dato>
            {/* El UUID con que la app nombra la encuesta en el teléfono: es lo
                que permite cruzar esta fila con el dispositivo de campo. */}
            <Dato etiqueta="idLocal">
              <span className="font-mono break-all">{encuesta.idLocal}</span>
            </Dato>
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Audios</CardTitle>
        </CardHeader>
        <CardContent>
          {encuesta.audios.length === 0 ? (
            <p className="text-sm text-muted-foreground">Esta encuesta no tiene audio.</p>
          ) : (
            <ul className="divide-y divide-border">
              {encuesta.audios.map((audio) => (
                <SegmentoAudio key={audio.id} audio={audio} />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
