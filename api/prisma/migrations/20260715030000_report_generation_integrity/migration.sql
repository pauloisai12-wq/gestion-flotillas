-- El flujo anterior nunca vinculaba una fila PROCESSING con el job de BullMQ.
-- Cualquier fila que haya quedado así no puede reanudarse de forma segura tras
-- desplegar el protocolo nuevo; se cierra explícitamente antes de imponer la
-- exclusión atómica por periodo.
ALTER TABLE report_history
ADD COLUMN "runToken" UUID,
ADD COLUMN "leaseExpiresAt" TIMESTAMP(3);

UPDATE report_history
SET
  status = 'FAILED'::"ReportStatus",
  "errorMessage" = COALESCE(
    "errorMessage",
    'Generación heredada cerrada durante la migración; solicite una nueva ejecución.'
  ),
  "completedAt" = COALESCE("completedAt", NOW()),
  "updatedAt" = NOW()
WHERE status = 'PROCESSING'::"ReportStatus";

-- Outbox transaccional: la intención de encolar nace en la misma transacción
-- que ReportHistory. Si la API cae entre PostgreSQL y Redis, el despachador
-- periódico puede retomar esta fila sin dejar el periodo bloqueado para siempre.
CREATE TABLE report_generation_outbox (
  id SERIAL PRIMARY KEY,
  "reportHistoryId" INTEGER NOT NULL,
  "publishedAt" TIMESTAMP(3),
  attempts INTEGER NOT NULL DEFAULT 0,
  "lastError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT report_generation_outbox_report_history_fkey
    FOREIGN KEY ("reportHistoryId") REFERENCES report_history(id)
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "report_generation_outbox_reportHistoryId_key"
ON report_generation_outbox ("reportHistoryId");

CREATE INDEX "report_generation_outbox_publishedAt_createdAt_idx"
ON report_generation_outbox ("publishedAt", "createdAt");

-- Prisma no expresa índices únicos parciales en schema.prisma. Este índice es
-- la barrera real contra dos solicitudes concurrentes del mismo mes/año.
CREATE UNIQUE INDEX report_history_one_processing_period_idx
ON report_history (month, year)
WHERE status = 'PROCESSING'::"ReportStatus";
