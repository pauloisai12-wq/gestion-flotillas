// Hook de gasolineras — v2 con campos fiscales (RFC, legalName, email, phone, address)

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';

export interface Station {
  id: number;
  rfc: string;
  legalName: string;
  tradeName: string | null;
  email: string;
  phone: string;
  address: string;
  isActive: boolean;
  _count: { fuelLoads: number };
}

export interface StationInput {
  rfc: string;
  legalName: string;
  tradeName?: string | null;
  email: string;
  phone: string;
  address: string;
  isActive?: boolean;
}

export function useStations() {
  return useQuery<Station[]>({
    queryKey: ['stations'],
    queryFn: async () => {
      const { data } = await api.get('/stations');
      return data;
    },
  });
}

export function useCreateStation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: StationInput) => {
      const { data } = await api.post('/stations', input);
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['stations'] }),
  });
}

export function useUpdateStation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, input }: { id: number; input: Partial<StationInput> }) => {
      const { data } = await api.put(`/stations/${id}`, input);
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['stations'] }),
  });
}

export function useDeleteStation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => {
      const { data } = await api.delete(`/stations/${id}`);
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['stations'] }),
  });
}
