-- State machine de revisión de combustible.
--
-- IMPORTANTE: las cargas PENDING_REVIEW creadas antes de esta migración
-- pudieron haber afectado presupuesto y/o odómetro con la implementación
-- histórica. No existe evidencia por fila que permita inferir esos efectos.
-- Por eso se marcan para reconciliación explícita, sin aprobarlas, rechazarlas,
-- devolver presupuesto ni cambiar odómetros automáticamente.

ALTER TABLE "fuel_loads"
  ADD COLUMN "reviewedAt" TIMESTAMP(3),
  ADD COLUMN "reviewedById" INTEGER,
  ADD COLUMN "reviewReason" TEXT,
  -- DEFAULT true es deliberado: mientras la API anterior siga viva durante un
  -- despliegue, sus PENDING_REVIEW (que aplican efectos) quedan bloqueados.
  -- La API nueva escribe false explicitamente al crear capturas sin efectos.
  ADD COLUMN "requiresReconciliation" BOOLEAN NOT NULL DEFAULT true;

-- Los estados que nunca pasan por revision no necesitan reconciliacion. Esta
-- normalizacion no abre los PENDING insertados concurrentemente por la API vieja.
UPDATE "fuel_loads"
SET "requiresReconciliation" = false
WHERE "status" <> 'PENDING_REVIEW'::"FuelLoadStatus";

UPDATE "fuel_loads"
SET "requiresReconciliation" = true
WHERE "status" = 'PENDING_REVIEW'::"FuelLoadStatus";

CREATE INDEX "fuel_loads_status_requiresReconciliation_createdAt_idx"
  ON "fuel_loads"("status", "requiresReconciliation", "createdAt");

CREATE INDEX "fuel_loads_reviewedById_idx"
  ON "fuel_loads"("reviewedById");

ALTER TABLE "fuel_loads"
  ADD CONSTRAINT "fuel_loads_reviewedById_fkey"
  FOREIGN KEY ("reviewedById") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

COMMENT ON COLUMN "fuel_loads"."requiresReconciliation" IS
  'true para pendientes históricos cuyos efectos no pueden inferirse; exige decisión ADMIN con hechos verificados';
