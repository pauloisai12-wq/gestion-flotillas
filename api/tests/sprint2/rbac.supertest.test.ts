import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import {
  RoleGroups,
  Roles,
  roleMiddleware,
} from '../../src/middlewares/roleMiddleware';

const allRoles = Object.values(Roles);

function appFor(allowedRoles: readonly (typeof allRoles)[number][]) {
  const app = express();
  app.get(
    '/resource',
    (req, _res, next) => {
      const role = req.header('x-test-role');
      if (role) {
        req.user = { userId: 1, email: 'test@example.invalid', role: role as never };
      }
      next();
    },
    roleMiddleware(allowedRoles),
    (_req, res) => res.json({ ok: true }),
  );
  return app;
}

describe('RBAC real mediante HTTP', () => {
  it.each([
    ['maintenance', RoleGroups.MAINTENANCE_READERS],
    ['budget', RoleGroups.BUDGET_READERS],
  ] as const)('aplica la matriz negativa de %s para los siete roles', async (_name, allowed) => {
    const app = appFor(allowed);
    for (const role of allRoles) {
      const response = await request(app).get('/resource').set('x-test-role', role);
      expect(response.status, role).toBe(allowed.includes(role) ? 200 : 403);
    }
  });

  it('rechaza una solicitud sin identidad', async () => {
    const response = await request(appFor(RoleGroups.MAINTENANCE_READERS)).get('/resource');
    expect(response.status).toBe(401);
  });
});
