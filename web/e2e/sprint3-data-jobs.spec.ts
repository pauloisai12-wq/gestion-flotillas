import { expect, test, type Page, type Route } from '@playwright/test';

type JsonValue = Record<string, unknown> | unknown[];

async function json(route: Route, body: JsonValue, status = 200) {
  await route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
  });
}

async function authenticate(page: Page, role: string) {
  await page.context().addCookies([{
    name: 'token',
    value: 'sprint3-session',
    url: 'http://127.0.0.1:3100',
    httpOnly: true,
    sameSite: 'Strict',
  }]);
  return {
    id: 1,
    email: `${role.toLowerCase()}@flotillas.test`,
    fullName: `Usuario ${role}`,
    role,
    isActive: true,
  };
}

async function observeNativeDownload(page: Page) {
  await page.evaluate(() => {
    document.addEventListener('click', (event) => {
      if (!(event.target instanceof HTMLAnchorElement) || !event.target.download) return;
      event.preventDefault();
      void fetch(event.target.href, { credentials: 'include' });
    }, { capture: true });
  });
}

test('exportación QA se encola, reporta progreso y habilita descarga', async ({ page }) => {
  const user = await authenticate(page, 'REVISOR_QA');
  let activeReads = 0;
  let statusReads = 0;
  let downloadHeadRequested = false;
  let downloadGetRequested = false;

  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    if (pathname === '/api/auth/me') return json(route, { data: user });
    if (pathname === '/api/qa-externa-registros' && request.method() === 'GET') {
      return json(route, {
        data: [],
        pagination: { page: 1, limit: 20, total: 0, totalPages: 0 },
      });
    }
    if (pathname === '/api/qa-externa-registros/exports/active' && request.method() === 'GET') {
      activeReads += 1;
      return json(route, { data: null });
    }
    if (pathname === '/api/qa-externa-registros/exports' && request.method() === 'POST') {
      return json(route, {
        data: {
          id: 41,
          type: 'QA_EXPORT',
          status: 'QUEUED',
          progress: 0,
          artifactName: null,
          artifactSize: null,
          result: null,
          errorMessage: null,
          completedAt: null,
          expiresAt: '2026-07-22T12:00:00.000Z',
        },
      }, 202);
    }
    if (pathname === '/api/qa-externa-registros/exports/41/download') {
      if (request.method() === 'HEAD') downloadHeadRequested = true;
      if (request.method() === 'GET') downloadGetRequested = true;
      return route.fulfill({
        status: 200,
        headers: {
          'content-type': 'application/zip',
          'content-disposition': 'attachment; filename="evidencias-buffalo.zip"',
        },
        body: request.method() === 'HEAD' ? undefined : 'ZIP-E2E',
      });
    }
    if (pathname === '/api/qa-externa-registros/exports/41') {
      statusReads += 1;
      const completed = statusReads >= 2;
      return json(route, {
        data: {
          id: 41,
          type: 'QA_EXPORT',
          status: completed ? 'COMPLETED' : 'PROCESSING',
          progress: completed ? 100 : 55,
          artifactName: completed ? 'evidencias-buffalo.zip' : null,
          artifactSize: completed ? 2048 : null,
          result: completed ? { records: 25 } : null,
          errorMessage: null,
          completedAt: completed ? '2026-07-15T12:00:00.000Z' : null,
          expiresAt: '2026-07-22T12:00:00.000Z',
        },
      });
    }
    return json(route, { data: [] });
  });

  await page.goto('/revision');
  await page.getByLabel('Desde').fill('2026-07-01');
  await page.getByLabel('Hasta').fill('2026-07-15');
  await page.getByRole('button', { name: 'Generar ZIP' }).click();

  await expect.poll(() => page.evaluate(() => sessionStorage.getItem('flotillas.pendingQaExport')))
    .toContain('41');
  await page.reload();
  await expect(page.getByLabel('Desde')).toHaveValue('2026-07-01');
  await expect(page.getByLabel('Hasta')).toHaveValue('2026-07-15');

  await expect(page.getByText('Exportación lista')).toBeVisible({ timeout: 10_000 });
  await observeNativeDownload(page);
  await page.getByRole('button', { name: 'Descargar BUFFALO (ZIP)' }).click();
  await expect.poll(() => downloadHeadRequested).toBe(true);
  await expect.poll(() => downloadGetRequested).toBe(true);
  expect(activeReads).toBe(1);
});

test('exportación QA se recupera del servidor sin sessionStorage', async ({ page }) => {
  const user = await authenticate(page, 'REVISOR_QA');
  let activeReads = 0;
  let postAttempts = 0;

  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    if (pathname === '/api/auth/me') return json(route, { data: user });
    if (pathname === '/api/qa-externa-registros' && request.method() === 'GET') {
      return json(route, {
        data: [],
        pagination: { page: 1, limit: 20, total: 0, totalPages: 0 },
      });
    }
    if (pathname === '/api/qa-externa-registros/exports/active' && request.method() === 'GET') {
      activeReads += 1;
      return json(route, {
        data: {
          id: 42,
          type: 'QA_EXPORT',
          status: 'QUEUED',
          progress: 0,
          artifactName: null,
          artifactSize: null,
          result: null,
          errorMessage: null,
          completedAt: null,
          expiresAt: '2026-07-22T12:00:00.000Z',
        },
      });
    }
    if (pathname === '/api/qa-externa-registros/exports' && request.method() === 'POST') {
      postAttempts += 1;
      return json(route, { error: 'No debía crearse otro trabajo' }, 409);
    }
    if (pathname === '/api/qa-externa-registros/exports/42') {
      return json(route, {
        data: {
          id: 42,
          type: 'QA_EXPORT',
          status: 'COMPLETED',
          progress: 100,
          artifactName: 'evidencias-recuperadas.zip',
          artifactSize: 4096,
          result: { records: 12 },
          errorMessage: null,
          completedAt: '2026-07-15T12:00:00.000Z',
          expiresAt: '2026-07-22T12:00:00.000Z',
        },
      });
    }
    return json(route, { data: [] });
  });

  await page.goto('/revision');
  await expect(page.getByText('Exportación lista')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole('button', { name: 'Descargar exportación (ZIP)' })).toBeVisible();
  await expect.poll(() => page.evaluate(() => sessionStorage.getItem('flotillas.pendingQaExport')))
    .toContain('42');
  expect(activeReads).toBe(1);
  expect(postAttempts).toBe(0);
});

test('exportación ZIP de encuestas conserva filtros, progresa y se reanuda', async ({ page }) => {
  const user = await authenticate(page, 'REVISOR_QA');
  let statusReads = 0;
  let downloadHeadRequested = false;
  let downloadGetRequested = false;
  let postedFilters = '';

  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const pathname = url.pathname;
    if (pathname === '/api/auth/me') return json(route, { data: user });
    if (pathname === '/api/encuestas' && request.method() === 'GET') {
      return json(route, {
        data: [],
        pagination: { page: 1, limit: 20, total: 0, totalPages: 0 },
      });
    }
    if (pathname === '/api/encuestas/exports/active' && request.method() === 'GET') {
      return json(route, { data: null });
    }
    if (pathname === '/api/encuestas/exports' && request.method() === 'POST') {
      postedFilters = url.searchParams.toString();
      return json(route, {
        data: {
          id: 81,
          type: 'ENCUESTAS_EXPORT',
          status: 'QUEUED',
          progress: 0,
          artifactName: null,
          artifactSize: null,
          result: null,
          errorMessage: null,
          completedAt: null,
          expiresAt: '2026-08-26T12:00:00.000Z',
        },
      }, 202);
    }
    if (pathname === '/api/encuestas/exports/81/download') {
      if (request.method() === 'HEAD') downloadHeadRequested = true;
      if (request.method() === 'GET') downloadGetRequested = true;
      return route.fulfill({
        status: 200,
        headers: {
          'content-type': 'application/zip',
          'content-disposition':
            'attachment; filename="encuestas-2026-08-01_2026-08-15-sin-audio.zip"',
        },
        body: request.method() === 'HEAD' ? undefined : 'ZIP-ENCUESTAS-E2E',
      });
    }
    if (pathname === '/api/encuestas/exports/81') {
      statusReads += 1;
      const completed = statusReads >= 2;
      return json(route, {
        data: {
          id: 81,
          type: 'ENCUESTAS_EXPORT',
          status: completed ? 'COMPLETED' : 'PROCESSING',
          progress: completed ? 100 : 60,
          artifactName: completed
            ? 'encuestas-2026-08-01_2026-08-15-sin-audio.zip'
            : null,
          artifactSize: completed ? 4096 : null,
          result: completed ? { records: 4, audios: 0 } : null,
          errorMessage: null,
          completedAt: completed ? '2026-08-25T12:00:00.000Z' : null,
          expiresAt: '2026-08-26T12:00:00.000Z',
        },
      });
    }
    return json(route, { data: [] });
  });

  await page.goto('/revision/encuestas');
  await page.getByLabel('Desde').fill('2026-08-01');
  await page.getByLabel('Hasta').fill('2026-08-15');
  await page.getByLabel('Estado').selectOption('noElegible');
  await page.getByRole('button', { name: 'Sin audio' }).click();
  await page.getByRole('button', { name: 'Descargar todo (ZIP)' }).click();

  expect(postedFilters).toContain('estado=noElegible');
  expect(postedFilters).toContain('conAudio=false');
  await expect.poll(() => page.evaluate(
    () => sessionStorage.getItem('flotillas.pendingEncuestasExport'),
  )).toContain('81');
  await page.reload();
  await expect(page.getByLabel('Desde')).toHaveValue('2026-08-01');
  await expect(page.getByLabel('Hasta')).toHaveValue('2026-08-15');
  await expect(page.getByLabel('Estado')).toHaveValue('noElegible');
  await expect(page.getByRole('button', { name: 'Sin audio' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.getByText('ZIP listo')).toBeVisible({ timeout: 10_000 });

  await observeNativeDownload(page);
  await page.getByRole('button', { name: 'Descargar todo (ZIP)' }).click();
  await expect.poll(() => downloadHeadRequested).toBe(true);
  await expect.poll(() => downloadGetRequested).toBe(true);
});

test('la descarga de reportes valida y transmite sin construir un Blob', async ({ page }) => {
  const user = await authenticate(page, 'ADMIN');
  let downloadHeadRequested = false;
  let downloadGetRequested = false;

  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    if (pathname === '/api/auth/me') return json(route, { data: user });
    if (pathname === '/api/reports' && request.method() === 'GET') {
      return json(route, {
        data: [{
          id: 71,
          month: 6,
          year: 2026,
          pdfPath: '/reports/reporte_71.pdf',
          excelPath: null,
          pdfSize: 4096,
          excelSize: null,
          status: 'COMPLETED',
          requestedBy: 'admin@flotillas.test',
          errorMessage: null,
          startedAt: '2026-07-15T12:00:00.000Z',
          completedAt: '2026-07-15T12:01:00.000Z',
          createdAt: '2026-07-15T12:00:00.000Z',
        }],
        pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
      });
    }
    if (pathname === '/api/reports/71/download/pdf') {
      if (request.method() === 'HEAD') downloadHeadRequested = true;
      if (request.method() === 'GET') downloadGetRequested = true;
      return route.fulfill({
        status: 200,
        headers: {
          'content-type': 'application/pdf',
          'content-disposition': 'attachment; filename="reporte_71.pdf"',
        },
        body: request.method() === 'HEAD' ? undefined : '%PDF-E2E',
      });
    }
    return json(route, { data: [] });
  });

  await page.goto('/reports');
  await observeNativeDownload(page);
  await page.getByRole('button', { name: 'PDF (4.0 KB)' }).click();
  await expect.poll(() => downloadHeadRequested).toBe(true);
  await expect.poll(() => downloadGetRequested).toBe(true);
});

test('importación vehicular continúa como job y muestra resultado final', async ({ page }) => {
  const user = await authenticate(page, 'ADMIN');
  let activeReads = 0;
  let importCreated = false;
  let statusReads = 0;

  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    if (pathname === '/api/auth/me') return json(route, { data: user });
    if (pathname === '/api/vehicles/import/active' && request.method() === 'GET') {
      activeReads += 1;
      return json(route, {
        data: importCreated ? {
          id: 52,
          type: 'VEHICLE_IMPORT',
          status: 'QUEUED',
          progress: 0,
          originalFileName: 'inventario.csv',
          result: null,
          errorMessage: null,
        } : null,
      });
    }
    if (pathname === '/api/vehicles/import' && request.method() === 'POST') {
      importCreated = true;
      return json(route, {
        data: {
          id: 52,
          type: 'VEHICLE_IMPORT',
          status: 'QUEUED',
          progress: 0,
          originalFileName: 'inventario.csv',
          result: null,
          errorMessage: null,
        },
      }, 202);
    }
    if (pathname === '/api/vehicles/import/52') {
      statusReads += 1;
      if (statusReads === 1) {
        await new Promise((resolve) => setTimeout(resolve, 800));
      }
      const completed = statusReads >= 2;
      return json(route, {
        data: {
          id: 52,
          type: 'VEHICLE_IMPORT',
          status: completed ? 'COMPLETED' : 'PROCESSING',
          progress: completed ? 100 : 40,
          originalFileName: 'inventario.csv',
          result: completed ? {
            total: 2,
            created: 1,
            updated: 1,
            skipped: 0,
            errors: [],
            warnings: [],
          } : null,
          errorMessage: null,
        },
      });
    }
    if (pathname === '/api/vehicles' && request.method() === 'GET') {
      return json(route, {
        data: [],
        pagination: { page: 1, limit: 20, total: 0, totalPages: 0 },
      });
    }
    if (pathname === '/api/vehicle-types') return json(route, []);
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

  await page.goto('/vehicles');
  await page.getByRole('button', { name: 'Importar Excel' }).click();
  await page.locator('input[type="file"]').setInputFiles({
    name: 'inventario.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from('No. Económico,Placa,Marca,Modelo\nECO-1,ABC-1,Ford,Ranger\nECO-2,ABC-2,Nissan,NP300\n'),
  });
  await page.getByRole('button', { name: 'Importar', exact: true }).click();

  await expect(page.getByText('Importación en cola')).toBeVisible();
  await page.getByRole('button', { name: 'Cerrar y continuar en segundo plano' }).click();
  await expect(page.getByRole('heading', { name: 'Importar vehículos desde Excel' })).toBeHidden();
  await page.evaluate(() => sessionStorage.removeItem('flotillas.pendingVehicleImportJobId'));
  await page.reload();
  await page.getByRole('button', { name: 'Importar Excel' }).click();

  await expect(page.getByText('Importación completada')).toBeVisible({ timeout: 10_000 });
  await expect.poll(() => page.evaluate(() => sessionStorage.getItem('flotillas.pendingVehicleImportJobId')))
    .toBe('52');
  await expect(page.getByText('2', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('1', { exact: true }).first()).toBeVisible();
  expect(activeReads).toBe(2);
});

test('cambiar periodo no deja editar filas del presupuesto anterior', async ({ page }) => {
  const user = await authenticate(page, 'ADMIN');
  let initialMonth: string | null = null;
  let releaseNextPeriod!: () => void;
  const nextPeriodGate = new Promise<void>((resolve) => {
    releaseNextPeriod = resolve;
  });

  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const pathname = url.pathname;
    if (pathname === '/api/auth/me') return json(route, { data: user });
    if (pathname === '/api/budgets') {
      const month = url.searchParams.get('month');
      if (initialMonth == null) initialMonth = month;
      if (month !== initialMonth) {
        await nextPeriodGate;
        return json(route, {
          data: [],
          pagination: { page: 1, limit: 50, total: 0, totalPages: 0 },
        });
      }
      return json(route, {
        data: [{
          id: 91,
          vehicleId: 9,
          baseAmount: 10_000,
          rolloverIn: 0,
          spentAmount: 1_000,
          available: 9_000,
          isCutOff: false,
          vehicle: {
            id: 9,
            economicNumber: 'ECO-STALE',
            plate: 'ABC-123',
            classification: 'ESTATAL',
          },
        }],
        pagination: { page: 1, limit: 50, total: 1, totalPages: 1 },
      });
    }
    if (pathname === '/api/budgets/monthly-pool') {
      return json(route, {
        data: {
          totalPool: 10_000,
          assigned: 10_000,
          rollover: 0,
          spent: 1_000,
          unassigned: 0,
          pctAssigned: 100,
          unitsCount: 1,
          notes: null,
          hasPool: true,
        },
      });
    }
    if (pathname === '/api/budgets/distribution-targets') {
      return json(route, {
        data: { all: 1, unassigned: 0, byClassification: { POLICIAL: 0, ESTATAL: 1, VIAL: 0 } },
      });
    }
    if (pathname === '/api/dashboard/summary') {
      return json(route, {
        totalVehicles: 1,
        blockedVehicles: 0,
        operativeVehicles: 1,
        docsExpiring: 0,
      });
    }
    if (pathname === '/api/notifications/count') return json(route, { data: { unreadCount: 0 } });
    if (pathname === '/api/notifications') {
      return json(route, {
        data: [], unreadCount: 0,
        pagination: { page: 1, limit: 20, total: 0, totalPages: 0 },
      });
    }
    return json(route, { data: [] });
  });

  await page.goto('/budget/fuel');
  await expect(page.getByText('ECO-STALE')).toBeVisible();
  await page.getByRole('button', { name: 'Editar base' }).click();
  await expect(page.getByRole('button', { name: 'Guardar presupuesto de ECO-STALE' })).toBeVisible();

  const monthSelect = page.getByLabel('Mes del presupuesto');
  const currentMonth = await monthSelect.inputValue();
  await monthSelect.selectOption(currentMonth === '1' ? '2' : '1');
  await expect(page.getByText('ECO-STALE')).toBeHidden({ timeout: 500 });
  await expect(page.getByRole('button', { name: 'Guardar presupuesto de ECO-STALE' })).toHaveCount(0);
  releaseNextPeriod();
});
