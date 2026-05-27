// api/src/routes/serviceCatalogRouter.ts
// Endpoints CRUD para el catálogo de servicios de mantenimiento.
// ADMIN puede crear/editar/eliminar. SUPERVISOR puede consultar.

import { Router, Request, Response } from 'express';
import { roleMiddleware } from '../middlewares/roleMiddleware';
import { serviceCatalogSchema } from '../validators/serviceCatalogValidator';
import * as serviceCatalogService from '../services/serviceCatalogService';

const router = Router();

// GET /api/service-catalog — Listar todos (filtro opcional por tipo de vehículo)
router.get('/', async function(req: Request, res: Response) {
  try {
    const vehicleTypeId = req.query.vehicleTypeId
      ? parseInt(req.query.vehicleTypeId as string)
      : undefined;

    const services = await serviceCatalogService.getAll(vehicleTypeId);
    res.json({ data: services });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/service-catalog/:id — Obtener por ID
router.get('/:id', async function(req: Request, res: Response) {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: 'ID inválido' });

    const service = await serviceCatalogService.getById(id);
    if (!service) return res.status(404).json({ error: 'Servicio no encontrado' });

    res.json({ data: service });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/service-catalog — Crear (solo ADMIN)
router.post('/', roleMiddleware(['ADMIN']), async function(req: Request, res: Response) {
  try {
    const parsed = serviceCatalogSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: 'Datos inválidos',
        details: parsed.error.issues.map(function(i) {
          return { field: i.path.join('.'), message: i.message };
        }),
      });
    }

    const service = await serviceCatalogService.create(parsed.data);
    res.status(201).json({ data: service });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// PUT /api/service-catalog/:id — Actualizar (solo ADMIN)
router.put('/:id', roleMiddleware(['ADMIN']), async function(req: Request, res: Response) {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: 'ID inválido' });

    const parsed = serviceCatalogSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: 'Datos inválidos',
        details: parsed.error.issues.map(function(i) {
          return { field: i.path.join('.'), message: i.message };
        }),
      });
    }

    const service = await serviceCatalogService.update(id, parsed.data);
    res.json({ data: service });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// DELETE /api/service-catalog/:id — Eliminar (solo ADMIN)
router.delete('/:id', roleMiddleware(['ADMIN']), async function(req: Request, res: Response) {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: 'ID inválido' });

    await serviceCatalogService.remove(id);
    res.json({ message: 'Servicio eliminado correctamente' });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

export default router;