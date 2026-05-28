// Archivo: /flotillas/api/src/routes/operatorRouter.ts
// NUEVO: Endpoints REST para operadores
import { Router, Request, Response, NextFunction } from 'express';
import { operatorSchema } from '../validators/operatorValidator';
import * as operatorService from '../services/operatorService';
import { roleMiddleware } from '../middlewares/roleMiddleware';

const router = Router();

router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const query = {
      page: req.query.page ? parseInt(req.query.page as string) : 1,
      limit: req.query.limit ? parseInt(req.query.limit as string) : 20,
      search: req.query.search as string | undefined,
    };
    const result = await operatorService.getAllOperators(query);
    res.json(result);
  } catch (error) {
    next(error);
    }
});

router.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: 'ID inválido' });
    const operator = await operatorService.getOperatorById(id);
    res.json(operator);
  } catch (error) {
    next(error);
    }
});

router.post('/', roleMiddleware(['ADMIN', 'SUPERVISOR_VEHICLES']), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = operatorSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: 'Datos inválidos',
        details: parsed.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })),
      });
    }
    const operator = await operatorService.createOperator(parsed.data);
    res.status(201).json(operator);
  } catch (error) {
    next(error);
    }
});

router.put('/:id', roleMiddleware(['ADMIN', 'SUPERVISOR_VEHICLES']), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: 'ID inválido' });

    const parsed = operatorSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: 'Datos inválidos',
        details: parsed.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })),
      });
    }
    const operator = await operatorService.updateOperator(id, parsed.data);
    res.json(operator);
  } catch (error) {
    next(error);
    }
});

router.delete('/:id', roleMiddleware(['ADMIN']), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: 'ID inválido' });
    await operatorService.deleteOperator(id);
    res.json({ message: 'Operador eliminado correctamente' });
  } catch (error) {
    next(error);
    }
});

export default router;