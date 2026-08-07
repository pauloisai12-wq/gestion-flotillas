// Hooks del portal de revisión (rol REVISOR_QA) para el módulo "Encuestas
// Okrean": la app móvil de encuestas, sin relación con GeoCampo/qa_externa.
// Espeja useQaPersonas.ts —same-origin vía el rewrite /api/* de next.config.ts,
// cookie httpOnly con withCredentials, exportación en CSV que la API sirve en
// streaming (sin job que sondear)— con dos diferencias: el modelo no tiene
// programa (una sola tabla) y no hay búsqueda libre.

import { useQuery } from '@tanstack/react-query';
import api, { getApiError } from '@/lib/api';
import { toast } from '@/components/ui/toast';

// Proyección que devuelve la API al revisor: deliberadamente NO trae payloadRaw,
// payloadHash ni los JSON de respuestas (esos solo salen en el CSV).
export interface Encuesta {
  id: number;
  idRemoto: string;
  folioLocal: string | null;
  // null = el teléfono no mandó el campo (app anterior a su captura): es
  // opcional en el contrato de ingesta, igual que folioLocal.
  encuestador: string | null;
  versionCuestionario: number;
  preferenciaElectoral: string | null;
  preferenciaPartido: string | null;
  // Equivalentes v1 (cuestionario restaurado): null en filas v3.
  partidoPreferido: string | null;
  candidatoPreferido: string | null;
  conoceLalo: string | null;
  duracionSegundos: number;
  fechaHoraFinalizacion: string;
  recibidoEn: string;
  // NULL ≠ false: null es "el teléfono no mandó el bloque de ubicación"
  // (registro antiguo), false es "lo mandó y no había ubicación disponible".
  ubicacionDisponible: boolean | null;
  dispositivo: { id: number; identificador: string };
}

export interface EncuestasResponse {
  data: Encuesta[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}

interface EncuestaQuery {
  page?: number;
  limit?: number;
  dateFrom?: string;
  dateTo?: string;
}

function buildParams(query: EncuestaQuery): URLSearchParams {
  const params = new URLSearchParams();
  if (query.page) params.set('page', query.page.toString());
  if (query.limit) params.set('limit', query.limit.toString());
  if (query.dateFrom) params.set('dateFrom', query.dateFrom);
  if (query.dateTo) params.set('dateTo', query.dateTo);
  return params;
}

export function useEncuestas(query: EncuestaQuery = {}) {
  const params = buildParams(query);

  return useQuery<EncuestasResponse>({
    queryKey: ['encuestas', query],
    queryFn: async () => {
      const res = await api.get('/encuestas?' + params.toString());
      return res.data;
    },
  });
}

// La API exige rango de fechas para exportar, así que aquí también es obligatorio.
export interface EncuestasCsvParams {
  dateFrom: string;
  dateTo: string;
}

/**
 * Traduce el fallo de la descarga a algo accionable. Un 4xx significa que la
 * petición está mal formada (filtros fuera de rango, sin permiso): repetirla tal
 * cual nunca va a funcionar, así que el mensaje dice QUÉ corregir. El
 * "intenta de nuevo" se reserva para 5xx y cortes de red, que sí se resuelven
 * reintentando.
 *
 * Se lee `details[0].message` porque esa es la forma real del error de la API
 * (validate.ts arma details a partir de los issues de Zod y el errorHandler lo
 * adjunta al AppError; no es `issues`, que solo sale con un ZodError crudo).
 * Aun así hay respaldo por status: la validación viaja en un HEAD y una
 * respuesta a HEAD nunca lleva cuerpo, así que en la práctica `details` llega
 * vacío y sin el respaldo el revisor se quedaría sin explicación.
 */
function mensajeDeFalloCsv(err: unknown): string {
  const { status, data } = getApiError(err);
  if (status === undefined || status >= 500) {
    return 'No se pudo descargar el CSV. Intenta de nuevo.';
  }
  const delServidor = data?.details?.[0]?.message || data?.error;
  if (delServidor) return delServidor;
  if (status === 400) {
    return 'La API rechazó los filtros: revisa que la fecha inicial no sea posterior a la final y que el rango no pase de 366 días.';
  }
  if (status === 401) return 'Tu sesión expiró. Inicia sesión otra vez para descargar el CSV.';
  if (status === 403) return 'Tu cuenta no tiene permiso para exportar las encuestas.';
  if (status === 429) return 'Demasiadas descargas seguidas. Espera un momento antes de volver a intentarlo.';
  return 'No se pudo descargar el CSV: ajusta los filtros e inténtalo otra vez.';
}

// Mismo patrón que descargarPersonasCsv: primero un HEAD que valide sesión y
// filtros (su 401 lo intercepta api.ts y manda a /revision/login) y solo después
// la descarga nativa del navegador. Así el CSV nunca se materializa en memoria y
// la URL same-origin conserva la cookie httpOnly de sesión.
export async function descargarEncuestasCsv(params: EncuestasCsvParams) {
  const query = buildParams(params).toString();
  const apiPath = `/encuestas/export.csv?${query}`;
  try {
    await api.head(apiPath);
    const link = document.createElement('a');
    link.href = `/api${apiPath}`;
    // El nombre definitivo lo fija el Content-Disposition de la API; este es
    // solo el respaldo por si la cabecera no llegara.
    link.download = `encuestas-${params.dateFrom}_${params.dateTo}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
  } catch (err) {
    toast.error(mensajeDeFalloCsv(err));
  }
}
