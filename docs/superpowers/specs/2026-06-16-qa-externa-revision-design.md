# Spec de diseño — Portal de revisión/descarga `qa_externa` (rol `REVISOR_QA`)

> Estado: **aprobado para implementación** · Fecha: 2026-06-16
> Continuación de `2026-06-16-qa-externa-design.md` (solo se construyó la **ingesta**; esto es la **revisión/descarga**).
> Este spec NO incluye código; es la entrada para el plan de implementación.

---

## 0. Resumen y decisiones

La ingesta `qa_externa` ya recibe evidencias de GeoCampo (`POST /api/qa-externa/ingest`, API key de
dispositivo) y está validada en el VPS público. Falta el extremo de **revisión**: que alguien pueda
**descargar** esas evidencias. Tras brainstorming con el usuario, el alcance se acotó a un tool mínimo
de **descarga**, no un explorador.

Decisiones tomadas con el usuario (2026-06-16):

| Decisión | Elección | Motivo |
|---|---|---|
| Quién accede | **Rol nuevo y aislado `REVISOR_QA`** | El usuario no quiere reusar ningún rol existente; un revisor externo separado del panel. |
| Aislamiento | **SOLO `REVISOR_QA`** entra a `/revision` (ni ADMIN) | Área 100% separada; el revisor no ve nada del SAF de flotillas. |
| Login | **Página propia `/revision/login`** | Experiencia de acceso independiente del login de flotillas. |
| Objetivo | **Descargar TODA la base** (foto + datos) | El usuario explicitó "solo quiero descargar los datos de registro con las fotos". |
| Formato | **ZIP = fotos + hoja `.xlsx`** | Un único archivo con imágenes y una hoja con todos los campos de cada registro. |
| Alcance de la descarga | **Siempre todo** (ignora filtros) | Decisión del usuario: la exportación no depende de filtros de pantalla. |
| Mapa / detalle | **No** (lat/lng en texto) | El usuario los descartó explícitamente. |
| Layout en pantalla | **DataTable** (convención del repo) | Tabla con miniatura para ver qué se va a descargar. |

**Regla dura respetada:** aditivo; no se toca el SAS ni los routers/modelos/roles existentes. Único
cambio de esquema: **un valor nuevo en el enum `UserRole`**. Stack Node/Express/TS (Python solo worker; no se toca).

---

## 1. Restricción crítica de ruteo (bug ya resuelto en la ingesta)

Todo `/api/qa-externa/*` se monta **antes** de las rutas JWT y va envuelto por `deviceAuthMiddleware`
(porque `app.use('/api', authMiddleware, ...)` con comodín atraparía cualquier `/api/*`). Por eso el
endpoint JWT de revisión **NO puede colgar de `/api/qa-externa/`**; se monta como hermano entre las
rutas protegidas en **`/api/qa-externa-registros`** con `authMiddleware` + `requireRole([REVISOR_QA])`.

---

## 2. Backend (API Node/Express/TS)

### 2.1 Rol
- `enum UserRole` += `REVISOR_QA` (migración `ALTER TYPE "UserRole" ADD VALUE 'REVISOR_QA';`, en su
  propia migración; precedente `20260522000000_maintenance_tickets_enums`).
- `Roles.REVISOR_QA` en `roleMiddleware.ts`. **No** se añade a ningún `RoleGroups` (aislamiento).
- CLI `qa:reviewer:create` (espejo de `create-user.ts`) para alta del usuario revisor.

### 2.2 Endpoints (`/api/qa-externa-registros`, todos `requireRole([REVISOR_QA])`)
- `GET /` — lista paginada `{ data, pagination:{page,limit,total,totalPages} }` (filtros opcionales
  tipo/dispositivo/fechas, solo para ver en pantalla). Patrón: `fuelLoadService.getAllFuelLoads`.
- `GET /export` — **stream de ZIP** de TODA la base: hoja `datos.xlsx` (SheetJS, ya dep) + `fotos/*.jpg`
  (vía `archiver`, dep nueva JS-pura). Audita `action:'EXPORT'`. Fotos faltantes en disco se omiten y
  se marcan en el xlsx. Orden estricto: validar+consultar+armar xlsx → fijar cabeceras
  (`Content-Type: application/zip`) → `archive.pipe(res)` → append → `finalize()`.
- `GET /imagenes/:sha256` — stream role-gated de una foto (valida `sha256`, confina la ruta como
  `reportRouter.ts`) para las miniaturas de la tabla. El revisor **no** usa `/uploads`.

### 2.3 Seguridad
- `REVISOR_QA` queda fuera de todo `RoleGroups` → 403 en el resto de la API.
- Guard 403 para `REVISOR_QA` antes del `express.static('/uploads')` (defensa en profundidad).
- Imágenes content-addressed leídas del disco server-side → el ZIP solo contiene fotos `qa_externa`.

---

## 3. Frontend (Next.js 16, App Router)

Nuevo segmento aislado `web/src/app/revision/` (hermano de `(dashboard)`), client components (sin
`metadata`/segment-config/`params`, por `web/AGENTS.md`):
- `revision/login/page.tsx` — login propio (reusa `useAuth().login`, con redirección a `/revision`).
- `revision/layout.tsx` — guard que admite **solo** `REVISOR_QA` (patrón de `(dashboard)/layout.tsx`).
- `revision/page.tsx` — DataTable (miniatura vía `/imagenes/:sha256`, tipo, fecha, lat/lng, dispositivo)
  + botón **"Descargar todo (ZIP)"** (descarga blob de `/export`, patrón `downloadReport`).

Cambios aditivos de soporte: `UserRole` += `REVISOR_QA` (AuthContext), `getHomePath`/`RESTRICTED_PREFIXES`
(`access.ts`), `isPublicPath` + redirect 401 sensible a `/revision` (`api.ts`), `login(email,pwd,redirectTo?)`
con 3er parámetro opcional (callers actuales intactos), hook `useQaRegistros.ts`.

---

## 4. Verificación (no hay framework de tests)

- Gate API: `npx prisma validate` · `npx prisma generate` · `npx tsc --noEmit` · `npm run build`.
- Gate Web: `npm run lint` · `npx tsc --noEmit` · `npm run build`.
- Manual: login en `/revision/login` → tabla con miniaturas → "Descargar todo" → ZIP con `datos.xlsx`
  + `fotos/*.jpg`; `REVISOR_QA` recibe 403 en otros endpoints y en `/uploads`; aislamiento bidireccional
  entre `/revision` y el panel.
- Despliegue (VPS Hetzner): `git pull && ./deploy-public.sh` (rebuild de imagen → `archiver` + migración;
  el one-shot `migrate` aplica el enum antes de servir). Alta del revisor: `qa:reviewer:create`.

---

## 5. Fuera de alcance

Detalle por registro, mapa embebido, edición/aprobación de evidencias, notificaciones, exportación
filtrada/selectiva, generación asíncrona vía el worker Python. Se añaden en una iteración futura si se requieren.
