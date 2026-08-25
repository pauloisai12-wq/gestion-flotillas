"""ZIP de encuestas por cursores, audios almacenados y publicación atómica."""

import csv
import io
import json
import os
import stat
import uuid
import zipfile
from datetime import timezone
from pathlib import Path

from artifact_storage import atomic_write
from db import connection
from encuestas_export_policy import (
    EXPORT_BATCH_SIZE,
    MAX_ENCUESTAS_EXPORT_SOURCE_BYTES,
    EncuestasExportValidationError,
    archive_audio_name,
    artifact_download_name,
    checked_record_count,
    checked_source_bytes,
    confined_audio_path,
    validate_export_payload,
)
from psycopg2.extras import RealDictCursor

HEADERS = json.loads(
    Path(__file__).with_name("encuestas_csv_headers.json").read_text(encoding="utf-8")
)
MANIFEST_HEADERS = [
    "idLocal",
    "idRemoto",
    "segmento",
    "sha256",
    "tamano_bytes",
    "duracion_ms",
    "recibido_en",
    "archivo",
    "faltante",
]
GOVERNANTES = ["sheinbaum", "jara", "huerta"]
PERSONAS = [
    "lalo_ximenez",
    "laura_estrada",
    "paco_nino",
    "gabriela_delgado",
    "irineo_molina",
    "goyo_castaneda",
    "ernesto_montero",
]
MEDIOS = ["redes_sociales", "otras_personas", "labor_social"]


def _iso_utc(value):
    if value is None:
        return ""
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return (
        value.astimezone(timezone.utc)
        .isoformat(timespec="milliseconds")
        .replace("+00:00", "Z")
    )


def _safe_text(value):
    if value is None:
        return ""
    text = str(value)
    if text.startswith(("=", "+", "-", "@", "\t", "\r")):
        return f"'{text}"
    return text


def _text_list(value):
    if not isinstance(value, list):
        return ""
    return ";".join(str(item) for item in value if isinstance(item, str))


def _mapping(value, key, result):
    mapped = {}
    if not isinstance(value, list):
        return mapped
    for item in value:
        if (
            isinstance(item, dict)
            and isinstance(item.get(key), str)
            and isinstance(item.get(result), str)
        ):
            mapped[item[key]] = item[result]
    return mapped


def _media_cells(value):
    if not isinstance(value, dict):
        return "", ""
    kind = value.get("tipo") if isinstance(value.get("tipo"), str) else ""
    selected = value.get("medios")
    if not isinstance(selected, list):
        return kind, ""
    selected = {item for item in selected if isinstance(item, str)}
    return kind, ";".join(item for item in MEDIOS if item in selected)


def _yes_no(value):
    if value is None:
        return ""
    return "si" if value else "no"


def _survey_csv_row(row):
    ratings = _mapping(row["aprobacion_por_gobernante"], "gobernante", "calificacion")
    levels = _mapping(row["conocimiento_por_persona"], "persona", "nivel")
    media_kind, media_list = _media_cells(row["medios_conocimiento"])
    values = [
        row["id_remoto"],
        row["id_local"],
        row["folio_local"],
        row["encuestador"],
        _iso_utc(row["recibido_en"]),
        _iso_utc(row["fecha_hora_inicio"]),
        _iso_utc(row["fecha_hora_finalizacion"]),
        row["duracion_segundos"],
        row["estado"],
        row["elegibilidad"],
        row["version_cuestionario"],
        row["credencial_vigente"],
        row["sexo"],
        row["rango_edad"],
        row["genero"],
        row["partido_preferido"],
        _text_list(row["empresarios_conocidos"]),
        _text_list(row["politicos_conocidos"]),
        row["conoce_lalo"],
        row["rol_lalo"],
        row["opinion_lalo"],
        row["preferencia_electoral"],
        row["preferencia_electoral_otro"],
        row["preferencia_partido"],
        row["preferencia_partido_otro"],
        *(ratings.get(item, "") for item in GOVERNANTES),
        *(levels.get(item, "") for item in PERSONAS),
        media_kind,
        media_list,
        row["mayor_personalidad"],
        row["candidato_preferido"],
        _yes_no(row["ubicacion_disponible"]),
        row["ubicacion_lat"],
        row["ubicacion_lng"],
        row["ubicacion_precision_m"],
        _yes_no(row["ubicacion_es_valida"]),
        _iso_utc(row["ubicacion_capturada_at"]),
        row["ubicacion_permiso"],
        _yes_no(row["ubicacion_servicio_activo"]),
        row["ubicacion_motivo_no_disponible"],
        row["dispositivo_plataforma"],
        row["dispositivo_modelo"],
        row["dispositivo_version_sistema"],
        row["version_aplicacion"],
        row["dispositivo"],
    ]
    return [_safe_text(value) if isinstance(value, str) else value for value in values]


def _where(filters, alias="e"):
    clauses = [
        f"{alias}.fecha_hora_finalizacion >= %s",
        f"{alias}.fecha_hora_finalizacion < %s",
    ]
    params = [filters["date_from"], filters["date_to_exclusive"]]
    if filters["estado"]:
        clauses.append(f'{alias}.estado = %s::"EncuestaEstado"')
        params.append(filters["estado"])
    if filters["dispositivo"]:
        clauses.append("d.identificador ILIKE %s")
        params.append(f"%{filters['dispositivo']}%")
    if filters["con_audio"] is True:
        clauses.append(
            f"EXISTS (SELECT 1 FROM encuestas_audios af WHERE af.encuesta_id = {alias}.id)"
        )
    elif filters["con_audio"] is False:
        clauses.append(
            f"NOT EXISTS (SELECT 1 FROM encuestas_audios af WHERE af.encuesta_id = {alias}.id)"
        )
    return " AND ".join(clauses), params


def _measure(conn, filters):
    where, params = _where(filters)
    cursor = conn.cursor(cursor_factory=RealDictCursor)
    try:
        cursor.execute(
            f"""
            SELECT COUNT(DISTINCT e.id) AS records,
                   COUNT(a.id) AS audios,
                   COALESCE(SUM(a.tamano_bytes), 0) AS source_bytes
            FROM encuestas e
            JOIN encuestas_dispositivos d ON d.id = e.dispositivo_id
            LEFT JOIN encuestas_audios a ON a.encuesta_id = e.id
            WHERE {where}
            """,  # nosec B608 -- fragmentos fijos; todos los valores usan placeholders
            params,
        )
        row = cursor.fetchone()
        return int(row["records"]), int(row["audios"]), int(row["source_bytes"])
    finally:
        cursor.close()


def _survey_sql(where):
    return f"""
        SELECT e.id_remoto, e.id_local, e.folio_local, e.encuestador,
               e.recibido_en, e.fecha_hora_inicio, e.fecha_hora_finalizacion,
               e.duracion_segundos, e.estado::text AS estado,
               e.elegibilidad::text AS elegibilidad, e.version_cuestionario,
               e.credencial_vigente, e.sexo, e.rango_edad, e.genero,
               e.partido_preferido, e.empresarios_conocidos,
               e.politicos_conocidos, e.conoce_lalo, e.rol_lalo,
               e.opinion_lalo, e.preferencia_electoral,
               e.preferencia_electoral_otro, e.preferencia_partido,
               e.preferencia_partido_otro, e.aprobacion_por_gobernante,
               e.conocimiento_por_persona, e.medios_conocimiento,
               e.mayor_personalidad, e.candidato_preferido,
               e.ubicacion_disponible, e.ubicacion_lat, e.ubicacion_lng,
               e.ubicacion_precision_m, e.ubicacion_es_valida,
               e.ubicacion_capturada_at, e.ubicacion_permiso,
               e.ubicacion_servicio_activo, e.ubicacion_motivo_no_disponible,
               e.dispositivo_plataforma, e.dispositivo_modelo,
               e.dispositivo_version_sistema, e.version_aplicacion,
               d.identificador AS dispositivo
        FROM encuestas e
        JOIN encuestas_dispositivos d ON d.id = e.dispositivo_id
        WHERE {where}
        ORDER BY e.id
    """


def _audio_sql(where):
    return f"""
        SELECT e.id_local, e.id_remoto, a.segmento, a.sha256,
               a.tamano_bytes, a.duracion_ms, a.recibido_en, a.ruta
        FROM encuestas e
        JOIN encuestas_dispositivos d ON d.id = e.dispositivo_id
        JOIN encuestas_audios a ON a.encuesta_id = e.id
        WHERE {where}
        ORDER BY e.id, a.recibido_en, a.id
    """


def _write_surveys(archive, conn, filters, counters, total, on_progress):
    where, params = _where(filters)
    cursor = conn.cursor(
        name=f"encuestas_export_rows_{uuid.uuid4().hex}",
        cursor_factory=RealDictCursor,
    )
    cursor.itersize = EXPORT_BATCH_SIZE
    try:
        cursor.execute(_survey_sql(where), params)
        raw = archive.open("encuestas.csv", mode="w", force_zip64=True)
        text = io.TextIOWrapper(raw, encoding="utf-8-sig", newline="")
        try:
            writer = csv.writer(text, lineterminator="\r\n")
            writer.writerow(HEADERS)
            while True:
                batch = cursor.fetchmany(EXPORT_BATCH_SIZE)
                if not batch:
                    break
                for row in batch:
                    counters["records"] = checked_record_count(
                        counters["records"], filters["max_records"]
                    )
                    writer.writerow(_survey_csv_row(row))
                text.flush()
                if on_progress:
                    ratio = counters["records"] / max(total, 1)
                    on_progress(min(35, 5 + int(ratio * 30)))
        finally:
            text.flush()
            text.detach()
            raw.close()
    finally:
        cursor.close()


def _is_regular_file(path):
    try:
        info = os.lstat(path)
    except OSError:
        return False
    return stat.S_ISREG(info.st_mode) and not stat.S_ISLNK(info.st_mode)


def _write_audios(
    archive,
    conn,
    filters,
    storage_root,
    manifest_path,
    counters,
    total_audios,
    on_progress,
):
    where, params = _where(filters)
    cursor = conn.cursor(
        name=f"encuestas_export_audios_{uuid.uuid4().hex}",
        cursor_factory=RealDictCursor,
    )
    cursor.itersize = EXPORT_BATCH_SIZE
    try:
        cursor.execute(_audio_sql(where), params)
        with open(manifest_path, "w", encoding="utf-8-sig", newline="") as manifest:
            writer = csv.writer(manifest, lineterminator="\r\n")
            writer.writerow(MANIFEST_HEADERS)
            while True:
                batch = cursor.fetchmany(EXPORT_BATCH_SIZE)
                if not batch:
                    break
                for row in batch:
                    source_path = confined_audio_path(
                        storage_root, row["ruta"], row["sha256"]
                    )
                    archive_name = archive_audio_name(
                        row["id_local"], row["segmento"]
                    )
                    missing = (
                        source_path is None
                        or archive_name is None
                        or not _is_regular_file(source_path)
                    )
                    if not missing:
                        size = os.path.getsize(source_path)
                        counters["sourceBytes"] = checked_source_bytes(
                            counters["sourceBytes"], size
                        )
                        archive.write(
                            source_path,
                            archive_name,
                            compress_type=zipfile.ZIP_STORED,
                        )
                        counters["audios"] += 1
                    else:
                        archive_name = ""
                        counters["missingAudios"] += 1
                    writer.writerow(
                        [
                            _safe_text(row["id_local"]),
                            _safe_text(row["id_remoto"]),
                            _safe_text(row["segmento"]),
                            row["sha256"],
                            row["tamano_bytes"],
                            row["duracion_ms"] if row["duracion_ms"] is not None else "",
                            _iso_utc(row["recibido_en"]),
                            archive_name,
                            1 if missing else 0,
                        ]
                    )
                    counters["audioRows"] += 1
                if on_progress:
                    ratio = counters["audioRows"] / max(total_audios, 1)
                    on_progress(min(90, 35 + int(ratio * 55)))
    finally:
        cursor.close()


def generate_encuestas_export(
    data_job_id,
    payload,
    output_dir,
    storage_root,
    attempt_token,
    on_progress=None,
):
    filters = validate_export_payload(payload)
    os.makedirs(output_dir, exist_ok=True)
    token = uuid.UUID(str(attempt_token)).hex
    storage_name = f"encuestas-export-{int(data_job_id)}_a{token}.zip"
    final_path = os.path.join(output_dir, storage_name)
    counters = {
        "records": 0,
        "audioRows": 0,
        "audios": 0,
        "missingAudios": 0,
        "sourceBytes": 0,
    }
    manifest_path = None

    def write_archive(temp_zip_path):
        nonlocal manifest_path
        manifest_path = (
            f"{temp_zip_path}.{uuid.uuid4().hex}.manifest.csv"
        )
        with connection() as conn:
            conn.set_session(
                isolation_level="REPEATABLE READ",
                readonly=True,
                autocommit=False,
            )
            try:
                total, total_audios, declared_bytes = _measure(conn, filters)
                if total > filters["max_records"]:
                    raise EncuestasExportValidationError(
                        f"La exportación contiene {total} encuestas; "
                        f"el máximo es {filters['max_records']}"
                    )
                if declared_bytes > MAX_ENCUESTAS_EXPORT_SOURCE_BYTES:
                    raise EncuestasExportValidationError(
                        "Los audios del rango exceden el máximo de 1 GiB; "
                        "divide el rango"
                    )
                with zipfile.ZipFile(
                    temp_zip_path,
                    mode="w",
                    compression=zipfile.ZIP_STORED,
                    allowZip64=True,
                ) as archive:
                    _write_surveys(
                        archive,
                        conn,
                        filters,
                        counters,
                        total,
                        on_progress,
                    )
                    _write_audios(
                        archive,
                        conn,
                        filters,
                        storage_root,
                        manifest_path,
                        counters,
                        total_audios,
                        on_progress,
                    )
                    archive.write(
                        manifest_path,
                        "manifiesto-audios.csv",
                        compress_type=zipfile.ZIP_STORED,
                    )
            finally:
                conn.rollback()
                conn.set_session(
                    isolation_level="READ COMMITTED",
                    readonly=False,
                    autocommit=False,
                )

    try:
        atomic_write(final_path, write_archive)
    finally:
        if manifest_path:
            try:
                os.remove(manifest_path)
            except FileNotFoundError:
                pass

    artifact_size = os.path.getsize(final_path)
    if on_progress:
        on_progress(95)
    return {
        **counters,
        "artifactBytes": artifact_size,
        "artifactPath": final_path,
        "artifactName": artifact_download_name(filters),
    }
