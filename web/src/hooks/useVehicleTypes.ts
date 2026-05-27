// Archivo: /flotillas/web/src/hooks/useVehicleTypes.ts
// NUEVO: Hook para operaciones CRUD de tipos de vehículo
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';

// Tipo que representa un tipo de vehículo (coincide con lo que retorna la API)
export interface VehicleType {
  id: number;
  name: string;
  expectedKmPerLiter: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  _count: {
    vehicles: number;
  };
}

// Tipo para crear o editar (lo que enviamos a la API)
export interface VehicleTypeInput {
  name: string;
  expectedKmPerLiter: number;
  isActive?: boolean;
}

/**
 * Hook para obtener todos los tipos de vehículo.
 * TanStack Query los guarda en caché y los refresca automáticamente.
 */
export function useVehicleTypes() {
  return useQuery<VehicleType[]>({
    queryKey: ['vehicle-types'],
    queryFn: async () => {
      const { data } = await api.get('/vehicle-types');
      return data;
    },
  });
}

/**
 * Hook para crear un tipo de vehículo.
 * Al completar, refresca la lista automáticamente.
 */
export function useCreateVehicleType() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: VehicleTypeInput) => {
      const { data } = await api.post('/vehicle-types', input);
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vehicle-types'] });
    },
  });
}

/**
 * Hook para actualizar un tipo de vehículo.
 */
export function useUpdateVehicleType() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, input }: { id: number; input: VehicleTypeInput }) => {
      const { data } = await api.put(`/vehicle-types/${id}`, input);
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vehicle-types'] });
    },
  });
}

/**
 * Hook para eliminar un tipo de vehículo.
 */
export function useDeleteVehicleType() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => {
      const { data } = await api.delete(`/vehicle-types/${id}`);
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vehicle-types'] });
    },
  });
}