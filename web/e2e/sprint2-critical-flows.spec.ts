import { expect, test, type Page, type Route } from '@playwright/test';

type JsonValue = Record<string, unknown> | unknown[];

async function json(route: Route, body: JsonValue, status = 200) {
  await route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
  });
}

async function authenticatedPage(
  page: Page,
  user: { id: number; email: string; fullName: string; role: string; isActive: boolean },
) {
  await page.context().addCookies([
    {
      name: 'token',
      value: 'e2e-session',
      url: 'http://127.0.0.1:3100',
      httpOnly: true,
      sameSite: 'Strict',
    },
  ]);

  return user;
}

test('login envía credenciales y entra al panel', async ({ page }) => {
  const user = {
    id: 1,
    email: 'admin@flotillas.test',
    fullName: 'Admin E2E',
    role: 'ADMIN',
    isActive: true,
  };
  await authenticatedPage(page, user);

  let loginBody: unknown;
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;

    if (pathname === '/api/auth/me') return json(route, { error: 'Sin sesión' }, 401);
    if (pathname === '/api/auth/login' && request.method() === 'POST') {
      loginBody = request.postDataJSON();
      return json(route, { data: { user } });
    }
    if (pathname === '/api/notifications/count') {
      return json(route, { data: { unreadCount: 0 } });
    }
    if (pathname === '/api/notifications') {
      return json(route, {
        data: [],
        unreadCount: 0,
        pagination: { page: 1, limit: 20, total: 0, totalPages: 0 },
      });
    }
    return json(route, { data: [] });
  });

  await page.goto('/login');
  await page.getByPlaceholder('admin@flotillas.com').fill('admin@flotillas.test');
  await page.locator('input[type="password"]').fill('Clave-segura-123');
  await page.getByRole('button', { name: 'Iniciar sesión' }).click();

  await expect.poll(() => loginBody).toEqual({
    email: 'admin@flotillas.test',
    password: 'Clave-segura-123',
  });
  await expect(page).toHaveURL(/\/dashboard(?:\/global)?$/);
});

test('operador registra una carga de combustible desde móvil', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  let submittedLoad: Record<string, unknown> | undefined;

  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;

    if (pathname === '/api/auth/me') return json(route, { error: 'Sin sesión' }, 401);
    if (pathname === '/api/public/session-token') return json(route, { csrfToken: 'csrf-e2e' });
    if (pathname === '/api/public/stations') {
      return json(route, { data: [{ id: 3, legalName: 'Estación Centro', tradeName: 'Centro' }] });
    }
    if (pathname === '/api/public/verify') {
      return json(route, {
        vehicle: {
          id: 9,
          plate: 'ABC-123-A',
          economicNumber: 'ECO-0009',
          classification: 'ESTATAL',
          type: 'Pickup',
        },
        operator: { fullName: 'Operador Campo' },
        budget: { base: 2_000, rollover: 0, spent: 1_000, available: 1_000, cutOff: false },
      });
    }
    if (pathname === '/api/public/fuel-loads' && request.method() === 'POST') {
      submittedLoad = request.postDataJSON() as Record<string, unknown>;
      return json(route, { data: { folio: 4321, available: 850 } });
    }
    return json(route, { data: [] });
  });

  await page.goto('/cargas/registro-rapido');
  await page.getByPlaceholder('EMP-00001').fill('EMP-00007');
  await page.getByPlaceholder('ECO-0001').fill('ECO-0009');
  await page.getByRole('button', { name: 'Verificar' }).click();

  await expect(page.getByText('Operador Campo')).toBeVisible();
  await page.locator('form select').selectOption('3');
  const numberInputs = page.locator('form input[type="number"]');
  await numberInputs.nth(0).fill('150');
  await numberInputs.nth(2).fill('12345');
  await page.getByRole('button', { name: 'Registrar carga' }).click();

  await expect(page.getByRole('heading', { name: 'Carga registrada' })).toBeVisible();
  await expect(page.getByText('#4321')).toBeVisible();
  expect(submittedLoad).toMatchObject({
    csrfToken: 'csrf-e2e',
    vehicleEconomicNumber: 'ECO-0009',
    operatorEmployee: 'EMP-00007',
    stationId: 3,
    amount: 150,
    odometer: 12345,
  });
});

test('ejecutor crea un ticket para una unidad asignada', async ({ page }) => {
  const user = await authenticatedPage(page, {
    id: 7,
    email: 'ejecutor@flotillas.test',
    fullName: 'Ejecutor E2E',
    role: 'EXECUTOR',
    isActive: true,
  });
  let ticketBody: unknown;

  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;

    if (pathname === '/api/auth/me') return json(route, { data: user });
    if (pathname === '/api/vehicles' && request.method() === 'GET') {
      return json(route, {
        data: [{
          id: 9,
          economicNumber: 'ECO-0009',
          plate: 'ABC-123-A',
          brand: 'Ford',
          model: 'Ranger',
          year: 2024,
        }],
        pagination: { page: 1, limit: 100, total: 1, totalPages: 1 },
      });
    }
    if (pathname === '/api/maintenance-tickets' && request.method() === 'POST') {
      ticketBody = request.postDataJSON();
      return json(route, { id: 77, status: 'PENDING_ADMIN_APPROVAL' });
    }
    if (pathname === '/api/maintenance-tickets/77' && request.method() === 'GET') {
      return json(route, {
        id: 77,
        vehicleId: 9,
        vehicle: {
          id: 9,
          economicNumber: 'ECO-0009',
          plate: 'ABC-123-A',
          brand: 'Ford',
          model: 'Ranger',
          year: 2024,
        },
        requestedById: 7,
        requestedBy: { id: 7, fullName: 'Ejecutor E2E' },
        failureCategory: 'OTHER',
        description: 'Los frenos chillan al detener la unidad.',
        reportedOdometer: null,
        odometerStatus: 'OK',
        status: 'PENDING_ADMIN_APPROVAL',
        rejectionReason: null,
        rejectedAt: null,
        rejectedById: null,
        finalConcept: null,
        selectedQuoteId: null,
        approvedByAdminId: null,
        approvedAt: null,
        repairStartedAt: null,
        repairCompletedAt: null,
        completedRecordId: null,
        quotes: [],
        attachments: [],
        createdAt: '2026-07-15T12:00:00.000Z',
        updatedAt: '2026-07-15T12:00:00.000Z',
      });
    }
    if (pathname === '/api/notifications/count') {
      return json(route, { data: { unreadCount: 0 } });
    }
    if (pathname === '/api/notifications') {
      return json(route, {
        data: [],
        unreadCount: 0,
        pagination: { page: 1, limit: 20, total: 0, totalPages: 0 },
      });
    }
    return json(route, { data: [] });
  });

  await page.goto('/tickets/nuevo');
  await expect(page.getByRole('heading', { name: 'Nueva solicitud de reparación' })).toBeVisible();
  await page.locator('form select').selectOption('9');
  await page.locator('textarea').fill('Los frenos chillan al detener la unidad.');
  await page.getByRole('button', { name: 'Enviar solicitud' }).click();

  await expect.poll(() => ticketBody).toMatchObject({
    vehicleId: 9,
    failureCategory: 'OTHER',
    description: 'Los frenos chillan al detener la unidad.',
    reportedOdometer: null,
  });
  await expect(page).toHaveURL(/\/tickets\/77$/);
});

test('admin distribuye un presupuesto a más de 100 vehículos', async ({ page }) => {
  const user = await authenticatedPage(page, {
    id: 1,
    email: 'admin@flotillas.test',
    fullName: 'Admin E2E',
    role: 'ADMIN',
    isActive: true,
  });
  let distributionBody: unknown;

  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;

    if (pathname === '/api/auth/me') return json(route, { data: user });
    if (pathname === '/api/budgets') return json(route, { data: [] });
    if (pathname === '/api/budgets/monthly-pool') {
      return json(route, {
        data: {
          totalPool: 500_000,
          assigned: 0,
          rollover: 0,
          spent: 0,
          unassigned: 500_000,
          pctAssigned: 0,
          unitsCount: 101,
          notes: null,
          hasPool: true,
        },
      });
    }
    if (pathname === '/api/budgets/distribution-targets') {
      return json(route, {
        data: {
          all: 101,
          unassigned: 101,
          byClassification: { POLICIAL: 30, ESTATAL: 50, VIAL: 21 },
        },
      });
    }
    if (pathname === '/api/budgets/distribute-target' && request.method() === 'POST') {
      distributionBody = request.postDataJSON();
      return json(route, { data: { count: 101, totalAmount: 500_000 } });
    }
    if (pathname === '/api/notifications/count') {
      return json(route, { data: { unreadCount: 0 } });
    }
    if (pathname === '/api/notifications') {
      return json(route, {
        data: [],
        unreadCount: 0,
        pagination: { page: 1, limit: 20, total: 0, totalPages: 0 },
      });
    }
    return json(route, { data: [] });
  });

  await page.goto('/budget/fuel');
  await expect(page.getByRole('heading', { name: 'Presupuesto de combustible' })).toBeVisible();
  await page.getByRole('button', { name: 'Asignar a todos' }).click();
  await expect(page.getByText('101 vehículos activos seleccionados')).toBeVisible();
  await page.getByPlaceholder('500000').fill('500000');
  await page.getByRole('button', { name: 'Confirmar asignación' }).click();

  await expect.poll(() => distributionBody).toMatchObject({
    kind: 'FUEL',
    target: { mode: 'ALL' },
    allocation: { mode: 'TOTAL', amount: 500_000 },
  });
  await expect(page.getByText('Presupuesto asignado a 101 vehículos')).toBeVisible();
});

test('admin reconcilia una carga histórica con corrección atómica de odómetro', async ({ page }) => {
  const user = await authenticatedPage(page, {
    id: 1,
    email: 'admin@flotillas.test',
    fullName: 'Admin E2E',
    role: 'ADMIN',
    isActive: true,
  });
  let reconciliationBody: unknown;

  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;

    if (pathname === '/api/auth/me') return json(route, { data: user });
    if (pathname === '/api/stations') return json(route, []);
    if (pathname === '/api/fuel-loads/41/reconcile' && request.method() === 'PATCH') {
      reconciliationBody = request.postDataJSON();
      return json(route, {
        id: 41,
        status: 'REJECTED',
        odometerCorrection: { before: 120, after: 100, evidenceFloor: 95 },
      });
    }
    if (pathname === '/api/fuel-loads') {
      return json(route, {
        data: [{
          id: 41,
          vehicleId: 7,
          operatorId: 11,
          operatorNameRaw: null,
          operatorEmployeeRaw: 'EMP-11',
          stationId: 3,
          liters: 10,
          amount: 150,
          odometer: 120,
          odometerStatus: 'OK',
          kmPerLiter: null,
          isApproved: true,
          status: 'PENDING_REVIEW',
          reviewedAt: null,
          reviewReason: null,
          requiresReconciliation: true,
          loadDate: '2026-07-14T20:00:00.000Z',
          vehicle: {
            id: 7,
            plate: 'ABC-123',
            economicNumber: 'ECO-007',
            classification: 'ESTATAL',
            vehicleType: { expectedKmPerLiter: 8 },
          },
          operator: { id: 11, fullName: 'Operador Histórico', employeeNumber: 'EMP-11' },
          station: { id: 3, legalName: 'Estación Centro', tradeName: 'Centro', isActive: true },
        }],
        pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
      });
    }
    if (pathname === '/api/notifications/count') {
      return json(route, { data: { unreadCount: 0 } });
    }
    if (pathname === '/api/notifications') {
      return json(route, {
        data: [],
        unreadCount: 0,
        pagination: { page: 1, limit: 20, total: 0, totalPages: 0 },
      });
    }
    return json(route, { data: [] });
  });

  await page.goto('/fuel');
  await page.getByRole('button', { name: 'Reconciliar' }).click();
  await expect(page.getByRole('heading', { name: 'Reconciliar carga histórica' })).toBeVisible();
  await page.getByLabel('Decisión final').selectOption('REJECT');
  await page.getByLabel('Efecto histórico en presupuesto').selectOption('NO_BUDGET');
  await page.getByLabel('Efecto histórico en odómetro').selectOption('APPLIED');
  await page.getByLabel('Odómetro maestro corregido').fill('100');
  await page.getByLabel('Evidencia y motivo').fill('Comprobante histórico contrastado con bitácora física.');
  await page.getByRole('button', { name: 'Confirmar reconciliación' }).click();

  await expect.poll(() => reconciliationBody).toEqual({
    decision: 'REJECT',
    budgetEffect: 'NO_BUDGET',
    odometerEffect: 'APPLIED',
    correctedOdometer: 100,
    reason: 'Comprobante histórico contrastado con bitácora física.',
  });
});
