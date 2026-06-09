-- Sincroniza el historial de migraciones con schema.prisma.
-- Varias columnas/índices del schema nunca se migraron (se aplicaban con
-- db push / migrate dev), así que un `migrate deploy` limpio producía un
-- esquema incompleto: faltaban columnas de `vehicles` (expedientNumber,
-- engineNumber, area, usage, vehicleClass, ...) y de `users` (lockedUntil,
-- lastLoginAt), rompiendo la importación de vehículos y el lockout de auth.
-- DDL generado con `prisma migrate diff --from-url <db-migrada> --to-schema-datamodel`.

-- DropForeignKey
ALTER TABLE "maintenance_tickets" DROP CONSTRAINT "maintenance_tickets_requestedById_fkey";

-- DropForeignKey
ALTER TABLE "maintenance_tickets" DROP CONSTRAINT "maintenance_tickets_vehicleId_fkey";

-- DropForeignKey
ALTER TABLE "ticket_quotes" DROP CONSTRAINT "ticket_quotes_workshopId_fkey";

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "lastLoginAt" TIMESTAMP(3),
ADD COLUMN     "lockedUntil" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "vehicles" ADD COLUMN     "area" TEXT,
ADD COLUMN     "cylinders" INTEGER,
ADD COLUMN     "engineNumber" TEXT,
ADD COLUMN     "executiveUnit" TEXT,
ADD COLUMN     "expedientNumber" TEXT,
ADD COLUMN     "invoiceCertifiedAt" TIMESTAMP(3),
ADD COLUMN     "lastInsuredYear" INTEGER,
ADD COLUMN     "lastResguardoDate" TIMESTAMP(3),
ADD COLUMN     "lastTenenciaYear" INTEGER,
ADD COLUMN     "physicalCondition" TEXT,
ADD COLUMN     "previousPlate" TEXT,
ADD COLUMN     "usage" TEXT,
ADD COLUMN     "vehicleClass" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "vehicles_expedientNumber_key" ON "vehicles"("expedientNumber");

-- AddForeignKey
ALTER TABLE "maintenance_tickets" ADD CONSTRAINT "maintenance_tickets_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "vehicles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance_tickets" ADD CONSTRAINT "maintenance_tickets_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_quotes" ADD CONSTRAINT "ticket_quotes_workshopId_fkey" FOREIGN KEY ("workshopId") REFERENCES "workshops"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

