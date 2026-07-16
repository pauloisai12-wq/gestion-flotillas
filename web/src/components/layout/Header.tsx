// Header rediseñado per PDF §9.2 — breadcrumbs, campana, toggle tema, avatar.

'use client';

import { useAuth } from '@/contexts/AuthContext';
import { LogOut, Menu, Moon, Sun, Monitor } from 'lucide-react';
import { type RefObject, useEffect, useRef, useState } from 'react';
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
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, []);

  const Icon = resolvedTheme === 'dark' ? Moon : Sun;

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex size-11 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground transition-colors lg:size-9"
        aria-label="Cambiar tema"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <Icon className="size-4" />
      </button>
      {open && (
        <div role="menu" aria-label="Seleccionar tema" className="absolute right-0 mt-2 w-40 rounded-md border border-border bg-popover shadow-md z-50 py-1 text-sm">
          {([
            { k: 'light', label: 'Claro', Ic: Sun },
            { k: 'dark', label: 'Oscuro', Ic: Moon },
            { k: 'system', label: 'Sistema', Ic: Monitor },
          ] as const).map(({ k, label, Ic }) => (
            <button
              type="button"
              role="menuitemradio"
              aria-checked={theme === k}
              key={k}
              onClick={() => {
                setTheme(k);
                setOpen(false);
              }}
              className={cn(
                'flex min-h-11 w-full items-center gap-2 px-3 py-2 text-left hover:bg-muted',
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

interface HeaderProps {
  navigationOpen: boolean;
  onOpenNavigation: () => void;
  navigationTriggerRef: RefObject<HTMLButtonElement | null>;
}

export default function Header({ navigationOpen, onOpenNavigation, navigationTriggerRef }: HeaderProps) {
  const { user, logout } = useAuth();
  const [showDropdown, setShowDropdown] = useState(false);
  const dropRef = useRef<HTMLDivElement>(null);
  const crumbs = useBreadcrumbs();

  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (dropRef.current && !dropRef.current.contains(e.target as Node)) setShowDropdown(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setShowDropdown(false);
    }
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, []);

  return (
    <header className="sticky top-0 z-40 flex h-14 items-center justify-between gap-2 border-b border-border bg-background/95 px-2 backdrop-blur sm:px-4 lg:px-5">
      <div className="flex min-w-0 items-center gap-1">
        <button
          ref={navigationTriggerRef}
          type="button"
          onClick={onOpenNavigation}
          className="flex size-11 shrink-0 items-center justify-center rounded-md text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:hidden"
          aria-label="Abrir navegación"
          aria-controls="primary-navigation"
          aria-expanded={navigationOpen}
        >
          <Menu className="size-5" />
        </button>
      <nav aria-label="Migas de pan" className="hidden min-w-0 items-center gap-1.5 overflow-hidden text-sm text-muted-foreground sm:flex">
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
      </div>

      <div className="flex shrink-0 items-center gap-0.5 sm:gap-1 lg:gap-2">
        <StatusStrip />
        <span className="hidden lg:block w-px h-5 bg-border" />
        <NotificationBell />
        <ThemeToggle />
        <div ref={dropRef} className="relative ml-1">
          <button
            type="button"
            onClick={() => setShowDropdown((v) => !v)}
            className="flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-md px-1 hover:bg-muted transition-colors lg:min-h-9 lg:px-2"
            aria-label={`Menú de usuario${user?.fullName ? `: ${user.fullName}` : ''}`}
            aria-haspopup="menu"
            aria-expanded={showDropdown}
          >
            <div className="flex size-7 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs font-semibold uppercase">
              {user?.fullName?.slice(0, 2) || 'U'}
            </div>
            <span className="hidden sm:inline text-sm max-w-[160px] truncate">{user?.fullName}</span>
          </button>

          {showDropdown && (
            <div role="menu" aria-label="Menú de usuario" className="absolute right-0 mt-2 w-56 rounded-md border border-border bg-popover shadow-md z-50 overflow-hidden">
              <div className="px-4 py-3 border-b border-border">
                <p className="text-sm font-medium truncate">{user?.fullName}</p>
                <p className="text-xs text-muted-foreground truncate">{user?.email}</p>
                <p className="text-[10px] uppercase tracking-wider text-primary mt-0.5">{user?.role}</p>
              </div>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setShowDropdown(false);
                  logout();
                }}
                className="flex min-h-11 w-full items-center gap-2 px-4 py-2 text-sm text-destructive hover:bg-destructive/10"
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
