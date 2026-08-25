-- Módulo "Encuestas Okrean": audios grabados durante la encuesta (1..N
-- segmentos por encuesta). Migración PURAMENTE ADITIVA: una tabla hija nueva
-- con su unique, su índice y su FK. No toca ninguna fila ni columna existente.

-- CreateTable
CREATE TABLE "encuestas_audios" (
    "id" SERIAL NOT NULL,
    "encuesta_id" INTEGER NOT NULL,
    "segmento" VARCHAR(64) NOT NULL,
    "sha256" CHAR(64) NOT NULL,
    "tamano_bytes" INTEGER NOT NULL,
    "mime_declarado" VARCHAR(120),
    "ruta" TEXT NOT NULL,
    "duracion_ms" INTEGER,
    "recibido_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "encuestas_audios_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "encuestas_audios_encuesta_id_segmento_key" ON "encuestas_audios"("encuesta_id", "segmento");

-- CreateIndex
CREATE INDEX "encuestas_audios_sha256_idx" ON "encuestas_audios"("sha256");

-- AddForeignKey
ALTER TABLE "encuestas_audios" ADD CONSTRAINT "encuestas_audios_encuesta_id_fkey" FOREIGN KEY ("encuesta_id") REFERENCES "encuestas"("id") ON DELETE CASCADE ON UPDATE CASCADE;
