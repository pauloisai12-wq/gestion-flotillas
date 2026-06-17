-- ════════════════════════════════════════════════════════════════
-- ROL REVISOR_QA — nuevo valor en el enum UserRole
-- ════════════════════════════════════════════════════════════════
-- Postgres NO permite usar un nuevo valor de enum en la misma transacción
-- en que se agregó. Aquí el valor 'REVISOR_QA' NO se referencia en ninguna
-- otra sentencia de esta migración (sin CHECK constraints ni defaults que lo
-- usen), así que es seguro dentro de la transacción de Prisma en PG16.
--
-- Rol nuevo:
--   - REVISOR_QA: revisor externo aislado; solo lista y descarga evidencias
--     qa_externa (ver /revision). Sin acceso a ningún otro endpoint.

-- ─── UserRole ────────────────────────────────────────────────────
ALTER TYPE "UserRole" ADD VALUE 'REVISOR_QA';
