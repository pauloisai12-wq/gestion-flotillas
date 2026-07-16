// Hooks para reportes

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';
import { toast } from '@/components/ui/toast';

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

// Valida primero que el artefacto siga disponible y luego deja que el navegador
// lo descargue de forma nativa. Evita duplicar el reporte completo en memoria;
// la URL same-origin conserva la cookie httpOnly de sesión.
export async function downloadReport(reportId: number, type: 'pdf' | 'excel') {
  const apiPath = `/reports/${reportId}/download/${type}`;
  try {
    await api.head(apiPath);
    const ext = type === 'pdf' ? '.pdf' : '.xlsx';
    const link = document.createElement('a');
    link.href = `/api${apiPath}`;
    link.download = `reporte_${reportId}${ext}`;
    document.body.appendChild(link);
    link.click();
    link.remove();
  } catch {
    // El interceptor de api.ts ya redirige a /login en 401; para otros errores
    // avisamos antes de iniciar la descarga nativa.
    toast.error('No se pudo descargar el reporte. Intenta de nuevo.');
  }
}
