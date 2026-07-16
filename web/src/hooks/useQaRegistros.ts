// Hooks del portal de revisión (rol REVISOR_QA): listado paginado de registros
// de evidencia qa_externa y descarga del ZIP completo. Same-origin vía el
// rewrite /api/* de next.config.ts; la cookie httpOnly va con withCredentials.

import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';
import { toast } from '@/components/ui/toast';

export type QaTipo = 'lona' | 'reunion' | 'barda' | 'otro';

// Programa al que pertenece el dispositivo que capturó la evidencia. Es
// ortogonal a `tipo`: lo estampa el servidor desde req.device en cada ingest;
// el cliente nunca lo envía. La separación de seguridad la da la API key.
export type QaPrograma = 'BUFFALO' | 'LX';

export interface QaRegistroImagen {
  sha256: string;
  mime: string;
  bytes: number;
  width: number | null;
  height: number | null;
  programa: QaPrograma;
  thumbnailUrl: string;
}

export interface QaRegistro {
  id: number;
  clienteRegistroId: string;
  identificadorApp: string;
  tipo: QaTipo;
  programa: QaPrograma;
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

export type DataJobStatus = 'QUEUED' | 'PROCESSING' | 'COMPLETED' | 'FAILED';

export interface QaExportJob {
  id: number;
  type: 'QA_EXPORT';
  status: DataJobStatus;
  progress: number;
  artifactName: string | null;
  artifactSize: number | null;
  result: unknown;
  errorMessage: string | null;
  completedAt: string | null;
  expiresAt: string;
}

interface QaRegistroQuery {
  page?: number;
  limit?: number;
  tipo?: string;
  programa?: string;
  dateFrom?: string;
  dateTo?: string;
}

export function useQaRegistros(query: QaRegistroQuery = {}) {
  const params = new URLSearchParams();
  if (query.page) params.set('page', query.page.toString());
  if (query.limit) params.set('limit', query.limit.toString());
  if (query.tipo) params.set('tipo', query.tipo);
  if (query.programa) params.set('programa', query.programa);
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

export async function createQaExport(
  programa: QaPrograma,
  dateFrom: string,
  dateTo: string,
): Promise<QaExportJob> {
  const res = await api.post('/qa-externa-registros/exports', undefined, {
    params: { programa, dateFrom, dateTo },
  });
  return res.data.data as QaExportJob;
}

export function useQaExportJob(jobId: number | null) {
  return useQuery<QaExportJob>({
    queryKey: ['qa-export-job', jobId],
    queryFn: async () => {
      const res = await api.get(`/qa-externa-registros/exports/${jobId}`);
      return res.data.data as QaExportJob;
    },
    enabled: jobId !== null,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === 'COMPLETED' || status === 'FAILED' ? false : 1_500;
    },
  });
}

export async function getActiveQaExport(): Promise<QaExportJob | null> {
  const res = await api.get('/qa-externa-registros/exports/active');
  return (res.data.data as QaExportJob | null) ?? null;
}

export function useActiveQaExport(enabled: boolean) {
  return useQuery<QaExportJob | null>({
    queryKey: ['qa-export-job', 'active'],
    queryFn: getActiveQaExport,
    enabled,
    refetchOnWindowFocus: false,
  });
}

// Valida primero que el artefacto siga disponible y luego deja que el navegador
// lo descargue de forma nativa. Evita materializar en memoria ZIPs que pueden ser
// muy grandes; la URL same-origin conserva la cookie httpOnly de sesión.
export async function downloadQaZip(job: QaExportJob) {
  const apiPath = `/qa-externa-registros/exports/${job.id}/download`;
  try {
    await api.head(apiPath);
    const link = document.createElement('a');
    link.href = `/api${apiPath}`;
    link.download = job.artifactName || `evidencias-qa-${job.id}.zip`;
    document.body.appendChild(link);
    link.click();
    link.remove();
  } catch {
    // El interceptor de api.ts ya redirige a /revision/login en 401; para otros
    // errores avisamos antes de iniciar la descarga nativa.
    toast.error('No se pudo descargar el ZIP. Intenta de nuevo.');
  }
}
