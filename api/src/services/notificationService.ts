// api/src/services/notificationService.ts
// Servicio central de notificaciones internas.

import prisma from '../lib/prisma';
import { NotificationType, UserRole } from '@prisma/client';

export { NotificationType };

/**
 * Crear una notificación para un usuario específico.
 */
export async function createNotification(params: {
  userId: number;
  type: NotificationType;
  title: string;
  message: string;
  entityRef?: string;
}) {
  return prisma.notification.create({
    data: {
      userId: params.userId,
      type: params.type,
      title: params.title,
      message: params.message,
      entityRef: params.entityRef || null,
      read: false,
    },
  });
}

/**
 * Crear notificación para TODOS los usuarios con un rol específico.
 */
export async function notifyByRole(params: {
  role: 'ADMIN' | 'SUPERVISOR_VEHICLES' | 'SUPERVISOR_FUEL' | 'SUPERVISOR_MAINTENANCE';
  type: NotificationType;
  title: string;
  message: string;
  entityRef?: string;
}) {
  const users = await prisma.user.findMany({
    where: { role: params.role, isActive: true },
    select: { id: true },
  });

  const notifications = users.map((u) => ({
    userId: u.id,
    type: params.type,
    title: params.title,
    message: params.message,
    entityRef: params.entityRef || null,
    read: false,
  }));

  if (notifications.length > 0) {
    await prisma.notification.createMany({ data: notifications });
  }

  return notifications.length;
}

/**
 * Notifica a TODOS los usuarios de uno o varios roles sobre VARIOS items en
 * lote: resuelve los destinatarios UNA sola vez (evita el N+1 de llamar
 * notifyByRole por item/rol) y hace UN solo createMany. Si se pasa
 * dedupeWithinHours, NO recrea notificaciones (mismo userId+type+entityRef) ya
 * emitidas en esa ventana — evita inundar al usuario en jobs diarios.
 */
export async function notifyManyByRole(params: {
  roles: UserRole[];
  type: NotificationType;
  items: { title: string; message: string; entityRef?: string }[];
  dedupeWithinHours?: number;
}): Promise<number> {
  if (params.items.length === 0) return 0;

  const users = await prisma.user.findMany({
    where: { role: { in: params.roles }, isActive: true },
    select: { id: true },
  });
  if (users.length === 0) return 0;
  const userIds = users.map((u) => u.id);

  let candidates = userIds.flatMap((userId) =>
    params.items.map((it) => ({
      userId,
      type: params.type,
      title: it.title,
      message: it.message,
      entityRef: it.entityRef ?? null,
      read: false,
    })),
  );

  if (params.dedupeWithinHours && params.dedupeWithinHours > 0) {
    const since = new Date(Date.now() - params.dedupeWithinHours * 3_600_000);
    const refs = [...new Set(candidates.map((c) => c.entityRef).filter((r): r is string => r != null))];
    if (refs.length > 0) {
      const existing = await prisma.notification.findMany({
        where: { type: params.type, userId: { in: userIds }, entityRef: { in: refs }, createdAt: { gte: since } },
        select: { userId: true, entityRef: true },
      });
      const seen = new Set(existing.map((e) => `${e.userId}::${e.entityRef}`));
      candidates = candidates.filter((c) => !seen.has(`${c.userId}::${c.entityRef}`));
    }
  }

  if (candidates.length > 0) {
    await prisma.notification.createMany({ data: candidates });
  }
  return candidates.length;
}

/**
 * Obtener notificaciones de un usuario (paginadas).
 */
export async function getByUser(userId: number, page: number = 1, limit: number = 20) {
  const skip = (page - 1) * limit;

  const [notifications, total, unreadCount] = await Promise.all([
    prisma.notification.findMany({
      where: { userId },
      skip,
      take: limit,
      orderBy: { createdAt: 'desc' },
    }),
    prisma.notification.count({ where: { userId } }),
    prisma.notification.count({ where: { userId, read: false } }),
  ]);

  return {
    data: notifications,
    unreadCount,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  };
}

/**
 * Contar notificaciones no leídas de un usuario.
 */
export async function getUnreadCount(userId: number) {
  return prisma.notification.count({
    where: { userId, read: false },
  });
}

/**
 * Marcar una notificación como leída.
 */
export async function markAsRead(id: number, userId: number) {
  return prisma.notification.updateMany({
    where: { id, userId },
    data: { read: true },
  });
}

/**
 * Marcar TODAS las notificaciones de un usuario como leídas.
 */
export async function markAllAsRead(userId: number) {
  return prisma.notification.updateMany({
    where: { userId, read: false },
    data: { read: true },
  });
}