"""Límites y validación pura del export QA (sin dependencias de BD)."""

import os
import re
from datetime import datetime


EXPORT_BATCH_SIZE = 250
MAX_QA_EXPORT_RECORDS = 50_000
MAX_QA_EXPORT_SOURCE_BYTES = 1024 * 1024 * 1024
SHA256_RE = re.compile(r"^[a-f0-9]{64}$")
QA_EXPORT_GENERIC_ERROR = "No se pudo generar la exportación QA; reintenta más tarde"


class QaExportValidationError(ValueError):
    """Error de dominio con texto público controlado por el worker."""


def public_qa_export_error(error):
    if isinstance(error, QaExportValidationError):
        return str(error)
    return QA_EXPORT_GENERIC_ERROR


def checked_record_count(current, maximum):
    next_count = int(current) + 1
    if next_count > int(maximum):
        raise QaExportValidationError(
            f"La exportación excede el máximo de {int(maximum)} registros",
        )
    return next_count


def checked_source_bytes(current, added, maximum=MAX_QA_EXPORT_SOURCE_BYTES):
    current = int(current)
    added = int(added)
    maximum = int(maximum)
    if current < 0 or added < 0 or maximum < 1:
        raise QaExportValidationError("Tamaño de imagen inválido")
    next_size = current + added
    if next_size > maximum:
        raise QaExportValidationError(
            "Las imágenes del rango exceden el máximo de 1 GiB; divide el rango",
        )
    return next_size


def validate_export_payload(payload):
    if not isinstance(payload, dict):
        raise QaExportValidationError("Payload de exportación inválido")
    programa = payload.get("programa")
    if programa not in {"BUFFALO", "LX"}:
        raise QaExportValidationError("Programa de exportación inválido")
    try:
        date_from = datetime.fromisoformat(
            str(payload["dateFrom"]).replace("Z", "+00:00")
        )
        date_to = datetime.fromisoformat(
            str(payload["dateToExclusive"]).replace("Z", "+00:00")
        )
        max_records = int(payload["maxRecords"])
    except (KeyError, TypeError, ValueError) as exc:
        raise QaExportValidationError("Rango o límite de exportación inválido") from exc
    if date_to <= date_from:
        raise QaExportValidationError("Rango de exportación vacío")
    if (date_to - date_from).days > 366:
        raise QaExportValidationError("El rango máximo de exportación es 366 días")
    if max_records < 1 or max_records > MAX_QA_EXPORT_RECORDS:
        raise QaExportValidationError("Límite de registros de exportación inválido")
    return programa, date_from, date_to, max_records


def confined_photo_path(storage_root, programa, sha256):
    if programa not in {"BUFFALO", "LX"} or not SHA256_RE.fullmatch(sha256):
        return None
    subdir = "buffalo" if programa == "BUFFALO" else "lx"
    base = os.path.realpath(os.path.join(storage_root, subdir))
    candidate = os.path.realpath(os.path.join(base, f"{sha256}.jpg"))
    try:
        if os.path.commonpath([base, candidate]) != base:
            return None
    except ValueError:
        return None
    return candidate


def spreadsheet_text(value):
    """Neutraliza fórmulas sin convertir columnas numéricas/fecha del caller."""
    if value is None:
        return ""
    text = str(value)
    if text.startswith(("=", "+", "-", "@")):
        return f"'{text}"
    return text
