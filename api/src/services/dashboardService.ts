// Archivo: api/src/services/dashboardService.ts
// Propósito: Servicios del dashboard con soporte de filtros globales
// REEMPLAZA: contenido anterior completo

import prisma from '../lib/prisma';
import { Prisma } from '@prisma/client';

// Interfaz de filtros
export interface DashboardFilters {
  vehicleTypeId?: number;
  operatorId?: number;
  dateFrom?: string;
  dateTo?: string;
}

function hasFilters(filters: DashboardFilters): boolean {
  return !!(filters.vehicleTypeId || filters.operatorId || filters.dateFrom || filters.dateTo);
}

// ─── Resumen general ───
export async function getDashboardSummary(filters: DashboardFilters = {}) {
  // Sin filtros: leer de vista materializada (rápido)
  if (!hasFilters(filters)) {
    const result = await prisma.$queryRaw<any[]>`
      SELECT * FROM mv_dashboard_summary LIMIT 1
    `;
    if (result.length === 0) return emptyDashboard();
    const row = result[0];
    return {
      totalVehicles: Number(row.total_vehicles),
      operativeVehicles: Number(row.operative_count),
      blockedVehicles: Number(row.blocked_count),
      docsValid: Number(row.docs_valid),
      docsExpiring: Number(row.docs_expiring),
      docsExpired: Number(row.docs_expired),
      monthlySpent: Number(row.monthly_spent),
      monthlyLiters: Number(row.monthly_liters),
      monthlyLoads: Number(row.monthly_loads),
      monthlyAvgKml: Math.round(Number(row.monthly_avg_kml) * 100) / 100,
      refreshedAt: row.refreshed_at,
    };
  }

  // Con filtros: consultar tablas base
  const now = new Date();
  const thirtyDays = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const vehicleWhere: Prisma.VehicleWhereInput = {};
  if (filters.vehicleTypeId) vehicleWhere.vehicleTypeId = filters.vehicleTypeId;

  const fuelWhere: Prisma.FuelLoadWhereInput = {
    loadDate: { gte: filters.dateFrom ? new Date(filters.dateFrom) : monthStart, ...(filters.dateTo ? { lte: new Date(filters.dateTo) } : {}) },
  };
  if (filters.vehicleTypeId) fuelWhere.vehicle = { vehicleTypeId: filters.vehicleTypeId };
  if (filters.operatorId) fuelWhere.operatorId = filters.operatorId;

  const docWhere: Prisma.DocumentWhereInput = {};
  if (filters.vehicleTypeId) docWhere.vehicle = { vehicleTypeId: filters.vehicleTypeId };

  const [totalVehicles, blockedVehicles, docsExpiring, docsExpired, fuelAgg, kmlAgg] = await Promise.all([
    prisma.vehicle.count({ where: { ...vehicleWhere, isActive: true } }),
    prisma.vehicle.count({ where: { ...vehicleWhere, isActive: true, status: 'BLOCKED' } }),
    prisma.document.count({ where: { ...docWhere, expiresAt: { gt: now, lte: thirtyDays } } }),
    prisma.document.count({ where: { ...docWhere, expiresAt: { lte: now } } }),
    prisma.fuelLoad.aggregate({ where: fuelWhere, _count: true, _sum: { amount: true, liters: true } }),
    prisma.fuelLoad.aggregate({ where: { ...fuelWhere, kmPerLiter: { not: null } }, _avg: { kmPerLiter: true } }),
  ]);

  return {
    totalVehicles,
    operativeVehicles: totalVehicles - blockedVehicles,
    blockedVehicles,
    docsValid: 0,
    docsExpiring,
    docsExpired,
    monthlySpent: fuelAgg._sum.amount || 0,
    monthlyLiters: fuelAgg._sum.liters || 0,
    monthlyLoads: fuelAgg._count,
    monthlyAvgKml: kmlAgg._avg.kmPerLiter ? Math.round(kmlAgg._avg.kmPerLiter * 100) / 100 : 0,
    refreshedAt: now,
  };
}

// ─── Tendencia mensual ───
export async function getFuelMonthlyTrend(filters: DashboardFilters = {}) {
  if (!hasFilters(filters)) {
    const result = await prisma.$queryRaw<any[]>`
      SELECT to_char(month, 'YYYY-MM') AS month_label, total_spent, total_liters, total_loads, avg_kml
      FROM mv_fuel_monthly_trend ORDER BY month ASC
    `;
    return result.map(formatTrendRow);
  }

  // Con filtros: consulta parametrizada (segura contra inyección SQL)
  const conds: Prisma.Sql[] = [Prisma.sql`fl."loadDate" >= NOW() - INTERVAL '12 months'`];
  if (filters.vehicleTypeId) conds.push(Prisma.sql`v."vehicleTypeId" = ${Number(filters.vehicleTypeId)}`);
  if (filters.operatorId)    conds.push(Prisma.sql`fl."operatorId" = ${Number(filters.operatorId)}`);
  if (filters.dateFrom)      conds.push(Prisma.sql`fl."loadDate" >= ${new Date(filters.dateFrom)}`);
  if (filters.dateTo)        conds.push(Prisma.sql`fl."loadDate" <= ${new Date(filters.dateTo)}`);

  const where = Prisma.join(conds, ' AND ');

  const result = await prisma.$queryRaw<any[]>`
    SELECT
      to_char(date_trunc('month', fl."loadDate"), 'YYYY-MM') AS month_label,
      SUM(fl.amount) AS total_spent,
      SUM(fl.liters) AS total_liters,
      COUNT(*) AS total_loads,
      AVG(fl."kmPerLiter") FILTER (WHERE fl."kmPerLiter" IS NOT NULL) AS avg_kml
    FROM fuel_loads fl
    JOIN vehicles v ON v.id = fl."vehicleId"
    WHERE ${where}
    GROUP BY date_trunc('month', fl."loadDate")
    ORDER BY date_trunc('month', fl."loadDate") ASC
  `;
  return result.map(formatTrendRow);
}

// ─── Top vehículos ───
export async function getVehicleRankingTop(limit: number = 10, filters: DashboardFilters = {}) {
  if (!hasFilters(filters)) {
    const result = await prisma.$queryRaw<any[]>`
      SELECT * FROM mv_vehicle_ranking WHERE avg_kml IS NOT NULL ORDER BY avg_kml DESC LIMIT ${limit}
    `;
    return result.map(formatRankingRow);
  }
  return queryVehicleRanking(limit, 'DESC', filters);
}

// ─── Bottom vehículos ───
export async function getVehicleRankingBottom(limit: number = 10, filters: DashboardFilters = {}) {
  if (!hasFilters(filters)) {
    const result = await prisma.$queryRaw<any[]>`
      SELECT * FROM mv_vehicle_ranking WHERE avg_kml IS NOT NULL ORDER BY avg_kml ASC LIMIT ${limit}
    `;
    return result.map(formatRankingRow);
  }
  return queryVehicleRanking(limit, 'ASC', filters);
}

// ─── Ranking operadores ───
export async function getOperatorRanking(limit: number = 10, filters: DashboardFilters = {}) {
  if (!hasFilters(filters)) {
    const result = await prisma.$queryRaw<any[]>`
      SELECT * FROM mv_operator_ranking ORDER BY avg_kml DESC LIMIT ${limit}
    `;
    return result.map(formatOperatorRow);
  }

  const conds: Prisma.Sql[] = [Prisma.sql`fl."kmPerLiter" IS NOT NULL`];
  if (filters.vehicleTypeId) conds.push(Prisma.sql`v."vehicleTypeId" = ${Number(filters.vehicleTypeId)}`);
  if (filters.operatorId)    conds.push(Prisma.sql`o.id = ${Number(filters.operatorId)}`);
  if (filters.dateFrom)      conds.push(Prisma.sql`fl."loadDate" >= ${new Date(filters.dateFrom)}`);
  if (filters.dateTo)        conds.push(Prisma.sql`fl."loadDate" <= ${new Date(filters.dateTo)}`);
  if (!filters.dateFrom && !filters.dateTo) conds.push(Prisma.sql`fl."loadDate" >= date_trunc('month', NOW())`);

  const where = Prisma.join(conds, ' AND ');

  const result = await prisma.$queryRaw<any[]>`
    SELECT o.id AS operator_id, o."fullName" AS operator_name,
      AVG(fl."kmPerLiter") AS avg_kml, COUNT(fl.id) AS load_count,
      SUM(fl.amount) AS total_spent, SUM(fl.liters) AS total_liters
    FROM operators o
    JOIN fuel_loads fl ON fl."operatorId" = o.id
    JOIN vehicles v ON v.id = fl."vehicleId"
    WHERE ${where}
    GROUP BY o.id, o."fullName"
    ORDER BY avg_kml DESC LIMIT ${Number(limit)}
  `;
  return result.map(formatOperatorRow);
}

// ─── Presupuesto ───
export async function getBudgetProgress(filters: DashboardFilters = {}) {
  if (!hasFilters(filters)) {
    const result = await prisma.$queryRaw<any[]>`
      SELECT * FROM mv_budget_progress ORDER BY pct_used DESC
    `;
    return result.map(formatBudgetRow);
  }

  const conds: Prisma.Sql[] = [
    Prisma.sql`fb.month = EXTRACT(MONTH FROM NOW())::int`,
    Prisma.sql`fb.year = EXTRACT(YEAR FROM NOW())::int`,
  ];
  if (filters.vehicleTypeId) conds.push(Prisma.sql`v."vehicleTypeId" = ${Number(filters.vehicleTypeId)}`);

  const where = Prisma.join(conds, ' AND ');

  const result = await prisma.$queryRaw<any[]>`
    SELECT vb.id AS vehicle_budget_id, vb."vehicleId" AS vehicle_id,
      v.plate, v."economicNumber" AS eco,
      vb."assignedAmount" AS assigned, vb."spentAmount" AS spent,
      CASE WHEN vb."assignedAmount" > 0 THEN ROUND((vb."spentAmount" / vb."assignedAmount" * 100)::numeric, 1) ELSE 0 END AS pct_used,
      vb."isCutOff" AS is_cut_off
    FROM vehicle_budgets vb
    JOIN vehicles v ON v.id = vb."vehicleId"
    JOIN fuel_budgets fb ON fb.id = vb."budgetId"
    WHERE ${where}
    ORDER BY pct_used DESC
  `;
  return result.map(formatBudgetRow);
}

// ─── Helpers ───
function emptyDashboard() {
  return {
    totalVehicles: 0, operativeVehicles: 0, blockedVehicles: 0,
    docsValid: 0, docsExpiring: 0, docsExpired: 0,
    monthlySpent: 0, monthlyLiters: 0, monthlyLoads: 0, monthlyAvgKml: 0, refreshedAt: null,
  };
}

function formatTrendRow(row: any) {
  return {
    month: row.month_label,
    totalSpent: Number(row.total_spent),
    totalLiters: Number(row.total_liters),
    totalLoads: Number(row.total_loads),
    avgKml: row.avg_kml ? Math.round(Number(row.avg_kml) * 100) / 100 : 0,
  };
}

function formatRankingRow(row: any) {
  return {
    vehicleId: row.vehicle_id, plate: row.plate, eco: row.eco,
    vehicleType: row.vehicle_type, expectedKml: Number(row.expected_kml),
    avgKml: row.avg_kml ? Math.round(Number(row.avg_kml) * 100) / 100 : 0,
    loadCount: Number(row.load_count), deviationPct: Number(row.deviation_pct),
  };
}

function formatOperatorRow(row: any) {
  return {
    operatorId: row.operator_id, operatorName: row.operator_name,
    avgKml: row.avg_kml ? Math.round(Number(row.avg_kml) * 100) / 100 : 0,
    loadCount: Number(row.load_count),
    totalSpent: Number(row.total_spent), totalLiters: Number(row.total_liters),
  };
}

function formatBudgetRow(row: any) {
  return {
    vehicleBudgetId: row.vehicle_budget_id, vehicleId: row.vehicle_id,
    plate: row.plate, eco: row.eco,
    assigned: Number(row.assigned), spent: Number(row.spent),
    pctUsed: Number(row.pct_used), isCutOff: row.is_cut_off,
  };
}

async function queryVehicleRanking(limit: number, direction: 'ASC' | 'DESC', filters: DashboardFilters) {
  const conds: Prisma.Sql[] = [Prisma.sql`fl."kmPerLiter" IS NOT NULL`];
  if (filters.vehicleTypeId) conds.push(Prisma.sql`v."vehicleTypeId" = ${Number(filters.vehicleTypeId)}`);
  if (filters.operatorId)    conds.push(Prisma.sql`fl."operatorId" = ${Number(filters.operatorId)}`);
  if (filters.dateFrom)      conds.push(Prisma.sql`fl."loadDate" >= ${new Date(filters.dateFrom)}`);
  if (filters.dateTo)        conds.push(Prisma.sql`fl."loadDate" <= ${new Date(filters.dateTo)}`);
  if (!filters.dateFrom && !filters.dateTo) conds.push(Prisma.sql`fl."loadDate" >= date_trunc('month', NOW())`);

  const where = Prisma.join(conds, ' AND ');
  // direction es identificador SQL (no valor), no es parametrizable: validamos con whitelist
  const order = direction === 'ASC' ? Prisma.sql`ASC` : Prisma.sql`DESC`;

  const result = await prisma.$queryRaw<any[]>`
    SELECT v.id AS vehicle_id, v.plate, v."economicNumber" AS eco,
      vt.name AS vehicle_type, vt."expectedKmPerLiter" AS expected_kml,
      AVG(fl."kmPerLiter") AS avg_kml, COUNT(fl.id) AS load_count,
      CASE WHEN vt."expectedKmPerLiter" > 0 THEN ROUND(((AVG(fl."kmPerLiter") - vt."expectedKmPerLiter") / vt."expectedKmPerLiter" * 100)::numeric, 1) ELSE 0 END AS deviation_pct
    FROM vehicles v
    JOIN vehicle_types vt ON v."vehicleTypeId" = vt.id
    JOIN fuel_loads fl ON fl."vehicleId" = v.id
    WHERE ${where}
    GROUP BY v.id, v.plate, v."economicNumber", vt.name, vt."expectedKmPerLiter"
    ORDER BY avg_kml ${order} LIMIT ${Number(limit)}
  `;
  return result.map(formatRankingRow);
}