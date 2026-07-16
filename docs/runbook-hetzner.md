# Runbook operativo — Hetzner Cloud

## 1. Alcance y objetivos

Este documento es la fuente vigente para `deploy-public.sh` y
`docker-compose.public.yml` en un VPS dedicado de Hetzner Cloud. El servidor de
casa, WireGuard, LUKS y el servicio vecino son legado y no forman parte de esta
operación.

- RPO objetivo: **6 horas**. Solo se cumple si el último bundle cifrado ya está
  fuera del VPS y tiene menos de 360 minutos.
- RTO objetivo: **120 minutos**, desde la declaración del incidente hasta el
  smoke test público y los flujos críticos aprobados.
- Perfil soportado: `docker compose --env-file .env -p flotillas -f
  docker-compose.yml -f docker-compose.public.yml`.
- Nunca ejecutar `docker compose down -v`: elimina los volúmenes de datos.

## 2. Base de infraestructura

Mínimo recomendado: 2 vCPU, 4 GiB RAM y 40 GiB de disco. Los servicios
permanentes tienen aproximadamente 3 GiB de límite de memoria agregado; los
one-shot `storage-init` y `migrate` agregan picos breves. Si el host tiene menos
de 4 GiB, no aumentar concurrencia y revisar OOM antes de atribuir una caída a la
aplicación.

En Hetzner Cloud Firewall:

| Entrada | Origen |
|---|---|
| TCP 22 | solo CIDR administrativo |
| TCP 80 | `0.0.0.0/0` para ACME/redirect |
| TCP 443 | `0.0.0.0/0` |

No publicar 3000, 3001, 5432, 6379 ni el socket Docker. El merge Compose limpia
esos puertos y CI lo valida. El perfil actual enlaza Caddy solo en IPv4; no
publicar un registro DNS AAAA hasta agregar bindings IPv6 explícitos y probar
firewall/ACME. Antes de desplegar:

```bash
chmod 600 .env
docker compose --env-file .env -p flotillas \
  -f docker-compose.yml -f docker-compose.public.yml config --quiet
docker compose --env-file .env -p flotillas \
  -f docker-compose.yml -f docker-compose.public.yml config --format json |
  python3 scripts/ops/validate_public_compose.py
```

El despliegue permitido es `./deploy-public.sh`; la migración one-shot rechaza
un arranque directo sin la guardia de backup.

## 3. Cuotas y logs

| Servicio | RAM | CPU | PIDs |
|---|---:|---:|---:|
| postgres | 768 MiB | 1.0 | 256 |
| redis | 256 MiB | 0.5 | 128 |
| api | 512 MiB | 1.0 | 256 |
| web | 384 MiB | 0.5 | 256 |
| worker-python | 1 GiB | 1.0 | 256 |
| caddy | 128 MiB | 0.5 | 128 |
| storage-init | 128 MiB | 0.25 | 64 |
| migrate | 384 MiB | 0.5 | 128 |

Todos usan `json-file` con `OPS_LOG_MAX_SIZE=10m` y
`OPS_LOG_MAX_FILES=5`: máximo nominal 50 MiB por contenedor antes de overhead.
No usar `docker logs` como archivo de auditoría; es diagnóstico rotatorio.

Comprobaciones:

```bash
docker compose --env-file .env -p flotillas \
  -f docker-compose.yml -f docker-compose.public.yml ps
docker stats --no-stream
docker inspect flotillas_api --format '{{json .HostConfig.LogConfig}}'
journalctl -u docker --since '-30 min' | grep -Ei 'oom|no space|error'
```

Si hay OOM: identificar el contenedor, conservar logs, medir el payload/job que
lo causó y ajustar código o carga antes de subir la cuota. Si el disco supera
85 %, detener cargas no esenciales, confirmar qué directorio creció y liberar
solo artefactos con una política conocida; no podar volúmenes a ciegas.

## 4. Worker, cola y monitor

El worker escribe cada 15 s un heartbeat atómico local. Estados `ready` y
`busy` con edad máxima de 60 s son saludables. El archivo expone contadores,
ID del último job y clase del último fallo, nunca el payload ni el mensaje de
error. Compose lo marca `unhealthy` si el event loop deja de avanzar.

Consulta puntual:

```bash
docker compose --env-file .env -p flotillas \
  -f docker-compose.yml -f docker-compose.public.yml \
  exec -T worker-python python healthcheck.py --json
python3 scripts/ops/public_monitor.py --env-file .env
```

El monitor devuelve JSON y estos códigos: `0` sano, `1` degradado, `2` error del
monitor o del webhook. Mide estado/health de contenedores y las colas BullMQ
configuradas (`waiting`, `active`, `delayed`, `failed`, `prioritized`) por cola y
en agregado, heartbeat,
uso del filesystem Docker, edad del último backup y, si se configura, el
`/api/health` público. Los umbrales y `OPS_ALERT_WEBHOOK_URL` están en
`.env.public.example`; el cooldown evita tormentas y se envía recuperación.

Unit vigente para el checkout y permisos actuales del host:

```ini
# /etc/systemd/system/flotillas-monitor.service
[Unit]
Description=Monitor operativo flotillas Hetzner
After=docker.service

[Service]
Type=oneshot
User=root
Group=root
WorkingDirectory=/root/gestion-flotillas
Environment=OPS_ALERT_STATE_FILE=/var/lib/flotillas-ops/monitor.json
ExecStart=/usr/bin/python3 /root/gestion-flotillas/scripts/ops/public_monitor.py --env-file /root/gestion-flotillas/.env
StateDirectory=flotillas-ops
UMask=0077
```

El monitor necesita leer el mismo `.env` `0600 root:root`, consultar Docker y
recorrer el checkout bajo `/root`; por eso usa la misma identidad operativa que
el backup. No se debe cambiar solo `User`: checkout, env-file, estado y permisos
deben migrarse como una unidad si después se adopta un usuario dedicado.

```ini
# /etc/systemd/system/flotillas-monitor.timer
[Unit]
Description=Monitor flotillas cada minuto

[Timer]
OnBootSec=2min
OnUnitActiveSec=1min
AccuracySec=10s
Persistent=true

[Install]
WantedBy=timers.target
```

Activación y prueba:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now flotillas-monitor.timer
sudo systemctl start flotillas-monitor.service
journalctl -u flotillas-monitor.service -n 20 --no-pager
systemctl list-timers flotillas-monitor.timer
```

Respuesta a alertas:

- `worker heartbeat stale/unavailable`: ver `docker compose ps`, últimos 100
  logs del worker y OOM; no borrar el job. Reiniciar solo después de preservar
  evidencia. Las leases permiten recuperar un intento vencido.
- `waiting` o `delayed` alto: confirmar si `active=1` progresa y medir duración
  del job. No subir concurrencia sin medir RAM y conexiones PostgreSQL.
- `failed>0`: inspeccionar el job desde la aplicación/Redis sin copiar payloads
  sensibles al ticket; resolver y retirar/reintentar con el flujo soportado.
- disco >=85 %: revisar logs rotados, bundles y volúmenes. Nunca ejecutar
  `docker system prune --volumes`.
- backup ausente o >8 h: ejecutar el backup manual y confirmar la copia off-site.

### 4.1 Simulacro controlado de alertas

Ejecutar en Hetzner durante una ventana avisada, sin jobs activos y **un servicio
a la vez**. El script exige una línea base completamente sana, webhook no vacío
y la frase literal de confirmación. Solo acepta `worker-python` o `api`; un
`trap` de `EXIT`, `INT` y `TERM` vuelve a iniciar el servicio y espera su
healthcheck incluso si el monitor/webhook falla. `SIGKILL` y pérdida del host no
pueden ejecutar ningún trap: confirmar siempre el estado final manualmente.

Usar un estado de alertas separado evita interferir con el cooldown del timer:

```bash
cd /root/gestion-flotillas
export OPS_ALERT_STATE_FILE=/var/lib/flotillas-ops/alert-drill.json

bash scripts/ops/alert-drill-public.sh --env-file .env \
  --service worker-python --confirm HETZNER_ALERT_DRILL

bash scripts/ops/alert-drill-public.sh --env-file .env \
  --service api --confirm HETZNER_ALERT_DRILL
```

Resultado obligatorio para cada ejecución:

1. La línea base imprime JSON `"status":"ok"`; si no, el servicio no se toca.
2. Con `worker-python` detenido, el JSON degradado contiene `container
   worker-python no está running` y heartbeat no disponible. Con `api`, contiene
   `container api no está running`; si se configuró la URL pública también puede
   marcar `/api/health`.
3. El monitor sale `1` y el receptor recibe `[flotillas][ALERTA] ...`. Exit `2`
   significa que el monitor o la entrega del webhook falló y el simulacro no
   aprueba, aunque el trap restaure el servicio.
4. El script inicia el contenedor original, espera hasta 180 s su healthcheck,
   ejecuta el monitor de nuevo y exige JSON `"status":"ok"`.
5. El receptor recibe `[flotillas][RECUPERADO] ...` y el script termina con `OK
   alert drill ...`/exit `0`.

Verificación final independiente:

```bash
docker compose --env-file .env -p flotillas \
  -f docker-compose.yml -f docker-compose.public.yml ps
docker compose --env-file .env -p flotillas \
  -f docker-compose.yml -f docker-compose.public.yml \
  exec -T worker-python python healthcheck.py --json
docker compose --env-file .env -p flotillas \
  -f docker-compose.yml -f docker-compose.public.yml \
  exec -T api wget -qO- http://127.0.0.1:3001/api/health
python3 scripts/ops/public_monitor.py --env-file .env
journalctl -u flotillas-monitor.service -n 20 --no-pager
```

Guardar fecha, operador, ambos mensajes del webhook y salida final. No aprobar el
criterio si cualquiera de los dos servicios queda `unhealthy`, si no hubo
recovery o si fue necesario reiniciarlo manualmente.

## 5. Backups cifrados

Antes del primer despliegue, generar la identidad age **fuera del VPS** y poner
solo su recipient público en `BACKUP_AGE_RECIPIENT`. La identidad privada no va
en `.env`, repositorio, backup ni journal.

Generar también una clave independiente de al menos 32 bytes para
`BACKUP_RECEIPT_HMAC_KEY` (por ejemplo, `openssl rand -base64 48`). Debe quedar
solo en `.env` con modo `0600`: no reutilizar JWT, password de BD ni la identidad
age. Cada backup público publica atómicamente un `receipt.json` modo `0600` que
firma con HMAC el `created_utc`, perfil, nombre del bundle y SHA-256 de
`encrypted.sha256`. El monitor verifica la firma con comparación constante y
calcula la edad desde ese timestamp; nunca usa el `mtime` del directorio. Clave
ausente/débil o receipt faltante/alterado produce degradación explícita.

El receipt no cifra datos ni sustituye la copia off-site ni el simulacro de
restauración: únicamente evita que una marca de tiempo mutable simule frescura.

Cada bundle contiene un dump PostgreSQL custom, uploads, reportes, manifiesto y
checksums. Los datos se transmiten directamente a `age`; no hay temporales en
claro. Para consistencia, el backup periódico corta ingreso y detiene los
escritores que estaban activos, espera hasta 120 s al worker y luego restaura
exactamente esos servicios, esperando sus healthchecks. Mientras dura, publica
un marcador atómico con expiración de 45 minutos: el monitor silencia solamente
la caída esperada de API/Web/worker/Caddy; PostgreSQL, Redis, colas, disco y edad
del backup continúan vigilados. Un marcador vencido o inválido genera alerta.

El backup programado y `deploy-public.sh` comparten
`${BACKUP_DIR}/.flotillas-operation.lock`. Si uno ya está ejecutándose, el otro
aborta antes de tocar servicios; el deploy conserva el lock hasta terminar
migraciones, recuperación y smoke test. No se debe borrar ese archivo para
forzar concurrencia: el lock real lo mantiene el descriptor abierto.

Prueba manual:

```bash
bash scripts/ops/backup-public.sh --env-file .env
```

Timer recomendado cada seis horas, fuera de la mayor carga:

```ini
# /etc/systemd/system/flotillas-backup.service
[Unit]
Description=Backup cifrado flotillas Hetzner
After=docker.service

[Service]
Type=oneshot
User=root
Group=root
WorkingDirectory=/root/gestion-flotillas
ExecStart=/usr/bin/bash /root/gestion-flotillas/scripts/ops/backup-public.sh --env-file /root/gestion-flotillas/.env
TimeoutStartSec=45min
UMask=0077
```

Este unit refleja el host vigente: el repositorio vive bajo `/root`, `.env` es
`0600 root:root` y `${BACKUP_DIR}` es `0700 root:root`. Ejecutarlo como
`flotillas` impediría incluso entrar al directorio, leer la configuración y
abrir el lock. El acceso al socket de Docker ya equivale a privilegios de root;
usar `root` aquí no amplía esa frontera y conserva cerrados los secretos y los
backups. Si el repositorio se migra a `/opt`, deben cambiarse juntos rutas,
propietarios, permisos y este unit antes de volver a un usuario dedicado.

```ini
# /etc/systemd/system/flotillas-backup.timer
[Unit]
Description=Backup flotillas cada 6 horas

[Timer]
OnCalendar=*-*-* 00/6:17:00
RandomizedDelaySec=10min
Persistent=true

[Install]
WantedBy=timers.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now flotillas-backup.timer
sudo systemctl start flotillas-backup.service
journalctl -u flotillas-backup.service -n 50 --no-pager
```

`OPS_BACKUP_RETENTION_COUNT=28` conserva siete días locales con frecuencia de
seis horas. La rotación solo elimina bundles completos con nombre exacto. Esto
no protege contra pérdida del VPS: al finalizar cada backup, copiar el directorio
completo cifrado a un storage con credenciales separadas, retención/versionado y
acceso probado. El RPO se calcula contra la copia off-site confirmada, no contra
el directorio local.

## 6. Verificación y simulacros

Verificación de índices y checksums, sin restaurar:

```bash
BACKUP_AGE_IDENTITY=/run/user/$UID/flotillas-age-identity \
  bash scripts/ops/verify-restore.sh \
    --bundle /var/backups/flotillas/flotillas-public-AAAAMMDDTHHMMSSZ \
    --list-only -- docker compose --env-file .env -p flotillas \
    -f docker-compose.yml -f docker-compose.public.yml
```

Simulacro técnico mensual: descargar primero el bundle más reciente **desde
el storage off-site** a una ruta temporal. Copiar el mismo directorio local no
demuestra que la réplica externa cumpla el RPO.

```bash
BACKUP_AGE_IDENTITY=/run/user/$UID/flotillas-age-identity \
  bash scripts/ops/restore-drill-public.sh --env-file .env \
    --bundle /var/tmp/flotillas-drill/flotillas-public-AAAAMMDDTHHMMSSZ \
    --bundle-source offsite
```

El script descifra `created_utc`, calcula `backup_age_minutes` redondeando hacia
arriba y solo marca `rpo_met=true` si la procedencia declarada es `offsite` y la
edad no supera 360 minutos. Después valida los tres cifrados, restaura el dump en
una base scratch con nombre aleatorio, comprueba relaciones, elimina esa base y
escribe un recibo `flotillas-restore-drill-v1` con hashes, edad, duración,
`rpo_met` y `rto_met`. Un incumplimiento termina con error **después** de publicar
la evidencia. No extrae sobre uploads/reportes ni escribe en `POSTGRES_DB`.
Copiar el recibo junto con la evidencia off-site y exigir `result=success`,
`rpo_met=true` y `rto_met=true`.

`--bundle-source local` permite comprobar técnicamente un bundle local, pero el
recibo queda `result=failure`, `rpo_met=false` y el comando sale con error: no
cuenta como simulacro de RPO.

Una vez por trimestre hacer además un simulacro integral en un proyecto Hetzner
aislado y cronometrado: provisionar VM, recuperar repositorio/.env sin secretos
compartidos, descargar un bundle off-site, ejecutar el simulacro técnico,
restaurar archivos y BD, desplegar, probar login, vehículos, asignaciones y
generación/descarga de reportes. Ese ejercicio, no solo el scratch restore,
demuestra el RTO de negocio.

## 7. Recuperación integral

Solo en una VM de recuperación nueva, sin DNS productivo y con el firewall 443
cerrado inicialmente:

1. Instalar Docker/Compose >=2.24, checkout del commit desplegado y `.env` nuevo.
2. Descargar un bundle completo y verificar sus hashes/scratch restore.
3. Construir imágenes e iniciar solo PostgreSQL/Redis/storage:

   ```bash
   COMPOSE=(docker compose --env-file .env -p flotillas -f docker-compose.yml -f docker-compose.public.yml)
   "${COMPOSE[@]}" build
   "${COMPOSE[@]}" up -d --wait postgres redis
   FLOTILLAS_PREDEPLOY_GUARD=passed-recovery-storage \
     "${COMPOSE[@]}" run --rm --no-deps storage-init
   ```

4. Confirmar que la base destino no contiene relaciones de aplicación. Si no
   está vacía, detenerse: este procedimiento no limpia ni sobreescribe.
5. Restaurar el dump a la base vacía:

   ```bash
   age --decrypt --identity "$BACKUP_AGE_IDENTITY" "$BUNDLE/database.dump.age" |
     "${COMPOSE[@]}" exec -T postgres sh -ceu \
       'exec pg_restore --exit-on-error --no-owner --no-privileges --username="$POSTGRES_USER" --dbname="$POSTGRES_DB"'
   ```

6. Restaurar uploads y reportes después de la validación TAR del paso 2:

   ```bash
   age --decrypt --identity "$BACKUP_AGE_IDENTITY" "$BUNDLE/uploads.tar.age" |
     "${COMPOSE[@]}" run --rm --no-deps -T --entrypoint sh api \
       -ceu 'exec tar -C /app/uploads -xf -'
   age --decrypt --identity "$BACKUP_AGE_IDENTITY" "$BUNDLE/reports.tar.age" |
     "${COMPOSE[@]}" run --rm --no-deps -T --entrypoint sh api \
       -ceu 'exec tar -C /app/storage/reports -xf -'
   ```

7. Ejecutar `./deploy-public.sh`: crea un backup previo de lo restaurado, aplica
   migraciones pendientes y espera healthchecks.
8. Con DNS aún aislado, validar `/api/health`, login por rol, consulta/edición de
   vehículo, asignación y reporte. Registrar tiempos, hashes y responsables.
9. Cambiar DNS/abrir 443 solo con aprobación. Rotar secretos si el incidente fue
   una intrusión.

## 8. Validación local y CI

Sin Docker ni infraestructura remota:

```bash
python3 scripts/ops/backup_receipt.py --check
python3 scripts/ops/public_monitor.py --check
python3 scripts/ops/validate_public_compose.py --check
bash scripts/ops/alert-drill-public.sh --check
bash scripts/ops/backup-public.sh --check
bash scripts/ops/restore-drill-public.sh --check
cd worker && python3 -m unittest discover -s tests -p 'test_*.py' -v
```

CI ejecuta esos self-checks, sintaxis Bash/Python y valida el JSON del merge
Compose. Ninguno despliega, accede a Hetzner ni requiere secretos reales.
