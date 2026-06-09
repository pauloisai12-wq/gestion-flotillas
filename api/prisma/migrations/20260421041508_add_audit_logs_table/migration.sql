-- Crea la tabla `audit_logs` (modelo AuditLog) que faltaba en el historial de
-- migraciones. El schema la declara (@@map("audit_logs")) y la migración
-- 20260521000000_audit_log_global_created_at_index le crea un índice, pero
-- ninguna migración la creaba -> `prisma migrate deploy` fallaba en una BD nueva
-- con 42P01 (relation "audit_logs" does not exist).
--
-- DDL canónico generado con `prisma migrate diff --from-empty --to-schema-datamodel`.
-- Va después de 20260421041507 (crea `users`, referenciada por la FK) y antes de
-- la migración del índice (que usa IF NOT EXISTS sobre `audit_logs_createdAt_idx`,
-- así que queda como no-op idempotente).

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER,
    "action" TEXT NOT NULL,
    "resource" TEXT NOT NULL,
    "resourceId" TEXT,
    "before" JSONB,
    "after" JSONB,
    "metadata" JSONB,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "requestId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "audit_logs_userId_createdAt_idx" ON "audit_logs"("userId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "audit_logs_resource_resourceId_idx" ON "audit_logs"("resource", "resourceId");

-- CreateIndex
CREATE INDEX "audit_logs_action_createdAt_idx" ON "audit_logs"("action", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "audit_logs_createdAt_idx" ON "audit_logs"("createdAt" DESC);

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
