// Archivo: web/src/lib/exportCsv.ts
// Propósito: Utilidad para exportar datos de tablas a archivo CSV
// NUEVO archivo

interface CsvColumn<T = unknown> {
  header: string;
  accessor: (row: T) => string | number;
}

export function exportToCsv<T = unknown>(filename: string, columns: CsvColumn<T>[], data: T[]) {
  // Encabezados
  const headers = columns.map(function (col) { return col.header; }).join(',');

  // Filas
  const rows = data.map(function (row) {
    return columns.map(function (col) {
      const value = col.accessor(row);
      // Escapar comillas y envolver en comillas si contiene coma
      const str = String(value === null || value === undefined ? '' : value);
      if (str.includes(',') || str.includes('"') || str.includes('\n')) {
        return '"' + str.replace(/"/g, '""') + '"';
      }
      return str;
    }).join(',');
  });

  // BOM para que Excel reconozca UTF-8 (acentos, ñ)
  const bom = '\uFEFF';
  const csv = bom + headers + '\n' + rows.join('\n');

  // Descargar
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename + '.csv';
  link.click();
  URL.revokeObjectURL(url);
}