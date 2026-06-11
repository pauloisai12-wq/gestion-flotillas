// Hooks con soporte de filtros globales del dashboard

import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';

export interface DashboardFilters {
  vehicleTypeId?: number;
  operatorId?: number;
  dateFrom?: string;
  dateTo?: string;
}

function buildParams(filters: DashboardFilters): string {
  const params: string[] = [];
  if (filters.vehicleTypeId) params.push('vehicleTypeId=' + filters.vehicleTypeId);
  if (filters.operatorId) params.push('operatorId=' + filters.operatorId);
  if (filters.dateFrom) params.push('dateFrom=' + filters.dateFrom);
  if (filters.dateTo) params.push('dateTo=' + filters.dateTo);
  return params.length > 0 ? '?' + params.join('&') : '';
}

export function useDashboardSummaryFiltered(filters: DashboardFilters) {
  return useQuery({
    queryKey: ['dashboard', 'summary', filters],
    queryFn: async () => {
      const res = await api.get('/dashboard/summary' + buildParams(filters));
      return res.data;
    },
    refetchInterval: 60000,
  });
}

export function useFuelTrend(filters: DashboardFilters = {}) {
  return useQuery({
    queryKey: ['dashboard', 'fuel-trend', filters],
    queryFn: async () => {
      const res = await api.get('/dashboard/fuel-trend' + buildParams(filters));
      return res.data;
    },
    refetchInterval: 60000,
  });
}

export function useVehicleRankingTop(limit: number = 10, filters: DashboardFilters = {}, enabled: boolean = true) {
  return useQuery({
    queryKey: ['dashboard', 'vehicle-ranking-top', limit, filters],
    queryFn: async () => {
      const res = await api.get('/dashboard/vehicle-ranking/top?limit=' + limit + buildParams(filters).replace('?', '&'));
      return res.data;
    },
    enabled,
    refetchInterval: 60000,
  });
}

export function useVehicleRankingBottom(limit: number = 10, filters: DashboardFilters = {}, enabled: boolean = true) {
  return useQuery({
    queryKey: ['dashboard', 'vehicle-ranking-bottom', limit, filters],
    queryFn: async () => {
      const res = await api.get('/dashboard/vehicle-ranking/bottom?limit=' + limit + buildParams(filters).replace('?', '&'));
      return res.data;
    },
    enabled,
    refetchInterval: 60000,
  });
}

export function useOperatorRanking(limit: number = 10, filters: DashboardFilters = {}) {
  return useQuery({
    queryKey: ['dashboard', 'operator-ranking', limit, filters],
    queryFn: async () => {
      const res = await api.get('/dashboard/operator-ranking?limit=' + limit + buildParams(filters).replace('?', '&'));
      return res.data;
    },
    refetchInterval: 60000,
  });
}

export function useBudgetProgress(filters: DashboardFilters = {}) {
  return useQuery({
    queryKey: ['dashboard', 'budget-progress', filters],
    queryFn: async () => {
      const res = await api.get('/dashboard/budget-progress' + buildParams(filters));
      return res.data;
    },
    refetchInterval: 60000,
  });
}