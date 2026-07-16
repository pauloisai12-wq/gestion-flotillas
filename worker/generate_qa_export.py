"""Exportación QA por cursor, XLSX write-only y ZIP atómico."""

import os
import uuid
import zipfile
from datetime import datetime, timezone

from openpyxl import Workbook
from psycopg2.extras import RealDictCursor

from artifact_storage import atomic_write
from db import connection
from qa_export_policy import (
    EXPORT_BATCH_SIZE,
    MAX_QA_EXPORT_SOURCE_BYTES,
    QaExportValidationError,
    checked_record_count,
    checked_source_bytes,
    confined_photo_path,
    spreadsheet_text,
    validate_export_payload,
)


HEADERS = [
    "registro_id",
    "cliente_registro_id",
    "celular",
    "tipo",
    "lat",
    "lng",
    "accuracy",
    "capturado_at",
    "notas",
    "dispositivo",
    "created_at",
    "archivos",
    "foto_faltante",
]


def _iso_utc(value):
    if value is None:
        return ""
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def _photo_name(record, index):
    captured = record["capturado_at"]
    if captured.tzinfo is None:
        captured = captured.replace(tzinfo=timezone.utc)
    stamp = captured.astimezone(timezone.utc).strftime("%Y%m%d-%H%M%S")
    suffix = f"_{index}" if index else ""
    return f"{stamp}__{record['tipo']}__{record['id']}{suffix}.jpg"


def _measure_export(programa, date_from, date_to):
    with connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            """
            SELECT
              (SELECT COUNT(*)
                 FROM qa_externa_registros r
                WHERE r.programa = %s::"QaExternaPrograma"
                  AND r.capturado_at >= %s
                  AND r.capturado_at < %s) AS records,
              (SELECT COALESCE(SUM(i.bytes), 0)
                 FROM qa_externa_registro_imagenes ri
                 JOIN qa_externa_registros r ON r.id = ri.registro_id
                 JOIN qa_externa_imagenes i ON i.id = ri.imagen_id
                WHERE r.programa = %s::"QaExternaPrograma"
                  AND r.capturado_at >= %s
                  AND r.capturado_at < %s) AS source_bytes
            """,
            (programa, date_from, date_to, programa, date_from, date_to),
        )
        row = cursor.fetchone()
        return int(row["records"]), int(row["source_bytes"])


def generate_qa_export(
    data_job_id,
    payload,
    output_dir,
    storage_root,
    attempt_token,
    on_progress=None,
):
    programa, date_from, date_to, max_records = validate_export_payload(payload)
    total, source_bytes = _measure_export(programa, date_from, date_to)
    if total > max_records:
        raise QaExportValidationError(
            f"La exportación contiene {total} registros; el máximo es {max_records}"
        )
    if source_bytes > MAX_QA_EXPORT_SOURCE_BYTES:
        raise QaExportValidationError(
            "Las imágenes del rango exceden el máximo de 1 GiB; divide el rango"
        )

    os.makedirs(output_dir, exist_ok=True)
    token = uuid.UUID(str(attempt_token)).hex
    artifact_name = f"qa-externa-{programa.lower()}-{data_job_id}_a{token}.zip"
    final_path = os.path.join(output_dir, artifact_name)
    counters = {
        "records": 0,
        "photos": 0,
        "missingPhotos": 0,
        "sourceBytes": 0,
    }

    def write_archive(temp_zip_path):
        workbook = Workbook(write_only=True)
        sheet = workbook.create_sheet("Evidencia")
        sheet.append(HEADERS)
        temp_xlsx_path = f"{temp_zip_path}.{uuid.uuid4().hex}.xlsx"

        try:
            with zipfile.ZipFile(
                temp_zip_path,
                mode="w",
                compression=zipfile.ZIP_DEFLATED,
                compresslevel=1,
                allowZip64=True,
            ) as archive:
                with connection() as conn:
                    cursor = conn.cursor(
                        name=f"qa_export_{data_job_id}_{uuid.uuid4().hex}",
                        cursor_factory=RealDictCursor,
                    )
                    cursor.itersize = EXPORT_BATCH_SIZE
                    cursor.execute(
                        """
                        SELECT
                          r.id,
                          r.cliente_registro_id,
                          r.identificador_app,
                          r.tipo::text AS tipo,
                          r.lat,
                          r.lng,
                          r.accuracy,
                          r.capturado_at,
                          r.notas,
                          r.created_at,
                          d.identificador AS dispositivo,
                          COALESCE(
                            jsonb_agg(
                              jsonb_build_object(
                                'sha256', i.sha256,
                                'programa', i.programa::text
                              ) ORDER BY i.id
                            ) FILTER (WHERE i.id IS NOT NULL),
                            '[]'::jsonb
                          ) AS imagenes
                        FROM qa_externa_registros r
                        JOIN qa_externa_dispositivos d ON d.id = r.dispositivo_id
                        LEFT JOIN qa_externa_registro_imagenes ri
                          ON ri.registro_id = r.id
                        LEFT JOIN qa_externa_imagenes i ON i.id = ri.imagen_id
                        WHERE r.programa = %s::"QaExternaPrograma"
                          AND r.capturado_at >= %s
                          AND r.capturado_at < %s
                        GROUP BY r.id, d.identificador
                        ORDER BY r.id
                        """,
                        (programa, date_from, date_to),
                    )

                    while True:
                        batch = cursor.fetchmany(EXPORT_BATCH_SIZE)
                        if not batch:
                            break
                        for record in batch:
                            next_record_count = checked_record_count(
                                counters["records"],
                                max_records,
                            )
                            files = []
                            missing = False
                            for index, image in enumerate(record["imagenes"] or []):
                                photo_path = confined_photo_path(
                                    storage_root,
                                    image.get("programa"),
                                    image.get("sha256", ""),
                                )
                                photo_name = _photo_name(record, index)
                                if photo_path and os.path.isfile(photo_path):
                                    counters["sourceBytes"] = checked_source_bytes(
                                        counters["sourceBytes"],
                                        os.path.getsize(photo_path),
                                    )
                                    archive.write(
                                        photo_path,
                                        f"fotos/{photo_name}",
                                        compress_type=zipfile.ZIP_STORED,
                                    )
                                    files.append(photo_name)
                                    counters["photos"] += 1
                                else:
                                    missing = True
                                    counters["missingPhotos"] += 1

                            sheet.append(
                                [
                                    record["id"],
                                    spreadsheet_text(record["cliente_registro_id"]),
                                    spreadsheet_text(record["identificador_app"]),
                                    spreadsheet_text(record["tipo"]),
                                    record["lat"],
                                    record["lng"],
                                    record["accuracy"] if record["accuracy"] is not None else "",
                                    _iso_utc(record["capturado_at"]),
                                    spreadsheet_text(record["notas"]),
                                    spreadsheet_text(record["dispositivo"]),
                                    _iso_utc(record["created_at"]),
                                    spreadsheet_text(", ".join(files)),
                                    "sí" if missing else "",
                                ]
                            )
                            counters["records"] = next_record_count

                        if on_progress:
                            ratio = counters["records"] / max(total, 1)
                            on_progress(min(90, 5 + int(ratio * 85)))
                    cursor.close()

                workbook.save(temp_xlsx_path)
                archive.write(
                    temp_xlsx_path,
                    "datos.xlsx",
                    compress_type=zipfile.ZIP_DEFLATED,
                )
        finally:
            try:
                os.remove(temp_xlsx_path)
            except FileNotFoundError:
                pass

    atomic_write(final_path, write_archive)
    artifact_size = os.path.getsize(final_path)
    if on_progress:
        on_progress(95)
    return {
        **counters,
        "artifactBytes": artifact_size,
        "artifactPath": final_path,
        "artifactName": artifact_name,
    }
