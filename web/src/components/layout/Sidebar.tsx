// Sidebar rediseñado v2 — filtrado por rol + dashboards específicos + Operadores oculto para no-admin

'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth, type UserRole } from '@/contexts/AuthContext';
import { type RefObject, useEffect, useRef, useState } from 'react';
import {
  LayoutDashboard,
  Truck,
  Users,
  Fuel,
  Wrench,
  FileBarChart,
  Settings,
  GaugeCircle,
  Wallet,
  ChevronLeft,
  ChevronRight,
  Building2,
  Landmark,
  ClipboardList,
  Search,
  X,
} from 'lucide-react';
import { cn } from '@/lib/utils';

type Role = UserRole;

interface MenuItem {
  label: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  roles: Role[];
}

interface MenuSection {
  label: string;
  items: MenuItem[];
}

// ADMIN ve todo. Cada supervisor ve solo lo suyo.
// Operadores es EXCLUSIVO de admin.
const menu: MenuSection[] = [
  {
    label: 'Panel',
    items: [
      {
        label: 'Dashboard global', href: '/dashboard/global',
        icon: LayoutDashboard, roles: ['ADMIN'],
      },
      {
        label: 'Dashboard vehículos', href: '/dashboard/vehiculos',
        icon: Truck, roles: ['ADMIN', 'SUPERVISOR_VEHICLES'],
      },
      {
        label: 'Dashboard gasolina', href: '/dashboard/gasolina',
        icon: Fuel, roles: ['ADMIN', 'SUPERVISOR_FUEL'],
      },
      {
        label: 'Dashboard mantenimiento', href: '/dashboard/mantenimiento',
        icon: Wrench, roles: ['ADMIN', 'SUPERVISOR_MAINTENANCE'],
      },
    ],
  },
  {
    label: 'Operación',
    items: [
      {
        label: 'Vehículos', href: '/vehicles',
        icon: Truck, roles: ['ADMIN', 'SUPERVISOR_VEHICLES'],
      },
      {
        label: 'Operadores', href: '/operators',
        icon: Users, roles: ['ADMIN'],   // ← EXCLUSIVO ADMIN
      },
      {
        label: 'Combustible', href: '/fuel',
        icon: Fuel, roles: ['ADMIN', 'SUPERVISOR_FUEL'],
      },
      {
        // Único punto de entrada al flujo de tickets — el contenido cambia según rol.
        label: 'Tickets de reparación', href: '/tickets',
        icon: ClipboardList, roles: ['ADMIN', 'SUPERVISOR_MAINTENANCE', 'EXECUTOR', 'WORKSHOP'],
      },
      {
        // Búsqueda/consulta de solicitudes por CIV, placa, serie o folio.
        label: 'Buscar solicitudes', href: '/tickets/buscar',
        icon: Search, roles: ['ADMIN', 'SUPERVISOR_MAINTENANCE'],
      },
    ],
  },
  {
    label: 'Finanzas',
    items: [
      {
        label: 'Presupuesto gasolina', href: '/budget/fuel',
        icon: Wallet, roles: ['ADMIN', 'SUPERVISOR_FUEL'],
      },
      {
        label: 'Presupuesto mantto.', href: '/budget/maintenance',
        icon: Wallet, roles: ['ADMIN', 'SUPERVISOR_MAINTENANCE'],
      },
    ],
  },
  {
    label: 'Catálogos',
    items: [
      {
        label: 'Gasolineras', href: '/stations',
        icon: Landmark, roles: ['ADMIN', 'SUPERVISOR_FUEL'],
      },
      {
        label: 'Talleres', href: '/workshops',
        icon: Building2, roles: ['ADMIN', 'SUPERVISOR_MAINTENANCE'],
      },
      {
        label: 'Tipos de vehículo', href: '/vehicle-types',
        icon: GaugeCircle, roles: ['ADMIN'],
      },
      {
        label: 'Sectores', href: '/sectors',
        icon: Building2, roles: ['ADMIN'],
      },
    ],
  },
  {
    label: 'Reportes',
    items: [
      {
        label: 'Reportes mensuales', href: '/reports',
        icon: FileBarChart, roles: ['ADMIN', 'SUPERVISOR_VEHICLES', 'SUPERVISOR_FUEL', 'SUPERVISOR_MAINTENANCE'],
      },
    ],
  },
  {
    label: 'Sistema',
    items: [
      {
        label: 'Configuración', href: '/settings',
        icon: Settings, roles: ['ADMIN'],
      },
    ],
  },
];

const STORAGE_KEY = 'flotillas-sidebar-collapsed';

const roleLabels: Record<Role, string> = {
  ADMIN: 'Administrador',
  SUPERVISOR_VEHICLES: 'Sup. Vehículos',
  SUPERVISOR_FUEL: 'Sup. Gasolina',
  SUPERVISOR_MAINTENANCE: 'Sup. Mantenimiento',
  EXECUTOR: 'Ejecutor',
  WORKSHOP: 'Taller',
  // El revisor QA no usa esta barra (vive aislado en /revision), pero el
  // Record<Role,...> debe ser exhaustivo para el typecheck.
  REVISOR_QA: 'Revisor QA',
};

interface SidebarProps {
  mobileOpen: boolean;
  onMobileClose: () => void;
  returnFocusRef: RefObject<HTMLButtonElement | null>;
}

export default function Sidebar({ mobileOpen, onMobileClose, returnFocusRef }: SidebarProps) {
  const pathname = usePathname();
  const { user } = useAuth();
  const [collapsed, setCollapsed] = useState(false);
  const drawerRef = useRef<HTMLElement>(null);
  const previousPathRef = useRef(pathname);

  useEffect(() => {
    // Hidratación desde localStorage: solo accesible en cliente, así que
    // SSR renderiza con default y el effect ajusta tras hidratar. Este
    // patrón es el caso típico que la regla set-state-in-effect ignora.
    const v = localStorage.getItem(STORAGE_KEY);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (v === '1') setCollapsed(true);
  }, []);

  useEffect(() => {
    if (previousPathRef.current !== pathname) {
      previousPathRef.current = pathname;
      if (mobileOpen) onMobileClose();
    }
  }, [mobileOpen, onMobileClose, pathname]);

  useEffect(() => {
    if (!mobileOpen) return;

    const drawer = drawerRef.current;
    const returnFocusElement = returnFocusRef.current;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const focusableSelector =
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
    const focusable = () => Array.from(drawer?.querySelectorAll<HTMLElement>(focusableSelector) ?? []);
    focusable()[0]?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault();
        onMobileClose();
        return;
      }
      if (event.key !== 'Tab') return;
      const elements = focusable();
      if (elements.length === 0) {
        event.preventDefault();
        return;
      }
      const first = elements[0];
      const last = elements[elements.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
      returnFocusElement?.focus();
    };
  }, [mobileOpen, onMobileClose, returnFocusRef]);

  function toggle() {
    const next = !collapsed;
    setCollapsed(next);
    localStorage.setItem(STORAGE_KEY, next ? '1' : '0');
  }

  const visibleSections = menu
    .map((s) => ({
      ...s,
      items: s.items.filter((i) => user && i.roles.includes(user.role as Role)),
    }))
    .filter((s) => s.items.length > 0);

  return (
    <>
      {mobileOpen && (
        <button
          type="button"
          tabIndex={-1}
          aria-label="Cerrar navegación"
          className="fixed inset-0 z-40 bg-black/60 md:hidden"
          onClick={onMobileClose}
        />
      )}
    <aside
      ref={drawerRef}
      id="primary-navigation"
      role={mobileOpen ? 'dialog' : undefined}
      aria-modal={mobileOpen ? true : undefined}
      aria-label="Navegación principal"
      className={cn(
        'invisible fixed inset-y-0 left-0 z-50 flex min-h-dvh w-[min(18rem,calc(100vw-3rem))] -translate-x-full flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground shadow-xl transition-transform duration-200',
        mobileOpen && 'visible translate-x-0',
        'md:visible md:sticky md:top-0 md:z-30 md:min-h-screen md:translate-x-0 md:shadow-none md:transition-[width]',
        collapsed ? 'md:w-14' : 'md:w-60',
      )}
    >
      <div className="flex min-h-14 items-center justify-between gap-2 border-b border-sidebar-border px-3 py-2 md:px-4 md:py-4">
        <div className="md:hidden">
          <Link href="/dashboard" onClick={onMobileClose} className="flex min-h-11 items-center gap-2 group">
            <div className="size-2 rounded-full bg-primary shadow-[0_0_0_3px_var(--primary-subtle)] shrink-0" />
            <div className="min-w-0">
              <div className="text-sm font-semibold tracking-tight truncate">Flotillas</div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Sala de control</div>
            </div>
          </Link>
        </div>
        {!collapsed && (
          <Link href="/dashboard" className="hidden items-center gap-2 min-w-0 group md:flex">
            <div className="size-2 rounded-full bg-primary shadow-[0_0_0_3px_var(--primary-subtle)] shrink-0" />
            <div className="min-w-0">
              <div className="text-sm font-semibold tracking-tight truncate">Flotillas</div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Sala de control</div>
            </div>
          </Link>
        )}
        {collapsed && (
          <div className="hidden size-2 rounded-full bg-primary shadow-[0_0_0_3px_var(--primary-subtle)] mx-auto md:block" />
        )}
        <button
          type="button"
          onClick={toggle}
          className="hidden size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-colors md:flex"
          aria-label={collapsed ? 'Expandir' : 'Colapsar'}
        >
          {collapsed ? <ChevronRight className="size-4" /> : <ChevronLeft className="size-4" />}
        </button>
        <button
          type="button"
          onClick={onMobileClose}
          className="flex size-11 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground md:hidden"
          aria-label="Cerrar navegación"
        >
          <X className="size-5" />
        </button>
      </div>

      <nav className="flex-1 overflow-y-auto py-3">
        {visibleSections.map((section) => (
          <div key={section.label} className="mb-4">
            <div className={cn(
              'px-4 mb-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground',
              collapsed && 'md:hidden',
            )}>
                {section.label}
            </div>
            <ul className="flex flex-col gap-0.5 px-2">
              {section.items.map((item) => {
                const isActive = pathname === item.href || pathname.startsWith(item.href + '/');
                const Icon = item.icon;
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      onClick={onMobileClose}
                      title={collapsed ? item.label : undefined}
                      aria-current={isActive ? 'page' : undefined}
                      className={cn(
                        'group relative flex min-h-11 items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors md:min-h-0 md:px-2.5 md:py-1.5',
                        'hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground',
                        isActive
                          ? 'bg-sidebar-accent/60 text-sidebar-accent-foreground font-medium before:absolute before:left-0 before:top-1 before:bottom-1 before:w-[2px] before:rounded-full before:bg-primary'
                          : 'text-muted-foreground',
                        collapsed && 'justify-center',
                      )}
                    >
                      <Icon className="size-4 shrink-0" />
                      <span className={cn('truncate', collapsed && 'md:hidden')}>{item.label}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      {user && (
        <div className={cn('border-t border-sidebar-border p-3', collapsed && 'md:hidden')}>
          <div className="flex items-center gap-2.5">
            <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary-subtle text-primary text-xs font-semibold uppercase">
              {user.fullName.slice(0, 2)}
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium truncate">{user.fullName}</div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground truncate">
                {roleLabels[user.role as Role]}
              </div>
            </div>
          </div>
        </div>
      )}
      {user && collapsed && (
        <div className="hidden border-t border-sidebar-border p-2 justify-center md:flex">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary-subtle text-primary text-xs font-semibold uppercase">
            {user.fullName.slice(0, 2)}
          </div>
        </div>
      )}
    </aside>
    </>
  );
}
