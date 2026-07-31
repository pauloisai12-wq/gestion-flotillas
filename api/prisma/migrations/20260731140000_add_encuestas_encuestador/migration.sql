-- Módulo "Encuestas Okrean": añade el nombre de quien levanta la encuesta.
-- Migración PURAMENTE ADITIVA: una sola columna NULLABLE en `encuestas`. No
-- toca ninguna otra tabla, enum, índice ni vista, y no reescribe las filas
-- existentes (la columna es opcional en el contrato v1, igual que el folio).

-- AlterTable
ALTER TABLE "encuestas" ADD COLUMN "encuestador" TEXT;
