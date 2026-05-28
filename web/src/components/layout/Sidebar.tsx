// Sidebar rediseñado v2 — filtrado por rol + dashboards específicos + Operadores oculto para no-admin

'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth, type UserRole } from '@/contexts/AuthContext';
import { useEffect, useState } from 'react';
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
        label: 'Mantenimiento', href: '/maintenance',
        icon: Wrench, roles: ['ADMIN', 'SUPERVISOR_MAINTENANCE'],
      },
      {
        // Único punto de entrada al flujo de tickets — el contenido cambia según rol.
        label: 'Tickets de reparación', href: '/tickets',
        icon: ClipboardList, roles: ['ADMIN', 'SUPERVISOR_MAINTENANCE', 'EXECUTOR', 'WORKSHOP'],
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
};

export default function Sidebar() {
  const pathname = usePathname();
  const { user } = useAuth();
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    // Hidratación desde localStorage: solo accesible en cliente, así que
    // SSR renderiza con default y el effect ajusta tras hidratar. Este
    // patrón es el caso típico que la regla set-state-in-effect ignora.
    const v = localStorage.getItem(STORAGE_KEY);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (v === '1') setCollapsed(true);
  }, []);

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
    <aside
      className={cn(
        'flex min-h-screen flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground transition-[width] duration-200',
        collapsed ? 'w-14' : 'w-60',
      )}
    >
      <div className="flex items-center justify-between gap-2 px-4 py-4 border-b border-sidebar-border">
        {!collapsed && (
          <Link href="/dashboard" className="flex items-center gap-2 min-w-0 group">
            <div className="size-2 rounded-full bg-primary shadow-[0_0_0_3px_var(--primary-subtle)] shrink-0" />
            <div className="min-w-0">
              <div className="text-sm font-semibold tracking-tight truncate">Flotillas</div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Sala de control</div>
            </div>
          </Link>
        )}
        {collapsed && (
          <div className="size-2 rounded-full bg-primary shadow-[0_0_0_3px_var(--primary-subtle)] mx-auto" />
        )}
        <button
          onClick={toggle}
          className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-colors"
          aria-label={collapsed ? 'Expandir' : 'Colapsar'}
        >
          {collapsed ? <ChevronRight className="size-4" /> : <ChevronLeft className="size-4" />}
        </button>
      </div>

      <nav className="flex-1 overflow-y-auto py-3">
        {visibleSections.map((section) => (
          <div key={section.label} className="mb-4">
            {!collapsed && (
              <div className="px-4 mb-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                {section.label}
              </div>
            )}
            <ul className="flex flex-col gap-0.5 px-2">
              {section.items.map((item) => {
                const isActive = pathname === item.href || pathname.startsWith(item.href + '/');
                const Icon = item.icon;
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      title={collapsed ? item.label : undefined}
                      className={cn(
                        'group relative flex items-center gap-3 rounded-md px-2.5 py-1.5 text-sm transition-colors',
                        'hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground',
                        isActive
                          ? 'bg-sidebar-accent/60 text-sidebar-accent-foreground font-medium before:absolute before:left-0 before:top-1 before:bottom-1 before:w-[2px] before:rounded-full before:bg-primary'
                          : 'text-muted-foreground',
                        collapsed && 'justify-center',
                      )}
                    >
                      <Icon className="size-4 shrink-0" />
                      {!collapsed && <span className="truncate">{item.label}</span>}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      {user && !collapsed && (
        <div className="border-t border-sidebar-border p-3">
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
        <div className="border-t border-sidebar-border p-2 flex justify-center">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary-subtle text-primary text-xs font-semibold uppercase">
            {user.fullName.slice(0, 2)}
          </div>
        </div>
      )}
    </aside>
  );
}
