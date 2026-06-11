'use client';

// Sistema de toasts sin dependencias externas. El store vive a nivel de
// módulo para que toast.*() sea invocable desde cualquier sitio (handlers,
// hooks como useReports) sin necesidad de contexto React; <Toaster />,
// montado una sola vez en el layout raíz, renderiza la pila.

import { useEffect, useState } from 'react';
import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react';
import { cn } from '@/lib/utils';

type ToastVariant = 'info' | 'success' | 'error';

interface ToastItem {
  id: number;
  message: string;
  variant: ToastVariant;
}

const DURATION_MS = 5000;

let nextId = 1;
let items: ToastItem[] = [];
const listeners = new Set<(toasts: ToastItem[]) => void>();

function emit() {
  for (const listener of listeners) listener(items);
}

function dismiss(id: number) {
  items = items.filter((t) => t.id !== id);
  emit();
}

function push(message: string, variant: ToastVariant) {
  const id = nextId++;
  items = [...items, { id, message, variant }];
  emit();
  setTimeout(() => dismiss(id), DURATION_MS);
}

export const toast = {
  info: (message: string) => push(message, 'info'),
  success: (message: string) => push(message, 'success'),
  error: (message: string) => push(message, 'error'),
};

const ICONS: Record<ToastVariant, typeof Info> = {
  info: Info,
  success: CheckCircle2,
  error: AlertCircle,
};

const STYLES: Record<ToastVariant, string> = {
  info: 'border-border bg-card text-card-foreground',
  success: 'border-success/30 bg-success/10 text-success',
  error: 'border-destructive/30 bg-destructive/10 text-destructive',
};

export function Toaster() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  useEffect(() => {
    listeners.add(setToasts);
    return () => {
      listeners.delete(setToasts);
    };
  }, []);

  if (toasts.length === 0) return null;

  return (
    <div
      aria-live="polite"
      className="fixed right-4 bottom-4 z-100 flex w-80 flex-col gap-2"
    >
      {toasts.map((t) => {
        const Icon = ICONS[t.variant];
        return (
          <div
            key={t.id}
            role="status"
            className={cn(
              'flex items-start gap-2 rounded-lg border p-3 text-sm shadow-lg backdrop-blur-sm',
              STYLES[t.variant],
            )}
          >
            <Icon className="mt-0.5 size-4 shrink-0" />
            <p className="flex-1 break-words">{t.message}</p>
            <button
              type="button"
              onClick={() => dismiss(t.id)}
              aria-label="Cerrar notificación"
              className="shrink-0 opacity-60 transition-opacity hover:opacity-100"
            >
              <X className="size-4" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
