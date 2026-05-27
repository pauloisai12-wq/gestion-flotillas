import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';

export interface FuelLoad {
  id: number;
  vehicleId: number;
  operatorId: number | null;
  operatorNameRaw: string | null;
  operatorEmployeeRaw: string | null;
  stationId: number;
  liters: number | null;
  amount: number;
  odometer: number | null;
  odometerStatus: 'OK' | 'NF';
  kmPerLiter: number | null;
  isApproved: boolean;
  status: 'APPROVED' | 'PENDING_REVIEW' | 'REJECTED';
  loadDate: string;
  vehicle: {
    id: number; plate: string; economicNumber: string;
    classification?: string;
    vehicleType: { expectedKmPerLiter: number };
  };
  operator: { id: number; fullName: string; employeeNumber?: string } | null;
  station: { id: number; legalName: string; tradeName?: string | null; isActive: boolean };
}

export interface FuelLoadInput {
  vehicleId: number;
  operatorEmployee: string;
  operatorName: string;
  stationId: number;
  liters?: number | null;
  amount: number;
  odometer?: number | null;
  odometerStatus: 'OK' | 'NF';
  loadDate?: string;
}

interface FuelLoadsResponse {
  data: FuelLoad[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}

interface FuelLoadQuery {
  page?: number;
  limit?: number;
  vehicleId?: number;
  operatorId?: number;
  dateFrom?: string;
  dateTo?: string;
}

export function useFuelLoads(query: FuelLoadQuery = {}) {
  const params = new URLSearchParams();
  if (query.page) params.set('page', query.page.toString());
  if (query.limit) params.set('limit', query.limit.toString());
  if (query.vehicleId) params.set('vehicleId', query.vehicleId.toString());
  if (query.operatorId) params.set('operatorId', query.operatorId.toString());
  if (query.dateFrom) params.set('dateFrom', query.dateFrom);
  if (query.dateTo) params.set('dateTo', query.dateTo);

  return useQuery<FuelLoadsResponse>({
    queryKey: ['fuel-loads', query],
    queryFn: async function() {
      const res = await api.get('/fuel-loads?' + params.toString());
      return res.data;
    },
  });
}

export function useVehicleFuelLoads(vehicleId: number | null) {
  return useQuery<{ loads: FuelLoad[]; movingAverage: number | null }>({
    queryKey: ['fuel-loads-vehicle', vehicleId],
    queryFn: async function() {
      const res = await api.get('/fuel-loads/vehicle/' + vehicleId);
      return res.data;
    },
    enabled: !!vehicleId,
  });
}

export function useCreateFuelLoad() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async function(input: FuelLoadInput) {
      const res = await api.post('/fuel-loads', input);
      return res.data;
    },
    onSuccess: function() {
      qc.invalidateQueries({ queryKey: ['fuel-loads'] });
      qc.invalidateQueries({ queryKey: ['fuel-loads-vehicle'] });
      qc.invalidateQueries({ queryKey: ['vehicles'] });
      qc.invalidateQueries({ queryKey: ['vehicle'] });
    },
  });
}