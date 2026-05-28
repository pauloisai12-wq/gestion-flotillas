// Archivo: /api/src/middlewares/roleMiddleware.ts
// RBAC v2 — 6 roles, helpers tipados.

import { Request, Response, NextFunction } from 'express';
import { UserRole } from '@prisma/client';

/** Alias legibles para uso en rutas */
export const Roles = {
  ADMIN: 'ADMIN' as UserRole,
  SUP_VEHICLES: 'SUPERVISOR_VEHICLES' as UserRole,
  SUP_FUEL: 'SUPERVISOR_FUEL' as UserRole,
  SUP_MAINT: 'SUPERVISOR_MAINTENANCE' as UserRole,
  EXECUTOR: 'EXECUTOR' as UserRole,
  WORKSHOP: 'WORKSHOP' as UserRole,
} as const;

/** Grupos útiles */
export const RoleGroups = {
  /// Cualquier usuario autenticado de la organización (sin talleres externos)
  ANY_AUTH: [Roles.ADMIN, Roles.SUP_VEHICLES, Roles.SUP_FUEL, Roles.SUP_MAINT, Roles.EXECUTOR] as UserRole[],
  ADMIN_ONLY: [Roles.ADMIN] as UserRole[],
  FUEL_MANAGERS: [Roles.ADMIN, Roles.SUP_FUEL] as UserRole[],
  MAINT_MANAGERS: [Roles.ADMIN, Roles.SUP_MAINT] as UserRole[],
  /// Quienes administran presupuestos (FUEL o MAINTENANCE). El handler restringe luego por kind.
  BUDGET_MANAGERS: [Roles.ADMIN, Roles.SUP_FUEL, Roles.SUP_MAINT] as UserRole[],
  VEHICLE_READERS: [Roles.ADMIN, Roles.SUP_VEHICLES, Roles.SUP_FUEL, Roles.SUP_MAINT] as UserRole[],
  VEHICLE_WRITERS: [Roles.ADMIN, Roles.SUP_VEHICLES] as UserRole[],
  NOTES_WRITERS: [Roles.ADMIN, Roles.SUP_VEHICLES, Roles.SUP_FUEL, Roles.SUP_MAINT] as UserRole[],
  /// Quienes administran el flujo del ticket (filtro inicial + aprobación final)
  TICKET_ADMINS: [Roles.ADMIN, Roles.SUP_MAINT] as UserRole[],
  /// Quien levanta el ticket (incluye admins por si necesitan crear en nombre del ejecutor)
  TICKET_CREATORS: [Roles.EXECUTOR] as UserRole[],
  /// Solo el taller — para subir cotización, declinar, marcar inicio/fin de reparación
  WORKSHOP_ONLY: [Roles.WORKSHOP] as UserRole[],
} as const;

/**
 * Middleware que valida el rol del usuario autenticado.
 * Uso: router.get('/admin-only', auth, roleMiddleware(RoleGroups.ADMIN_ONLY), handler)
 */
export function roleMiddleware(allowedRoles: readonly UserRole[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const user = req.user;

    if (!user) {
      res.status(401).json({ error: 'No autorizado', message: 'Debe autenticarse primero' });
      return;
    }

    if (!allowedRoles.includes(user.role)) {
      res.status(403).json({
        error: 'Acceso denegado',
        message: `Se requiere uno de estos roles: ${allowedRoles.join(', ')}`,
        yourRole: user.role,
      });
      return;
    }

    next();
  };
}

/** Alias corto — legibilidad en rutas */
export const requireRole = roleMiddleware;
