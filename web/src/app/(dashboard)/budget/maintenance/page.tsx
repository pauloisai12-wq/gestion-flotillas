'use client';

import { BudgetTable } from '@/components/budget/BudgetTable';
import { Wrench } from 'lucide-react';

export default function BudgetMaintenancePage() {
  return (
    <BudgetTable
      kind="MAINTENANCE"
      title="Presupuesto de mantenimiento"
      description="Asignación mensual por unidad · independiente del presupuesto de combustible"
      icon={Wrench}
    />
  );
}
