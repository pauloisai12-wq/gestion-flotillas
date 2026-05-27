import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';

export interface Workshop {
  id: number;
  rfc: string;
  legalName: string;
  tradeName: string | null;
  email: string;
  phone: string;
  address: string;
  isActive: boolean;
}

export interface WorkshopInput {
  rfc: string;
  legalName: string;
  tradeName?: string | null;
  email: string;
  phone: string;
  address: string;
  isActive?: boolean;
}

export function useWorkshops() {
  return useQuery<Workshop[]>({
    queryKey: ['workshops'],
    queryFn: async () => {
      const { data } = await api.get('/workshops');
      return data.data as Workshop[];
    },
  });
}

export function useCreateWorkshop() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: WorkshopInput) => (await api.post('/workshops', input)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['workshops'] }),
  });
}

export function useUpdateWorkshop() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, input }: { id: number; input: Partial<WorkshopInput> }) =>
      (await api.patch(`/workshops/${id}`, input)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['workshops'] }),
  });
}

export function useDeleteWorkshop() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => (await api.delete(`/workshops/${id}`)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['workshops'] }),
  });
}
