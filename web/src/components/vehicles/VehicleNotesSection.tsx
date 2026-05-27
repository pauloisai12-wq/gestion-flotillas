// Bitácora de notas de un vehículo — append-log editable

'use client';

import { useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import {
  useVehicleNotes, useCreateVehicleNote, useUpdateVehicleNote, useDeleteVehicleNote,
  type VehicleNote,
} from '@/hooks/useVehicleNotes';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Pencil, Trash2, Check, X, MessageSquare, User as UserIcon, Clock } from 'lucide-react';

export function VehicleNotesSection({ vehicleId }: { vehicleId: number }) {
  const { user } = useAuth();
  const { data: notes, isLoading } = useVehicleNotes(vehicleId);
  const createNote = useCreateVehicleNote(vehicleId);
  const updateNote = useUpdateVehicleNote(vehicleId);
  const deleteNote = useDeleteVehicleNote(vehicleId);

  const [draft, setDraft] = useState('');
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editContent, setEditContent] = useState('');

  async function handleCreate() {
    if (!draft.trim()) return;
    try {
      await createNote.mutateAsync(draft.trim());
      setDraft('');
    } catch (e) {
      alert('Error: ' + (e as Error).message);
    }
  }

  function startEdit(note: VehicleNote) {
    setEditingId(note.id);
    setEditContent(note.content);
  }

  async function saveEdit() {
    if (!editingId || !editContent.trim()) return;
    try {
      await updateNote.mutateAsync({ noteId: editingId, content: editContent.trim() });
      setEditingId(null);
      setEditContent('');
    } catch (e) {
      alert('Error: ' + (e as Error).message);
    }
  }

  async function handleDelete(noteId: number) {
    if (!confirm('¿Eliminar esta nota de la bitácora?')) return;
    try {
      await deleteNote.mutateAsync(noteId);
    } catch (e) {
      alert('Error: ' + (e as Error).message);
    }
  }

  function canEdit(note: VehicleNote): boolean {
    if (!user) return false;
    return note.createdBy === user.id || user.role === 'ADMIN';
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <MessageSquare className="size-4 text-muted-foreground" />
          <CardTitle>Bitácora de notas</CardTitle>
          {notes && notes.length > 0 && (
            <span className="text-xs text-muted-foreground">· {notes.length}</span>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {/* Form para nueva nota */}
        <div className="flex flex-col gap-2 mb-5 pb-5 border-b border-border/50">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Agregar observación a la bitácora (quedará registrado tu usuario y la hora)…"
            className="min-h-20 rounded-md border border-input bg-transparent px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40 resize-none"
            maxLength={2000}
          />
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-muted-foreground">
              {draft.length}/2000 caracteres
            </span>
            <Button
              size="sm"
              onClick={handleCreate}
              disabled={!draft.trim() || createNote.isPending}
            >
              {createNote.isPending ? 'Guardando…' : 'Agregar nota'}
            </Button>
          </div>
        </div>

        {/* Lista de notas */}
        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-20 bg-muted rounded animate-pulse" />
            ))}
          </div>
        ) : !notes || notes.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <MessageSquare className="size-6 mx-auto mb-2 opacity-40" />
            <p className="text-sm">Sin notas en la bitácora</p>
            <p className="text-xs mt-0.5">Cuando agregues observaciones aparecerán aquí.</p>
          </div>
        ) : (
          <ol className="flex flex-col gap-3">
            {notes.map((note) => (
              <li
                key={note.id}
                className="rounded-md border border-border/60 bg-card p-3.5 transition-colors"
              >
                {editingId === note.id ? (
                  <div className="flex flex-col gap-2">
                    <textarea
                      value={editContent}
                      onChange={(e) => setEditContent(e.target.value)}
                      className="min-h-20 rounded-md border border-input bg-transparent px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40 resize-none"
                      maxLength={2000}
                      autoFocus
                    />
                    <div className="flex items-center gap-2 justify-end">
                      <Button size="xs" variant="ghost" onClick={() => setEditingId(null)}>
                        <X className="size-3" /> Cancelar
                      </Button>
                      <Button size="xs" onClick={saveEdit} disabled={!editContent.trim()}>
                        <Check className="size-3" /> Guardar
                      </Button>
                    </div>
                  </div>
                ) : (
                  <>
                    <p className="text-sm text-foreground whitespace-pre-wrap">{note.content}</p>
                    <div className="flex items-center justify-between gap-3 mt-2.5 pt-2.5 border-t border-border/40">
                      <div className="flex items-center gap-3 text-xs text-muted-foreground min-w-0">
                        <span className="flex items-center gap-1">
                          <UserIcon className="size-3" />
                          {note.author.fullName}
                        </span>
                        <span className="flex items-center gap-1">
                          <Clock className="size-3" />
                          {new Date(note.createdAt).toLocaleString('es-MX', { dateStyle: 'short', timeStyle: 'short' })}
                        </span>
                        {note.updatedAt !== note.createdAt && note.editor && (
                          <span className="text-[10px] italic">
                            · editada por {note.editor.fullName}
                          </span>
                        )}
                      </div>
                      {canEdit(note) && (
                        <div className="flex items-center gap-1 shrink-0">
                          <Button size="icon-xs" variant="ghost" onClick={() => startEdit(note)}>
                            <Pencil className="size-3" />
                          </Button>
                          <Button
                            size="icon-xs" variant="ghost"
                            onClick={() => handleDelete(note.id)}
                            className="hover:text-destructive"
                          >
                            <Trash2 className="size-3" />
                          </Button>
                        </div>
                      )}
                    </div>
                  </>
                )}
              </li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}
