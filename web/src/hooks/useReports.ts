// Archivo: /flotillas/web/src/hooks/useReports.ts
// ARCHIVO NUEVO — Hooks para reportes

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';

// Tipos
interface Report {
  id: number;
  month: number;
  year: number;
  pdfPath: string | null;
  excelPath: string | null;
  pdfSize: number | null;
  excelSize: number | null;
  status: 'PROCESSING' | 'COMPLETED' | 'FAILED';
  requestedBy: string;
  errorMessage: string | null;
  startedAt: string;
  completedAt: string | null;
  createdAt: string;
}

interface ReportsResponse {
  data: Report[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

// Obtener historial de reportes
export function useReports(page: number = 1) {
  return useQuery<ReportsResponse>({
    queryKey: ['reports', page],
    queryFn: async () => {
      const res = await api.get('/reports?page=' + page + '&limit=20');
      return res.data;
    },
    // Solo sondear (cada 10s) mientras haya un reporte generándose; los reportes
    // se generan el día 1 del mes, así que el resto del tiempo no hay polling.
    refetchInterval: (query) =>
      query.state.data?.data.some((r) => r.status === 'PROCESSING') ? 10000 : false,
  });
}

// Solicitar generación de reporte
export function useGenerateReport() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: { month: number; year: number }) => {
      const res = await api.post('/reports/generate', data);
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['reports'] });
    },
  });
}

// Descargar archivo.
// Usa el cliente axios (withCredentials → cookie httpOnly de sesión). El método
// anterior leía el JWT de document.cookie, pero la cookie es httpOnly y JS NUNCA
// la ve: el token quedaba 'undefined' y la petición SIEMPRE devolvía 401,
// descargando el JSON de error como archivo corrupto. Con responseType:'blob'
// axios rechaza en respuestas no-2xx, así que no se genera archivo corrupto.
export async function downloadReport(reportId: number, type: 'pdf' | 'excel') {
  try {
    const res = await api.get(`/reports/${reportId}/download/${type}`, {
      responseType: 'blob',
    });
    const ext = type === 'pdf' ? '.pdf' : '.xlsx';
    const blobUrl = URL.createObjectURL(res.data as Blob);
    const link = document.createElement('a');
    link.href = blobUrl;
    link.download = `reporte_${reportId}${ext}`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(blobUrl);
  } catch {
    // El interceptor de api.ts ya redirige a /login en 401; para otros errores
    // avisamos en vez de bajar un archivo corrupto.
    alert('No se pudo descargar el reporte. Intenta de nuevo.');
  }
}