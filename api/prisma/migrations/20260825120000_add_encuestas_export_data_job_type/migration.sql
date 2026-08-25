-- Exportación ZIP de encuestas. Cambio puramente aditivo: no modifica ni
-- elimina filas/tablas existentes y conserva los valores previos del enum.
ALTER TYPE "DataJobType" ADD VALUE IF NOT EXISTS 'ENCUESTAS_EXPORT';
