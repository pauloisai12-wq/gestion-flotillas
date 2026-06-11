'use client';

import { useState } from 'react';
import { useCurrentBudget, useCreateBudget, useDistributeEvenly } from '@/hooks/useBudgets';
import { toast } from '@/components/ui/toast';
import { formatCurrency } from '@/lib/formatters';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

export default function BudgetPage() {
  const { data: budget, isLoading } = useCurrentBudget();
  const createBudget = useCreateBudget();
  const distributeEvenly = useDistributeEvenly();

  const [newAmount, setNewAmount] = useState('');
  const [showCreateForm, setShowCreateForm] = useState(false);

  const now = new Date();
  const currentMonth = now.getMonth() + 1;
  const currentYear = now.getFullYear();

  const monthNames = [
    '', 'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
    'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
  ];

  async function handleCreateBudget(e: React.FormEvent) {
    e.preventDefault();
    const amount = parseFloat(newAmount);
    if (isNaN(amount) || amount <= 0) {
      toast.error('Ingrese un monto valido');
      return;
    }
    try {
      await createBudget.mutateAsync({
        month: currentMonth,
        year: currentYear,
        globalAmount: amount,
      });
      setNewAmount('');
      setShowCreateForm(false);
    } catch (error: unknown) {
      const err = error as { response?: { data?: { error?: string } } };
      toast.error(err.response?.data?.error || 'Error al crear presupuesto');
    }
  }

  async function handleDistributeEvenly() {
    if (!budget) return;
    if (!confirm('Esto distribuira ' + formatCurrency(budget.globalAmount) + ' equitativamente entre todos los vehiculos activos. Continuar?')) return;
    try {
      await distributeEvenly.mutateAsync(budget.id);
    } catch (error: unknown) {
      const err = error as { response?: { data?: { error?: string } } };
      toast.error(err.response?.data?.error || 'Error al distribuir');
    }
  }

  if (isLoading) {
    return <div className="p-6">Cargando presupuesto...</div>;
  }

  // Calcular métricas
  const globalPercent = budget ? Math.round((budget.spentAmount / budget.globalAmount) * 100) : 0;
  const vehicleBudgets = budget?.vehicleBudgets || [];
  const cutOffCount = vehicleBudgets.filter((vb) => vb.isCutOff).length;
  const warningCount = vehicleBudgets.filter((vb) => {
    const pct = vb.assignedAmount > 0 ? (vb.spentAmount / vb.assignedAmount) * 100 : 0;
    return pct >= 80 && !vb.isCutOff;
  }).length;

  return (
    <div className="p-6 space-y-6">
      {/* Encabezado */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Presupuesto de Combustible</h1>
          <p className="text-sm text-muted-foreground">
            {monthNames[currentMonth]} {currentYear}
          </p>
        </div>
        {!budget && (
          <Button onClick={() => setShowCreateForm(true)}>
            + Crear presupuesto del mes
          </Button>
        )}
      </div>

      {/* Formulario para crear presupuesto */}
      {showCreateForm && !budget && (
        <div className="rounded-md border p-4 max-w-md">
          <h2 className="text-lg font-semibold mb-3">Nuevo presupuesto mensual</h2>
          <form onSubmit={handleCreateBudget} className="flex gap-2">
            <Input
              type="number"
              placeholder="Monto global (ej: 500000)"
              value={newAmount}
              onChange={(e) => setNewAmount(e.target.value)}
              min="1"
              step="0.01"
            />
            <Button type="submit" disabled={createBudget.isPending}>
              Crear
            </Button>
            <Button type="button" variant="outline" onClick={() => setShowCreateForm(false)}>
              Cancelar
            </Button>
          </form>
        </div>
      )}

      {/* Sin presupuesto */}
      {!budget && !showCreateForm && (
        <div className="rounded-md border p-8 text-center text-muted-foreground">
          <p className="text-lg mb-2">No hay presupuesto definido para este mes</p>
          <p className="text-sm">Cree un presupuesto global y distribuyalo entre las unidades</p>
        </div>
      )}

      {/* Resumen del presupuesto */}
      {budget && (
        <>
          {/* Tarjetas de resumen */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            {/* Presupuesto global */}
            <div className="rounded-md border p-4">
              <p className="text-sm text-muted-foreground">Presupuesto global</p>
              <p className="text-2xl font-bold">{formatCurrency(budget.globalAmount)}</p>
            </div>

            {/* Gasto acumulado */}
            <div className="rounded-md border p-4">
              <p className="text-sm text-muted-foreground">Gasto acumulado</p>
              <p className="text-2xl font-bold">{formatCurrency(budget.spentAmount)}</p>
              <div className="mt-2 w-full bg-gray-200 rounded-full h-3">
                <div
                  className={
                    'h-3 rounded-full ' +
                    (globalPercent >= 90 ? 'bg-destructive' :
                     globalPercent >= 70 ? 'bg-warning' : 'bg-success')
                  }
                  style={{ width: Math.min(globalPercent, 100) + '%' }}
                />
              </div>
              <p className="text-xs text-muted-foreground mt-1">{globalPercent}% consumido</p>
            </div>

            {/* Unidades en warning */}
            <div className="rounded-md border p-4">
              <p className="text-sm text-muted-foreground">En alerta (80%+)</p>
              <p className={'text-2xl font-bold ' + (warningCount > 0 ? 'text-warning' : '')}>
                {warningCount}
              </p>
              <p className="text-xs text-muted-foreground">unidades</p>
            </div>

            {/* Unidades cortadas */}
            <div className="rounded-md border p-4">
              <p className="text-sm text-muted-foreground">Cortadas (100%)</p>
              <p className={'text-2xl font-bold ' + (cutOffCount > 0 ? 'text-destructive' : '')}>
                {cutOffCount}
              </p>
              <p className="text-xs text-muted-foreground">unidades</p>
            </div>
          </div>

          {/* Acciones */}
          <div className="flex gap-2">
            <Button onClick={handleDistributeEvenly} disabled={distributeEvenly.isPending}>
              Distribuir equitativamente
            </Button>
          </div>

          {/* Tabla de distribución por unidad */}
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>No. Eco</TableHead>
                  <TableHead>Placa</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead className="text-right">Asignado</TableHead>
                  <TableHead className="text-right">Gastado</TableHead>
                  <TableHead className="text-right">Restante</TableHead>
                  <TableHead className="text-center">Progreso</TableHead>
                  <TableHead className="text-center">Estado</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {vehicleBudgets.length > 0 ? (
                  vehicleBudgets.map((vb) => {
                    const pct = vb.assignedAmount > 0
                      ? Math.round((vb.spentAmount / vb.assignedAmount) * 100)
                      : 0;
                    const remaining = vb.assignedAmount - vb.spentAmount;

                    return (
                      <TableRow key={vb.id}>
                        <TableCell className="font-medium">
                          {vb.vehicle.economicNumber}
                        </TableCell>
                        <TableCell>{vb.vehicle.plate}</TableCell>
                        <TableCell>{vb.vehicle.vehicleType.name}</TableCell>
                        <TableCell className="text-right">
                          {formatCurrency(vb.assignedAmount)}
                        </TableCell>
                        <TableCell className="text-right">
                          {formatCurrency(vb.spentAmount)}
                        </TableCell>
                        <TableCell className="text-right">
                          <span className={remaining <= 0 ? 'text-destructive font-bold' : ''}>
                            {formatCurrency(remaining)}
                          </span>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <div className="flex-1 bg-gray-200 rounded-full h-2">
                              <div
                                className={
                                  'h-2 rounded-full ' +
                                  (pct >= 100 ? 'bg-destructive' :
                                   pct >= 80 ? 'bg-warning' : 'bg-success')
                                }
                                style={{ width: Math.min(pct, 100) + '%' }}
                              />
                            </div>
                            <span className="text-xs text-muted-foreground w-10 text-right">
                              {pct}%
                            </span>
                          </div>
                        </TableCell>
                        <TableCell className="text-center">
                          {vb.isCutOff ? (
                            <Badge variant="destructive">Cortado</Badge>
                          ) : pct >= 80 ? (
                            <Badge className="bg-warning text-white">Alerta</Badge>
                          ) : (
                            <Badge className="bg-success text-white">OK</Badge>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })
                ) : (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
                      Sin distribuciones. Use el boton &quot;Distribuir equitativamente&quot; para asignar presupuesto.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </>
      )}
    </div>
  );
}