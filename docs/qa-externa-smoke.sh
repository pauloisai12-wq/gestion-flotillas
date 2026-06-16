#!/usr/bin/env bash
# Smoke test de qa_externa. Cubre los criterios de aceptación con curl.
#
# Uso:
#   BASE_URL=http://localhost:3001 KEY="<api_key del dispositivo>" bash docs/qa-externa-smoke.sh
#
# BASE_URL debe apuntar a la API (directo a :3001 en dev, o vía Caddy en staging).
# Genera el dispositivo antes con: npm run qa:device:register (y usa la key impresa).
set -uo pipefail

BASE_URL="${BASE_URL:-http://localhost:3001}"
KEY="${KEY:?Define KEY con la API key del dispositivo}"
TMP="$(mktemp -d)"
IMG="$TMP/evidencia.jpg"
UUID="$(cat /proc/sys/kernel/random/uuid)"

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

echo ""
echo "Resultado: $pass OK, $fail fallos."
rm -rf "$TMP"
[ "$fail" -eq 0 ]
