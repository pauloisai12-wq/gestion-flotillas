// web/src/hooks/useNotifications.ts
// Hooks para el sistema de notificaciones internas.

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';

export interface Notification {
  id: number;
  userId: number;
  type: string;
  title: string;
  message: string;
  read: boolean;
  entityRef: string | null;
  createdAt: string;
}

// Obtener conteo de no leídas (para el badge) — polling cada 30 segundos
export function useUnreadCount() {
  return useQuery({
    queryKey: ['notifications', 'count'],
    queryFn: async () => {
      const res = await api.get('/notifications/count');
      return res.data.data.unreadCount as number;
    },
    refetchInterval: 30000, // 30 segundos
  });
}

// Obtener lista de notificaciones
export function useNotifications(page: number = 1) {
  return useQuery({
    queryKey: ['notifications', page],
    queryFn: async () => {
      const res = await api.get('/notifications?page=' + page + '&limit=20');
      return res.data as {
        data: Notification[];
        unreadCount: number;
        pagination: { page: number; limit: number; total: number; totalPages: number };
      };
    },
  });
}

// Marcar una como leída
export function useMarkAsRead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => {
      await api.put('/notifications/' + id + '/read');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
    },
  });
}

// Marcar todas como leídas
export function useMarkAllAsRead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      await api.put('/notifications/read-all');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
    },
  });
}