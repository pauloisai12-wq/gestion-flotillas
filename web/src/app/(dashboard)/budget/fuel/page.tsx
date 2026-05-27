'use client';

import { BudgetTable } from '@/components/budget/BudgetTable';
import { Fuel } from 'lucide-react';

export default function BudgetFuelPage() {
  return (
    <BudgetTable
      kind="FUEL"
      title="Presupuesto de combustible"
      description="Asignación mensual por unidad · incluye remanente del mes anterior (rollover)"
      icon={Fuel}
    />
  );
}
