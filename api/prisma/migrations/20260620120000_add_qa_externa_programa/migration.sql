-- 1. Nuevo enum. CREATE TYPE + uso inmediato es SEGURO en la misma transacción
--    (la restricción de "valor de enum en la misma transacción" aplica solo a ALTER TYPE ... ADD VALUE).
CREATE TYPE "QaExternaPrograma" AS ENUM ('BUFFALO', 'LX');

-- 2. Preservar datos existentes: añadir programa con default temporal para
--    backfill de filas previas sin borrar evidencia.
ALTER TABLE "qa_externa_dispositivos" ADD COLUMN "programa" "QaExternaPrograma" NOT NULL DEFAULT 'BUFFALO';
ALTER TABLE "qa_externa_registros"    ADD COLUMN "programa" "QaExternaPrograma" NOT NULL DEFAULT 'BUFFALO';
ALTER TABLE "qa_externa_imagenes"     ADD COLUMN "programa" "QaExternaPrograma" NOT NULL DEFAULT 'BUFFALO';

-- 3. Quitar default para mantener el schema canónico de Prisma (sin @default).
ALTER TABLE "qa_externa_dispositivos" ALTER COLUMN "programa" DROP DEFAULT;
ALTER TABLE "qa_externa_registros"    ALTER COLUMN "programa" DROP DEFAULT;
ALTER TABLE "qa_externa_imagenes"     ALTER COLUMN "programa" DROP DEFAULT;

-- 4. Reemplazar el unique simple de sha256 por el compuesto (sha256, programa).
DROP INDEX "qa_externa_imagenes_sha256_key";
CREATE UNIQUE INDEX "qa_externa_imagenes_sha256_programa_key" ON "qa_externa_imagenes"("sha256", "programa");

-- 5. Índices secundarios por programa.
CREATE INDEX "qa_externa_dispositivos_programa_idx" ON "qa_externa_dispositivos"("programa");
CREATE INDEX "qa_externa_registros_programa_idx"    ON "qa_externa_registros"("programa");
CREATE INDEX "qa_externa_imagenes_programa_idx"     ON "qa_externa_imagenes"("programa");
