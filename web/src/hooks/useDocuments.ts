// Archivo: /flotillas/web/src/hooks/useDocuments.ts
// NUEVO: Hook para documentos vehiculares
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';

export interface VehicleDocument {
  id: number;
  vehicleId: number;
  type: 'INSURANCE' | 'VERIFICATION' | 'CIRCULATION_CARD' | 'SCT_PERMIT';
  typeLabel: string;
  issuedAt: string;
  expiresAt: string;
  fileUrl: string | null;
  fileName: string | null;
  notes: string | null;
  trafficLight: 'GREEN' | 'YELLOW' | 'RED';
}

export function useVehicleDocuments(vehicleId: number | null) {
  return useQuery<VehicleDocument[]>({
    queryKey: ['documents', vehicleId],
    queryFn: async () => {
      const { data } = await api.get(`/vehicles/${vehicleId}/documents`);
      return data;
    },
    enabled: !!vehicleId,
  });
}

export function useCreateDocument() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (formData: FormData) => {
      const { data } = await api.post('/documents', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      return data;
    },
    onSuccess: (_data, variables) => {
      const vehicleId = variables.get('vehicleId');
      qc.invalidateQueries({ queryKey: ['documents', Number(vehicleId)] });
      qc.invalidateQueries({ queryKey: ['vehicle'] });
      qc.invalidateQueries({ queryKey: ['vehicles'] });
    },
  });
}

export function useUpdateDocument() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, formData }: { id: number; formData: FormData }) => {
      const { data } = await api.put(`/documents/${id}`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['documents'] });
      qc.invalidateQueries({ queryKey: ['vehicle'] });
      qc.invalidateQueries({ queryKey: ['vehicles'] });
    },
  });
}

export function useDeleteDocument() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => {
      const { data } = await api.delete(`/documents/${id}`);
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['documents'] });
      qc.invalidateQueries({ queryKey: ['vehicle'] });
      qc.invalidateQueries({ queryKey: ['vehicles'] });
    },
  });
}