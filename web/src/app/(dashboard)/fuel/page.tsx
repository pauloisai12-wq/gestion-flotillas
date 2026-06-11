'use client';

import { useState } from 'react';
import { useFuelLoads, FuelLoad } from '@/hooks/useFuelLoads';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import DataTable from '@/components/ui/data-table';
import FuelLoadFormDialog from '@/components/Fuel/FuelLoadFormDialog';
import { formatCurrency, formatDate, formatNumber } from '@/lib/formatters';
import { type ColumnDef } from '@tanstack/react-table';

const columns: ColumnDef<FuelLoad, unknown>[] = [
  {
    accessorKey: 'loadDate',
    header: 'Fecha',
    cell: ({ row }) => formatDate(row.original.loadDate),
  },
  {
    id: 'vehicle',
    header: 'Vehículo',
    accessorFn: (row) => row.vehicle?.economicNumber ?? '',
    cell: ({ row }) => <span className="font-medium">{row.original.vehicle.economicNumber}</span>,
  },
  {
    id: 'operator',
    header: 'Operador',
    accessorFn: (row) => row.operator?.fullName || row.operatorNameRaw || row.operatorEmployeeRaw || '',
    cell: ({ row }) => row.original.operator?.fullName || row.original.operatorNameRaw || row.original.operatorEmployeeRaw || '—',
  },
  {
    id: 'station',
    header: 'Gasolinera',
    accessorFn: (row) => row.station?.tradeName || row.station?.legalName || '',
    cell: ({ row }) => row.original.station.tradeName || row.original.station.legalName,
  },
  {
    accessorKey: 'liters',
    header: 'Litros',
    cell: ({ row }) => <span className="text-right block font-mono tabular-nums">{row.original.liters?.toFixed(1) ?? '—'}</span>,
  },
  {
    accessorKey: 'amount',
    header: 'Monto',
    cell: ({ row }) => (
      <span className="text-right block font-mono tabular-nums">
        {formatCurrency(row.original.amount, { minimumFractionDigits: 2 })}
      </span>
    ),
  },
  {
    accessorKey: 'odometer',
    header: 'Odómetro',
    cell: ({ row }) => (
      <span className="text-right block font-mono tabular-nums">
        {row.original.odometerStatus === 'NF' ? 'NF' : formatNumber(row.original.odometer) + ' km'}
      </span>
    ),
  },
  {
    accessorKey: 'kmPerLiter',
    header: 'km/l',
    cell: ({ row }) => {
      const kml = row.original.kmPerLiter;
      if (!kml) return <span className="text-right block">-</span>;
      const expected = row.original.vehicle.vehicleType?.expectedKmPerLiter || 0;
      const isLow = kml < expected * 0.8;
      return (
        <span className={'text-right block font-medium ' + (isLow ? 'text-destructive' : 'text-success')}>
          {kml.toFixed(1)}
        </span>
      );
    },
  },
  {
    accessorKey: 'isApproved',
    header: 'Aprobada',
    cell: ({ row }) => (
      row.original.isApproved
        ? <Badge className="bg-success text-white">Si</Badge>
        : <Badge variant="destructive">No</Badge>
    ),
  },
];

export default function FuelPage() {
  const [page, setPage] = useState(1);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const { data, isLoading } = useFuelLoads({
    page,
    limit: 20,
    dateFrom: dateFrom || undefined,
    dateTo: dateTo || undefined,
  });

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Cargas de Combustible</h1>
          <p className="text-sm text-muted-foreground">{data?.pagination?.total || 0} cargas registradas</p>
        </div>
      </div>

      {/* Filtros de fecha */}
      <div className="flex gap-2 items-end max-w-md">
        <div>
          <label className="text-xs text-muted-foreground">Desde</label>
          <Input type="date" value={dateFrom} onChange={function (e) { setDateFrom(e.target.value); setPage(1); }} />
        </div>
        <div>
          <label className="text-xs text-muted-foreground">Hasta</label>
          <Input type="date" value={dateTo} onChange={function (e) { setDateTo(e.target.value); setPage(1); }} />
        </div>
        {(dateFrom || dateTo) && (
          <Button variant="outline" size="sm" onClick={function () { setDateFrom(''); setDateTo(''); }}>Limpiar</Button>
        )}
      </div>

      <DataTable
        columns={columns}
        data={data?.data || []}
        pagination={data?.pagination}
        page={page}
        onPageChange={setPage}
        isLoading={isLoading}
        headerActions={
          <Button onClick={function () { setDialogOpen(true); }}>+ Nueva carga</Button>
        }
      />

      <FuelLoadFormDialog open={dialogOpen} onClose={function () { setDialogOpen(false); }} />
    </div>
  );
}