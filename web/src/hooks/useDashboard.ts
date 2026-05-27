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

export function useDashboardSummary() {
  return useQuery<DashboardSummary>({
    queryKey: ['dashboard-summary'],
    queryFn: async () => {
      const { data } = await api.get('/dashboard/summary');
      return data;
    },
    refetchInterval: 60000,
  });
}