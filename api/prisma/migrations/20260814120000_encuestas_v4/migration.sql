-- Expande el catálogo v4 de Encuestas Okrean: agrega dos columnas opcionales
-- para guardar el texto libre cuando preferenciaElectoral o preferenciaPartido
-- son "otro". Aditiva: sin cambios en columnas existentes, solo ADD COLUMN.

ALTER TABLE "encuestas"
  ADD COLUMN "preferencia_electoral_otro" TEXT,
  ADD COLUMN "preferencia_partido_otro" TEXT;
