// Control de acceso por rol para el área autenticada.
// Ejecutor y Taller solo participan en el flujo de tickets: no ven el panel general
// (dashboards, vehículos, finanzas, catálogos, reportes, configuración).

import type { UserRole } from '@/contexts/AuthContext';

// Roles cuyo acceso está restringido a un subconjunto de rutas.
// La lista son prefijos permitidos; cualquier otra ruta del panel les queda vedada.
const RESTRICTED_PREFIXES: Partial<Record<UserRole, string[]>> = {
  EXECUTOR: ['/tickets'],
  WORKSHOP: ['/tickets'],
};

/**
 * Ruta de inicio según rol — usada tras login y cuando un rol restringido
 * intenta entrar a una zona vedada.
 */
export function getHomePath(role: UserRole): string {
  switch (role) {
    case 'ADMIN':
      return '/dashboard/global';
    case 'SUPERVISOR_VEHICLES':
      return '/dashboard/vehiculos';
    case 'SUPERVISOR_FUEL':
      return '/dashboard/gasolina';
    case 'SUPERVISOR_MAINTENANCE':
      return '/dashboard/mantenimiento';
    case 'EXECUTOR':
    case 'WORKSHOP':
      return '/tickets';
    default:
      return '/tickets';
  }
}

/** ¿El rol puede acceder a esta ruta del panel? */
export function isPathAllowed(role: UserRole, pathname: string): boolean {
  const allowed = RESTRICTED_PREFIXES[role];
  if (!allowed) return true; // roles sin restricción ven todo el panel
  return allowed.some((p) => pathname === p || pathname.startsWith(p + '/'));
}
