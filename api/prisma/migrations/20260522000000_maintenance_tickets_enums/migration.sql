-- ════════════════════════════════════════════════════════════════
-- TICKETS DE MANTENIMIENTO — Parte 1/2: nuevos valores en enums
-- ════════════════════════════════════════════════════════════════
-- Postgres NO permite usar un nuevo valor de enum en la misma transacción
-- en que se agregó. Como las CHECK constraints de la parte 2 referencian
-- 'WORKSHOP', necesitamos commit antes — por eso esta migración va sola.
--
-- Roles nuevos:
--   - EXECUTOR: User responsable de vehículos asignados (levanta tickets)
--   - WORKSHOP: User vinculado 1:1 a un Workshop (cotiza y ejecuta reparaciones)
--
-- Tipos de notificación nuevos: cubren cada paso del flujo del ticket.

-- ─── UserRole ────────────────────────────────────────────────────
ALTER TYPE "UserRole" ADD VALUE 'EXECUTOR';
ALTER TYPE "UserRole" ADD VALUE 'WORKSHOP';

-- ─── NotificationType ────────────────────────────────────────────
ALTER TYPE "NotificationType" ADD VALUE 'MAINTENANCE_TICKET_CREATED';
ALTER TYPE "NotificationType" ADD VALUE 'MAINTENANCE_QUOTE_REQUESTED';
ALTER TYPE "NotificationType" ADD VALUE 'MAINTENANCE_QUOTE_SUBMITTED';
ALTER TYPE "NotificationType" ADD VALUE 'MAINTENANCE_TICKET_REJECTED';
ALTER TYPE "NotificationType" ADD VALUE 'MAINTENANCE_TICKET_APPROVED';
ALTER TYPE "NotificationType" ADD VALUE 'MAINTENANCE_REPAIR_STARTED';
ALTER TYPE "NotificationType" ADD VALUE 'MAINTENANCE_REPAIR_COMPLETED';
