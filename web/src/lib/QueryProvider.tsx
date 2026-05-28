// Archivo: /flotillas/web/src/lib/QueryProvider.tsx
// REEMPLAZA: Archivo nuevo

'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, ReactNode } from 'react';

export function QueryProvider({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // 30s funciona bien como default para la mayoría de listados.
            // Hooks de catálogos estáticos (vehicleTypes, stations, etc.) pueden
            // sobreescribir con staleTime más largo en su propio useQuery.
            staleTime: 30 * 1000,
            // gcTime explícito: descarta queries no usadas tras 5 min (default
            // de TanStack es 5 min también, lo dejamos visible para tunear).
            gcTime: 5 * 60 * 1000,
            // Refetch al recuperar foco genera muchos requests al cambiar de pestaña
            // y rara vez aporta UX: los hooks de dashboard ya tienen refetchInterval.
            refetchOnWindowFocus: false,
            retry: 1,
          },
        },
      })
  );

  return (
    <QueryClientProvider client={queryClient}>
      {children}
    </QueryClientProvider>
  );
}