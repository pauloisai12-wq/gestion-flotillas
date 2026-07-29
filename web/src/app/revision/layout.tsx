// Layout aislado del portal de revisión (rol REVISOR_QA). Chrome mínimo: una
// barra superior con cierre de sesión y el contenido. SIN Sidebar/Header/Footer
// del panel general — el revisor no debe ver nada del resto del sistema.

'use client';

import { useAuth } from '@/contexts/AuthContext';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { getHomePath } from '@/lib/access';
import { Button } from '@/components/ui/button';

// Secciones del portal. Son dos capturas distintas de la misma app de campo
// (evidencia con foto y registro de personas sin foto), así que se navegan como
// pestañas y no como filtros de una sola tabla.
const NAV_ITEMS: { href: string; label: string }[] = [
  { href: '/revision/evidencias', label: 'Evidencias de campo' },
  { href: '/revision/personas', label: 'Registro de personas' },
];

export default function RevisionLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user, loading, logout } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  // El login del portal vive bajo este layout: en esa ruta no aplicamos guard,
  // de lo contrario un revisor sin sesión nunca podría llegar al formulario.
  const isLoginRoute = pathname === '/revision/login' || pathname.startsWith('/revision/login/');

  useEffect(() => {
    if (loading) return;
    if (isLoginRoute) return;
    if (!user) {
      router.replace('/revision/login');
      return;
    }
    if (user.role !== 'REVISOR_QA') {
      router.replace(getHomePath(user.role));
    }
  }, [user, loading, router, isLoginRoute]);

  // El login se renderiza sin guard (su propia pantalla maneja el formulario).
  if (isLoginRoute) {
    return <>{children}</>;
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3">
          <div className="size-2.5 rounded-full bg-primary animate-pulse shadow-[0_0_0_4px_var(--primary-subtle)]" />
          <p className="text-sm text-muted-foreground">Cargando…</p>
        </div>
      </div>
    );
  }

  // Sin sesión o rol incorrecto: no renderizamos contenido mientras redirige.
  if (!user || user.role !== 'REVISOR_QA') {
    return null;
  }

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <header className="border-b border-border">
        <div className="mx-auto w-full max-w-[1600px] px-4 xl:px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="size-2.5 rounded-full bg-primary shadow-[0_0_0_4px_var(--primary-subtle)]" />
            <span className="text-sm font-semibold tracking-tight text-foreground">Revisión de evidencias</span>
          </div>
          <Button variant="outline" size="sm" onClick={() => logout('/revision/login')}>
            Cerrar sesión
          </Button>
        </div>
      </header>
      <nav aria-label="Secciones de revisión" className="border-b border-border">
        <div className="mx-auto w-full max-w-[1600px] px-4 xl:px-6 flex items-center gap-1">
          {NAV_ITEMS.map((item) => {
            // Coincidencia por prefijo para que una futura subruta (un detalle,
            // por ejemplo) siga marcando activa su sección.
            const activo = pathname === item.href || pathname.startsWith(item.href + '/');
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={activo ? 'page' : undefined}
                className={`-mb-px border-b-2 px-3 py-2.5 text-sm transition-colors ${
                  activo
                    ? 'border-primary font-medium text-foreground'
                    : 'border-transparent text-muted-foreground hover:text-foreground'
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </div>
      </nav>
      <main className="flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[1600px] px-4 xl:px-6 py-6">
          {children}
        </div>
      </main>
    </div>
  );
}
