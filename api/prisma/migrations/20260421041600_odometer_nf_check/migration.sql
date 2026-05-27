-- CHECK constraint: si odometerStatus=NF, odometer DEBE ser null (y viceversa)

ALTER TABLE "fuel_loads"
  ADD CONSTRAINT "fuel_loads_odometer_nf_consistency"
  CHECK (
    ("odometerStatus" = 'NF' AND "odometer" IS NULL) OR
    ("odometerStatus" = 'OK' AND "odometer" IS NOT NULL)
  );

ALTER TABLE "maintenance_records"
  ADD CONSTRAINT "maintenance_records_odometer_nf_consistency"
  CHECK (
    ("odometerStatus" = 'NF' AND "odometer" IS NULL) OR
    ("odometerStatus" = 'OK' AND "odometer" IS NOT NULL)
  );

-- Index parcial: documento vigente más reciente por tipo
CREATE INDEX "documents_latest_active_idx"
  ON "documents" ("vehicleId", "type", "expiresAt" DESC);
