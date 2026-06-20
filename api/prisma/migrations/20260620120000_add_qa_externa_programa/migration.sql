-- 1. Nuevo enum. CREATE TYPE + uso inmediato es SEGURO en la misma transacción
--    (la restricción de "valor de enum en la misma transacción" aplica solo a ALTER TYPE ... ADD VALUE).
CREATE TYPE "QaExternaPrograma" AS ENUM ('BUFFALO', 'LX');

-- 2. Empezar limpio: vaciar qa_externa para poder añadir programa NOT NULL sin backfill.
--    Orden por FKs: pivote -> registros -> imagenes -> dispositivos.
DELETE FROM "qa_externa_registro_imagenes";
DELETE FROM "qa_externa_registros";
DELETE FROM "qa_externa_imagenes";
DELETE FROM "qa_externa_dispositivos";

-- 3. Columnas programa NOT NULL (tablas vacías -> seguro sin DEFAULT).
ALTER TABLE "qa_externa_dispositivos" ADD COLUMN "programa" "QaExternaPrograma" NOT NULL;
ALTER TABLE "qa_externa_registros"    ADD COLUMN "programa" "QaExternaPrograma" NOT NULL;
ALTER TABLE "qa_externa_imagenes"     ADD COLUMN "programa" "QaExternaPrograma" NOT NULL;

-- 4. Reemplazar el unique simple de sha256 por el compuesto (sha256, programa).
DROP INDEX "qa_externa_imagenes_sha256_key";
CREATE UNIQUE INDEX "qa_externa_imagenes_sha256_programa_key" ON "qa_externa_imagenes"("sha256", "programa");

-- 5. Índices secundarios por programa.
CREATE INDEX "qa_externa_dispositivos_programa_idx" ON "qa_externa_dispositivos"("programa");
CREATE INDEX "qa_externa_registros_programa_idx"    ON "qa_externa_registros"("programa");
CREATE INDEX "qa_externa_imagenes_programa_idx"     ON "qa_externa_imagenes"("programa");
