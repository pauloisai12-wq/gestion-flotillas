// Hooks del portal de revisión (rol REVISOR_QA): listado paginado de registros
// de evidencia qa_externa y descarga del ZIP completo. Same-origin vía el
// rewrite /api/* de next.config.ts; la cookie httpOnly va con withCredentials.

import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';
import { toast } from '@/components/ui/toast';

export type QaTipo = 'lona' | 'reunion' | 'barda' | 'otro';

export interface QaRegistroImagen {
  sha256: string;
  mime: string;
  bytes: number;
  width: number | null;
  height: number | null;
}

export interface QaRegistro {
  id: number;
  clienteRegistroId: string;
  identificadorApp: string;
  tipo: QaTipo;
  lat: number;
  lng: number;
  accuracy: number | null;
  capturadoAt: string;
  notas: string | null;
  createdAt: string;
  dispositivo: { id: number; identificador: string };
  imagenes: QaRegistroImagen[];
}

export interface QaRegistrosResponse {
  data: QaRegistro[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}

interface QaRegistroQuery {
  page?: number;
  limit?: number;
  tipo?: string;
  dateFrom?: string;
  dateTo?: string;
}

export function useQaRegistros(query: QaRegistroQuery = {}) {
  const params = new URLSearchParams();
  if (query.page) params.set('page', query.page.toString());
  if (query.limit) params.set('limit', query.limit.toString());
  if (query.tipo) params.set('tipo', query.tipo);
  if (query.dateFrom) params.set('dateFrom', query.dateFrom);
  if (query.dateTo) params.set('dateTo', query.dateTo);

  return useQuery<QaRegistrosResponse>({
    queryKey: ['qa-registros', query],
    queryFn: async () => {
      const res = await api.get('/qa-externa-registros?' + params.toString());
      return res.data;
    },
  });
}

// Descarga el ZIP de evidencias. Usa el cliente axios (withCredentials → cookie
// httpOnly de sesión) con responseType:'blob' para que axios rechace respuestas
// no-2xx en vez de bajar un archivo de error corrupto (mismo patrón que
// downloadReport en useReports.ts).
export async function downloadQaZip() {
  try {
    const res = await api.get('/qa-externa-registros/export', {
      responseType: 'blob',
    });
    const blobUrl = URL.createObjectURL(res.data as Blob);
    const link = document.createElement('a');
    link.href = blobUrl;
    link.download = 'evidencias-qa.zip';
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(blobUrl);
  } catch {
    // El interceptor de api.ts ya redirige a /revision/login en 401; para otros
    // errores avisamos en vez de bajar un archivo corrupto.
    toast.error('No se pudo descargar el ZIP. Intenta de nuevo.');
  }
}
