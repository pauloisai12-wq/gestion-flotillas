import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';

export interface DashboardSummary {
  totalVehicles: number;
  blockedVehicles: number;
  operativeVehicles: number;
  docsValid: number;
  docsExpiring: number;
  docsExpired: number;
  fuelLoadsThisMonth: number;
  spentThisMonth: number;
  litersThisMonth: number;
  avgKmPerLiter: number;
  monthlySpent: number;
  monthlyLiters: number;
  monthlyLoads: number;
  monthlyAvgKml: number;
  refreshedAt: string | null;
}

export function useDashboardSummary(enabled = true) {
  return useQuery<DashboardSummary>({
    // La misma clave que useDashboardSummaryFiltered({}) evita que el header
    // y el dashboard lancen dos solicitudes/pollings para el mismo resumen.
    queryKey: ['dashboard', 'summary', {}],
    queryFn: async () => {
      const { data } = await api.get('/dashboard/summary');
      return data;
    },
    enabled,
    refetchInterval: 60000,
  });
}
