-- AlterEnum: añade valor VEHICLE_UNBLOCKED a NotificationType
-- Necesario para que el job diario de compliance pueda emitir notificaciones
-- cuando un vehículo pasa de BLOCKED → OPERATIVE.
ALTER TYPE "NotificationType" ADD VALUE 'VEHICLE_UNBLOCKED';
