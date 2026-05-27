-- CreateEnum
CREATE TYPE "VehicleStatus" AS ENUM ('OPERATIVE', 'BLOCKED');

-- CreateEnum
CREATE TYPE "VehicleClassification" AS ENUM ('POLICIAL', 'ESTATAL', 'VIAL');

-- CreateEnum
CREATE TYPE "ReportStatus" AS ENUM ('PROCESSING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "DocumentType" AS ENUM ('INVOICE', 'INSURANCE', 'VERIFICATION', 'CIRCULATION_CARD');

-- CreateEnum
CREATE TYPE "TrafficLight" AS ENUM ('GREEN', 'YELLOW', 'RED');

-- CreateEnum
CREATE TYPE "AssignmentType" AS ENUM ('FIXED', 'ROTATIVE');

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('ADMIN', 'SUPERVISOR_VEHICLES', 'SUPERVISOR_FUEL', 'SUPERVISOR_MAINTENANCE');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('DOCUMENT_EXPIRING', 'DOCUMENT_EXPIRED', 'VEHICLE_BLOCKED', 'BUDGET_WARNING', 'BUDGET_EXCEEDED', 'MAINTENANCE_DUE', 'MAINTENANCE_OVERDUE', 'FUEL_UNAPPROVED_STATION', 'FUEL_LOAD_PENDING_REVIEW', 'REPORT_READY');

-- CreateEnum
CREATE TYPE "BudgetKind" AS ENUM ('FUEL', 'MAINTENANCE');

-- CreateEnum
CREATE TYPE "OdometerStatus" AS ENUM ('OK', 'NF');

-- CreateEnum
CREATE TYPE "FuelLoadStatus" AS ENUM ('APPROVED', 'PENDING_REVIEW', 'REJECTED');

-- CreateTable
CREATE TABLE "vehicle_types" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "expectedKmPerLiter" DOUBLE PRECISION NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vehicle_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sectors" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sectors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" SERIAL NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'SUPERVISOR_VEHICLES',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vehicles" (
    "id" SERIAL NOT NULL,
    "plate" TEXT NOT NULL,
    "economicNumber" TEXT NOT NULL,
    "vehicleTypeId" INTEGER NOT NULL,
    "classification" "VehicleClassification" NOT NULL DEFAULT 'ESTATAL',
    "sectorId" INTEGER,
    "brand" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "vin" TEXT,
    "color" TEXT,
    "currentOdometer" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "status" "VehicleStatus" NOT NULL DEFAULT 'OPERATIVE',
    "blockReason" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vehicles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "documents" (
    "id" SERIAL NOT NULL,
    "vehicleId" INTEGER NOT NULL,
    "type" "DocumentType" NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "fileUrl" TEXT,
    "fileName" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vehicle_notes" (
    "id" SERIAL NOT NULL,
    "vehicleId" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "createdBy" INTEGER NOT NULL,
    "updatedBy" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "vehicle_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "operators" (
    "id" SERIAL NOT NULL,
    "employeeNumber" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "licenseNumber" TEXT NOT NULL,
    "licenseType" TEXT NOT NULL,
    "licenseExpiresAt" TIMESTAMP(3) NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "operators_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vehicle_assignments" (
    "id" SERIAL NOT NULL,
    "vehicleId" INTEGER NOT NULL,
    "operatorId" INTEGER NOT NULL,
    "type" "AssignmentType" NOT NULL DEFAULT 'ROTATIVE',
    "startDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vehicle_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approved_stations" (
    "id" SERIAL NOT NULL,
    "rfc" TEXT NOT NULL,
    "legalName" TEXT NOT NULL,
    "tradeName" TEXT,
    "email" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "approved_stations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workshops" (
    "id" SERIAL NOT NULL,
    "rfc" TEXT NOT NULL,
    "legalName" TEXT NOT NULL,
    "tradeName" TEXT,
    "email" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workshops_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fuel_loads" (
    "id" SERIAL NOT NULL,
    "vehicleId" INTEGER NOT NULL,
    "operatorId" INTEGER,
    "operatorNameRaw" TEXT,
    "operatorEmployeeRaw" TEXT,
    "stationId" INTEGER NOT NULL,
    "liters" DOUBLE PRECISION,
    "amount" DECIMAL(12,2) NOT NULL,
    "odometer" DOUBLE PRECISION,
    "odometerStatus" "OdometerStatus" NOT NULL DEFAULT 'OK',
    "kmPerLiter" DOUBLE PRECISION,
    "isApproved" BOOLEAN NOT NULL DEFAULT true,
    "status" "FuelLoadStatus" NOT NULL DEFAULT 'APPROVED',
    "loadDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fuel_loads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vehicle_budgets" (
    "id" SERIAL NOT NULL,
    "vehicleId" INTEGER NOT NULL,
    "kind" "BudgetKind" NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "baseAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "rolloverIn" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "spentAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "isClosed" BOOLEAN NOT NULL DEFAULT false,
    "closedAt" TIMESTAMP(3),
    "isCutOff" BOOLEAN NOT NULL DEFAULT false,
    "createdBy" INTEGER,
    "updatedBy" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vehicle_budgets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_catalog" (
    "id" SERIAL NOT NULL,
    "vehicleTypeId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "intervalKm" DOUBLE PRECISION NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "service_catalog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "maintenance_records" (
    "id" SERIAL NOT NULL,
    "vehicleId" INTEGER NOT NULL,
    "serviceId" INTEGER NOT NULL,
    "workshopId" INTEGER,
    "workshopRaw" TEXT,
    "odometer" DOUBLE PRECISION,
    "odometerStatus" "OdometerStatus" NOT NULL DEFAULT 'OK',
    "cost" DECIMAL(12,2) NOT NULL,
    "evidenceUrl" TEXT,
    "serviceDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "maintenance_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "type" "NotificationType" NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "read" BOOLEAN NOT NULL DEFAULT false,
    "entityRef" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "report_history" (
    "id" SERIAL NOT NULL,
    "month" INTEGER NOT NULL,
    "year" INTEGER NOT NULL,
    "pdfPath" TEXT,
    "excelPath" TEXT,
    "pdfSize" INTEGER,
    "excelSize" INTEGER,
    "status" "ReportStatus" NOT NULL DEFAULT 'PROCESSING',
    "requestedBy" TEXT NOT NULL DEFAULT 'sistema',
    "errorMessage" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "report_history_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "vehicle_types_name_key" ON "vehicle_types"("name");

-- CreateIndex
CREATE UNIQUE INDEX "sectors_code_key" ON "sectors"("code");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "vehicles_plate_key" ON "vehicles"("plate");

-- CreateIndex
CREATE UNIQUE INDEX "vehicles_economicNumber_key" ON "vehicles"("economicNumber");

-- CreateIndex
CREATE UNIQUE INDEX "vehicles_vin_key" ON "vehicles"("vin");

-- CreateIndex
CREATE INDEX "vehicles_vehicleTypeId_idx" ON "vehicles"("vehicleTypeId");

-- CreateIndex
CREATE INDEX "vehicles_sectorId_idx" ON "vehicles"("sectorId");

-- CreateIndex
CREATE INDEX "vehicles_status_idx" ON "vehicles"("status");

-- CreateIndex
CREATE INDEX "vehicles_classification_idx" ON "vehicles"("classification");

-- CreateIndex
CREATE INDEX "documents_vehicleId_type_expiresAt_idx" ON "documents"("vehicleId", "type", "expiresAt");

-- CreateIndex
CREATE INDEX "vehicle_notes_vehicleId_createdAt_idx" ON "vehicle_notes"("vehicleId", "createdAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "operators_employeeNumber_key" ON "operators"("employeeNumber");

-- CreateIndex
CREATE UNIQUE INDEX "operators_licenseNumber_key" ON "operators"("licenseNumber");

-- CreateIndex
CREATE INDEX "vehicle_assignments_vehicleId_endDate_idx" ON "vehicle_assignments"("vehicleId", "endDate");

-- CreateIndex
CREATE INDEX "vehicle_assignments_operatorId_endDate_idx" ON "vehicle_assignments"("operatorId", "endDate");

-- CreateIndex
CREATE UNIQUE INDEX "approved_stations_rfc_key" ON "approved_stations"("rfc");

-- CreateIndex
CREATE UNIQUE INDEX "workshops_rfc_key" ON "workshops"("rfc");

-- CreateIndex
CREATE INDEX "fuel_loads_vehicleId_createdAt_idx" ON "fuel_loads"("vehicleId", "createdAt");

-- CreateIndex
CREATE INDEX "fuel_loads_stationId_idx" ON "fuel_loads"("stationId");

-- CreateIndex
CREATE INDEX "fuel_loads_operatorId_createdAt_idx" ON "fuel_loads"("operatorId", "createdAt");

-- CreateIndex
CREATE INDEX "fuel_loads_loadDate_idx" ON "fuel_loads"("loadDate");

-- CreateIndex
CREATE INDEX "fuel_loads_status_idx" ON "fuel_loads"("status");

-- CreateIndex
CREATE INDEX "vehicle_budgets_year_month_kind_idx" ON "vehicle_budgets"("year", "month", "kind");

-- CreateIndex
CREATE INDEX "vehicle_budgets_vehicleId_kind_idx" ON "vehicle_budgets"("vehicleId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "vehicle_budgets_vehicleId_kind_year_month_key" ON "vehicle_budgets"("vehicleId", "kind", "year", "month");

-- CreateIndex
CREATE INDEX "service_catalog_vehicleTypeId_idx" ON "service_catalog"("vehicleTypeId");

-- CreateIndex
CREATE INDEX "maintenance_records_vehicleId_serviceId_idx" ON "maintenance_records"("vehicleId", "serviceId");

-- CreateIndex
CREATE INDEX "maintenance_records_serviceDate_idx" ON "maintenance_records"("serviceDate");

-- CreateIndex
CREATE INDEX "maintenance_records_workshopId_idx" ON "maintenance_records"("workshopId");

-- CreateIndex
CREATE INDEX "notifications_userId_read_createdAt_idx" ON "notifications"("userId", "read", "createdAt");

-- CreateIndex
CREATE INDEX "report_history_month_year_idx" ON "report_history"("month", "year");

-- CreateIndex
CREATE INDEX "report_history_status_idx" ON "report_history"("status");

-- AddForeignKey
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_vehicleTypeId_fkey" FOREIGN KEY ("vehicleTypeId") REFERENCES "vehicle_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_sectorId_fkey" FOREIGN KEY ("sectorId") REFERENCES "sectors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "vehicles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicle_notes" ADD CONSTRAINT "vehicle_notes_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "vehicles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicle_notes" ADD CONSTRAINT "vehicle_notes_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicle_notes" ADD CONSTRAINT "vehicle_notes_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicle_assignments" ADD CONSTRAINT "vehicle_assignments_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "vehicles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicle_assignments" ADD CONSTRAINT "vehicle_assignments_operatorId_fkey" FOREIGN KEY ("operatorId") REFERENCES "operators"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fuel_loads" ADD CONSTRAINT "fuel_loads_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "vehicles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fuel_loads" ADD CONSTRAINT "fuel_loads_operatorId_fkey" FOREIGN KEY ("operatorId") REFERENCES "operators"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fuel_loads" ADD CONSTRAINT "fuel_loads_stationId_fkey" FOREIGN KEY ("stationId") REFERENCES "approved_stations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicle_budgets" ADD CONSTRAINT "vehicle_budgets_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "vehicles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicle_budgets" ADD CONSTRAINT "vehicle_budgets_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicle_budgets" ADD CONSTRAINT "vehicle_budgets_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_catalog" ADD CONSTRAINT "service_catalog_vehicleTypeId_fkey" FOREIGN KEY ("vehicleTypeId") REFERENCES "vehicle_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance_records" ADD CONSTRAINT "maintenance_records_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "vehicles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance_records" ADD CONSTRAINT "maintenance_records_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "service_catalog"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance_records" ADD CONSTRAINT "maintenance_records_workshopId_fkey" FOREIGN KEY ("workshopId") REFERENCES "workshops"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
