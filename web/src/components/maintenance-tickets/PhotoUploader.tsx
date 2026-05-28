// Uploader de fotos (ejecutor) — drag & drop opcional, máx 5 fotos JPG/PNG ≤5MB.
// Para tickets NUEVOS sube las fotos secuencialmente DESPUÉS de crear el ticket
// (el endpoint /attachments necesita ticketId existente).
//
// Modo 1 (`onFilesChange`): solo recolecta archivos; el caller sube cuando tenga ticketId.
// Modo 2 (`ticketId`): sube directamente con useUploadAttachment.

'use client';

import { useRef, useState } from 'react';
import { Upload, X, ImagePlus, Loader2, AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useUploadAttachment } from '@/hooks/useMaintenanceTickets';

const MAX_FILES = 5;
const MAX_SIZE = 5 * 1024 * 1024; // 5 MB
const ALLOWED = ['image/jpeg', 'image/png'];

type Props =
  | {
      mode: 'collect';
      files: File[];
      onFilesChange: (files: File[]) => void;
      ticketId?: never;
      currentCount?: never;
    }
  | {
      mode: 'upload';
      ticketId: number;
      currentCount: number;
      files?: never;
      onFilesChange?: never;
    };

export function PhotoUploader(props: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // rules-of-hooks: el hook se llama SIEMPRE; lo usamos solo en modo 'upload'.
  const uploadHook = useUploadAttachment();
  const upload = props.mode === 'upload' ? uploadHook : null;

  const currentFiles = props.mode === 'collect' ? props.files : [];
  const totalCount =
    props.mode === 'collect' ? currentFiles.length : props.currentCount;
  const remaining = MAX_FILES - totalCount;
  const canAdd = remaining > 0 && (upload?.isPending !== true);

  function validate(file: File): string | null {
    if (!ALLOWED.includes(file.type)) return `${file.name}: solo JPG o PNG`;
    if (file.size > MAX_SIZE) return `${file.name}: máximo 5MB`;
    return null;
  }

  async function handleFiles(list: FileList | null) {
    if (!list || list.length === 0) return;
    setError(null);
    const incoming = Array.from(list).slice(0, remaining);

    for (const f of incoming) {
      const err = validate(f);
      if (err) {
        setError(err);
        return;
      }
    }

    if (props.mode === 'collect') {
      props.onFilesChange([...currentFiles, ...incoming]);
    } else {
      // Sube secuencialmente para evitar lock del API y mensajes más claros
      for (const f of incoming) {
        try {
          await upload!.mutateAsync({ ticketId: props.ticketId, file: f });
        } catch (e) {
          const msg = (e as { response?: { data?: { error?: string } } })?.response?.data?.error;
          setError(msg ?? `Falló subida de ${f.name}`);
          return;
        }
      }
    }
  }

  function removeFile(idx: number) {
    if (props.mode !== 'collect') return;
    props.onFilesChange(currentFiles.filter((_, i) => i !== idx));
  }

  return (
    <div>
      <label
        onDragOver={(e) => {
          e.preventDefault();
          if (canAdd) setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          if (canAdd) void handleFiles(e.dataTransfer.files);
        }}
        className={cn(
          'flex flex-col items-center gap-2 border-2 border-dashed rounded-md p-6 transition-colors',
          canAdd
            ? 'border-border hover:border-primary cursor-pointer'
            : 'border-border opacity-50 cursor-not-allowed',
          dragOver && 'border-primary bg-primary-subtle/30',
        )}
      >
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png"
          multiple
          className="hidden"
          disabled={!canAdd}
          onChange={(e) => void handleFiles(e.target.files)}
        />
        {upload?.isPending ? (
          <Loader2 className="size-6 text-muted-foreground animate-spin" />
        ) : (
          <ImagePlus className="size-6 text-muted-foreground" />
        )}
        <div className="text-sm text-center">
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={!canAdd}
            className="font-medium text-primary hover:underline disabled:no-underline disabled:text-muted-foreground"
          >
            Selecciona fotos
          </button>{' '}
          o arrástralas aquí
        </div>
        <div className="text-xs text-muted-foreground">
          {totalCount}/{MAX_FILES} · JPG/PNG · máx 5MB c/u
        </div>
      </label>

      {error && (
        <div className="mt-2 text-xs text-rose-600 dark:text-rose-400 flex items-center gap-1.5">
          <AlertCircle className="size-3.5" />
          {error}
        </div>
      )}

      {/* Preview de archivos pendientes (modo collect) */}
      {props.mode === 'collect' && currentFiles.length > 0 && (
        <ul className="mt-3 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2">
          {currentFiles.map((f, i) => (
            <li
              key={`${f.name}-${i}`}
              className="relative aspect-square rounded-md overflow-hidden border border-border bg-muted group"
            >
              <img
                src={URL.createObjectURL(f)}
                alt={f.name}
                className="size-full object-cover"
              />
              <button
                type="button"
                onClick={() => removeFile(i)}
                className="absolute top-1 right-1 bg-background/90 hover:bg-rose-100 rounded-full size-6 flex items-center justify-center text-muted-foreground hover:text-rose-600 transition-colors"
                aria-label={`Quitar ${f.name}`}
              >
                <X className="size-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
