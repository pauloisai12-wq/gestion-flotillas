// Dialog para importar vehículos desde Excel/CSV

'use client';

import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
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

type ImportJobStatus = 'QUEUED' | 'PROCESSING' | 'COMPLETED' | 'FAILED';

interface VehicleImportJob {
  id: number;
  type: 'VEHICLE_IMPORT';
  status: ImportJobStatus;
  progress: number;
  originalFileName: string | null;
  result: ImportResult | null;
  errorMessage: string | null;
}

const PENDING_IMPORT_STORAGE_KEY = 'flotillas.pendingVehicleImportJobId';

export default function VehicleImportDialog({
  open, onClose,
}: { open: boolean; onClose: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [jobId, setJobId] = useState<number | null>(null);
  const [localImportRestoreComplete, setLocalImportRestoreComplete] = useState(false);
  const [error, setError] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const qc = useQueryClient();

  useEffect(() => {
    const stored = Number(window.sessionStorage.getItem(PENDING_IMPORT_STORAGE_KEY));
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      if (Number.isInteger(stored) && stored > 0) setJobId(stored);
      setLocalImportRestoreComplete(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const activeImportQuery = useQuery<VehicleImportJob | null>({
    queryKey: ['vehicle-import-job', 'active'],
    queryFn: async () => {
      const res = await api.get('/vehicles/import/active');
      return (res.data.data as VehicleImportJob | null) ?? null;
    },
    enabled: localImportRestoreComplete && jobId === null,
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    const activeJob = activeImportQuery.data;
    if (activeImportQuery.isFetching || !activeJob || jobId !== null) return;
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      setJobId(activeJob.id);
      setFile(null);
      setError('');
      window.sessionStorage.setItem(PENDING_IMPORT_STORAGE_KEY, String(activeJob.id));
      if (fileInputRef.current) fileInputRef.current.value = '';
    });
    return () => {
      cancelled = true;
    };
  }, [activeImportQuery.data, activeImportQuery.isFetching, jobId]);

  const {
    data: job,
    isError: jobQueryFailed,
  } = useQuery<VehicleImportJob>({
    queryKey: ['vehicle-import-job', jobId],
    queryFn: async () => {
      const res = await api.get(`/vehicles/import/${jobId}`);
      return res.data.data as VehicleImportJob;
    },
    enabled: jobId !== null,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === 'COMPLETED' || status === 'FAILED' ? false : 1_500;
    },
  });

  const result = job?.status === 'COMPLETED' ? job.result : null;
  // Entre el POST 202 y el primer GET todavía no hay `job`; ese intervalo
  // también es activo. Si se cerrara allí y se limpiara el id, el trabajo
  // seguiría en backend pero el usuario ya no podría recuperar el resultado.
  const isActiveJob = jobId !== null && (
    job == null || job.status === 'QUEUED' || job.status === 'PROCESSING'
  );

  useEffect(() => {
    if (job?.status === 'COMPLETED') {
      qc.invalidateQueries({ queryKey: ['vehicles'] });
    }
  }, [job?.status, qc]);

  const uploadMut = useMutation({
    mutationFn: async (file: File) => {
      const fd = new FormData();
      fd.append('file', file);
      const res = await api.post('/vehicles/import', fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
        timeout: 60_000,
      });
      return res.data.data as VehicleImportJob;
    },
    onSuccess: (createdJob) => {
      setJobId(createdJob.id);
      window.sessionStorage.setItem(PENDING_IMPORT_STORAGE_KEY, String(createdJob.id));
    },
    onError: async (err: { response?: { status?: number; data?: { error?: string } } }) => {
      if (err.response?.status === 409) {
        try {
          const res = await api.get('/vehicles/import/active');
          const activeJob = (res.data.data as VehicleImportJob | null) ?? null;
          if (activeJob) {
            setJobId(activeJob.id);
            setFile(null);
            setError('');
            window.sessionStorage.setItem(PENDING_IMPORT_STORAGE_KEY, String(activeJob.id));
            if (fileInputRef.current) fileInputRef.current.value = '';
            return;
          }
        } catch {
          // El mensaje general cubre también un fallo al recuperar el job activo.
        }
      }
      setError(err.response?.data?.error || 'Error al subir archivo');
    },
  });

  const waitingForActiveImport = jobId === null && (
    !localImportRestoreComplete || activeImportQuery.isFetching
  );

  function reset() {
    setFile(null);
    setJobId(null);
    setError('');
    window.sessionStorage.removeItem(PENDING_IMPORT_STORAGE_KEY);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  function close() {
    if (!isActiveJob) reset();
    onClose();
  }

  function handleUpload(e: React.FormEvent) {
    e.preventDefault();
    if (!file) return;
    setError('');
    uploadMut.mutate(file);
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
          <DialogDescription className="sr-only">
            Sube el inventario; el procesamiento continuará en segundo plano y mostrará su progreso.
          </DialogDescription>
        </DialogHeader>

        {waitingForActiveImport && (
          <div className="py-6 text-center text-sm text-muted-foreground" role="status">
            Buscando importación activa…
          </div>
        )}

        {!jobId && !waitingForActiveImport && !result && (
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
                {uploadMut.isPending ? 'Encolando…' : 'Importar'}
              </Button>
            </div>
          </form>
        )}

        {jobId && !result && (
          <div className="space-y-4" role="status" aria-live="polite">
            {jobQueryFailed || job?.status === 'FAILED' || job?.status === 'COMPLETED' ? (
              <div className="space-y-3">
                <div className="flex items-start gap-2 rounded-md border border-destructive/20 bg-destructive/10 px-3 py-3 text-sm text-destructive">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                  <span>{job?.errorMessage || (job?.status === 'COMPLETED'
                    ? 'La importación terminó sin un resultado legible.'
                    : 'No se pudo consultar o completar la importación.')}</span>
                </div>
                <div className="flex justify-end gap-2">
                  <Button type="button" variant="outline" onClick={close}>Cerrar</Button>
                  <Button type="button" onClick={reset}>Elegir otro archivo</Button>
                </div>
              </div>
            ) : (
              <>
                <div>
                  <div className="flex items-center justify-between gap-3 text-sm">
                    <span className="font-medium">
                      {job?.status === 'PROCESSING' ? 'Procesando inventario' : 'Importación en cola'}
                    </span>
                    <span className="font-mono tabular-nums text-muted-foreground">
                      {job?.progress ?? 0}%
                    </span>
                  </div>
                  <div
                    className="mt-2 h-2 overflow-hidden rounded-full bg-muted"
                    role="progressbar"
                    aria-label="Progreso de importación"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={job?.progress ?? 0}
                  >
                    <div
                      className="h-full rounded-full bg-primary transition-[width]"
                      style={{ width: `${job?.progress ?? 0}%` }}
                    />
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">
                    Puedes cerrar esta ventana; el trabajo continuará y se retomará al abrirla nuevamente.
                  </p>
                </div>
                <div className="flex justify-end">
                  <Button type="button" variant="outline" onClick={close}>
                    Cerrar y continuar en segundo plano
                  </Button>
                </div>
              </>
            )}
          </div>
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
