const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const migrationsDir = path.resolve(__dirname, '..', 'prisma', 'migrations');
const apiRoot = path.resolve(__dirname, '..');
const webRoot = path.resolve(apiRoot, '..', 'web');

function readMigration(name) {
  return fs.readFileSync(path.join(migrationsDir, name, 'migration.sql'), 'utf8');
}

const aggregateMigration = readMigration(
  '20260715000000_exclude_pending_fuel_from_aggregates',
);
const finalViewMigration = readMigration(
  '20260716000000_vehicle_deactivation_policy',
);

const newViewDefinitions = fs.readdirSync(migrationsDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && entry.name >= '20260715000000')
  .map((entry) => ({ name: entry.name, sql: readMigration(entry.name) }))
  .filter((migration) => /CREATE MATERIALIZED VIEW/i.test(migration.sql));

assert.ok(newViewDefinitions.length >= 2, 'Deben revisarse todas las redefiniciones nuevas de MVs');

for (const migration of newViewDefinitions) {
  assert.match(
    migration.sql,
    /AT TIME ZONE 'America\/Mexico_City'/,
    `${migration.name} debe declarar la zona de negocio`,
  );

  for (const forbidden of [
    /date_trunc\('month',\s*NOW\(\)\)/i,
    /EXTRACT\(MONTH FROM NOW\(\)\)/i,
    /EXTRACT\(YEAR FROM NOW\(\)\)/i,
  ]) {
    assert.doesNotMatch(
      migration.sql,
      forbidden,
      `${migration.name} no debe decidir el periodo con la zona implícita de la sesión`,
    );
  }
}

assert.match(
  aggregateMigration,
  /"loadDate" AT TIME ZONE 'UTC'\) AT TIME ZONE 'America\/Mexico_City'/,
  'La tendencia debe interpretar loadDate como UTC antes de agruparlo en CDMX',
);
assert.match(
  aggregateMigration,
  /DROP MATERIALIZED VIEW IF EXISTS mv_budget_progress;[\s\S]*CREATE MATERIALIZED VIEW mv_budget_progress AS/,
  'mv_budget_progress debe recrearse con el periodo de CDMX',
);

for (const activeFilter of [
  /CREATE MATERIALIZED VIEW mv_dashboard_summary AS[\s\S]*FROM vehicles v\s+WHERE v\."isActive" = true;/,
  /CREATE MATERIALIZED VIEW mv_vehicle_ranking AS[\s\S]*WHERE v\."isActive" = true\s+GROUP BY/,
  /CREATE MATERIALIZED VIEW mv_operator_ranking AS[\s\S]*JOIN vehicles v ON v\.id = fl\."vehicleId" AND v\."isActive" = true/,
  /CREATE MATERIALIZED VIEW mv_budget_progress AS[\s\S]*WHERE v\."isActive" = true\s+AND vb\.kind/,
]) {
  assert.match(
    finalViewMigration,
    activeFilter,
    'La corrección horaria no debe reincorporar vehículos dados de baja',
  );
}

const dashboardSummaryView = finalViewMigration.slice(
  finalViewMigration.indexOf('CREATE MATERIALIZED VIEW mv_dashboard_summary AS'),
  finalViewMigration.indexOf('CREATE MATERIALIZED VIEW mv_vehicle_ranking AS'),
);
assert.doesNotMatch(
  dashboardSummaryView,
  /JOIN vehicles fv ON fv\.id = fl\."vehicleId" AND fv\."isActive" = true/,
  'Los hechos financieros del periodo no deben desaparecer al dar de baja una unidad',
);
assert.match(
  finalViewMigration,
  /RAISE EXCEPTION[\s\S]*vehículos inactivos con tickets no terminales/,
  'La migración debe fallar cerrada ante tickets legacy sin resolución financiera',
);

const dashboardService = fs.readFileSync(
  path.join(apiRoot, 'src', 'services', 'dashboardService.ts'),
  'utf8',
);
assert.match(
  dashboardService,
  /businessDateRange\(filters\.dateFrom, filters\.dateTo\)/,
  'Los filtros del dashboard deben convertir fechas civiles en la zona de negocio',
);
assert.doesNotMatch(
  dashboardService,
  /new Date\(filters\.date(?:From|To)\)/,
  'El dashboard no debe interpretar YYYY-MM-DD como medianoche UTC',
);
assert.match(
  dashboardService,
  /fl\."loadDate" < \$\{range\.toExclusive\}/,
  'dateTo debe convertirse al inicio exclusivo del día siguiente',
);
assert.match(
  dashboardService,
  /CURRENT_TIMESTAMP - INTERVAL '12 months'\) AT TIME ZONE 'UTC'/,
  'La ventana móvil debe compararse con DateTime de Prisma sin depender de la sesión',
);

const solicitudPdf = fs.readFileSync(
  path.join(apiRoot, 'src', 'services', 'tickets', 'solicitudPdf.ts'),
  'utf8',
);
assert.match(solicitudPdf, /formatBusinessDate\(new Date\(value\)\)/);
assert.doesNotMatch(
  solicitudPdf,
  /\.get(?:Date|Month|FullYear)\(/,
  'Las fechas del folio no deben tomar la zona UTC del host',
);

const webBusinessTime = fs.readFileSync(
  path.join(webRoot, 'src', 'lib', 'businessTime.ts'),
  'utf8',
);
assert.match(webBusinessTime, /timeZone:\s*BUSINESS_TIME_ZONE/);
assert.match(webBusinessTime, /export function previousBusinessPeriod/);

for (const relativePath of [
  ['src', 'components', 'budget', 'BudgetTable.tsx'],
  ['src', 'app', '(dashboard)', 'budget', 'page.tsx'],
  ['src', 'app', '(dashboard)', 'dashboard', 'gasolina', 'DashboardGasolina.tsx'],
  ['src', 'app', '(dashboard)', 'dashboard', 'mantenimiento', 'DashboardMantenimiento.tsx'],
  ['src', 'app', '(dashboard)', 'reports', 'page.tsx'],
]) {
  const source = fs.readFileSync(path.join(webRoot, ...relativePath), 'utf8');
  assert.doesNotMatch(
    source,
    /\.get(?:Month|FullYear)\(/,
    `${relativePath.join('/')} no debe decidir periodos con la zona del dispositivo`,
  );
  assert.match(
    source,
    /(?:businessPeriodForDate|previousBusinessPeriod)/,
    `${relativePath.join('/')} debe usar la zona oficial del negocio`,
  );
}

console.log('business-time migration check passed');
