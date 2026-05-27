-- ════════════════════════════════════════════════════════════════
-- TICKETS DE MANTENIMIENTO — Parte 2/2: enums nuevos, tablas, constraints
-- ════════════════════════════════════════════════════════════════
-- Esta migración asume que la parte 1 (20260522000000_maintenance_tickets_enums)
-- ya está aplicada y comiteada — los valores EXECUTOR y WORKSHOP del enum
-- UserRole ya son referenciables.
--
-- Implementa el ciclo de vida del ticket:
--
--   PENDING_ADMIN_APPROVAL
--        ├── REJECTED_BY_ADMIN          (terminal)
--        └── AWAITING_QUOTES            (1-3 talleres cotizan)
--                ├── REJECTED_FINAL     (terminal)
--                └── APPROVED_FOR_REPAIR  ← admin escoge cotización
--                        └── IN_REPAIR    ← taller marca inicio
--                                └── COMPLETED (terminal — crea MaintenanceRecord)

-- ─── 1) Enums nuevos ─────────────────────────────────────────────
CREATE TYPE "MaintenanceTicketStatus" AS ENUM (
  'PENDING_ADMIN_APPROVAL',
  'REJECTED_BY_ADMIN',
  'AWAITING_QUOTES',
  'REJECTED_FINAL',
  'APPROVED_FOR_REPAIR',
  'IN_REPAIR',
  'COMPLETED'
);

CREATE TYPE "FailureCategory" AS ENUM (
  'ENGINE',
  'TRANSMISSION',
  'BRAKES',
  'ELECTRICAL',
  'BODY_PAINT',
  'TIRES_SUSPENSION',
  'AC_CLIMATE',
  'PREVENTIVE',
  'OTHER'
);

-- ─── 2a) users.workshopId — 1:1 a Workshop ───────────────────────
ALTER TABLE "users" ADD COLUMN "workshopId" INTEGER;
ALTER TABLE "users" ADD CONSTRAINT "users_workshopId_key" UNIQUE ("workshopId");
ALTER TABLE "users" ADD CONSTRAINT "users_workshopId_fkey"
  FOREIGN KEY ("workshopId") REFERENCES "workshops"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- ─── 2b) vehicles.executorId — N:1 a User ────────────────────────
ALTER TABLE "vehicles" ADD COLUMN "executorId" INTEGER;
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_executorId_fkey"
  FOREIGN KEY ("executorId") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "vehicles_executorId_idx" ON "vehicles"("executorId");

-- ─── 3a) maintenance_tickets ─────────────────────────────────────
-- FK selectedQuoteId → ticket_quotes se agrega más abajo (después de crear
-- la tabla de quotes, que apunta a este ticket).
CREATE TABLE "maintenance_tickets" (
  "id"                 SERIAL                    PRIMARY KEY,
  "vehicleId"          INTEGER                   NOT NULL,
  "requestedById"      INTEGER                   NOT NULL,
  "failureCategory"    "FailureCategory"         NOT NULL DEFAULT 'OTHER',
  "description"        TEXT                      NOT NULL,
  "reportedOdometer"   DOUBLE PRECISION,
  "odometerStatus"     "OdometerStatus"          NOT NULL DEFAULT 'OK',
  "status"             "MaintenanceTicketStatus" NOT NULL DEFAULT 'PENDING_ADMIN_APPROVAL',
  "rejectionReason"    TEXT,
  "rejectedAt"         TIMESTAMP(3),
  "rejectedById"       INTEGER,
  "finalConcept"       TEXT,
  "selectedQuoteId"    INTEGER,
  "approvedByAdminId"  INTEGER,
  "approvedAt"         TIMESTAMP(3),
  "repairStartedAt"    TIMESTAMP(3),
  "repairCompletedAt"  TIMESTAMP(3),
  "completedRecordId"  INTEGER,
  "createdAt"          TIMESTAMP(3)              NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"          TIMESTAMP(3)              NOT NULL,
  CONSTRAINT "maintenance_tickets_vehicleId_fkey"
    FOREIGN KEY ("vehicleId") REFERENCES "vehicles"("id") ON UPDATE CASCADE,
  CONSTRAINT "maintenance_tickets_requestedById_fkey"
    FOREIGN KEY ("requestedById") REFERENCES "users"("id") ON UPDATE CASCADE,
  CONSTRAINT "maintenance_tickets_rejectedById_fkey"
    FOREIGN KEY ("rejectedById") REFERENCES "users"("id") ON UPDATE CASCADE ON DELETE SET NULL,
  CONSTRAINT "maintenance_tickets_approvedByAdminId_fkey"
    FOREIGN KEY ("approvedByAdminId") REFERENCES "users"("id") ON UPDATE CASCADE ON DELETE SET NULL,
  CONSTRAINT "maintenance_tickets_completedRecordId_fkey"
    FOREIGN KEY ("completedRecordId") REFERENCES "maintenance_records"("id") ON UPDATE CASCADE ON DELETE SET NULL
);

CREATE UNIQUE INDEX "maintenance_tickets_selectedQuoteId_key"
  ON "maintenance_tickets"("selectedQuoteId");
CREATE UNIQUE INDEX "maintenance_tickets_completedRecordId_key"
  ON "maintenance_tickets"("completedRecordId");
CREATE INDEX "maintenance_tickets_vehicleId_createdAt_idx"
  ON "maintenance_tickets"("vehicleId", "createdAt" DESC);
CREATE INDEX "maintenance_tickets_requestedById_status_idx"
  ON "maintenance_tickets"("requestedById", "status");
CREATE INDEX "maintenance_tickets_status_createdAt_idx"
  ON "maintenance_tickets"("status", "createdAt" DESC);

-- ─── 3b) ticket_quotes ───────────────────────────────────────────
-- Se crean 3 filas (una por taller) cuando el ticket pasa a AWAITING_QUOTES,
-- todas con submittedAt=null. El taller las actualiza al enviar su PDF.
CREATE TABLE "ticket_quotes" (
  "id"              SERIAL          PRIMARY KEY,
  "ticketId"        INTEGER         NOT NULL,
  "workshopId"      INTEGER         NOT NULL,
  "amount"          DECIMAL(12, 2),
  "pdfUrl"          TEXT,
  "pdfFileName"     TEXT,
  "diagnosisNotes"  TEXT,
  "submittedAt"     TIMESTAMP(3),
  "isWinner"        BOOLEAN         NOT NULL DEFAULT false,
  "declinedAt"      TIMESTAMP(3),
  "declineReason"   TEXT,
  "createdAt"       TIMESTAMP(3)    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3)    NOT NULL,
  CONSTRAINT "ticket_quotes_ticketId_fkey"
    FOREIGN KEY ("ticketId") REFERENCES "maintenance_tickets"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ticket_quotes_workshopId_fkey"
    FOREIGN KEY ("workshopId") REFERENCES "workshops"("id") ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "ticket_quotes_ticketId_workshopId_key"
  ON "ticket_quotes"("ticketId", "workshopId");
CREATE INDEX "ticket_quotes_workshopId_submittedAt_idx"
  ON "ticket_quotes"("workshopId", "submittedAt");

-- ─── 3c) FK selectedQuoteId — ya existe ticket_quotes ────────────
ALTER TABLE "maintenance_tickets"
  ADD CONSTRAINT "maintenance_tickets_selectedQuoteId_fkey"
  FOREIGN KEY ("selectedQuoteId") REFERENCES "ticket_quotes"("id")
  ON UPDATE CASCADE ON DELETE SET NULL;

-- ─── 3d) ticket_attachments — fotos/archivos del ejecutor ────────
-- Límite app-side: 0-5 por ticket, JPG/PNG, máx 5MB c/u.
CREATE TABLE "ticket_attachments" (
  "id"          SERIAL        PRIMARY KEY,
  "ticketId"    INTEGER       NOT NULL,
  "fileUrl"     TEXT          NOT NULL,
  "fileName"    TEXT          NOT NULL,
  "mimeType"    TEXT,
  "sizeBytes"   INTEGER,
  "uploadedAt"  TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ticket_attachments_ticketId_fkey"
    FOREIGN KEY ("ticketId") REFERENCES "maintenance_tickets"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "ticket_attachments_ticketId_idx"
  ON "ticket_attachments"("ticketId");

-- ─── 4) CHECK constraints para consistencia ──────────────────────

-- Un User con role=WORKSHOP DEBE tener workshopId; cualquier otro rol NO.
ALTER TABLE "users" ADD CONSTRAINT "users_workshop_role_consistency" CHECK (
  (role = 'WORKSHOP' AND "workshopId" IS NOT NULL)
  OR (role <> 'WORKSHOP' AND "workshopId" IS NULL)
);

-- selectedQuoteId solo es válido en estados post-aprobación.
ALTER TABLE "maintenance_tickets" ADD CONSTRAINT "tickets_quote_post_approval" CHECK (
  "selectedQuoteId" IS NULL
  OR status IN ('APPROVED_FOR_REPAIR', 'IN_REPAIR', 'COMPLETED')
);

-- repairStartedAt set ⇔ status IN ('IN_REPAIR','COMPLETED')
ALTER TABLE "maintenance_tickets" ADD CONSTRAINT "tickets_started_consistency" CHECK (
  ("repairStartedAt" IS NULL AND status NOT IN ('IN_REPAIR', 'COMPLETED'))
  OR ("repairStartedAt" IS NOT NULL AND status IN ('IN_REPAIR', 'COMPLETED'))
);

-- repairCompletedAt y completedRecordId set ⇔ status = 'COMPLETED'
ALTER TABLE "maintenance_tickets" ADD CONSTRAINT "tickets_completed_consistency" CHECK (
  ("repairCompletedAt" IS NULL AND "completedRecordId" IS NULL AND status <> 'COMPLETED')
  OR ("repairCompletedAt" IS NOT NULL AND "completedRecordId" IS NOT NULL AND status = 'COMPLETED')
);

-- Rechazos requieren motivo + timestamp
ALTER TABLE "maintenance_tickets" ADD CONSTRAINT "tickets_rejection_consistency" CHECK (
  (status NOT IN ('REJECTED_BY_ADMIN', 'REJECTED_FINAL') AND "rejectedAt" IS NULL)
  OR (status IN ('REJECTED_BY_ADMIN', 'REJECTED_FINAL')
      AND "rejectedAt" IS NOT NULL
      AND "rejectionReason" IS NOT NULL)
);
