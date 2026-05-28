// Wrapper para handlers async en Express 4.
// Express 4 NO propaga excepciones async a next(err) automáticamente
// (Express 5 sí). Sin este wrapper, un throw deja la respuesta colgada
// hasta el timeout y nunca llega al errorHandler global.
//
// Uso:
//   router.get('/foo', asyncHandler(async (req, res) => {
//     const data = await service.foo();
//     res.json(data);                  // si esto throws → next(err) automático
//   }));

import { Request, Response, NextFunction, RequestHandler } from 'express';

type AsyncFn = (req: Request, res: Response, next: NextFunction) => Promise<unknown>;

export const asyncHandler =
  (fn: AsyncFn): RequestHandler =>
  (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };

// Alias corto para mantener los routers legibles
export const ah = asyncHandler;
