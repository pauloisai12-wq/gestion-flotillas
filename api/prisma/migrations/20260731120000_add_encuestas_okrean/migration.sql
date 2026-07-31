-- Módulo "Encuestas Okrean": ingesta de la app móvil de encuestas.
-- Migración PURAMENTE ADITIVA: crea 2 enums y 2 tablas nuevas con sus índices
-- y una FK entre ellas. No toca ninguna tabla, enum ni vista existente; en
-- particular NO comparte nada con qa_externa (otra app, datos separados).

-- CreateEnum
CREATE TYPE "EncuestaEstado" AS ENUM ('completada', 'noElegible');

-- CreateEnum
CREATE TYPE "EncuestaElegibilidad" AS ENUM ('elegible', 'noElegible');

-- CreateTable
CREATE TABLE "encuestas_dispositivos" (
    "id" SERIAL NOT NULL,
    "identificador" TEXT NOT NULL,
    "key_hash" TEXT NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "last_used_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "encuestas_dispositivos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "encuestas" (
    "id" SERIAL NOT NULL,
    "id_remoto" TEXT NOT NULL,
    "id_local" TEXT NOT NULL,
    "dispositivo_id" INTEGER NOT NULL,
    "payload_hash" TEXT NOT NULL,
    "version_cuestionario" INTEGER NOT NULL,
    "folio_local" TEXT,
    "estado" "EncuestaEstado" NOT NULL,
    "elegibilidad" "EncuestaElegibilidad" NOT NULL,
    "fecha_hora_inicio" TIMESTAMP(3) NOT NULL,
    "fecha_hora_finalizacion" TIMESTAMP(3) NOT NULL,
    "duracion_segundos" INTEGER NOT NULL,
    "credencial_vigente" TEXT NOT NULL,
    "rango_edad" TEXT,
    "genero" TEXT,
    "partido_preferido" TEXT,
    "conocimiento_por_persona" JSONB,
    "medios_conocimiento" JSONB,
    "mayor_personalidad" TEXT,
    "candidato_preferido" TEXT,
    "ubicacion_disponible" BOOLEAN,
    "ubicacion_lat" DOUBLE PRECISION,
    "ubicacion_lng" DOUBLE PRECISION,
    "ubicacion_precision_m" DOUBLE PRECISION,
    "ubicacion_capturada_at" TIMESTAMP(3),
    "ubicacion_es_valida" BOOLEAN,
    "ubicacion_permiso" TEXT,
    "ubicacion_servicio_activo" BOOLEAN,
    "ubicacion_motivo_no_disponible" TEXT,
    "dispositivo_plataforma" TEXT NOT NULL,
    "dispositivo_modelo" TEXT NOT NULL,
    "dispositivo_version_sistema" TEXT NOT NULL,
    "version_aplicacion" TEXT NOT NULL,
    "payload_raw" TEXT,
    "recibido_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "encuestas_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "encuestas_dispositivos_key_hash_key" ON "encuestas_dispositivos"("key_hash");

-- CreateIndex
CREATE UNIQUE INDEX "encuestas_id_remoto_key" ON "encuestas"("id_remoto");

-- CreateIndex
CREATE UNIQUE INDEX "encuestas_id_local_key" ON "encuestas"("id_local");

-- CreateIndex
CREATE INDEX "encuestas_dispositivo_id_idx" ON "encuestas"("dispositivo_id");

-- CreateIndex
CREATE INDEX "encuestas_recibido_en_idx" ON "encuestas"("recibido_en");

-- CreateIndex
CREATE INDEX "encuestas_fecha_hora_finalizacion_idx" ON "encuestas"("fecha_hora_finalizacion");

-- CreateIndex
CREATE INDEX "encuestas_estado_idx" ON "encuestas"("estado");

-- AddForeignKey
ALTER TABLE "encuestas" ADD CONSTRAINT "encuestas_dispositivo_id_fkey" FOREIGN KEY ("dispositivo_id") REFERENCES "encuestas_dispositivos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
