// Archivo: /flotillas/web/src/app/(dashboard)/reports/page.tsx
// REEMPLAZA: Archivo existente (era un placeholder)
'use client';

import { useState } from 'react';
import { useReports, useGenerateReport, downloadReport } from '@/hooks/useReports';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PageHeader } from '@/components/ui/page-header';
import { EmptyState } from '@/components/ui/empty-state';
import { SkeletonTable } from '@/components/ui/skeleton';
import { FileBarChart } from 'lucide-react';

const MONTH_NAMES: Record<number, string> = {
  1: 'Enero', 2: 'Febrero', 3: 'Marzo', 4: 'Abril',
  5: 'Mayo', 6: 'Junio', 7: 'Julio', 8: 'Agosto',
  9: 'Septiembre', 10: 'Octubre', 11: 'Noviembre', 12: 'Diciembre',
};

function formatBytes(bytes: number | null): string {
  if (!bytes) return '-';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '-';
  const d = new Date(dateStr);
  return d.toLocaleDateString('es-MX', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function ReportsPage() {
  const [page, setPage] = useState(1);
  const [showDialog, setShowDialog] = useState(false);
  const { data, isLoading } = useReports(page);
  const generateMutation = useGenerateReport();

  const handleGenerate = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const month = parseInt(formData.get('month') as string);
    const year = parseInt(formData.get('year') as string);

    if (month && year) {
      generateMutation.mutate(
        { month, year },
        {
          onSuccess: () => {
            setShowDialog(false);
            alert('Reporte encolado. Se notificará al completarse.');
          },
          onError: (error: unknown) => {
            const e = error as { response?: { data?: { error?: string } }; message?: string };
            alert('Error: ' + (e.response?.data?.error || e.message || 'desconocido'));
          },
        }
      );
    }
  };

  // Valores por defecto: mes anterior
  const now = new Date();
  const defaultMonth = now.getMonth() === 0 ? 12 : now.getMonth();
  const defaultYear = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear();

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Reportes mensuales"
        description="Reportes generados automáticamente o bajo demanda"
        actions={
          <Button onClick={() => setShowDialog(true)}>
            Generar reporte
          </Button>
        }
      />

      {/* Tabla de reportes */}
      {isLoading ? (
        <SkeletonTable rows={5} cols={6} />
      ) : !data?.data?.length ? (
        <EmptyState
          icon={FileBarChart}
          title="Sin reportes generados"
          description="Aún no se han creado reportes. Genera el primero para comenzar."
          action={<Button onClick={() => setShowDialog(true)}>Generar reporte</Button>}
        />
      ) : (
        <>
          <div className="bg-card rounded-lg border shadow-sm overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-muted/50 border-b">
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">Periodo</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">Estado</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">Solicitado por</th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">Fecha</th>
                  <th className="text-right px-4 py-3 font-medium text-muted-foreground">PDF</th>
                  <th className="text-right px-4 py-3 font-medium text-muted-foreground">Excel</th>
                </tr>
              </thead>
              <tbody>
                {data.data.map((report) => (
                  <tr key={report.id} className="border-b hover:bg-muted/50">
                    {/* Periodo */}
                    <td className="px-4 py-3 font-medium">
                      {MONTH_NAMES[report.month]} {report.year}
                    </td>

                    {/* Estado */}
                    <td className="px-4 py-3">
                      {report.status === 'COMPLETED' && (
                        <Badge className="bg-success/15 text-success">Completado</Badge>
                      )}
                      {report.status === 'PROCESSING' && (
                        <Badge className="bg-primary-subtle text-primary">Procesando...</Badge>
                      )}
                      {report.status === 'FAILED' && (
                        <Badge className="bg-destructive/15 text-destructive">Error</Badge>
                      )}
                    </td>

                    {/* Solicitado por */}
                    <td className="px-4 py-3 text-muted-foreground">
                      {report.requestedBy}
                    </td>

                    {/* Fecha */}
                    <td className="px-4 py-3 text-muted-foreground">
                      {formatDate(report.completedAt || report.startedAt)}
                    </td>

                    {/* Descargar PDF */}
                    <td className="px-4 py-3 text-right">
                      {report.status === 'COMPLETED' && report.pdfPath ? (
                        <button
                          onClick={() => downloadReport(report.id, 'pdf')}
                          className="text-primary hover:text-primary hover:underline text-sm"
                        >
                          PDF ({formatBytes(report.pdfSize)})
                        </button>
                      ) : (
                        <span className="text-placeholder">-</span>
                      )}
                    </td>

                    {/* Descargar Excel */}
                    <td className="px-4 py-3 text-right">
                      {report.status === 'COMPLETED' && report.excelPath ? (
                        <button
                          onClick={() => downloadReport(report.id, 'excel')}
                          className="text-success hover:text-success hover:underline text-sm"
                        >
                          Excel ({formatBytes(report.excelSize)})
                        </button>
                      ) : (
                        <span className="text-placeholder">-</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Paginación */}
          {data.pagination.totalPages > 1 && (
            <div className="flex justify-center gap-2 mt-4">
              <Button
                variant="outline"
                size="sm"
                disabled={page <= 1}
                onClick={() => setPage(page - 1)}
              >
                Anterior
              </Button>
              <span className="text-sm text-muted-foreground flex items-center px-3">
                Página {page} de {data.pagination.totalPages}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= data.pagination.totalPages}
                onClick={() => setPage(page + 1)}
              >
                Siguiente
              </Button>
            </div>
          )}
        </>
      )}

      {/* Dialog para generar reporte */}
      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Generar Reporte Mensual</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleGenerate} className="space-y-4 mt-4">
            <div>
              <Label htmlFor="month">Mes</Label>
              <select
                name="month"
                id="month"
                defaultValue={defaultMonth}
                className="w-full mt-1 px-3 py-2 border rounded-md text-sm"
              >
                {Object.entries(MONTH_NAMES).map(([num, name]) => (
                  <option key={num} value={num}>{name}</option>
                ))}
              </select>
            </div>
            <div>
              <Label htmlFor="year">Año</Label>
              <Input
                name="year"
                id="year"
                type="number"
                defaultValue={defaultYear}
                min={2020}
                max={2100}
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setShowDialog(false)}
              >
                Cancelar
              </Button>
              <Button
                type="submit"
                disabled={generateMutation.isPending}
              >
                {generateMutation.isPending ? 'Enviando...' : 'Generar'}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}