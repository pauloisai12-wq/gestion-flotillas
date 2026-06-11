// Endpoints REST para operadores
import { Router, Request, Response } from 'express';
import { operatorSchema, OperatorInput } from '../validators/operatorValidator';
import * as operatorService from '../services/operatorService';
import { roleMiddleware, RoleGroups } from '../middlewares/roleMiddleware';
import { ah } from '../lib/asyncHandler';
import { validateBody } from '../middlewares/validate';
import { parseId, parsePagination } from '../lib/http';

const router = Router();

router.get('/', roleMiddleware(RoleGroups.VEHICLE_READERS), ah(async (req: Request, res: Response) => {
  const { page, limit } = parsePagination(req);
  const result = await operatorService.getAllOperators({
    page,
    limit,
    search: req.query.search as string | undefined,
  });
  res.json(result);
}));

router.get('/:id', roleMiddleware(RoleGroups.VEHICLE_READERS), ah(async (req: Request, res: Response) => {
  const id = parseId(req);
  const operator = await operatorService.getOperatorById(id);
  res.json(operator);
}));

router.post('/', roleMiddleware(['ADMIN', 'SUPERVISOR_VEHICLES']), validateBody(operatorSchema), ah(async (req: Request, res: Response) => {
  const operator = await operatorService.createOperator(req.body as OperatorInput);
  res.status(201).json(operator);
}));

router.put('/:id', roleMiddleware(['ADMIN', 'SUPERVISOR_VEHICLES']), validateBody(operatorSchema), ah(async (req: Request, res: Response) => {
  const id = parseId(req);
  const operator = await operatorService.updateOperator(id, req.body as OperatorInput);
  res.json(operator);
}));

router.delete('/:id', roleMiddleware(['ADMIN']), ah(async (req: Request, res: Response) => {
  const id = parseId(req);
  await operatorService.deleteOperator(id);
  res.json({ message: 'Operador eliminado correctamente' });
}));

export default router;
