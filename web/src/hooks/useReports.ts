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
    refetchInterval: 10000, // Refrescar cada 10s para ver cuando termina un reporte
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

// Descargar archivo
export function downloadReport(reportId: number, type: 'pdf' | 'excel') {
  const token = document.cookie
    .split('; ')
    .find((row) => row.startsWith('token='))
    ?.split('=')[1];

  const url = (process.env.NEXT_PUBLIC_API_URL || '')
    + '/api/reports/' + reportId + '/download/' + type;

  // Abrir en nueva pestaña con token en header
  fetch(url, {
    headers: { Authorization: 'Bearer ' + token },
  })
    .then((res) => res.blob())
    .then((blob) => {
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      const ext = type === 'pdf' ? '.pdf' : '.xlsx';
      link.download = 'reporte_' + reportId + ext;
      link.click();
      URL.revokeObjectURL(link.href);
    });
}