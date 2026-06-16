-- CreateEnum
CREATE TYPE "QaExternaTipo" AS ENUM ('lona', 'reunion', 'barda', 'otro');

-- CreateTable
CREATE TABLE "qa_externa_dispositivos" (
    "id" SERIAL NOT NULL,
    "identificador" TEXT NOT NULL,
    "key_hash" TEXT NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "last_used_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "qa_externa_dispositivos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "qa_externa_registros" (
    "id" SERIAL NOT NULL,
    "cliente_registro_id" TEXT NOT NULL,
    "dispositivo_id" INTEGER NOT NULL,
    "identificador_app" TEXT NOT NULL,
    "tipo" "QaExternaTipo" NOT NULL,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "accuracy" DOUBLE PRECISION,
    "capturado_at" TIMESTAMP(3) NOT NULL,
    "notas" TEXT,
    "metadata_raw" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "qa_externa_registros_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "qa_externa_imagenes" (
    "id" SERIAL NOT NULL,
    "sha256" TEXT NOT NULL,
    "ruta" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "bytes" INTEGER NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "qa_externa_imagenes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "qa_externa_registro_imagenes" (
    "registro_id" INTEGER NOT NULL,
    "imagen_id" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "qa_externa_registro_imagenes_pkey" PRIMARY KEY ("registro_id","imagen_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "qa_externa_dispositivos_key_hash_key" ON "qa_externa_dispositivos"("key_hash");

-- CreateIndex
CREATE UNIQUE INDEX "qa_externa_registros_cliente_registro_id_key" ON "qa_externa_registros"("cliente_registro_id");

-- CreateIndex
CREATE INDEX "qa_externa_registros_dispositivo_id_idx" ON "qa_externa_registros"("dispositivo_id");

-- CreateIndex
CREATE INDEX "qa_externa_registros_capturado_at_idx" ON "qa_externa_registros"("capturado_at");

-- CreateIndex
CREATE UNIQUE INDEX "qa_externa_imagenes_sha256_key" ON "qa_externa_imagenes"("sha256");

-- CreateIndex
CREATE INDEX "qa_externa_registro_imagenes_imagen_id_idx" ON "qa_externa_registro_imagenes"("imagen_id");

-- AddForeignKey
ALTER TABLE "qa_externa_registros" ADD CONSTRAINT "qa_externa_registros_dispositivo_id_fkey" FOREIGN KEY ("dispositivo_id") REFERENCES "qa_externa_dispositivos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qa_externa_registro_imagenes" ADD CONSTRAINT "qa_externa_registro_imagenes_registro_id_fkey" FOREIGN KEY ("registro_id") REFERENCES "qa_externa_registros"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qa_externa_registro_imagenes" ADD CONSTRAINT "qa_externa_registro_imagenes_imagen_id_fkey" FOREIGN KEY ("imagen_id") REFERENCES "qa_externa_imagenes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

