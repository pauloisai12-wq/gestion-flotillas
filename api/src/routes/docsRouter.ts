// Router para servir la documentación OpenAPI interactiva.
//
//   GET /api/docs        → Swagger UI (interfaz interactiva en navegador)
//   GET /api/docs.json   → spec OpenAPI en JSON (consumible por herramientas)

import { Router } from 'express';
import swaggerUi from 'swagger-ui-express';
import { generateOpenApiDocument } from '../lib/openapi';

const router = Router();

const spec = generateOpenApiDocument();

router.get('/docs.json', (_req, res) => {
  res.json(spec);
});

router.use('/docs', swaggerUi.serve, swaggerUi.setup(spec, {
  customSiteTitle: 'Flotillas API — Docs',
  swaggerOptions: {
    persistAuthorization: true,
    docExpansion: 'list',
  },
}));

export default router;
