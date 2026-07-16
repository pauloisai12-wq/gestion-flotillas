import { expect, test, type Page, type Route } from '@playwright/test';

type TestUser = {
  id: number;
  email: string;
  fullName: string;
  role: 'ADMIN' | 'EXECUTOR';
  isActive: boolean;
};

const admin: TestUser = {
  id: 1,
  email: 'admin@flotillas.test',
  fullName: 'Admin Accesible',
  role: 'ADMIN',
  isActive: true,
};

const executor: TestUser = {
  id: 7,
  email: 'ejecutor@flotillas.test',
  fullName: 'Operador Campo',
  role: 'EXECUTOR',
  isActive: true,
};

const summary = {
  totalVehicles: 10,
  blockedVehicles: 2,
  operativeVehicles: 8,
  docsValid: 8,
  docsExpiring: 1,
  docsExpired: 1,
  fuelLoadsThisMonth: 5,
  spentThisMonth: 2_000,
  litersThisMonth: 100,
  avgKmPerLiter: 8,
  monthlySpent: 2_000,
  monthlyLiters: 100,
  monthlyLoads: 5,
  monthlyAvgKml: 8,
  refreshedAt: '2026-07-15T12:00:00.000Z',
};

async function json(route: Route, body: unknown, status = 200) {
  await route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
  });
}

async function mockAuthenticatedApp(
  page: Page,
  user: TestUser,
  options: {
    failVehicles?: () => boolean;
    failDashboardSummary?: () => boolean;
    onSummary?: () => void;
  } = {},
) {
  // El proxy de Next protege las rutas antes de hidratar; la cookie permite
  // llegar al layout y /auth/me sigue siendo la fuente del usuario simulado.
  await page.context().addCookies([{
    name: 'token',
    value: 'sprint3-e2e-session',
    url: 'http://127.0.0.1:3100',
    httpOnly: true,
    sameSite: 'Strict',
  }]);

  await page.route('**/api/**', async (route) => {
    const pathname = new URL(route.request().url()).pathname;

    if (pathname === '/api/auth/me') return json(route, { data: user });
    if (pathname === '/api/notifications/count') return json(route, { data: { unreadCount: 0 } });
    if (pathname === '/api/notifications') {
      return json(route, {
        data: [],
        unreadCount: 0,
        pagination: { page: 1, limit: 20, total: 0, totalPages: 0 },
      });
    }
    if (pathname === '/api/dashboard/summary') {
      options.onSummary?.();
      if (options.failDashboardSummary?.()) {
        return json(route, { error: 'Resumen temporalmente no disponible' }, 503);
      }
      return json(route, summary);
    }
    if (pathname === '/api/vehicles') {
      if (options.failVehicles?.()) return json(route, { error: 'Servicio temporalmente no disponible' }, 503);
      return json(route, {
        data: [],
        pagination: { page: 1, limit: 20, total: 0, totalPages: 0 },
      });
    }
    if (pathname === '/api/fuel-loads') {
      return json(route, {
        data: [],
        pagination: { page: 1, limit: 20, total: 0, totalPages: 0 },
      });
    }
    if (pathname === '/api/stations') return json(route, []);
    if (pathname === '/api/vehicle-types') return json(route, []);
    if (pathname === '/api/operators') {
      return json(route, {
        data: [],
        pagination: { page: 1, limit: 100, total: 0, totalPages: 0 },
      });
    }
    if (pathname === '/api/maintenance-tickets') {
      return json(route, { tickets: [], total: 0, page: 1, limit: 20 });
    }
    if (pathname.startsWith('/api/dashboard/')) return json(route, []);
    return json(route, { data: [] });
  });
}

for (const width of [320, 360]) {
  test(`drawer móvil es usable y no desborda a ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 740 });
    await mockAuthenticatedApp(page, admin);
    await page.goto('/vehicles');

    await expect(page.getByRole('heading', { name: 'Vehículos' })).toBeVisible();
    await expect(page.getByText('Aún no hay vehículos registrados')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);

    const trigger = page.getByRole('button', { name: 'Abrir navegación' });
    await trigger.click();
    const drawer = page.getByRole('dialog', { name: 'Navegación principal' });
    await expect(drawer).toBeVisible();
    expect(await drawer.evaluate((element) => element.contains(document.activeElement))).toBe(true);
    await page.keyboard.press('Shift+Tab');
    expect(await drawer.evaluate((element) => element.contains(document.activeElement))).toBe(true);

    await page.keyboard.press('Escape');
    await expect(drawer).toBeHidden();
    await expect(trigger).toBeFocused();

    await trigger.click();
    await page.getByRole('link', { name: 'Combustible', exact: true }).click();
    await expect(page).toHaveURL(/\/fuel$/);
    await expect(page.getByRole('dialog', { name: 'Navegación principal' })).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  });
}

test('layout y tabla permanecen contenidos a 768px', async ({ page }) => {
  await page.setViewportSize({ width: 768, height: 900 });
  await mockAuthenticatedApp(page, admin);
  await page.goto('/vehicles');

  await expect(page.locator('#primary-navigation')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Abrir navegación' })).toBeHidden();
  await expect(page.getByRole('search')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});

test('lista principal comunica error, permite reintentar y anuncia vacío', async ({ page }) => {
  let failing = true;
  await mockAuthenticatedApp(page, admin, { failVehicles: () => failing });
  await page.goto('/vehicles');

  const alert = page.getByRole('alert').filter({ hasText: 'No pudimos cargar los datos' });
  await expect(alert).toContainText('No pudimos cargar los datos');
  failing = false;
  await alert.getByRole('button', { name: 'Reintentar' }).click();
  await expect(page.getByText('Aún no hay vehículos registrados')).toBeVisible();
  await expect(page.getByRole('search').getByLabel('Buscar registros')).toBeVisible();
});

test('dashboard distingue fallos de datos vacíos y reintenta solo lo fallido', async ({ page }) => {
  let failing = true;
  await mockAuthenticatedApp(page, admin, {
    failDashboardSummary: () => failing,
    failVehicles: () => failing,
  });
  await page.goto('/dashboard/vehiculos');

  const alert = page.getByRole('alert').filter({ hasText: 'No pudimos actualizar todo el tablero' });
  await expect(alert).toContainText('resumen de flota');
  await expect(alert).toContainText('inventario de vehículos');
  await expect(page.getByText('Ninguna unidad requiere atención inmediata')).toHaveCount(0);

  failing = false;
  await alert.getByRole('button', { name: 'Reintentar datos fallidos' }).click();
  await expect(alert).toHaveCount(0);
  await expect(page.getByText('Ninguna unidad requiere atención inmediata')).toBeVisible();
});

test('F2-007 evita 403 para ejecutor y no inicia polling global', async ({ page }) => {
  let summaryRequests = 0;
  await mockAuthenticatedApp(page, executor, { onSummary: () => summaryRequests++ });
  await page.goto('/tickets');

  await expect(page.getByRole('heading', { name: 'Mantenimiento de mi flotilla' })).toBeVisible();
  await page.waitForTimeout(300);
  expect(summaryRequests).toBe(0);
});

test('F2-007 comparte una sola consulta de resumen entre header y dashboard', async ({ page }) => {
  let summaryRequests = 0;
  await mockAuthenticatedApp(page, admin, { onSummary: () => summaryRequests++ });
  await page.goto('/dashboard/global');

  await expect(page.getByRole('heading', { name: /Admin$/ })).toBeVisible();
  await expect(page.getByText('8', { exact: true }).first()).toBeVisible();
  await expect.poll(() => summaryRequests).toBe(1);
});

test('badges verde y ámbar conservan contraste AA en modos claro y oscuro', async ({ page }) => {
  await page.goto('/login');
  const ratios = await page.evaluate(() => {
    function renderedRgb(color: string, background: string): [number, number, number] {
      const canvas = document.createElement('canvas');
      canvas.width = 1;
      canvas.height = 1;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      if (!context) throw new Error('Canvas no disponible');
      context.fillStyle = background;
      context.fillRect(0, 0, 1, 1);
      context.fillStyle = color;
      context.fillRect(0, 0, 1, 1);
      const pixel = context.getImageData(0, 0, 1, 1).data;
      return [pixel[0], pixel[1], pixel[2]];
    }

    function luminance([r, g, b]: [number, number, number]) {
      const linear = [r, g, b].map((channel) => {
        const value = channel / 255;
        return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
    }

    function ratio(element: HTMLElement, pageBackground: string) {
      const style = getComputedStyle(element);
      const renderedBackground = renderedRgb(style.backgroundColor, pageBackground);
      const opaqueBackground = `rgb(${renderedBackground.join(' ')})`;
      const foreground = luminance(renderedRgb(style.color, opaqueBackground));
      const background = luminance(renderedBackground);
      const lighter = Math.max(foreground, background);
      const darker = Math.min(foreground, background);
      return (lighter + 0.05) / (darker + 0.05);
    }

    function measure(dark: boolean) {
      document.documentElement.classList.toggle('dark', dark);
      const success = document.createElement('span');
      success.className = 'bg-success/12 text-success-readable';
      success.textContent = 'Operativo';
      const warning = document.createElement('span');
      warning.className = 'bg-warning/15 text-warning-readable';
      warning.textContent = 'Por vencer';
      document.body.append(success, warning);
      const pageBackground = getComputedStyle(document.body).backgroundColor;
      const result = {
        success: ratio(success, pageBackground),
        warning: ratio(warning, pageBackground),
      };
      success.remove();
      warning.remove();
      return result;
    }

    const result = { light: measure(false), dark: measure(true) };
    document.documentElement.classList.remove('dark');
    return result;
  });

  expect(ratios.light.success).toBeGreaterThanOrEqual(4.5);
  expect(ratios.light.warning).toBeGreaterThanOrEqual(4.5);
  expect(ratios.dark.success).toBeGreaterThanOrEqual(4.5);
  expect(ratios.dark.warning).toBeGreaterThanOrEqual(4.5);
});
