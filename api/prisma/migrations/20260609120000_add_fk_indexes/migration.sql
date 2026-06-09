-- Índices en claves foráneas sin indexar. PostgreSQL NO crea índice automático en
-- columnas FK; sin esto, filtros/JOINs por autor/editor/rechazador/aprobador hacen
-- Seq Scan. Generado con `prisma migrate diff` (nombres canónicos de Prisma).

-- CreateIndex
CREATE INDEX "vehicle_notes_createdBy_idx" ON "vehicle_notes"("createdBy");

-- CreateIndex
CREATE INDEX "vehicle_notes_updatedBy_idx" ON "vehicle_notes"("updatedBy");

-- CreateIndex
CREATE INDEX "vehicle_budgets_createdBy_idx" ON "vehicle_budgets"("createdBy");

-- CreateIndex
CREATE INDEX "vehicle_budgets_updatedBy_idx" ON "vehicle_budgets"("updatedBy");

-- CreateIndex
CREATE INDEX "maintenance_tickets_rejectedById_idx" ON "maintenance_tickets"("rejectedById");

-- CreateIndex
CREATE INDEX "maintenance_tickets_approvedByAdminId_idx" ON "maintenance_tickets"("approvedByAdminId");
