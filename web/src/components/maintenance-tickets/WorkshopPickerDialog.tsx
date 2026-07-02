// Diálogo para que el admin seleccione de 1 a 3 talleres.
// El backend valida que sean 1-3 únicos y activos; aquí ayudamos visualmente.

'use client';

import { useState, useMemo, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Check, Search, AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useWorkshops } from '@/hooks/useWorkshops';
import { useAssignWorkshops, useReassignWorkshops } from '@/hooks/useMaintenanceTickets';

interface Props {
  ticketId: number;
  children: React.ReactNode; // trigger
  onSuccess?: () => void;
  /** 'assign' = asignación inicial (PENDING); 'reassign' = cambiar talleres (AWAITING_QUOTES). */
  mode?: 'assign' | 'reassign';
  /** Talleres ya asignados a preseleccionar (modo reassign). */
  initialSelected?: number[];
}

const MIN = 1;
const MAX = 3;

export function WorkshopPickerDialog({
  ticketId,
  children,
  onSuccess,
  mode = 'assign',
  initialSelected,
}: Props) {
  const isReassign = mode === 'reassign';
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Set<number>>(new Set(initialSelected ?? []));
  const { data: workshops, isLoading } = useWorkshops();
  const assign = useAssignWorkshops();
  const reassign = useReassignWorkshops();
  const mutation = isReassign ? reassign : assign;

  // Al abrir, sembrar la selección con los talleres actuales (reassign) o vaciar (assign).
  useEffect(() => {
    if (open) {
      setSelected(new Set(initialSelected ?? []));
      setSearch('');
    }
    // initialSelected es un array nuevo en cada render; lo serializamos para comparar por valor.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, (initialSelected ?? []).join(',')]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = (workshops ?? []).filter((w) => w.isActive);
    if (!q) return list;
    return list.filter(
      (w) =>
        w.legalName.toLowerCase().includes(q) ||
        w.tradeName?.toLowerCase().includes(q) ||
        w.rfc.toLowerCase().includes(q),
    );
  }, [workshops, search]);

  function toggle(id: number) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else if (next.size < MAX) next.add(id);
    setSelected(next);
  }

  async function submit() {
    if (selected.size < MIN || selected.size > MAX) return;
    try {
      await mutation.mutateAsync({ ticketId, workshopIds: Array.from(selected) });
      setOpen(false);
      setSelected(new Set());
      setSearch('');
      onSuccess?.();
    } catch {
      /* el toast lo maneja el caller via mutation state */
    }
  }

  const error = mutation.error as { response?: { data?: { error?: string } } } | null;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{isReassign ? 'Cambiar talleres asignados' : 'Asignar talleres para cotizar'}</DialogTitle>
          <DialogDescription>
            Selecciona entre <strong>{MIN}</strong> y <strong>{MAX}</strong> talleres.{' '}
            {isReassign ? (
              <>
                Los talleres nuevos recibirán una invitación; los que quites dejarán de participar
                (si ya habían enviado su cotización, se perderá).
              </>
            ) : (
              <>Recibirán una notificación para subir su cotización.</>
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input
            placeholder="Buscar por nombre o RFC…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8"
          />
        </div>

        <div className="max-h-[40vh] overflow-y-auto -mx-1 px-1">
          {isLoading ? (
            <p className="text-sm text-muted-foreground p-4 text-center">Cargando…</p>
          ) : filtered.length === 0 ? (
            <p className="text-sm text-muted-foreground p-4 text-center">Sin coincidencias.</p>
          ) : (
            <ul className="space-y-1">
              {filtered.map((w) => {
                const isSel = selected.has(w.id);
                const disabled = !isSel && selected.size >= MAX;
                return (
                  <li key={w.id}>
                    <button
                      type="button"
                      onClick={() => toggle(w.id)}
                      disabled={disabled}
                      className={cn(
                        'w-full flex items-center gap-3 text-left p-2.5 rounded-md border transition-colors',
                        isSel
                          ? 'border-primary bg-primary-subtle/40'
                          : disabled
                            ? 'border-border opacity-40 cursor-not-allowed'
                            : 'border-border hover:border-primary/60',
                      )}
                    >
                      <div
                        className={cn(
                          'size-5 rounded border-2 flex items-center justify-center shrink-0',
                          isSel ? 'border-primary bg-primary' : 'border-border',
                        )}
                      >
                        {isSel && <Check className="size-3 text-primary-foreground" />}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium truncate">{w.legalName}</div>
                        <div className="text-xs text-muted-foreground">
                          {w.rfc} · {w.phone}
                        </div>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {error?.response?.data?.error && (
          <div className="text-xs text-rose-600 dark:text-rose-400 flex items-center gap-1.5">
            <AlertCircle className="size-3.5" />
            {error.response.data.error}
          </div>
        )}

        <DialogFooter className="sm:justify-between items-center">
          <span className="text-xs text-muted-foreground">
            Seleccionados: <span className="font-semibold text-foreground">{selected.size}</span> / {MAX}
          </span>
          <Button
            onClick={submit}
            disabled={selected.size < MIN || selected.size > MAX || mutation.isPending}
          >
            {mutation.isPending
              ? isReassign
                ? 'Guardando…'
                : 'Asignando…'
              : isReassign
                ? 'Guardar cambios'
                : 'Asignar y notificar'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
