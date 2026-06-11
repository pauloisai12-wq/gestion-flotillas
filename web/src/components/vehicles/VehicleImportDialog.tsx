// Dialog para importar vehículos desde Excel/CSV

'use client';

import { useState, useRef } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Upload, FileSpreadsheet, CheckCircle2, AlertTriangle, X } from 'lucide-react';

interface ImportResult {
  total: number;
  created: number;
  updated: number;
  skipped: number;
  errors: { row: number; message: string }[];
  // Avisos no fatales: clave única repetida que se guardó desambiguada con
  // sufijo -DUP- (revisar el duplicado en el archivo de origen).
  warnings: { row: number; message: string }[];
}

export default function VehicleImportDialog({
  open, onClose,
}: { open: boolean; onClose: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const qc = useQueryClient();

  const uploadMut = useMutation({
    mutationFn: async (file: File) => {
      const fd = new FormData();
      fd.append('file', file);
      // Timeout largo (10 min): un inventario de miles de filas tarda más que
      // el timeout global de 30 s. Sin esto el cliente cortaba, el servidor
      // seguía procesando, y el reintento del usuario lanzaba imports
      // concurrentes que duplicaban todos los vehículos.
      const res = await api.post('/vehicles/import', fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
        timeout: 600_000,
      });
      return res.data.data as ImportResult;
    },
    onSuccess: (data) => {
      setResult(data);
      qc.invalidateQueries({ queryKey: ['vehicles'] });
    },
    onError: (err: { response?: { data?: { error?: string } } }) => {
      setError(err.response?.data?.error || 'Error al subir archivo');
    },
  });

  function reset() {
    setFile(null);
    setResult(null);
    setError('');
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  function close() {
    reset();
    onClose();
  }

  async function handleUpload(e: React.FormEvent) {
    e.preventDefault();
    if (!file) return;
    setError('');
    await uploadMut.mutateAsync(file);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    const f = e.dataTransfer.files[0];
    if (f) setFile(f);
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Importar vehículos desde Excel</DialogTitle>
        </DialogHeader>

        {!result && (
          <form onSubmit={handleUpload} className="space-y-4">
            <div className="text-sm text-muted-foreground">
              Sube un archivo .xlsx, .xls o .csv. El sistema mapeará las columnas automáticamente
              (Placa, No. Económico, Marca, Tipo, etc.) y hará upsert por <span className="font-mono">No. Económico</span>.
            </div>

            {/* Drop zone */}
            <label
              className="flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-border bg-muted/30 px-4 py-8 cursor-pointer hover:border-primary hover:bg-primary-subtle/30 transition-colors"
              onDragOver={(e) => e.preventDefault()}
              onDrop={handleDrop}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.xls,.csv"
                className="hidden"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
              {file ? (
                <>
                  <FileSpreadsheet className="size-8 text-primary" />
                  <div className="text-sm font-medium">{file.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {(file.size / 1024).toFixed(1)} KB
                  </div>
                  <Button
                    type="button" variant="ghost" size="xs"
                    onClick={(e) => { e.preventDefault(); reset(); }}
                  >
                    <X className="size-3" /> Quitar
                  </Button>
                </>
              ) : (
                <>
                  <Upload className="size-8 text-muted-foreground" />
                  <div className="text-sm font-medium">Arrastra el archivo aquí o haz clic para seleccionar</div>
                  <div className="text-xs text-muted-foreground">.xlsx · .xls · .csv (máx 10MB)</div>
                </>
              )}
            </label>

            <details className="text-xs text-muted-foreground">
              <summary className="cursor-pointer hover:text-foreground">Columnas reconocidas (clic para ver)</summary>
              <ul className="mt-2 pl-4 space-y-0.5 list-disc">
                <li>No. Exp · Placa · Placa Anterior · No. Económico</li>
                <li>Marca · Tipo · Clase del Vehículo · Color · Mod · Motor · Serie · Cilindros</li>
                <li>Uso · Estatus · Estatus Físico Actual</li>
                <li>UEjec · Área · Resguardante</li>
                <li>Último año asegurado · Última tenencia · Último resguardo · Certificación factura</li>
                <li>Observaciones</li>
              </ul>
              <p className="mt-2 text-[11px]">Mayúsculas, acentos y abreviaciones se normalizan automáticamente.</p>
            </details>

            {error && (
              <div className="flex items-start gap-2 rounded-md bg-destructive/10 border border-destructive/20 text-destructive px-3 py-2 text-sm">
                <AlertTriangle className="size-4 mt-0.5 shrink-0" /> <span>{error}</span>
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={close} disabled={uploadMut.isPending}>
                Cancelar
              </Button>
              <Button type="submit" disabled={!file || uploadMut.isPending}>
                {uploadMut.isPending ? 'Procesando…' : 'Importar'}
              </Button>
            </div>
          </form>
        )}

        {result && (
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="size-5 text-success" />
              <span className="font-medium">Importación completada</span>
            </div>

            <div className="grid grid-cols-4 gap-2">
              <div className="rounded-md bg-muted/40 p-3 text-center">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Total</div>
                <div className="font-mono text-xl font-semibold tabular-nums">{result.total}</div>
              </div>
              <div className="rounded-md bg-success/10 p-3 text-center">
                <div className="text-[10px] uppercase tracking-wider text-success">Creados</div>
                <div className="font-mono text-xl font-semibold tabular-nums text-success">{result.created}</div>
              </div>
              <div className="rounded-md bg-primary-subtle p-3 text-center">
                <div className="text-[10px] uppercase tracking-wider text-primary">Actualizados</div>
                <div className="font-mono text-xl font-semibold tabular-nums text-primary">{result.updated}</div>
              </div>
              <div className="rounded-md bg-warning/10 p-3 text-center">
                <div className="text-[10px] uppercase tracking-wider text-warning">Omitidos</div>
                <div className="font-mono text-xl font-semibold tabular-nums text-warning">{result.skipped}</div>
              </div>
            </div>

            {result.errors.length > 0 && (
              <div className="rounded-md border border-destructive/30 bg-destructive/5">
                <div className="flex items-center gap-2 px-3 py-2 border-b border-destructive/20 text-destructive text-sm font-medium">
                  <AlertTriangle className="size-4" />
                  {result.errors.length} fila{result.errors.length === 1 ? '' : 's'} con error
                </div>
                <div className="max-h-48 overflow-y-auto p-2 text-xs space-y-1">
                  {result.errors.slice(0, 30).map((e, i) => (
                    <div key={i} className="font-mono text-destructive">
                      Fila {e.row}: <span className="font-sans">{e.message}</span>
                    </div>
                  ))}
                  {result.errors.length > 30 && (
                    <div className="text-muted-foreground italic">…y {result.errors.length - 30} más</div>
                  )}
                </div>
              </div>
            )}

            {result.warnings?.length > 0 && (
              <div className="rounded-md border border-warning/30 bg-warning/5">
                <div className="flex items-center gap-2 px-3 py-2 border-b border-warning/20 text-warning text-sm font-medium">
                  <AlertTriangle className="size-4" />
                  {result.warnings.length} aviso{result.warnings.length === 1 ? '' : 's'} de duplicado (revisar)
                </div>
                <div className="max-h-48 overflow-y-auto p-2 text-xs space-y-1">
                  {result.warnings.slice(0, 50).map((w, i) => (
                    <div key={i} className="font-mono text-warning">
                      Fila {w.row}: <span className="font-sans text-foreground">{w.message}</span>
                    </div>
                  ))}
                  {result.warnings.length > 50 && (
                    <div className="text-muted-foreground italic">…y {result.warnings.length - 50} más</div>
                  )}
                </div>
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={reset}>Importar otro</Button>
              <Button onClick={close}>Cerrar</Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
