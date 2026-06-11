// Componente genérico de tabla con sorting, búsqueda y paginación servidor

'use client';

import { useState } from 'react';
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  flexRender,
  type ColumnDef,
  type SortingState,
} from '@tanstack/react-table';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ArrowUpDown, ArrowUp, ArrowDown, Download } from 'lucide-react';

interface PaginationInfo {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

interface DataTableProps<T> {
  columns: ColumnDef<T, unknown>[];
  data: T[];
  pagination?: PaginationInfo;
  page: number;
  onPageChange: (page: number) => void;
  search?: string;
  onSearchChange?: (search: string) => void;
  searchPlaceholder?: string;
  sorting?: SortingState;
  onSortingChange?: (sorting: SortingState) => void;
  onRowClick?: (row: T) => void;
  isLoading?: boolean;
  headerActions?: React.ReactNode;
  onExportCsv?: () => void;
}

export default function DataTable<T>({
  columns,
  data,
  pagination,
  page,
  onPageChange,
  search,
  onSearchChange,
  searchPlaceholder = 'Buscar...',
  sorting = [],
  onSortingChange,
  onRowClick,
  isLoading,
  headerActions,
  onExportCsv,
}: DataTableProps<T>) {
  const [searchInput, setSearchInput] = useState(search || '');
  const [internalSorting, setInternalSorting] = useState<SortingState>([]);

  // Sort client-side por default (más simple). Si onSortingChange se pasa, delega al padre.
  const useClientSort = !onSortingChange;
  const effectiveSorting = useClientSort ? internalSorting : sorting;

  // useReactTable retorna funciones no memoizables (limitación documentada
  // de TanStack Table). El compilador de React saltea esta sección.
  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: useClientSort ? getSortedRowModel() : undefined,
    manualSorting: !useClientSort,
    manualPagination: true,
    state: { sorting: effectiveSorting },
    onSortingChange: (updater) => {
      const current = effectiveSorting;
      const next = typeof updater === 'function' ? updater(current) : updater;
      if (onSortingChange) onSortingChange(next);
      else setInternalSorting(next);
    },
    rowCount: pagination?.total || 0,
  });

  function handleSearchSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (onSearchChange) {
      onSearchChange(searchInput);
      onPageChange(1);
    }
  }

  if (isLoading) {
    return <div className="p-6 text-center text-gray-400">Cargando datos...</div>;
  }

  return (
    <div className="space-y-4">
      {/* Barra de búsqueda y acciones */}
      <div className="flex items-center justify-between gap-4">
        {onSearchChange ? (
          <form onSubmit={handleSearchSubmit} className="flex gap-2 max-w-md">
            <Input
              placeholder={searchPlaceholder}
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
            />
            <Button type="submit" variant="outline">
              Buscar
            </Button>
          </form>
        ) : (
          <div />
        )}
        <div className="flex gap-2">
          {onExportCsv && (
            <Button variant="outline" size="sm" onClick={onExportCsv}>
              <Download className="h-4 w-4 mr-1" />
              CSV
            </Button>
          )}
          {headerActions}
        </div>
      </div>

      {/* Tabla */}
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => {
                  const canSort = header.column.getCanSort();
                  const sorted = header.column.getIsSorted();
                  return (
                    <TableHead
                      key={header.id}
                      className={canSort ? 'cursor-pointer select-none' : ''}
                      onClick={canSort ? header.column.getToggleSortingHandler() : undefined}
                    >
                      <div className="flex items-center gap-1">
                        {flexRender(header.column.columnDef.header, header.getContext())}
                        {canSort && !sorted && <ArrowUpDown className="h-3 w-3 text-gray-400" />}
                        {sorted === 'asc' && <ArrowUp className="h-3 w-3" />}
                        {sorted === 'desc' && <ArrowDown className="h-3 w-3" />}
                      </div>
                    </TableHead>
                  );
                })}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows.length > 0 ? (
              table.getRowModel().rows.map((row) => (
                <TableRow
                  key={row.id}
                  className={onRowClick ? 'cursor-pointer hover:bg-muted/50' : ''}
                  onClick={onRowClick ? () => onRowClick(row.original) : undefined}
                >
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id}>
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={columns.length} className="text-center py-8 text-muted-foreground">
                  No se encontraron registros
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {/* Paginación */}
      {pagination && pagination.totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            Pagina {pagination.page} de {pagination.totalPages} ({pagination.total} registros)
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1}
              onClick={() => onPageChange(page - 1)}
            >
              Anterior
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= pagination.totalPages}
              onClick={() => onPageChange(page + 1)}
            >
              Siguiente
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}