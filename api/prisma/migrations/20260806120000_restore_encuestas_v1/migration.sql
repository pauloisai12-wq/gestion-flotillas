-- Restaura la recepción del cuestionario v1 JUNTO al v3 (spec
-- 2026-08-06-encuestas-v1-restaurada-design.md). Aditiva: SIN
-- TRUNCATE/DELETE/DROP TABLE (gate scripts/check-qa-migrations-safe.js).
-- Re-crea lo que 20260805120000_encuestas_v3 eliminó, pero ahora NULLABLE:
-- en la convivencia v1+v3 cada fila solo llena las columnas de su versión.

-- La rama noElegible vuelve al contrato (P1 = "no" termina la encuesta).
-- PG16 permite ADD VALUE en transacción mientras el valor no se use en la
-- misma migración; aquí solo se declara.
ALTER TYPE "EncuestaEstado" ADD VALUE IF NOT EXISTS 'noElegible';

-- Elegibilidad del registro (la app la manda explícita, atada al estado).
CREATE TYPE "EncuestaElegibilidad" AS ENUM ('elegible', 'noElegible');

-- Respuestas v1. Catálogos como TEXT validado en la app (no enums de
-- Postgres), igual que las columnas v3. NULL = fila de la otra versión.
-- rango_edad NO se re-crea: la columna existente se comparte entre versiones
-- (catálogos disjuntos; version_cuestionario desambigua).
ALTER TABLE "encuestas"
  ADD COLUMN "elegibilidad" "EncuestaElegibilidad",
  ADD COLUMN "credencial_vigente" TEXT,
  ADD COLUMN "genero" TEXT,
  ADD COLUMN "partido_preferido" TEXT,
  ADD COLUMN "conocimiento_por_persona" JSONB,
  ADD COLUMN "medios_conocimiento" JSONB,
  ADD COLUMN "mayor_personalidad" TEXT,
  ADD COLUMN "candidato_preferido" TEXT;
