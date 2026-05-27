// Archivo: /flotillas/web/src/hooks/useVehicles.ts
// NUEVO: Hook para operaciones CRUD de vehículos
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';

export interface Vehicle {
  id: number;
  plate: string;
  economicNumber: string;
  vehicleTypeId: number;
  vehicleType: {
    name: string;
    expectedKmPerLiter: number;
  };
  brand: string;
  model: string;
  year: number;
  vin: string | null;
  color: string | null;
  currentOdometer: number;
  status: 'OPERATIVE' | 'BLOCKED';
  blockReason: string | null;
  isActive: boolean;
  documents: { expiresAt: string }[];
  _count: {
    fuelLoads: number;
    maintenanceRecords: number;
  };
}

export interface VehicleInput {
  plate: string;
  economicNumber: string;
  vehicleTypeId: number;
  brand: string;
  model: string;
  year: number;
  vin?: string | null;
  color?: string | null;
  currentOdometer?: number;
  isActive?: boolean;
}

interface VehiclesResponse {
  data: Vehicle[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

interface VehicleQuery {
  page?: number;
  limit?: number;
  search?: string;
  vehicleTypeId?: number;
  status?: string;
  /** Filtra por User responsable (rol EXECUTOR). */
  executorId?: number;
}

/**
 * Hook para obtener lista paginada de vehículos.
 */
export function useVehicles(query: VehicleQuery = {}) {
  const params = new URLSearchParams();
  if (query.page) params.set('page', query.page.toString());
  if (query.limit) params.set('limit', query.limit.toString());
  if (query.search) params.set('search', query.search);
  if (query.vehicleTypeId) params.set('vehicleTypeId', query.vehicleTypeId.toString());
  if (query.status) params.set('status', query.status);
  if (query.executorId) params.set('executorId', query.executorId.toString());

  return useQuery<VehiclesResponse>({
    queryKey: ['vehicles', query],
    queryFn: async () => {
      const { data } = await api.get(`/vehicles?${params.toString()}`);
      return data;
    },
  });
}

/**
 * Hook para obtener un vehículo por ID.
 */
export function useVehicle(id: number | null) {
  return useQuery({
    queryKey: ['vehicle', id],
    queryFn: async () => {
      const { data } = await api.get(`/vehicles/${id}`);
      return data;
    },
    enabled: !!id,
  });
}

export function useCreateVehicle() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: VehicleInput) => {
      const { data } = await api.post('/vehicles', input);
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vehicles'] });
    },
  });
}

export function useUpdateVehicle() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, input }: { id: number; input: VehicleInput }) => {
      const { data } = await api.put(`/vehicles/${id}`, input);
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vehicles'] });
    },
  });
}

export function useDeleteVehicle() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => {
      const { data } = await api.delete(`/vehicles/${id}`);
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vehicles'] });
    },
  });
}