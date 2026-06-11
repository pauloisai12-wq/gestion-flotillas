// Endpoints CRUD para el catálogo de servicios de mantenimiento.
// ADMIN puede crear/editar/eliminar. SUPERVISOR puede consultar.

import { Router, Request, Response } from 'express';
import { roleMiddleware } from '../middlewares/roleMiddleware';
import {
  serviceCatalogSchema,
  serviceCatalogQuerySchema,
  ServiceCatalogInput,
  ServiceCatalogQuery,
} from '../validators/serviceCatalogValidator';
import * as serviceCatalogService from '../services/serviceCatalogService';
import { ah } from '../lib/asyncHandler';
import { validateBody, validateQuery } from '../middlewares/validate';
import { parseId, ensureFound } from '../lib/http';

const router = Router();

// GET /api/service-catalog — Listar todos (filtro opcional por tipo de vehículo)
router.get(
  '/',
  validateQuery(serviceCatalogQuerySchema),
  ah(async (req: Request, res: Response) => {
    const { vehicleTypeId } = req.query as unknown as ServiceCatalogQuery;
    const services = await serviceCatalogService.getAll(vehicleTypeId);
    res.json({ data: services });
  }),
);

// GET /api/service-catalog/:id — Obtener por ID
router.get(
  '/:id',
  ah(async (req: Request, res: Response) => {
    const id = parseId(req);
    const service = ensureFound(await serviceCatalogService.getById(id), 'Servicio');
    res.json({ data: service });
  }),
);

// POST /api/service-catalog — Crear (solo ADMIN)
router.post(
  '/',
  roleMiddleware(['ADMIN']),
  validateBody(serviceCatalogSchema),
  ah(async (req: Request, res: Response) => {
    const service = await serviceCatalogService.create(req.body as ServiceCatalogInput);
    res.status(201).json({ data: service });
  }),
);

// PUT /api/service-catalog/:id — Actualizar (solo ADMIN)
router.put(
  '/:id',
  roleMiddleware(['ADMIN']),
  validateBody(serviceCatalogSchema),
  ah(async (req: Request, res: Response) => {
    const id = parseId(req);
    const service = await serviceCatalogService.update(id, req.body as ServiceCatalogInput);
    res.json({ data: service });
  }),
);

// DELETE /api/service-catalog/:id — Eliminar (solo ADMIN)
router.delete(
  '/:id',
  roleMiddleware(['ADMIN']),
  ah(async (req: Request, res: Response) => {
    const id = parseId(req);
    await serviceCatalogService.remove(id);
    res.json({ message: 'Servicio eliminado correctamente' });
  }),
);

export default router;
