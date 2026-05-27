# Pruebas con ngrok

Permite exponer Flotillas v2 en una URL pública para probar desde celulares, dispositivos externos o compartir con alguien para feedback.

## Cómo funciona

Un solo túnel ngrok apunta al puerto 3000 (Next.js). Next.js hace **proxy interno** del prefijo `/api/*` hacia la API local en el puerto 3001 (configurado en `web/next.config.ts`).

```
Internet ─► ngrok ─► localhost:3000 (Next.js) ─► /api/* ─► localhost:3001 (API)
                                              └► resto ─► páginas Next.js
```

Ventajas:
- Un solo túnel (compatible con plan free de ngrok).
- Sin problemas de CORS ni cookies cross-domain — todo viaja por el mismo origen.
- No hace falta cambiar variables de entorno cuando cambia la URL del túnel.

## Setup inicial (una sola vez)

1. **Crear cuenta gratuita** en https://dashboard.ngrok.com/signup
2. **Copiar tu authtoken** desde https://dashboard.ngrok.com/get-started/your-authtoken
3. **Autenticar el agente local:**
   ```powershell
   ngrok config add-authtoken TU_TOKEN_AQUI
   ```

## Uso diario

```
doble click  →  start-ngrok.bat
```

El script:
1. Arranca Docker Desktop si está apagado.
2. Levanta Postgres + Redis.
3. Abre la API (ventana "Flotillas API") con `npm run dev`.
4. Abre el Web (ventana "Flotillas Web") con `npm run dev`.
5. Lanza `ngrok http 3000` en una tercera ventana.
6. Obtiene la URL pública y abre el navegador en ella.
7. Abre el inspector de ngrok en http://localhost:4040

Para apagar todo:

```
doble click  →  stop-ngrok.bat
```

## URLs útiles

| Qué | Dónde |
|---|---|
| Web local | http://localhost:3000 |
| API local | http://localhost:3001 |
| Inspector ngrok (logs, replay) | http://localhost:4040 |
| URL pública del túnel | (cambia en cada arranque, sale en la ventana de ngrok) |
| Portal público remoto | `<URL_PUBLICA>/cargas/registro-rapido` |
| Dashboard remoto | `<URL_PUBLICA>/` |

## Limitaciones del plan free

- **La URL cambia en cada arranque** (`xxxx-xxx.ngrok-free.app`). Si compartes el link y reinicias, tienes que volver a compartir.
- **Pantalla de advertencia** en la primera visita del navegador (clic en "Visit Site").
- **1 sesión simultánea** por authtoken.
- Para tener una URL fija necesitas un dominio reservado en https://dashboard.ngrok.com/cloud-edge/domains (plan free incluye uno).

## Si quieres URL fija (dominio reservado)

1. Reserva un dominio en https://dashboard.ngrok.com/cloud-edge/domains, ej. `flotillas-pruebas.ngrok-free.app`.
2. Edita `start-ngrok.bat` y cambia:
   ```
   start "ngrok" cmd /k "ngrok http 3000 --log=stdout"
   ```
   por:
   ```
   start "ngrok" cmd /k "ngrok http --domain=flotillas-pruebas.ngrok-free.app 3000 --log=stdout"
   ```

## Cambios técnicos hechos en el repo

- `web/next.config.ts` — añadido `rewrites` (/api → API local) y `allowedDevOrigins` (acepta dominios ngrok).
- `web/.env.local` — `NEXT_PUBLIC_API_URL=""` para que el cliente use rutas relativas.
- `web/src/lib/api.ts`, `web/src/hooks/useReports.ts`, `web/src/app/cargas/registro-rapido/page.tsx`, `web/src/app/(dashboard)/maintenance/page.tsx`, `web/src/app/(dashboard)/vehicles/[id]/page.tsx` — fallback cambiado de `||` a `??` para respetar la cadena vacía.
- `start-ngrok.bat`, `stop-ngrok.bat` — scripts de arranque/apagado.

Nada de esto rompe el flujo de `start.bat` original (sigue funcionando para uso local sin ngrok), salvo que ahora el web también puede levantarse con `npm run dev` y que `.env.local` apunta a rutas relativas. Si quieres volver al comportamiento previo en local, basta con borrar `web/.env.local` o setear `NEXT_PUBLIC_API_URL=http://localhost:3001` ahí.

## Troubleshooting

**"ERR_NGROK_4018" o pide authtoken**
→ No has corrido `ngrok config add-authtoken ...`. Ver Setup inicial.

**La API responde 401 desde la URL pública pero local funciona**
→ Asegúrate de haber hecho login *desde la URL pública* (no desde localhost). La cookie JWT se asocia al dominio.

**`ngrok http 3000` falla con "tunnel session failed"**
→ Otra sesión de ngrok activa. Cierra `ngrok.exe` con `stop-ngrok.bat` y vuelve a intentar.

**Cambios en código no se reflejan**
→ El script usa `npm run dev` (hot reload). Si modificas `next.config.ts` o `.env.local`, reinicia el web (cierra la ventana "Flotillas Web" y vuelve a correr `start-ngrok.bat`).

**Postal Turnstile (captcha) bloquea el registro público**
→ En dev `TURNSTILE_SECRET` está vacío en `.env`, el portal acepta cualquier token. Si lo activaste, registra `*.ngrok-free.app` en Cloudflare Turnstile como hostname permitido.
