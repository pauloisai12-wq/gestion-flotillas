#!/usr/bin/env bash
# Smoke test de qa_externa. Cubre los criterios de aceptación con curl, para las
# DOS capturas de GeoCampo: la evidencia (/ingest) y el registro de personas
# (/personas). Solo escribe filas de prueba; no borra ni modifica nada existente.
#
# Uso:
#   BASE_URL=http://localhost:3001 KEY="<api_key del dispositivo>" bash docs/qa-externa-smoke.sh
#
# BASE_URL debe apuntar a la API (directo a :3001 en dev, o vía Caddy en staging).
# Genera el dispositivo antes con: npm run qa:device:register (y usa la key impresa).
#
# Opcional: REVISOR_TOKEN="<JWT de un usuario REVISOR_QA>" añade la comprobación
# del CSV (solo lectura, un GET; no escribe nada).
set -uo pipefail

BASE_URL="${BASE_URL:-http://localhost:3001}"
KEY="${KEY:?Define KEY con la API key del dispositivo}"
TMP="$(mktemp -d)"
IMG="$TMP/evidencia.jpg"
UUID="$(cat /proc/sys/kernel/random/uuid)"
# UUIDs propios del registro de personas: la idempotencia es por captura, así que
# no se reutiliza el de la evidencia.
PUUID="$(cat /proc/sys/kernel/random/uuid)"
PUUID_JSON="$(cat /proc/sys/kernel/random/uuid)"
# Fila sin accuracy: sirve para dos cosas a la vez — que el alta pase con 200 y
# que su celda "Precisión (m)" salga vacía en el CSV del revisor.
PUUID_SIN_ACC="$(cat /proc/sys/kernel/random/uuid)"

# JPEG válido mínimo (1x1) — magic bytes FFD8FF, suficiente para file-type.
base64 -d > "$IMG" <<'B64'
/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0a
HBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAA
AAAAAAAAAAAAAP/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AfwD/2Q==
B64

pass=0; fail=0
check () { # $1=descripción $2=esperado $3=obtenido
  if [ "$2" = "$3" ]; then echo "✅ $1 (HTTP $3)"; pass=$((pass+1));
  else echo "❌ $1 — esperado $2, obtenido $3"; fail=$((fail+1)); fi
}

post () { # imprime el código HTTP de un POST de ingesta con el UUID dado
  curl -s -o "$TMP/out.json" -w '%{http_code}' \
    -H "Authorization: Bearer $KEY" \
    -F "cliente_registro_id=$1" \
    -F "identificador_app=smoke-test" \
    -F "lat=19.432608" -F "lng=-99.133209" \
    -F "capturado_at=2026-06-15T18:30:00.000Z" \
    -F 'metadata={"tipo":"lona","notas":null}' \
    -F "imagenes[]=@$IMG;type=image/jpeg;filename=$1.jpg" \
    "$BASE_URL/api/qa-externa/ingest"
}

# El registro de personas no lleva archivos y acepta DOS content-types: la app
# reutiliza su uploader multipart, otros clientes mandan JSON. Se prueban ambos.
post_persona () { # $1=cliente_registro_id $2=telefono → código HTTP (multipart)
  curl -s -o "$TMP/persona.json" -w '%{http_code}' \
    -H "Authorization: Bearer $KEY" \
    -F "cliente_registro_id=$1" \
    -F "identificador_app=smoke-test" \
    -F "nombre=Persona Smoke" \
    -F "telefono=$2" \
    -F "lat=19.432608" -F "lng=-99.133209" -F "accuracy=8.5" \
    -F "capturado_at=2026-06-15T18:30:00.000Z" \
    "$BASE_URL/api/qa-externa/personas"
}

post_persona_json () { # $1=cliente_registro_id → código HTTP (application/json)
  curl -s -o "$TMP/persona.json" -w '%{http_code}' \
    -H "Authorization: Bearer $KEY" \
    -H 'Content-Type: application/json' \
    --data "{\"cliente_registro_id\":\"$1\",\"identificador_app\":\"smoke-test\",\"nombre\":\"Persona Smoke JSON\",\"telefono\":\"+52 55 1234 5678\",\"lat\":19.432608,\"lng\":-99.133209,\"capturado_at\":\"2026-06-15T18:30:00.000Z\"}" \
    "$BASE_URL/api/qa-externa/personas"
}

# Cuerpo JSON a medida: los casos de lat/lng nula solo se pueden expresar en
# JSON (en multipart todo viaja como texto y un null es inexpresable).
post_persona_json_crudo () { # $1=cuerpo JSON completo → código HTTP
  curl -s -o "$TMP/persona.json" -w '%{http_code}' \
    -H "Authorization: Bearer $KEY" \
    -H 'Content-Type: application/json' \
    --data "$1" \
    "$BASE_URL/api/qa-externa/personas"
}

# Igual que post_persona pero SIN el campo accuracy: el GPS no siempre reporta
# precisión y la columna es nullable.
post_persona_sin_accuracy () { # $1=cliente_registro_id → código HTTP (multipart)
  curl -s -o "$TMP/persona.json" -w '%{http_code}' \
    -H "Authorization: Bearer $KEY" \
    -F "cliente_registro_id=$1" \
    -F "identificador_app=smoke-test" \
    -F "nombre=Persona Sin Precision" \
    -F "telefono=5512345678" \
    -F "lat=19.432608" -F "lng=-99.133209" \
    -F "capturado_at=2026-06-15T18:30:00.000Z" \
    "$BASE_URL/api/qa-externa/personas"
}

registro_id () { # $1=archivo con la respuesta JSON → imprime el registro_id
  grep -o '"registro_id":[0-9]*' "$1" | grep -o '[0-9]*'
}

echo "== ping =="
code=$(curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $KEY" "$BASE_URL/api/qa-externa/ping")
check "ping con key válida" "200" "$code"
code=$(curl -s -o /dev/null -w '%{http_code}' "$BASE_URL/api/qa-externa/ping")
check "ping sin key" "401" "$code"
code=$(curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer no-sirve" "$BASE_URL/api/qa-externa/ping")
check "ping con key inválida" "401" "$code"

echo "== probar conexión (GET /ingest) =="
code=$(curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $KEY" "$BASE_URL/api/qa-externa/ingest")
check "GET /ingest con key → 405" "405" "$code"
code=$(curl -s -o /dev/null -w '%{http_code}' "$BASE_URL/api/qa-externa/ingest")
check "GET /ingest sin key → 401" "401" "$code"

# Misma red de seguridad en /personas: con key válida el método equivocado debe
# devolver 405, NO el 401 del comodín /api (que el móvil leería como "API key
# inválida" y dispararía una reconfiguración innecesaria).
code=$(curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $KEY" "$BASE_URL/api/qa-externa/personas")
check "GET /personas con key → 405 (no 401)" "405" "$code"
code=$(curl -s -o /dev/null -w '%{http_code}' "$BASE_URL/api/qa-externa/personas")
check "GET /personas sin key → 401" "401" "$code"

echo "== ingesta + idempotencia =="
code=$(post "$UUID"); check "primer POST" "200" "$code"
id1=$(grep -o '"registro_id":[0-9]*' "$TMP/out.json" | grep -o '[0-9]*')
code=$(post "$UUID"); check "reintento mismo UUID" "200" "$code"
id2=$(grep -o '"registro_id":[0-9]*' "$TMP/out.json" | grep -o '[0-9]*')
if [ -n "$id1" ] && [ "$id1" = "$id2" ]; then echo "✅ idempotencia: mismo registro_id ($id1)"; pass=$((pass+1));
else echo "❌ idempotencia: registro_id distinto ($id1 vs $id2)"; fail=$((fail+1)); fi

echo "== auth + validación =="
code=$(curl -s -o /dev/null -w '%{http_code}' \
  -F "cliente_registro_id=$(cat /proc/sys/kernel/random/uuid)" \
  -F "identificador_app=x" -F "lat=0" -F "lng=0" \
  -F "capturado_at=2026-06-15T18:30:00.000Z" \
  -F 'metadata={"tipo":"lona","notas":null}' \
  -F "imagenes[]=@$IMG;type=image/jpeg;filename=x.jpg" \
  "$BASE_URL/api/qa-externa/ingest")
check "POST sin Authorization → 401" "401" "$code"

code=$(curl -s -o /dev/null -w '%{http_code}' \
  -H "Authorization: Bearer $KEY" \
  -F "cliente_registro_id=$(cat /proc/sys/kernel/random/uuid)" \
  -F "identificador_app=x" -F "lat=0" -F "lng=0" \
  -F "capturado_at=2026-06-15T18:30:00.000Z" \
  -F 'metadata={"tipo":"NO_EXISTE","notas":null}' \
  -F "imagenes[]=@$IMG;type=image/jpeg;filename=x.jpg" \
  "$BASE_URL/api/qa-externa/ingest")
check "tipo inválido → 400" "400" "$code"

echo "== personas: alta + idempotencia =="
code=$(post_persona "$PUUID" "+52 55 1234 5678"); check "primer POST /personas (multipart)" "200" "$code"
pid1=$(registro_id "$TMP/persona.json")
code=$(post_persona "$PUUID" "+52 55 1234 5678"); check "reintento mismo UUID" "200" "$code"
pid2=$(registro_id "$TMP/persona.json")
if [ -n "$pid1" ] && [ "$pid1" = "$pid2" ]; then echo "✅ idempotencia personas: mismo registro_id ($pid1)"; pass=$((pass+1));
else echo "❌ idempotencia personas: registro_id distinto ($pid1 vs $pid2)"; fail=$((fail+1)); fi

code=$(post_persona_json "$PUUID_JSON"); check "POST /personas (application/json)" "200" "$code"

echo "== personas: auth + validación =="
code=$(curl -s -o /dev/null -w '%{http_code}' \
  -F "cliente_registro_id=$(cat /proc/sys/kernel/random/uuid)" \
  -F "identificador_app=smoke-test" \
  -F "nombre=Persona Smoke" -F "telefono=5512345678" \
  -F "lat=19.432608" -F "lng=-99.133209" \
  -F "capturado_at=2026-06-15T18:30:00.000Z" \
  "$BASE_URL/api/qa-externa/personas")
check "POST /personas sin Authorization → 401" "401" "$code"

# 'no-es-telefono' no pasa el patrón de caracteres admitidos.
code=$(post_persona "$(cat /proc/sys/kernel/random/uuid)" "no-es-telefono")
check "teléfono inválido → 400" "400" "$code"

# '12 - 34' pasa el patrón de caracteres (7 chars admitidos) pero solo tiene 4
# dígitos reales: verifica el refine de conteo, no el regex.
code=$(post_persona "$(cat /proc/sys/kernel/random/uuid)" "12 - 34")
check "teléfono con muy pocos dígitos → 400" "400" "$code"

echo "== personas: lat/lng nulas se rechazan (no se cuelan como 0,0) =="
# Number(null) === 0, así que sin la guarda previa al coerce esto se guardaría
# con 200 OK como una captura en el golfo de Guinea.
code=$(post_persona_json_crudo "{\"cliente_registro_id\":\"$(cat /proc/sys/kernel/random/uuid)\",\"identificador_app\":\"smoke-test\",\"nombre\":\"Persona Smoke\",\"telefono\":\"5512345678\",\"lat\":null,\"lng\":-99.133209,\"capturado_at\":\"2026-06-15T18:30:00.000Z\"}")
check "lat:null → 400" "400" "$code"

code=$(post_persona_json_crudo "{\"cliente_registro_id\":\"$(cat /proc/sys/kernel/random/uuid)\",\"identificador_app\":\"smoke-test\",\"nombre\":\"Persona Smoke\",\"telefono\":\"5512345678\",\"lat\":19.432608,\"lng\":\"\",\"capturado_at\":\"2026-06-15T18:30:00.000Z\"}")
check 'lng:"" → 400' "400" "$code"

echo "== personas: accuracy es opcional (ausente/null → NULL, nunca 0) =="
code=$(post_persona_sin_accuracy "$PUUID_SIN_ACC")
check "POST /personas sin accuracy → 200" "200" "$code"

code=$(post_persona_json_crudo "{\"cliente_registro_id\":\"$(cat /proc/sys/kernel/random/uuid)\",\"identificador_app\":\"smoke-test\",\"nombre\":\"Persona Smoke\",\"telefono\":\"5512345678\",\"lat\":19.432608,\"lng\":-99.133209,\"accuracy\":null,\"capturado_at\":\"2026-06-15T18:30:00.000Z\"}")
check "accuracy:null → 200" "200" "$code"

code=$(post_persona_json_crudo "{\"cliente_registro_id\":\"$(cat /proc/sys/kernel/random/uuid)\",\"identificador_app\":\"smoke-test\",\"nombre\":\"Persona Smoke\",\"telefono\":\"5512345678\",\"lat\":19.432608,\"lng\":-99.133209,\"accuracy\":-1,\"capturado_at\":\"2026-06-15T18:30:00.000Z\"}")
check "accuracy negativa → 400" "400" "$code"

# Lado REVISOR (opcional): confirma que la precisión ausente llega al CSV como
# celda VACÍA, no como el texto "null" ni como 0. Es un GET, no escribe nada.
if [ -n "${REVISOR_TOKEN:-}" ]; then
  echo "== CSV del revisor: precisión vacía =="
  code=$(curl -s -o "$TMP/personas.csv" -w '%{http_code}' \
    -H "Authorization: Bearer $REVISOR_TOKEN" \
    "$BASE_URL/api/qa-externa-personas/export.csv?dateFrom=2026-06-15&dateTo=2026-06-15")
  check "GET export.csv con sesión de revisor" "200" "$code"
  # Columnas: Nombre,Teléfono,Latitud,Longitud,Precisión (m),… → la 5ª.
  fila=$(grep -F "$PUUID_SIN_ACC" "$TMP/personas.csv" | head -n1)
  prec=$(printf '%s' "$fila" | cut -d, -f5)
  if [ -n "$fila" ] && [ -z "$prec" ]; then
    echo "✅ CSV: la fila sin accuracy trae la precisión vacía"; pass=$((pass+1));
  else
    echo "❌ CSV: precisión esperada vacía, obtenida '$prec' (fila: ${fila:-NO ENCONTRADA})"; fail=$((fail+1));
  fi
else
  echo "== CSV del revisor: omitido (define REVISOR_TOKEN con un JWT de rol REVISOR_QA) =="
fi

echo ""
echo "Resultado: $pass OK, $fail fallos."
rm -rf "$TMP"
[ "$fail" -eq 0 ]
