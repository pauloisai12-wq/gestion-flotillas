-- Segunda captura de GeoCampo: "registro de personas" (sin foto).
-- Migración PURAMENTE ADITIVA: crea una tabla nueva y sus índices. No toca
-- ninguna tabla existente ni el enum "QaExternaPrograma" (añadirle valores
-- rompería, entre otros, el borrado de artefactos de dataJobService).

-- CreateTable
CREATE TABLE "qa_externa_personas" (
    "id" SERIAL NOT NULL,
    "cliente_registro_id" TEXT NOT NULL,
    "dispositivo_id" INTEGER NOT NULL,
    "identificador_app" TEXT NOT NULL,
    "programa" "QaExternaPrograma" NOT NULL,
    "nombre" TEXT NOT NULL,
    "telefono" TEXT NOT NULL,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "accuracy" DOUBLE PRECISION,
    "capturado_at" TIMESTAMP(3) NOT NULL,
    "metadata_raw" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "qa_externa_personas_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "qa_externa_personas_cliente_registro_id_key" ON "qa_externa_personas"("cliente_registro_id");

-- CreateIndex
CREATE INDEX "qa_externa_personas_dispositivo_id_idx" ON "qa_externa_personas"("dispositivo_id");

-- CreateIndex
CREATE INDEX "qa_externa_personas_capturado_at_idx" ON "qa_externa_personas"("capturado_at");

-- CreateIndex
CREATE INDEX "qa_externa_personas_programa_idx" ON "qa_externa_personas"("programa");

-- AddForeignKey
ALTER TABLE "qa_externa_personas" ADD CONSTRAINT "qa_externa_personas_dispositivo_id_fkey" FOREIGN KEY ("dispositivo_id") REFERENCES "qa_externa_dispositivos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
