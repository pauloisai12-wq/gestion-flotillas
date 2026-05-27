// Header rediseñado per PDF §9.2 — breadcrumbs, campana, toggle tema, avatar.

'use client';

import { useAuth } from '@/contexts/AuthContext';
import { LogOut, Moon, Sun, Monitor } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
import NotificationBell from '@/components/layout/NotificationBell';
import StatusStrip from '@/components/layout/StatusStrip';
import { useTheme } from '@/components/theme-provider';
import { cn } from '@/lib/utils';

const routeLabels: Record<string, string> = {
  dashboard: 'Dashboard',
  vehicles: 'Vehículos',
  operators: 'Operadores',
  fuel: 'Combustible',
  budget: 'Presupuesto',
  maintenance: 'Mantenimiento',
  reports: 'Reportes',
  'vehicle-types': 'Tipos de vehículo',
  stations: 'Gasolineras',
  settings: 'Configuración',
};

function useBreadcrumbs() {
  const pathname = usePathname();
  if (!pathname) return [];
  const segments = pathname.split('/').filter(Boolean);
  return segments.map((seg, i) => {
    const href = '/' + segments.slice(0, i + 1).join('/');
    const label = routeLabels[seg] ?? decodeURIComponent(seg);
    return { label, href };
  });
}

function ThemeToggle() {
  const { theme, resolvedTheme, setTheme } = useTheme();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);

  const Icon = resolvedTheme === 'dark' ? Moon : Sun;

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex size-9 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
        aria-label="Tema"
      >
        <Icon className="size-4" />
      </button>
      {open && (
        <div className="absolute right-0 mt-2 w-40 rounded-md border border-border bg-popover shadow-md z-50 py-1 text-sm">
          {([
            { k: 'light', label: 'Claro', Ic: Sun },
            { k: 'dark', label: 'Oscuro', Ic: Moon },
            { k: 'system', label: 'Sistema', Ic: Monitor },
          ] as const).map(({ k, label, Ic }) => (
            <button
              key={k}
              onClick={() => {
                setTheme(k);
                setOpen(false);
              }}
              className={cn(
                'flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-muted',
                theme === k && 'text-primary font-medium',
              )}
            >
              <Ic className="size-4" />
              {label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function Header() {
  const { user, logout } = useAuth();
  const [showDropdown, setShowDropdown] = useState(false);
  const dropRef = useRef<HTMLDivElement>(null);
  const crumbs = useBreadcrumbs();

  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (dropRef.current && !dropRef.current.contains(e.target as Node)) setShowDropdown(false);
    }
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);

  return (
    <header className="sticky top-0 z-40 flex h-14 items-center justify-between gap-4 border-b border-border bg-background/95 backdrop-blur px-5">
      <nav className="flex items-center gap-1.5 text-sm text-muted-foreground min-w-0 overflow-hidden">
        <Link href="/dashboard" className="hover:text-foreground transition-colors">
          Inicio
        </Link>
        {crumbs.map((c, i) => (
          <span key={c.href} className="flex items-center gap-1.5 min-w-0">
            <span className="text-border">/</span>
            {i === crumbs.length - 1 ? (
              <span className="text-foreground font-medium truncate">{c.label}</span>
            ) : (
              <Link href={c.href} className="hover:text-foreground transition-colors truncate">
                {c.label}
              </Link>
            )}
          </span>
        ))}
      </nav>

      <div className="flex items-center gap-2">
        <StatusStrip />
        <span className="hidden lg:block w-px h-5 bg-border" />
        <NotificationBell />
        <ThemeToggle />
        <div ref={dropRef} className="relative ml-1">
          <button
            onClick={() => setShowDropdown((v) => !v)}
            className="flex items-center gap-2 rounded-md pl-1 pr-2 py-1 hover:bg-muted transition-colors"
          >
            <div className="flex size-7 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs font-semibold uppercase">
              {user?.fullName?.slice(0, 2) || 'U'}
            </div>
            <span className="hidden sm:inline text-sm max-w-[160px] truncate">{user?.fullName}</span>
          </button>

          {showDropdown && (
            <div className="absolute right-0 mt-2 w-56 rounded-md border border-border bg-popover shadow-md z-50 overflow-hidden">
              <div className="px-4 py-3 border-b border-border">
                <p className="text-sm font-medium truncate">{user?.fullName}</p>
                <p className="text-xs text-muted-foreground truncate">{user?.email}</p>
                <p className="text-[10px] uppercase tracking-wider text-primary mt-0.5">{user?.role}</p>
              </div>
              <button
                onClick={() => {
                  setShowDropdown(false);
                  logout();
                }}
                className="flex w-full items-center gap-2 px-4 py-2 text-sm text-destructive hover:bg-destructive/10"
              >
                <LogOut className="size-4" />
                Cerrar sesión
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
