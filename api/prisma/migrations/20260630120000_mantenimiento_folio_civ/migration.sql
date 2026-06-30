-- Módulo de Mantenimiento: folio de solicitud, columna CIV en vehículos y contador de folios.
-- Migración ADITIVA / no destructiva (columnas + índices + tabla nuevos).
-- Revert documentado (no lo ejecuta Prisma):
--   DROP TABLE "maintenance_folio_counters";
--   DROP INDEX "maintenance_tickets_folio_key"; ALTER TABLE "maintenance_tickets" DROP COLUMN "folio";
--   DROP INDEX "vehicles_civ_key"; ALTER TABLE "vehicles" DROP COLUMN "civ";

-- ── CIV en vehículos ────────────────────────────────────────────────
ALTER TABLE "vehicles" ADD COLUMN "civ" TEXT;
CREATE UNIQUE INDEX "vehicles_civ_key" ON "vehicles"("civ");

-- ── Folio en solicitudes de mantenimiento ───────────────────────────
ALTER TABLE "maintenance_tickets" ADD COLUMN "folio" TEXT;

-- ── Contador de folios (reinicio por año) ───────────────────────────
CREATE TABLE "maintenance_folio_counters" (
  "year" INTEGER PRIMARY KEY,
  "lastValue" INTEGER NOT NULL DEFAULT 0
);

-- ── Backfill: asignar folios a tickets existentes (SM-AAAA-NNNNN) ────
WITH numbered AS (
  SELECT
    id,
    EXTRACT(YEAR FROM "createdAt")::int AS yr,
    ROW_NUMBER() OVER (
      PARTITION BY EXTRACT(YEAR FROM "createdAt")
      ORDER BY "createdAt", id
    ) AS n
  FROM "maintenance_tickets"
)
UPDATE "maintenance_tickets" t
SET "folio" = 'SM-' || numbered.yr || '-' || LPAD(numbered.n::text, 5, '0')
FROM numbered
WHERE numbered.id = t.id;

-- Índice único del folio (después del backfill para evitar choques con NULLs duplicados)
CREATE UNIQUE INDEX "maintenance_tickets_folio_key" ON "maintenance_tickets"("folio");

-- ── Sembrar el contador con el máximo usado por año ─────────────────
INSERT INTO "maintenance_folio_counters" ("year", "lastValue")
SELECT EXTRACT(YEAR FROM "createdAt")::int, COUNT(*)
FROM "maintenance_tickets"
GROUP BY EXTRACT(YEAR FROM "createdAt");
