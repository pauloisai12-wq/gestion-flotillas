// Archivo: /flotillas/web/src/hooks/useOperators.ts
// NUEVO: Hook para operaciones CRUD de operadores
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';

export interface Operator {
  id: number;
  fullName: string;
  licenseNumber: string;
  licenseType: string;
  licenseExpiresAt: string;
  phone: string | null;
  email: string | null;
  isActive: boolean;
  _count: {
    assignments: number;
    fuelLoads: number;
  };
}

export interface OperatorInput {
  fullName: string;
  licenseNumber: string;
  licenseType: string;
  licenseExpiresAt: string;
  phone?: string | null;
  email?: string | null;
  isActive?: boolean;
}

interface OperatorsResponse {
  data: Operator[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export function useOperators(query: { page?: number; limit?: number; search?: string } = {}) {
  const params = new URLSearchParams();
  if (query.page) params.set('page', query.page.toString());
  if (query.limit) params.set('limit', query.limit.toString());
  if (query.search) params.set('search', query.search);

  return useQuery<OperatorsResponse>({
    queryKey: ['operators', query],
    queryFn: async () => {
      const { data } = await api.get(`/operators?${params.toString()}`);
      return data;
    },
  });
}

export function useCreateOperator() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: OperatorInput) => {
      const { data } = await api.post('/operators', input);
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['operators'] }),
  });
}

export function useUpdateOperator() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, input }: { id: number; input: OperatorInput }) => {
      const { data } = await api.put(`/operators/${id}`, input);
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['operators'] }),
  });
}

export function useDeleteOperator() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => {
      const { data } = await api.delete(`/operators/${id}`);
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['operators'] }),
  });
}