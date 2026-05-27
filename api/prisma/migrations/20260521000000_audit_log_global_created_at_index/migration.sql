-- Índice global por fecha en audit_logs.
-- Acelera queries del tipo "qué pasó el día X" o "auditoría entre fechas",
-- que antes hacían full scan (los índices existentes son compuestos y empiezan
-- por userId/resource/action, así que un filtro solo por rango de fecha
-- no podía usarlos como leading column).
--
-- CONCURRENTLY: no bloquea writes durante la creación. Importante porque
-- audit_logs recibe inserciones de cada request.
-- IF NOT EXISTS: idempotente, seguro de re-ejecutar.

CREATE INDEX CONCURRENTLY IF NOT EXISTS "audit_logs_createdAt_idx"
  ON "audit_logs" ("createdAt" DESC);
