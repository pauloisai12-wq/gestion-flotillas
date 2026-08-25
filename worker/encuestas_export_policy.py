"""Límites, payload y rutas seguras del ZIP de Encuestas Okrean."""

import os
import re
from datetime import datetime, time, timedelta, timezone

EXPORT_BATCH_SIZE = 250
MAX_ENCUESTAS_EXPORT_RECORDS = 50_000
MAX_ENCUESTAS_EXPORT_SOURCE_BYTES = 1024 * 1024 * 1024
ENCUESTAS_EXPORT_GENERIC_ERROR = (
    "No se pudo generar la exportación de encuestas; reintenta más tarde"
)
SHA256_RE = re.compile(r"^[a-f0-9]{64}$")
SEGMENT_RE = re.compile(r"^[A-Za-z0-9._-]{1,64}$")
ID_LOCAL_RE = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$",
    re.IGNORECASE,
)


class EncuestasExportValidationError(ValueError):
    """Error de dominio cuyo texto sí puede mostrarse al revisor."""


def public_encuestas_export_error(error):
    if isinstance(error, EncuestasExportValidationError):
        return str(error)
    return ENCUESTAS_EXPORT_GENERIC_ERROR


def checked_record_count(current, maximum):
    next_count = int(current) + 1
    if next_count > int(maximum):
        raise EncuestasExportValidationError(
            f"La exportación excede el máximo de {int(maximum)} encuestas"
        )
    return next_count


def checked_source_bytes(
    current,
    added,
    maximum=MAX_ENCUESTAS_EXPORT_SOURCE_BYTES,
):
    current = int(current)
    added = int(added)
    maximum = int(maximum)
    if current < 0 or added < 0 or maximum < 1:
        raise EncuestasExportValidationError("Tamaño de audio inválido")
    next_size = current + added
    if next_size > maximum:
        raise EncuestasExportValidationError(
            "Los audios del rango exceden el máximo de 1 GiB; divide el rango"
        )
    return next_size


def _parse_timestamp(payload, key):
    try:
        return datetime.fromisoformat(str(payload[key]).replace("Z", "+00:00"))
    except (KeyError, TypeError, ValueError) as exc:
        raise EncuestasExportValidationError(
            "Rango de exportación inválido"
        ) from exc


def validate_export_payload(payload):
    if not isinstance(payload, dict):
        raise EncuestasExportValidationError("Payload de exportación inválido")
    date_from = _parse_timestamp(payload, "dateFrom")
    date_to_exclusive = _parse_timestamp(payload, "dateToExclusive")
    date_to = payload.get("dateTo")
    if not isinstance(date_to, str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", date_to):
        raise EncuestasExportValidationError("Fecha final de exportación inválida")
    if date_from.tzinfo is None or date_to_exclusive.tzinfo is None:
        raise EncuestasExportValidationError("El rango debe incluir zona horaria")
    date_from = date_from.astimezone(timezone.utc)
    date_to_exclusive = date_to_exclusive.astimezone(timezone.utc)
    if date_from.time() != time.min or date_to_exclusive.time() != time.min:
        raise EncuestasExportValidationError("El rango debe empezar en medianoche UTC")
    try:
        expected_to_exclusive = (
            datetime.fromisoformat(date_to).replace(tzinfo=timezone.utc)
            + timedelta(days=1)
        )
    except ValueError as exc:
        raise EncuestasExportValidationError(
            "Fecha final de exportación inválida"
        ) from exc
    if date_to_exclusive != expected_to_exclusive:
        raise EncuestasExportValidationError("La fecha final no coincide con el rango")
    if date_to_exclusive <= date_from:
        raise EncuestasExportValidationError("Rango de exportación vacío")
    if (date_to_exclusive - date_from).days > 366:
        raise EncuestasExportValidationError(
            "El rango máximo de exportación es 366 días"
        )
    try:
        max_records = int(payload["maxRecords"])
    except (KeyError, TypeError, ValueError) as exc:
        raise EncuestasExportValidationError(
            "Límite de encuestas inválido"
        ) from exc
    if max_records < 1 or max_records > MAX_ENCUESTAS_EXPORT_RECORDS:
        raise EncuestasExportValidationError(
            "Límite de encuestas de exportación inválido"
        )

    estado = payload.get("estado")
    if estado is not None and estado not in {"completada", "noElegible"}:
        raise EncuestasExportValidationError("Estado de encuesta inválido")
    con_audio = payload.get("conAudio")
    if con_audio is not None and type(con_audio) is not bool:
        raise EncuestasExportValidationError("Filtro de audio inválido")
    dispositivo = payload.get("dispositivo")
    if dispositivo is not None and (
        not isinstance(dispositivo, str) or not (1 <= len(dispositivo) <= 120)
    ):
        raise EncuestasExportValidationError("Filtro de dispositivo inválido")

    return {
        "date_from": date_from,
        "date_to_exclusive": date_to_exclusive,
        "date_from_label": date_from.date().isoformat(),
        "date_to_label": date_to,
        "max_records": max_records,
        "estado": estado,
        "con_audio": con_audio,
        "dispositivo": dispositivo,
    }


def confined_audio_path(storage_root, ruta, sha256):
    if not isinstance(ruta, str) or not SHA256_RE.fullmatch(str(sha256)):
        return None
    expected = f"encuestas-audio/{sha256}.m4a"
    if ruta != expected:
        return None
    base = os.path.realpath(storage_root)
    candidate = os.path.realpath(os.path.join(base, f"{sha256}.m4a"))
    try:
        if os.path.commonpath([base, candidate]) != base:
            return None
    except ValueError:
        return None
    return candidate


def archive_audio_name(id_local, segmento):
    if not isinstance(id_local, str) or not ID_LOCAL_RE.fullmatch(id_local):
        return None
    if not isinstance(segmento, str) or not SEGMENT_RE.fullmatch(segmento):
        return None
    return f"audios/{id_local}/{segmento}"


def artifact_download_name(filters):
    suffix = ""
    if filters["con_audio"] is True:
        suffix = "-con-audio"
    elif filters["con_audio"] is False:
        suffix = "-sin-audio"
    return (
        f"encuestas-{filters['date_from_label']}_"
        f"{filters['date_to_label']}{suffix}.zip"
    )
