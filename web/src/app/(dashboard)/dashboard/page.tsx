'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { getHomePath } from '@/lib/access';
import { Loader2 } from 'lucide-react';

/**
 * /dashboard — entrypoint que redirige a la zona de inicio según rol.
 * ADMIN → /dashboard/global · SUP_VEH → /dashboard/vehiculos
 * SUP_FUEL → /dashboard/gasolina · SUP_MAINT → /dashboard/mantenimiento
 * EXECUTOR / WORKSHOP → /tickets (no tienen panel general)
 */
export default function DashboardRedirect() {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (loading || !user) return;
    router.replace(getHomePath(user.role));
  }, [user, loading, router]);

  return (
    <div className="min-h-[50vh] flex items-center justify-center">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        Redirigiendo…
      </div>
    </div>
  );
}
