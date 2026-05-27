// web/src/hooks/useMaintenance.ts
// Hooks para mantenimiento preventivo: catálogo de servicios,
// próximos servicios y registros de mantenimiento.

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';

// === CATÁLOGO DE SERVICIOS ===

export interface ServiceCatalogItem {
  id: number;
  vehicleTypeId: number;
  serviceName: string;
  intervalKm: number;
  description: string | null;
  vehicleType: { id: number; name: string };
}

export function useServiceCatalog(vehicleTypeId?: number) {
  return useQuery({
    queryKey: ['service-catalog', vehicleTypeId],
    queryFn: async () => {
      const url = vehicleTypeId
        ? '/service-catalog?vehicleTypeId=' + vehicleTypeId
        : '/service-catalog';
      const res = await api.get(url);
      return res.data.data as ServiceCatalogItem[];
    },
  });
}

export function useCreateService() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (data: { vehicleTypeId: number; serviceName: string; intervalKm: number; description?: string }) => {
      const res = await api.post('/service-catalog', data);
      return res.data.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['service-catalog'] });
    },
  });
}

export function useDeleteService() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => {
      await api.delete('/service-catalog/' + id);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['service-catalog'] });
    },
  });
}

// === PRÓXIMOS SERVICIOS ===

export interface UpcomingService {
  serviceId: number;
  serviceName: string;
  intervalKm: number;
  lastMaintenanceKm: number | null;
  lastMaintenanceDate: string | null;
  nextServiceKm: number;
  currentOdometer: number;
  progressPercent: number;
  status: 'OK' | 'WARNING' | 'OVERDUE';
  remainingKm: number;
}

export interface PendingService extends UpcomingService {
  vehicleId: number;
  plate: string;
  economicNumber: string;
}

export function useUpcomingServices(vehicleId: number | null) {
  return useQuery({
    queryKey: ['maintenance', 'upcoming', vehicleId],
    queryFn: async () => {
      const res = await api.get('/maintenance/upcoming/' + vehicleId);
      return res.data.data as UpcomingService[];
    },
    enabled: vehicleId !== null,
  });
}

export function usePendingServices() {
  return useQuery({
    queryKey: ['maintenance', 'pending'],
    queryFn: async () => {
      const res = await api.get('/maintenance/pending');
      return res.data.data as PendingService[];
    },
  });
}

// === REGISTROS DE MANTENIMIENTO ===

export interface MaintenanceRecord {
  id: number;
  vehicleId: number;
  serviceId: number;
  odometer: number;
  cost: number;
  provider: string;
  workshop: string;
  serviceDate: string;
  notes: string | null;
  evidenceUrl: string | null;
  vehicle: { id: number; plate: string; economicNumber: string };
  service: { id: number; serviceName: string; intervalKm: number };
}

export function useMaintenanceRecords(query?: { vehicleId?: number; page?: number }) {
  return useQuery({
    queryKey: ['maintenance', 'records', query],
    queryFn: async () => {
      let url = '/maintenance?page=' + (query?.page || 1);
      if (query?.vehicleId) url += '&vehicleId=' + query.vehicleId;
      const res = await api.get(url);
      return res.data as {
        data: MaintenanceRecord[];
        pagination: { page: number; limit: number; total: number; totalPages: number };
      };
    },
  });
}

export function useCreateMaintenance() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (formData: FormData) => {
      const res = await api.post('/maintenance', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      return res.data.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['maintenance'] });
    },
  });
}