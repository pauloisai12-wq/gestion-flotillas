// Layout del área autenticada — usa tokens del design system.

'use client';

import { useAuth } from '@/contexts/AuthContext';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect } from 'react';
import Sidebar from '@/components/layout/Sidebar';
import Header from '@/components/layout/Header';
import Footer from '@/components/layout/Footer';
import { getHomePath, isPathAllowed } from '@/lib/access';

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user, loading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (loading) return;
    if (!user) {
      router.push('/login');
      return;
    }
    // Ejecutor y Taller no pueden entrar al panel general: si llegan a una
    // ruta vedada (por URL directa o link viejo), los mandamos a su zona.
    if (!isPathAllowed(user.role, pathname)) {
      router.replace(getHomePath(user.role));
    }
  }, [user, loading, router, pathname]);

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

  if (!user) {
    return null;
  }

  // Rol restringido en ruta vedada: no renderizamos el contenido mientras redirige.
  if (!isPathAllowed(user.role, pathname)) {
    return null;
  }

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <Header />
        <main className="flex-1 overflow-y-auto flex flex-col">
          <div className="mx-auto w-full max-w-[1600px] px-4 xl:px-6 py-6 flex-1">
            {children}
          </div>
          <Footer />
        </main>
      </div>
    </div>
  );
}
