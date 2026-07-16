-- Fail closed: una baja legacy con tickets abiertos no tiene una cancelación
-- financiera inequívoca. Se detiene la migración antes de tocar presupuestos
-- para que Operación resuelva el expediente explícitamente.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM maintenance_tickets mt
    JOIN vehicles v ON v.id = mt."vehicleId"
    WHERE v."isActive" = false
      AND mt.status IN (
        'PENDING_ADMIN_APPROVAL'::"MaintenanceTicketStatus",
        'AWAITING_QUOTES'::"MaintenanceTicketStatus",
        'APPROVED_FOR_REPAIR'::"MaintenanceTicketStatus",
        'IN_REPAIR'::"MaintenanceTicketStatus"
      )
  ) THEN
    RAISE EXCEPTION
      'vehicle_deactivation_policy: existen vehículos inactivos con tickets no terminales';
  END IF;
END $$;

-- La baja lógica libera solamente saldos de periodos abiertos. El gasto ya
-- consumido permanece en la fila y ningún presupuesto cerrado se modifica.
UPDATE vehicle_budgets vb
SET "baseAmount" = LEAST(vb."baseAmount", vb."spentAmount"),
    "rolloverIn" = LEAST(
      vb."rolloverIn",
      GREATEST(vb."spentAmount" - vb."baseAmount", 0)
    ),
    "isCutOff" = true,
    "updatedAt" = NOW()
FROM vehicles v
WHERE v.id = vb."vehicleId"
  AND v."isActive" = false
  AND vb."isClosed" = false;

-- Una asignación vigente no puede seguir operativa para una unidad inactiva;
-- se conserva su historia cerrando el intervalo, sin borrar la relación.
UPDATE vehicle_assignments va
SET "endDate" = NOW(),
    "updatedAt" = NOW()
FROM vehicles v
WHERE v.id = va."vehicleId"
  AND v."isActive" = false
  AND va."endDate" IS NULL;

-- Los indicadores de estado actual excluyen bajas lógicas. Las tendencias y
-- montos históricos de combustible no se reescriben: siguen representando el
-- gasto que realmente ocurrió antes de la baja.
DROP MATERIALIZED VIEW IF EXISTS mv_dashboard_summary;
DROP MATERIALIZED VIEW IF EXISTS mv_vehicle_ranking;
DROP MATERIALIZED VIEW IF EXISTS mv_operator_ranking;
DROP MATERIALIZED VIEW IF EXISTS mv_budget_progress;

CREATE MATERIALIZED VIEW mv_dashboard_summary AS
WITH business_clock AS (
  SELECT (
    date_trunc('month', CURRENT_TIMESTAMP AT TIME ZONE 'America/Mexico_City')
      AT TIME ZONE 'America/Mexico_City'
  ) AT TIME ZONE 'UTC' AS month_start_utc
)
SELECT
  COUNT(*) FILTER (WHERE v.status = 'OPERATIVE') AS operative_count,
  COUNT(*) FILTER (WHERE v.status = 'BLOCKED') AS blocked_count,
  COUNT(*) AS total_vehicles,
  (
    SELECT COUNT(*)
    FROM documents d
    JOIN vehicles dv ON dv.id = d."vehicleId"
    WHERE dv."isActive" = true
      AND d."expiresAt" > NOW() + INTERVAL '30 days'
  ) AS docs_valid,
  (
    SELECT COUNT(*)
    FROM documents d
    JOIN vehicles dv ON dv.id = d."vehicleId"
    WHERE dv."isActive" = true
      AND d."expiresAt" <= NOW() + INTERVAL '30 days'
      AND d."expiresAt" > NOW()
  ) AS docs_expiring,
  (
    SELECT COUNT(*)
    FROM documents d
    JOIN vehicles dv ON dv.id = d."vehicleId"
    WHERE dv."isActive" = true
      AND d."expiresAt" <= NOW()
  ) AS docs_expired,
  (
    SELECT COALESCE(SUM(fl.amount), 0)
    FROM fuel_loads fl
    WHERE fl.status = 'APPROVED'::"FuelLoadStatus"
      AND fl."loadDate" >= (SELECT month_start_utc FROM business_clock)
  ) AS monthly_spent,
  (
    SELECT COALESCE(SUM(fl.liters), 0)
    FROM fuel_loads fl
    WHERE fl.status = 'APPROVED'::"FuelLoadStatus"
      AND fl."loadDate" >= (SELECT month_start_utc FROM business_clock)
  ) AS monthly_liters,
  (
    SELECT COUNT(*)
    FROM fuel_loads fl
    WHERE fl.status = 'APPROVED'::"FuelLoadStatus"
      AND fl."loadDate" >= (SELECT month_start_utc FROM business_clock)
  ) AS monthly_loads,
  (
    SELECT COALESCE(AVG(fl."kmPerLiter"), 0)
    FROM fuel_loads fl
    WHERE fl.status = 'APPROVED'::"FuelLoadStatus"
      AND fl."kmPerLiter" IS NOT NULL
      AND fl."loadDate" >= (SELECT month_start_utc FROM business_clock)
  ) AS monthly_avg_kml,
  NOW() AS refreshed_at
FROM vehicles v
WHERE v."isActive" = true;

CREATE MATERIALIZED VIEW mv_vehicle_ranking AS
WITH business_clock AS (
  SELECT (
    date_trunc('month', CURRENT_TIMESTAMP AT TIME ZONE 'America/Mexico_City')
      AT TIME ZONE 'America/Mexico_City'
  ) AT TIME ZONE 'UTC' AS month_start_utc
)
SELECT
  v.id AS vehicle_id,
  v.plate,
  v."economicNumber" AS eco,
  vt.name AS vehicle_type,
  vt."expectedKmPerLiter" AS expected_kml,
  AVG(fl."kmPerLiter") AS avg_kml,
  COUNT(fl.id) AS load_count,
  CASE
    WHEN vt."expectedKmPerLiter" > 0
      THEN ROUND(((AVG(fl."kmPerLiter") - vt."expectedKmPerLiter") / vt."expectedKmPerLiter" * 100)::numeric, 1)
    ELSE 0
  END AS deviation_pct
FROM vehicles v
JOIN vehicle_types vt ON v."vehicleTypeId" = vt.id
LEFT JOIN fuel_loads fl ON fl."vehicleId" = v.id
  AND fl.status = 'APPROVED'::"FuelLoadStatus"
  AND fl."kmPerLiter" IS NOT NULL
  AND fl."loadDate" >= (SELECT month_start_utc FROM business_clock)
WHERE v."isActive" = true
GROUP BY v.id, v.plate, v."economicNumber", vt.name, vt."expectedKmPerLiter"
ORDER BY avg_kml DESC NULLS LAST;

CREATE MATERIALIZED VIEW mv_operator_ranking AS
WITH business_clock AS (
  SELECT (
    date_trunc('month', CURRENT_TIMESTAMP AT TIME ZONE 'America/Mexico_City')
      AT TIME ZONE 'America/Mexico_City'
  ) AT TIME ZONE 'UTC' AS month_start_utc
)
SELECT
  o.id AS operator_id,
  o."fullName" AS operator_name,
  AVG(fl."kmPerLiter") AS avg_kml,
  COUNT(fl.id) AS load_count,
  SUM(fl.amount) AS total_spent,
  SUM(fl.liters) AS total_liters
FROM operators o
JOIN fuel_loads fl ON fl."operatorId" = o.id
  AND fl.status = 'APPROVED'::"FuelLoadStatus"
  AND fl."kmPerLiter" IS NOT NULL
  AND fl."loadDate" >= (SELECT month_start_utc FROM business_clock)
JOIN vehicles v ON v.id = fl."vehicleId" AND v."isActive" = true
GROUP BY o.id, o."fullName"
ORDER BY avg_kml DESC;

CREATE MATERIALIZED VIEW mv_budget_progress AS
WITH business_period AS (
  SELECT
    EXTRACT(MONTH FROM CURRENT_TIMESTAMP AT TIME ZONE 'America/Mexico_City')::int AS month,
    EXTRACT(YEAR FROM CURRENT_TIMESTAMP AT TIME ZONE 'America/Mexico_City')::int AS year
)
SELECT
  vb.id AS vehicle_budget_id,
  vb."vehicleId" AS vehicle_id,
  v.plate,
  v."economicNumber" AS eco,
  (vb."baseAmount" + vb."rolloverIn")::numeric AS assigned,
  vb."spentAmount"::numeric AS spent,
  CASE
    WHEN (vb."baseAmount" + vb."rolloverIn") > 0
      THEN ROUND((vb."spentAmount" / (vb."baseAmount" + vb."rolloverIn") * 100)::numeric, 1)
    ELSE 0
  END AS pct_used,
  vb."isCutOff" AS is_cut_off,
  vb.month,
  vb.year
FROM vehicle_budgets vb
JOIN vehicles v ON v.id = vb."vehicleId"
WHERE v."isActive" = true
  AND vb.kind = 'FUEL'::"BudgetKind"
  AND vb.month = (SELECT month FROM business_period)
  AND vb.year = (SELECT year FROM business_period);

-- Requeridos por REFRESH MATERIALIZED VIEW CONCURRENTLY.
CREATE UNIQUE INDEX idx_mv_dashboard_summary ON mv_dashboard_summary (refreshed_at);
CREATE UNIQUE INDEX idx_mv_vehicle_ranking ON mv_vehicle_ranking (vehicle_id);
CREATE UNIQUE INDEX idx_mv_operator_ranking ON mv_operator_ranking (operator_id);
CREATE UNIQUE INDEX idx_mv_budget_progress ON mv_budget_progress (vehicle_budget_id);
