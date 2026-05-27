// web/src/hooks/useBudgets.ts
// Hooks para gestión de presupuestos de combustible.

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';

export interface VehicleBudget {
  id: number;
  vehicleId: number;
  budgetId: number;
  assignedAmount: number;
  spentAmount: number;
  isCutOff: boolean;
  vehicle: {
    id: number;
    plate: string;
    economicNumber: string;
    status: string;
    vehicleType: { name: string };
  };
}

export interface FuelBudget {
  id: number;
  month: number;
  year: number;
  globalAmount: number;
  spentAmount: number;
  vehicleBudgets: VehicleBudget[];
}

// Obtener presupuesto del mes actual
export function useCurrentBudget() {
  return useQuery({
    queryKey: ['budgets', 'current'],
    queryFn: async () => {
      const res = await api.get('/budgets/current');
      return res.data.data as FuelBudget | null;
    },
  });
}

// Obtener presupuesto por ID
export function useBudget(id: number | null) {
  return useQuery({
    queryKey: ['budgets', id],
    queryFn: async () => {
      const res = await api.get('/budgets/' + id);
      return res.data.data as FuelBudget;
    },
    enabled: id !== null,
  });
}

// Crear presupuesto global
export function useCreateBudget() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (data: { month: number; year: number; globalAmount: number }) => {
      const res = await api.post('/budgets', data);
      return res.data.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['budgets'] });
    },
  });
}

// Actualizar monto global
export function useUpdateBudget() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, globalAmount }: { id: number; globalAmount: number }) => {
      const res = await api.put('/budgets/' + id, { globalAmount });
      return res.data.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['budgets'] });
    },
  });
}

// Distribuir equitativamente
export function useDistributeEvenly() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (budgetId: number) => {
      const res = await api.post('/budgets/' + budgetId + '/distribute-evenly');
      return res.data.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['budgets'] });
    },
  });
}

// Distribuir manualmente
export function useDistributeBudget() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ budgetId, distributions }: {
      budgetId: number;
      distributions: { vehicleId: number; assignedAmount: number }[];
    }) => {
      const res = await api.post('/budgets/' + budgetId + '/distribute', { distributions });
      return res.data.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['budgets'] });
    },
  });
}