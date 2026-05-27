'use client';

import { useState } from 'react';
import { useUnreadCount, useNotifications, useMarkAsRead, useMarkAllAsRead } from '@/hooks/useNotifications';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Bell } from 'lucide-react';

export default function NotificationBell() {
  const [open, setOpen] = useState(false);
  const { data: unreadCount } = useUnreadCount();
  const { data: notifData } = useNotifications(1);
  const markAsRead = useMarkAsRead();
  const markAllAsRead = useMarkAllAsRead();

  const notifications = notifData?.data || [];

  function handleToggle() {
    setOpen(!open);
  }

  function handleMarkRead(id: number) {
    markAsRead.mutate(id);
  }

  function handleMarkAllRead() {
    markAllAsRead.mutate();
  }

  // Color del badge según tipo de notificación
  function getTypeBadge(type: string) {
    if (type.includes('BLOCKED') || type.includes('EXCEEDED') || type.includes('OVERDUE')) {
      return 'blocked' as const;
    }
    if (type.includes('WARNING') || type.includes('DUE') || type.includes('EXPIRING')) {
      return 'expiring' as const;
    }
    if (type.includes('MAINTENANCE')) {
      return 'maintenance' as const;
    }
    return 'info' as const;
  }

  return (
    <div className="relative">
      {/* Botón de campana */}
      <button
        onClick={handleToggle}
        className="relative flex size-9 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
        aria-label="Notificaciones"
      >
        <Bell className="size-4" />
        {unreadCount && unreadCount > 0 ? (
          <span className="absolute top-0.5 right-0.5 bg-destructive text-destructive-foreground text-[10px] font-semibold rounded-full h-4 min-w-4 px-1 flex items-center justify-center font-mono tabular-nums">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        ) : null}
      </button>

      {/* Panel desplegable */}
      {open && (
        <>
          {/* Overlay para cerrar al hacer click fuera */}
          <div
            className="fixed inset-0 z-40"
            onClick={() => setOpen(false)}
          />

          <div className="absolute right-0 top-11 z-50 w-96 rounded-md border border-border bg-popover shadow-lg max-h-[28rem] flex flex-col">
            {/* Header del panel */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-border">
              <h3 className="text-sm font-semibold">Notificaciones</h3>
              {unreadCount && unreadCount > 0 ? (
                <Button
                  variant="ghost"
                  size="xs"
                  onClick={handleMarkAllRead}
                >
                  Marcar todas leídas
                </Button>
              ) : null}
            </div>

            {/* Lista de notificaciones */}
            <div className="overflow-y-auto flex-1">
              {notifications.length > 0 ? (
                notifications.map((n) => (
                  <div
                    key={n.id}
                    className={
                      'px-4 py-3 border-b border-border last:border-0 hover:bg-muted/40 cursor-pointer transition-colors ' +
                      (!n.read ? 'bg-primary-subtle/50' : '')
                    }
                    onClick={() => {
                      if (!n.read) handleMarkRead(n.id);
                    }}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <Badge variant={getTypeBadge(n.type)} className="text-[10px] uppercase tracking-wider">
                            {n.type.replace(/_/g, ' ')}
                          </Badge>
                          {!n.read && (
                            <span className="size-1.5 rounded-full bg-primary shrink-0" />
                          )}
                        </div>
                        <p className="font-medium text-sm">{n.title}</p>
                        <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                          {n.message}
                        </p>
                      </div>
                      <span className="text-xs text-muted-foreground flex-shrink-0">
                        {new Date(n.createdAt).toLocaleDateString('es-MX', {
                          day: 'numeric',
                          month: 'short',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </span>
                    </div>
                  </div>
                ))
              ) : (
                <div className="p-6 text-center text-muted-foreground text-sm">
                  Sin notificaciones
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}