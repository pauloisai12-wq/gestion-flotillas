# Sesión 2026-05-24 — Flujo de tickets de mantenimiento

Resumen legible de la conversación que construyó el flujo de tickets de mantenimiento
correctivo. El transcript completo está en `2026-05-24-tickets-mantenimiento.jsonl`
(mismo directorio).

## Qué se construyó

Flujo de mantenimiento correctivo con 3 roles, cada uno con su propia experiencia:

| Rol | Zona | Puede |
|-----|------|-------|
| **Administrador** / Sup. mantenimiento | Panel completo | Ve toda la flota; filtro inicial (aprueba/rechaza); asigna 3 talleres; decide cotización ganadora viendo presupuesto vs costo |
| **Ejecutor** | Solo `/tickets` | Ve su flotilla; solicita mantenimiento; ve estado de sus solicitudes (4 estados) |
| **Taller** | Solo `/tickets` | Ve solo unidades asignadas a él; sube cotización (PDF + monto + diagnóstico); inicia y finaliza reparación |

### Máquina de estados (backend, 7 estados internos)

```
PENDING_ADMIN_APPROVAL ──reject──> REJECTED_BY_ADMIN
        │ assign 3 talleres
        ▼
   AWAITING_QUOTES ──reject──> REJECTED_FINAL
        │ approve (elige cotización + concepto)
        ▼
  APPROVED_FOR_REPAIR ──start──> IN_REPAIR ──complete──> COMPLETED
```

El **ejecutor** ve estos 7 agrupados en 4 (mapeo "natural"):
- `Pendiente` = PENDING_ADMIN_APPROVAL + AWAITING_QUOTES
- `Aceptado` = APPROVED_FOR_REPAIR + IN_REPAIR
- `No aceptado` = REJECTED_BY_ADMIN + REJECTED_FINAL
- `Finalizado` = COMPLETED

El **taller** completa en **dos pasos**: Iniciar reparación → Finalizar servicio.

## Cambios de esta sesión (sobre Fases 1-3 ya existentes)

1. **Control de acceso por rol** (`web/src/lib/access.ts`): ejecutor y taller solo
   acceden a `/tickets`; el `(dashboard)/layout.tsx` los redirige si entran a una
   ruta vedada; `/dashboard` redirige según rol (`getHomePath`).

2. **Tres vistas diferenciadas** en `/tickets` (`page.tsx` ramifica por rol):
   - `AdminTicketsView` — lista completa, 7 estados.
   - `ExecutorTicketsView` — estado de solicitudes arriba (4 estados) + flotilla
     como **lista** con botón "Solicitar mantenimiento" por fila.
   - `WorkshopTicketsView` — unidades agrupadas por acción (Por valorizar →
     Iniciar → Finalizar), cada tarjeta con botón de acción explícito; basada en
     `/ticket-quotes/mine`.

3. **Privacidad del taller (fuga corregida)** en `getTicketById`
   (`api/src/services/maintenanceTicketService.ts`): el taller solo recibe su
   propia cotización (nunca las ajenas ni la ganadora si es de otro); el ejecutor
   no recibe cotizaciones (solo estado). Admin/supervisor ven todas.

## Decisiones tomadas (con el usuario)

- Estados del ejecutor: **agrupación natural** (4 buckets).
- Cierre del taller: **dos pasos** (iniciar → finalizar), sin cambio de backend.
- Flotilla del ejecutor: **lista**, no tarjetas; botón al final de cada fila.

## ⚠️ Caveat de entorno (WSL + Windows)

Los `npm run dev` lanzados desde WSL ejecutan el **node.exe de Windows** (primero en
el PATH), así que API (3001) y web (3000) escuchan en el **localhost de Windows**:

- Desde WSL hay que usar el **gateway IP** (`ip route show default | awk '{print $3}'`,
  típicamente `172.26.48.1`) para alcanzarlos; `localhost` desde WSL no responde.
- **Hot-reload roto:** ni `tsx watch` (API) ni el watcher de Next/Turbopack (web)
  detectan ediciones a `/mnt/c` hechas desde WSL. Tras cualquier cambio de código hay
  que **reiniciar el server** (`taskkill.exe /F /PID <pid>` + relanzar) y hard-refresh
  en el navegador, o se sirve código viejo aunque el typecheck pase.

## Credenciales demo

| Rol | Email | Password |
|-----|-------|----------|
| Admin | admin@flotillas.com | admin123 |
| Ejecutor | ejecutor1@flotillas.com / ejecutor2@ | ejecutor123 |
| Taller | taller1@flotillas.com / taller2@ / taller3@ | taller123 |
