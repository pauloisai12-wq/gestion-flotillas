// Archivo: api/src/routes/dashboardRouter.ts
// Propósito: Endpoints del dashboard con soporte de filtros globales
// REEMPLAZA: contenido anterior completo

import { Router, Request, Response } from 'express';
import * as dashboardService from '../services/dashboardService';
import { DashboardFilters } from '../services/dashboardService';
import { requireRole, RoleGroups } from '../middlewares/roleMiddleware';
import { ah } from '../lib/asyncHandler';

const router = Router();

// Todos los endpoints del dashboard requieren rol con acceso global a la flota.
// Excluye EXECUTOR (acotado a sus vehículos) y WORKSHOP (taller externo).
const requireDashboardAccess = requireRole(RoleGroups.VEHICLE_READERS);

function extractFilters(req: Request): DashboardFilters {
  return {
    vehicleTypeId: req.query.vehicleTypeId ? Number(req.query.vehicleTypeId) : undefined,
    operatorId: req.query.operatorId ? Number(req.query.operatorId) : undefined,
    dateFrom: req.query.dateFrom ? String(req.query.dateFrom) : undefined,
    dateTo: req.query.dateTo ? String(req.query.dateTo) : undefined,
  };
}

router.get(
  '/summary',
  requireDashboardAccess,
  ah(async (req: Request, res: Response) => {
    const summary = await dashboardService.getDashboardSummary(extractFilters(req));
    res.json(summary);
  }),
);

router.get(
  '/fuel-trend',
  requireDashboardAccess,
  ah(async (req: Request, res: Response) => {
    const trend = await dashboardService.getFuelMonthlyTrend(extractFilters(req));
    res.json(trend);
  }),
);

router.get(
  '/vehicle-ranking/top',
  requireDashboardAccess,
  ah(async (req: Request, res: Response) => {
    const limit = Number(req.query.limit) || 10;
    const ranking = await dashboardService.getVehicleRankingTop(limit, extractFilters(req));
    res.json(ranking);
  }),
);

router.get(
  '/vehicle-ranking/bottom',
  requireDashboardAccess,
  ah(async (req: Request, res: Response) => {
    const limit = Number(req.query.limit) || 10;
    const ranking = await dashboardService.getVehicleRankingBottom(limit, extractFilters(req));
    res.json(ranking);
  }),
);

router.get(
  '/operator-ranking',
  requireDashboardAccess,
  ah(async (req: Request, res: Response) => {
    const limit = Number(req.query.limit) || 10;
    const ranking = await dashboardService.getOperatorRanking(limit, extractFilters(req));
    res.json(ranking);
  }),
);

router.get(
  '/budget-progress',
  requireDashboardAccess,
  ah(async (req: Request, res: Response) => {
    const progress = await dashboardService.getBudgetProgress(extractFilters(req));
    res.json(progress);
  }),
);

export default router;
