// web/src/hooks/useMaintenance.ts
// Catálogo de servicios por tipo de vehículo.
// Lo consume el flujo de tickets de reparación (RepairActions → completar
// reparación) para elegir el servicio del MaintenanceRecord que se genera.

import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';

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
