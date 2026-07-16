-- El cierre ya no depende de que exista al menos un VehicleBudget. MonthlyBudget
-- funciona como marcador persistente para impedir escrituras posteriores.
ALTER TABLE "monthly_budgets"
  ADD COLUMN "isClosed" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "closedAt" TIMESTAMP(3);

-- Conserva cierres históricos solo cuando todas las asignaciones conocidas del
-- periodo ya estaban cerradas. Un periodo mixto queda abierto para revisión.
INSERT INTO "monthly_budgets" (
  "kind", "year", "month", "totalAmount", "notes", "createdBy", "updatedBy",
  "isClosed", "closedAt", "createdAt", "updatedAt"
)
SELECT
  "kind", "year", "month", 0, NULL, NULL, NULL,
  true, COALESCE(MAX("closedAt"), CURRENT_TIMESTAMP),
  CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "vehicle_budgets"
GROUP BY "kind", "year", "month"
HAVING BOOL_AND("isClosed")
ON CONFLICT ("kind", "year", "month") DO UPDATE
SET
  "isClosed" = true,
  "closedAt" = COALESCE("monthly_budgets"."closedAt", EXCLUDED."closedAt"),
  "updatedAt" = CURRENT_TIMESTAMP;
