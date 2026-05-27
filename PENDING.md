# Mejoras pendientes — flotillas-v2

Documento de seguimiento de mejoras detectadas durante la revisión de código
del 2026-05-21. Las críticas e intermedias ya están aplicadas; lo listado
aquí es **trabajo opcional** que no afecta funcionalidad pero mejora
mantenimiento, UX o robustez.

---

## 🟡 Pendientes nice-to-have

### 1. Accesibilidad (A11y) — frontend
**Estado:** sin iniciar.
**Por qué importa:** el sistema es gubernamental; en México (LFPDPPP/normativas
de inclusión) suele haber requisitos legales. Hoy ~15 de 40 componentes tienen
algún `aria-*`/`alt=`, los otros no.

**Próximos pasos:**
- Auditar con `eslint-plugin-jsx-a11y` (añadir al config existente).
- Revisar contraste de color del tema `oklch` con la herramienta a11y de Storybook (ya activada vía `@storybook/addon-a11y`).
- Etiquetar inputs sin `<Label>` asociado en formularios de `vehiculos/`, `combustible/`, `mantenimiento/`.
- Añadir `aria-live` a las notificaciones (campana/toasts).
- Foco visible en estados `:focus-visible` para keyboard nav.

---

### 2. OpenAPI — cobertura completa
**Estado:** esqueleto inicial implementado (`api/src/lib/openapi.ts` cubre auth/login, auth/me, vehicles GET, health). UI accesible en `/api/docs`.
**Por qué importa:** documentación viva del API; permite generar clientes TypeScript automáticos para el web.

**Próximos pasos:**
- Migrar los ~45 endpoints restantes (vehículos POST/PUT/DELETE, fuel-loads, budgets, maintenance, operators, stations, workshops, sectors, documents, notifications, reports, audit-logs, admin, public, vehicle-notes).
- Convertir los `zod` schemas existentes en `src/validators/` para que se auto-registren en el registry (ahorra duplicar definiciones — usar `extendZodWithOpenApi`).
- Generar cliente TS para el frontend con `openapi-typescript` o `openapi-fetch`: reemplaza `axios.get('/api/vehicles')` no-tipado con un cliente que valide tipos contra el spec.
- Añadir ejemplos (`.openapi({ example: ... })`) a los schemas para que Swagger UI muestre payloads realistas.

---

### 3. Storybook — más stories
**Estado:** Storybook 9 configurado con addon-a11y. 3 stories iniciales (`Button`, `StatusBadge`, `KpiCard`).
**Cómo levantarlo:** `cd web && npm run storybook` → http://localhost:6006

**Próximos pasos:**
- Crear stories para los 14 componentes UI restantes: `Badge`, `Card`, `Dialog`, `EmptyState`, `Input`, `Label`, `PageHeader`, `Skeleton`, `Sparkline`, `Table`, `DataTable`.
- Stories para componentes de dominio (`vehicles/VehicleCard`, `dashboard/FleetSummary`, etc.).
- Documentar variantes y estados (loading, empty, error) — útil para QA visual.
- Configurar Chromatic o Percy si se quiere regresión visual automática en CI.

---

## 🟠 Estructurales aplazadas (riesgo medio)

### 4. Refresh tokens (I5)
**Problema actual:** JWT dura 8h. Al expirar, el usuario es expulsado abruptamente — puede estar a mitad de un formulario y perder lo escrito.

**Diseño propuesto:**
- Access token corto (15 min) en memoria del cliente.
- Refresh token largo (7 días) en httpOnly cookie + tabla `refresh_tokens` en BD para revocación.
- Endpoint nuevo `POST /api/auth/refresh` que valida refresh y devuelve nuevo access.
- Endpoint nuevo `POST /api/auth/logout-all` que revoca todos los refresh del usuario.
- Interceptor en `web/src/lib/api.ts`: al recibir 401, intentar refresh una vez antes de redirigir a `/login`.

**Riesgo:** un refresh token robado vale por 7 días. Mitigación: cookie httpOnly + Secure + SameSite=Strict + rotación en cada uso.

---

### 5. Reestructura de volúmenes en docker-compose (I8)
**Problema actual:** `./api:/app` + volumen anónimo `/app/node_modules` es frágil — el tipo de Node de tu PC contamina los binarios del container (bcrypt, prisma).

**Opciones:**
- **A.** Mover todo a Docker (deps + node) — más reproducible pero más lento de cambiar deps.
- **B.** Quitar Docker para dev del API/Web — usar `npm run dev` en host, dejar Docker solo para postgres/redis. Es lo que hacen los scripts `start.bat` hoy (a medias).

Decidir cuál se prefiere y consolidar.

---

### 6. Scripts cross-platform
**Problema actual:** `start.bat`, `stop.bat`, `start-ngrok.bat`, etc. son solo Windows.

**Próximos pasos:**
- Migrar a `make` (común en Linux/Mac) o `just` (más moderno, sintaxis amigable).
- O simplemente añadir scripts npm equivalentes en raíz: `npm run start`, `npm run start:ngrok`.

---

### 7. Suite de tests (C4 diferido)
**Estado:** No hay tests.
**Por qué importa:** 20 modelos, ~50 endpoints, lógica de presupuesto con rollover. Refactorizar sin tests es jugar a la ruleta.

**Plan:**
- Vitest + Testcontainers de Postgres para tests de integración.
- Prioridad 1: `budgetService.closeMonthAndRollover` (lógica más crítica del negocio).
- Prioridad 2: `authService.login` (intentos fallidos, bloqueo temporal).
- Prioridad 3: `blockingService.runDailyComplianceCheck`.
- Prioridad 4: `fuelLoadService.createPublicFuelLoad` (validación CSRF + Turnstile + presupuesto).
- Frontend: React Testing Library para hooks críticos (`useAuth`, `useVehicles`).

---

## 🛡️ Vulnerabilidades de dependencias

`npm install` reportó vulnerabilidades:
- **API:** 5 vulnerabilities (2 moderate, 3 high)
- **Web:** 3 vulnerabilities (1 moderate, 2 high)

**Próximos pasos:**
- Correr `npm audit` en cada carpeta para ver detalles.
- Aplicar `npm audit fix` (sin `--force`) para fixes no-breaking.
- Revisar manualmente los que requieren bump major.

---

## ✅ Ya completado (referencia)

**Críticas (todas):**
- C1: `web/package.json` reconstruido con 16 deps reales.
- C2: `.env` verificado fuera del historial git.
- C3: `.env.example` ampliado de 7 a 22 vars con secciones documentadas.
- C5: Dockerfiles API+Web multi-stage con healthcheck y usuario no-root.
- C6: Turnstile ya estaba bien implementado.

**Intermedias (8 de 10):**
- I1: tipar `req.user` (+arregló bug latente de privacidad en notificationRouter/vehicleNoteRouter/budgetRouter).
- I2: `console.log` → logger Pino en jobs y queue.
- I3: pool de conexiones psycopg2 en worker Python.
- I4: healthchecks explícitos en compose, web espera api healthy.
- I6: workflow CI GitHub Actions (api typecheck + web build + worker syntax).
- I7: `REDIS_URL` única fuente de verdad para BullMQ.
- I9: índice global `audit_logs.createdAt` (migración + aplicada).
- I10: cálculo robusto de mes anterior en rollover (resistente a timezone drift).

**Nice-to-have iniciado:**
- Sentry configurado en API (`@sentry/node`) y Web (`@sentry/nextjs`) — solo añadir `SENTRY_DSN` al `.env` para activar.
- OpenAPI esqueleto + UI en `/api/docs`.
- Storybook 9 + 3 stories iniciales.
- Frontend login mejorado: diferencia 401 (credenciales mal), 429 (rate limit), 403 (cuenta bloqueada), red caída. Credenciales mostradas en pantalla actualizadas con usuarios reales del seed.

**Bugs latentes arreglados:**
- `notificationRouter` leía `req.user.id` (undefined) → Prisma ignoraba el filtro y devolvía notificaciones de otros usuarios. Ahora consistente con `req.user.userId`.
- Mismo bug en `vehicleNoteRouter` (3 endpoints) y `budgetRouter` (3 endpoints).
- 4 errores pre-existentes de typecheck (file-type ESM + TransactionClient con extended client) → 0 errores ahora.
- Login mostraba "Credenciales inválidas" genérico aún cuando el backend devolvía 429 (rate-limit) — confundía al usuario haciéndolo reintentar y multiplicando el bloqueo.
