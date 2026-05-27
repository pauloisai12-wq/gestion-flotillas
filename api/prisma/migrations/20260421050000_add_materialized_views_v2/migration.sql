-- Vista 1: Resumen general del dashboard
CREATE MATERIALIZED VIEW mv_dashboard_summary AS
SELECT
  COUNT(*) FILTER (WHERE v.status = 'OPERATIVE') AS operative_count,
  COUNT(*) FILTER (WHERE v.status = 'BLOCKED') AS blocked_count,
  COUNT(*) AS total_vehicles,
  (SELECT COUNT(*) FROM documents d WHERE d."expiresAt" > NOW() + INTERVAL '30 days') AS docs_valid,
  (SELECT COUNT(*) FROM documents d WHERE d."expiresAt" <= NOW() + INTERVAL '30 days' AND d."expiresAt" > NOW()) AS docs_expiring,
  (SELECT COUNT(*) FROM documents d WHERE d."expiresAt" <= NOW()) AS docs_expired,
  (SELECT COALESCE(SUM(fl.amount), 0) FROM fuel_loads fl WHERE fl."loadDate" >= date_trunc('month', NOW())) AS monthly_spent,
  (SELECT COALESCE(SUM(fl.liters), 0) FROM fuel_loads fl WHERE fl."loadDate" >= date_trunc('month', NOW())) AS monthly_liters,
  (SELECT COUNT(*) FROM fuel_loads fl WHERE fl."loadDate" >= date_trunc('month', NOW())) AS monthly_loads,
  (SELECT COALESCE(AVG(fl."kmPerLiter"), 0) FROM fuel_loads fl WHERE fl."kmPerLiter" IS NOT NULL AND fl."loadDate" >= date_trunc('month', NOW())) AS monthly_avg_kml,
  NOW() AS refreshed_at
FROM vehicles v;

-- Vista 2: Tendencia mensual de combustible (últimos 12 meses)
CREATE MATERIALIZED VIEW mv_fuel_monthly_trend AS
SELECT
  date_trunc('month', fl."loadDate") AS month,
  SUM(fl.amount) AS total_spent,
  SUM(fl.liters) AS total_liters,
  COUNT(*) AS total_loads,
  AVG(fl."kmPerLiter") FILTER (WHERE fl."kmPerLiter" IS NOT NULL) AS avg_kml
FROM fuel_loads fl
WHERE fl."loadDate" >= NOW() - INTERVAL '12 months'
GROUP BY date_trunc('month', fl."loadDate")
ORDER BY month;

-- Vista 3: Ranking de vehículos por rendimiento km/l (mes actual)
CREATE MATERIALIZED VIEW mv_vehicle_ranking AS
SELECT
  v.id AS vehicle_id,
  v.plate AS plate,
  v."economicNumber" AS eco,
  vt.name AS vehicle_type,
  vt."expectedKmPerLiter" AS expected_kml,
  AVG(fl."kmPerLiter") AS avg_kml,
  COUNT(fl.id) AS load_count,
  CASE
    WHEN vt."expectedKmPerLiter" > 0 THEN ROUND(((AVG(fl."kmPerLiter") - vt."expectedKmPerLiter") / vt."expectedKmPerLiter" * 100)::numeric, 1)
    ELSE 0
  END AS deviation_pct
FROM vehicles v
JOIN vehicle_types vt ON v."vehicleTypeId" = vt.id
LEFT JOIN fuel_loads fl ON fl."vehicleId" = v.id
  AND fl."kmPerLiter" IS NOT NULL
  AND fl."loadDate" >= date_trunc('month', NOW())
GROUP BY v.id, v.plate, v."economicNumber", vt.name, vt."expectedKmPerLiter"
ORDER BY avg_kml DESC NULLS LAST;

-- Vista 4: Ranking de operadores por rendimiento km/l (mes actual)
CREATE MATERIALIZED VIEW mv_operator_ranking AS
SELECT
  o.id AS operator_id,
  o."fullName" AS operator_name,
  AVG(fl."kmPerLiter") AS avg_kml,
  COUNT(fl.id) AS load_count,
  SUM(fl.amount) AS total_spent,
  SUM(fl.liters) AS total_liters
FROM operators o
JOIN fuel_loads fl ON fl."operatorId" = o.id
  AND fl."kmPerLiter" IS NOT NULL
  AND fl."loadDate" >= date_trunc('month', NOW())
GROUP BY o.id, o."fullName"
ORDER BY avg_kml DESC;

-- Vista 5: Avance del presupuesto FUEL (v2 — unificado sin fuel_budgets)
CREATE MATERIALIZED VIEW mv_budget_progress AS
SELECT
  vb.id AS vehicle_budget_id,
  vb."vehicleId" AS vehicle_id,
  v.plate AS plate,
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
WHERE vb.kind = 'FUEL'::"BudgetKind"
  AND vb.month = EXTRACT(MONTH FROM NOW())::int
  AND vb.year = EXTRACT(YEAR FROM NOW())::int;

-- Índices únicos para permitir REFRESH CONCURRENTLY
CREATE UNIQUE INDEX idx_mv_dashboard_summary ON mv_dashboard_summary (refreshed_at);
CREATE UNIQUE INDEX idx_mv_fuel_monthly_trend ON mv_fuel_monthly_trend (month);
CREATE UNIQUE INDEX idx_mv_vehicle_ranking ON mv_vehicle_ranking (vehicle_id);
CREATE UNIQUE INDEX idx_mv_operator_ranking ON mv_operator_ranking (operator_id);
CREATE UNIQUE INDEX idx_mv_budget_progress ON mv_budget_progress (vehicle_budget_id);