// Archivo: web/src/components/dashboard/DashboardFilters.tsx
// Propósito: Barra de filtros globales del dashboard
// NUEVO archivo

'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useVehicleTypes } from '@/hooks/useVehicleTypes';
import { useOperators } from '@/hooks/useOperators';
import type { DashboardFilters } from '@/hooks/useDashboardAnalytics';

interface DashboardFiltersBarProps {
  filters: DashboardFilters;
  onFiltersChange: (filters: DashboardFilters) => void;
}

export default function DashboardFiltersBar({ filters, onFiltersChange }: DashboardFiltersBarProps) {
  const { data: vehicleTypes } = useVehicleTypes();
  const { data: operatorsData } = useOperators({ page: 1, limit: 100 });

  const operators = operatorsData?.data || [];

  const hasActiveFilters = !!(filters.vehicleTypeId || filters.operatorId || filters.dateFrom || filters.dateTo);

  function handleChange(key: keyof DashboardFilters, value: string) {
    const newFilters = { ...filters };
    if (key === 'vehicleTypeId' || key === 'operatorId') {
      newFilters[key] = value ? Number(value) : undefined;
    } else {
      newFilters[key] = value || undefined;
    }
    onFiltersChange(newFilters);
  }

  function handleClear() {
    onFiltersChange({});
  }

  const selectClass = "h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40 dark:bg-input/30";
  const labelClass = "text-[10px] font-medium uppercase tracking-wider text-muted-foreground block mb-1";

  return (
    <div className="rounded-lg bg-card p-4 ring-1 ring-inset ring-border/70 dark:ring-white/5 shadow-[0_1px_0_0_rgba(0,0,0,0.04)] dark:shadow-[0_1px_0_0_rgba(0,0,0,0.3)]">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[180px]">
          <label className={labelClass}>Tipo de vehículo</label>
          <select
            className={selectClass}
            value={filters.vehicleTypeId || ''}
            onChange={function (e) { handleChange('vehicleTypeId', e.target.value); }}
          >
            <option value="">Todos</option>
            {vehicleTypes && vehicleTypes.map(function (vt: { id: number; name: string }) {
              return <option key={vt.id} value={vt.id}>{vt.name}</option>;
            })}
          </select>
        </div>

        <div className="min-w-[200px]">
          <label className={labelClass}>Operador</label>
          <select
            className={selectClass}
            value={filters.operatorId || ''}
            onChange={function (e) { handleChange('operatorId', e.target.value); }}
          >
            <option value="">Todos</option>
            {operators.map(function (op: { id: number; fullName: string }) {
              return <option key={op.id} value={op.id}>{op.fullName}</option>;
            })}
          </select>
        </div>

        <div>
          <label className={labelClass}>Desde</label>
          <Input
            type="date"
            value={filters.dateFrom || ''}
            onChange={function (e) { handleChange('dateFrom', e.target.value); }}
            className="w-[160px]"
          />
        </div>

        <div>
          <label className={labelClass}>Hasta</label>
          <Input
            type="date"
            value={filters.dateTo || ''}
            onChange={function (e) { handleChange('dateTo', e.target.value); }}
            className="w-[160px]"
          />
        </div>

        {hasActiveFilters && (
          <Button variant="ghost" size="sm" onClick={handleClear}>
            Limpiar filtros
          </Button>
        )}
      </div>
    </div>
  );
}