// Hook para gestionar la bitácora de notas de un vehículo

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';

export interface VehicleNote {
  id: number;
  vehicleId: number;
  content: string;
  createdBy: number;
  updatedBy: number | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  author: { id: number; fullName: string; email?: string };
  editor?: { id: number; fullName: string } | null;
}

export function useVehicleNotes(vehicleId: number | null) {
  return useQuery({
    queryKey: ['vehicleNotes', vehicleId],
    queryFn: async () => {
      if (!vehicleId) return [] as VehicleNote[];
      const res = await api.get(`/vehicles/${vehicleId}/notes`);
      return res.data.data as VehicleNote[];
    },
    enabled: !!vehicleId,
  });
}

export function useCreateVehicleNote(vehicleId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (content: string) => {
      const res = await api.post(`/vehicles/${vehicleId}/notes`, { content });
      return res.data.data as VehicleNote;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['vehicleNotes', vehicleId] }),
  });
}

export function useUpdateVehicleNote(vehicleId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ noteId, content }: { noteId: number; content: string }) => {
      const res = await api.patch(`/notes/${noteId}`, { content });
      return res.data.data as VehicleNote;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['vehicleNotes', vehicleId] }),
  });
}

export function useDeleteVehicleNote(vehicleId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (noteId: number) => {
      await api.delete(`/notes/${noteId}`);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['vehicleNotes', vehicleId] }),
  });
}
