// Componente genérico de tabla con sorting, búsqueda y paginación servidor

'use client';

import { useId, useState } from 'react';
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
import { AlertTriangle, ArrowUpDown, ArrowUp, ArrowDown, Download, Loader2 } from 'lucide-react';

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
  rowActionLabel?: (row: T) => string;
  isLoading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  emptyTitle?: string;
  emptyDescription?: string;
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
  rowActionLabel,
  isLoading,
  error,
  onRetry,
  emptyTitle = 'No se encontraron registros',
  emptyDescription,
  headerActions,
  onExportCsv,
}: DataTableProps<T>) {
  const [searchInput, setSearchInput] = useState(search || '');
  const [internalSorting, setInternalSorting] = useState<SortingState>([]);
  const searchId = useId();

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
    return (
      <div role="status" aria-live="polite" className="flex min-h-40 items-center justify-center gap-2 rounded-md border border-dashed p-6 text-sm text-muted-foreground">
        <Loader2 aria-hidden="true" className="size-4 animate-spin" />
        Cargando datos…
      </div>
    );
  }

  if (error) {
    return (
      <div role="alert" className="flex min-h-40 flex-col items-center justify-center gap-3 rounded-md border border-destructive/30 bg-destructive/5 p-6 text-center">
        <AlertTriangle aria-hidden="true" className="size-8 text-destructive" />
        <div>
          <p className="font-medium">No pudimos cargar los datos</p>
          <p className="mt-1 text-sm text-muted-foreground">{error}</p>
        </div>
        {onRetry && (
          <Button type="button" variant="outline" onClick={onRetry}>
            Reintentar
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Barra de búsqueda y acciones */}
      <div className="flex flex-col items-stretch justify-between gap-3 sm:flex-row sm:items-center">
        {onSearchChange ? (
          <form onSubmit={handleSearchSubmit} role="search" className="grid w-full grid-cols-[minmax(0,1fr)_auto] gap-2 sm:max-w-md">
            <label htmlFor={searchId} className="sr-only">Buscar registros</label>
            <Input
              id={searchId}
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
        <div className="flex flex-wrap justify-end gap-2">
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
      <div className="max-w-full rounded-md border">
        <Table aria-label="Listado de registros">
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => {
                  const canSort = header.column.getCanSort();
                  const sorted = header.column.getIsSorted();
                  return (
                    <TableHead
                      key={header.id}
                      className={canSort ? 'p-0' : ''}
                      aria-sort={
                        sorted === 'asc'
                          ? 'ascending'
                          : sorted === 'desc'
                            ? 'descending'
                            : canSort
                              ? 'none'
                              : undefined
                      }
                    >
                      {canSort ? (
                      <button
                        type="button"
                        onClick={header.column.getToggleSortingHandler()}
                        className="flex min-h-10 w-full items-center gap-1 px-3 text-left uppercase tracking-wider hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                      >
                        {flexRender(header.column.columnDef.header, header.getContext())}
                        {canSort && !sorted && <ArrowUpDown className="h-3 w-3 text-gray-400" />}
                        {sorted === 'asc' && <ArrowUp className="h-3 w-3" />}
                        {sorted === 'desc' && <ArrowDown className="h-3 w-3" />}
                      </button>
                      ) : (
                        <div className="flex items-center gap-1">
                          {flexRender(header.column.columnDef.header, header.getContext())}
                        </div>
                      )}
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
                  tabIndex={onRowClick ? 0 : undefined}
                  role={onRowClick ? 'link' : undefined}
                  aria-label={onRowClick
                    ? rowActionLabel?.(row.original) ?? 'Abrir detalle del registro'
                    : undefined}
                  onKeyDown={onRowClick ? (event) => {
                    if (event.target !== event.currentTarget) return;
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      onRowClick(row.original);
                    }
                  } : undefined}
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
                <TableCell colSpan={columns.length} className="py-10 text-center text-muted-foreground">
                  <div role="status" className="mx-auto max-w-sm">
                    <p className="font-medium text-foreground">{emptyTitle}</p>
                    {emptyDescription && <p className="mt-1 text-sm">{emptyDescription}</p>}
                  </div>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {/* Paginación */}
      {pagination && pagination.totalPages > 1 && (
        <div className="flex flex-col items-stretch justify-between gap-3 sm:flex-row sm:items-center">
          <p className="text-sm text-muted-foreground">
            Página {pagination.page} de {pagination.totalPages} ({pagination.total} registros)
          </p>
          <div className="grid grid-cols-2 gap-2 sm:flex">
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
