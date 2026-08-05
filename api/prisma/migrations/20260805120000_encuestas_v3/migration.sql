-- Cuestionario v3 de "Encuestas Okrean": reemplaza por completo al v1.
-- SIN TRUNCATE/DELETE/DROP TABLE (gate scripts/check-qa-migrations-safe.js):
-- las capturas de campo se reestructuran con ALTER/UPDATE. Una fila v1
-- residual (solo en BDs de dev; producción no tiene datos v1) sobrevive con
-- version_cuestionario = 1 y las columnas v3 en NULL.

-- estado: el enum queda solo con 'completada' (la rama noElegible desaparece
-- del contrato). Receta estándar de Postgres para reducir un enum.
UPDATE "encuestas" SET "estado" = 'completada' WHERE "estado" <> 'completada';
CREATE TYPE "EncuestaEstado_new" AS ENUM ('completada');
ALTER TABLE "encuestas"
  ALTER COLUMN "estado" TYPE "EncuestaEstado_new"
  USING ('completada'::"EncuestaEstado_new");
DROP TYPE "EncuestaEstado";
ALTER TYPE "EncuestaEstado_new" RENAME TO "EncuestaEstado";

-- Fuera la elegibilidad del registro y las respuestas v1.
ALTER TABLE "encuestas"
  DROP COLUMN "elegibilidad",
  DROP COLUMN "credencial_vigente",
  DROP COLUMN "rango_edad",
  DROP COLUMN "genero",
  DROP COLUMN "partido_preferido",
  DROP COLUMN "conocimiento_por_persona",
  DROP COLUMN "medios_conocimiento",
  DROP COLUMN "mayor_personalidad",
  DROP COLUMN "candidato_preferido";
DROP TYPE "EncuestaElegibilidad";

-- Respuestas v3. Catálogos como TEXT validado en la app, no enums de Postgres
-- (una v4 no debe exigir ALTER TYPE). NULLABLES: la obligatoriedad la impone
-- el validador y el servicio siempre escribe valor; NULL es la representación
-- natural de una fila v1 residual.
ALTER TABLE "encuestas"
  ADD COLUMN "sexo" TEXT,
  ADD COLUMN "rango_edad" TEXT,
  ADD COLUMN "empresarios_conocidos" JSONB,
  ADD COLUMN "politicos_conocidos" JSONB,
  ADD COLUMN "conoce_lalo" TEXT,
  ADD COLUMN "rol_lalo" TEXT,
  ADD COLUMN "opinion_lalo" TEXT,
  ADD COLUMN "preferencia_electoral" TEXT,
  ADD COLUMN "preferencia_partido" TEXT,
  ADD COLUMN "aprobacion_por_gobernante" JSONB;
