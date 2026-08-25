import csv
import io
import json
import os
import sys
import tempfile
import types
import unittest
import uuid
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import patch

# El entorno unitario no necesita abrir PostgreSQL. Estos módulos falsos permiten
# importar el generador sin cargar psycopg2/pandas; `connection` se sustituye por
# un doble de cursor más abajo.
fake_extras = types.ModuleType("psycopg2.extras")
fake_extras.RealDictCursor = object
fake_psycopg2 = types.ModuleType("psycopg2")
fake_psycopg2.extras = fake_extras
fake_db = types.ModuleType("db")
fake_db.connection = None
sys.modules.setdefault("psycopg2", fake_psycopg2)
sys.modules.setdefault("psycopg2.extras", fake_extras)
sys.modules.setdefault("db", fake_db)

import generate_encuestas_export as generator

SURVEY_ID = "00000000-0000-4000-8000-000000000001"
NOW = datetime(2026, 8, 12, 15, 30, tzinfo=timezone.utc)


def survey_row():
    return {
        "id_remoto": "10000000-0000-4000-8000-000000000001",
        "id_local": SURVEY_ID,
        "folio_local": "LX-1",
        "encuestador": "=HYPERLINK(\"https://invalid\")",
        "recibido_en": NOW,
        "fecha_hora_inicio": NOW,
        "fecha_hora_finalizacion": NOW,
        "duracion_segundos": 120,
        "estado": "completada",
        "elegibilidad": None,
        "version_cuestionario": 3,
        "credencial_vigente": None,
        "sexo": "mujer",
        "rango_edad": "31_45",
        "genero": None,
        "partido_preferido": None,
        "empresarios_conocidos": ["Persona uno"],
        "politicos_conocidos": [],
        "conoce_lalo": "si",
        "rol_lalo": "empresario",
        "opinion_lalo": "buena",
        "preferencia_electoral": "lalo_ximenez",
        "preferencia_electoral_otro": None,
        "preferencia_partido": "morena",
        "preferencia_partido_otro": None,
        "aprobacion_por_gobernante": [
            {"gobernante": "jara", "calificacion": "regular"}
        ],
        "conocimiento_por_persona": None,
        "medios_conocimiento": None,
        "mayor_personalidad": None,
        "candidato_preferido": None,
        "ubicacion_disponible": True,
        "ubicacion_lat": 17.0,
        "ubicacion_lng": -96.0,
        "ubicacion_precision_m": 5.0,
        "ubicacion_es_valida": True,
        "ubicacion_capturada_at": NOW,
        "ubicacion_permiso": "concedido",
        "ubicacion_servicio_activo": True,
        "ubicacion_motivo_no_disponible": None,
        "dispositivo_plataforma": "android",
        "dispositivo_modelo": "modelo",
        "dispositivo_version_sistema": "14",
        "version_aplicacion": "1.0",
        "dispositivo": "encuestador-1",
    }


class FakeCursor:
    def __init__(self, rows=None, measured=None):
        self.rows = list(rows or [])
        self.measured = measured
        self.itersize = None

    def execute(self, _query, _params=None):
        return None

    def fetchone(self):
        return self.measured

    def fetchmany(self, size):
        batch = self.rows[:size]
        self.rows = self.rows[size:]
        return batch

    def close(self):
        return None


class FakeConnection:
    def __init__(self, surveys, audios):
        self.surveys = surveys
        self.audios = audios
        self.sessions = []

    def cursor(self, name=None, cursor_factory=None):
        del cursor_factory
        if name is None:
            return FakeCursor(
                measured={
                    "records": len(self.surveys),
                    "audios": len(self.audios),
                    "source_bytes": sum(row["tamano_bytes"] for row in self.audios),
                }
            )
        if "_rows_" in name:
            return FakeCursor(rows=self.surveys)
        return FakeCursor(rows=self.audios)

    def set_session(self, **kwargs):
        self.sessions.append(kwargs)

    def rollback(self):
        return None


class ConnectionContext:
    def __init__(self, conn):
        self.conn = conn

    def __enter__(self):
        return self.conn

    def __exit__(self, *_args):
        return False


class GenerateEncuestasExportTests(unittest.TestCase):
    def test_headers_match_api_contract(self):
        api_headers = json.loads(
            Path(__file__)
            .resolve()
            .parents[2]
            .joinpath("api/src/contracts/encuestasCsvHeaders.json")
            .read_text(encoding="utf-8")
        )
        self.assertEqual(generator.HEADERS, api_headers)
        self.assertEqual(len(generator.HEADERS), 53)

    def test_sql_keeps_filter_values_in_parameters(self):
        raw_device = "%' OR TRUE --"
        filters = generator.validate_export_payload({
            "dateFrom": "2026-08-01T00:00:00.000Z",
            "dateToExclusive": "2026-09-01T00:00:00.000Z",
            "dateTo": "2026-08-31",
            "maxRecords": 50_000,
            "estado": "noElegible",
            "conAudio": True,
            "dispositivo": raw_device,
        })

        where, params = generator._where(filters)

        self.assertNotIn(raw_device, where)
        self.assertIn("d.identificador ILIKE %s", where)
        self.assertIn("EXISTS", where)
        self.assertIn(f"%{raw_device}%", params)

    def test_generates_stored_zip_and_marks_missing_audio(self):
        present_sha = "a" * 64
        missing_sha = "b" * 64
        content = b"audio-original"
        audios = [
            {
                "id_local": SURVEY_ID,
                "id_remoto": "10000000-0000-4000-8000-000000000001",
                "segmento": "seg1.m4a",
                "sha256": present_sha,
                "tamano_bytes": len(content),
                "duracion_ms": 1000,
                "recibido_en": NOW,
                "ruta": f"encuestas-audio/{present_sha}.m4a",
            },
            {
                "id_local": SURVEY_ID,
                "id_remoto": "10000000-0000-4000-8000-000000000001",
                "segmento": "seg2.m4a",
                "sha256": missing_sha,
                "tamano_bytes": 10,
                "duracion_ms": None,
                "recibido_en": NOW,
                "ruta": f"encuestas-audio/{missing_sha}.m4a",
            },
        ]
        conn = FakeConnection([survey_row()], audios)

        with tempfile.TemporaryDirectory() as directory:
            output_dir = os.path.join(directory, "output")
            storage_dir = os.path.join(directory, "encuestas-audio")
            os.makedirs(storage_dir)
            Path(storage_dir, f"{present_sha}.m4a").write_bytes(content)
            payload = {
                "dateFrom": "2026-08-01T00:00:00.000Z",
                "dateToExclusive": "2026-09-01T00:00:00.000Z",
                "dateTo": "2026-08-31",
                "maxRecords": 50_000,
                "conAudio": True,
            }
            with patch.object(
                generator,
                "connection",
                return_value=ConnectionContext(conn),
            ):
                result = generator.generate_encuestas_export(
                    7,
                    payload,
                    output_dir,
                    storage_dir,
                    str(uuid.UUID(int=1)),
                )

            self.assertEqual(
                result["artifactName"],
                "encuestas-2026-08-01_2026-08-31-con-audio.zip",
            )
            self.assertEqual(result["records"], 1)
            self.assertEqual(result["audios"], 1)
            self.assertEqual(result["missingAudios"], 1)
            with zipfile.ZipFile(result["artifactPath"]) as archive:
                names = archive.namelist()
                self.assertEqual(
                    set(names),
                    {
                        "encuestas.csv",
                        "manifiesto-audios.csv",
                        f"audios/{SURVEY_ID}/seg1.m4a",
                    },
                )
                self.assertTrue(
                    all(item.compress_type == zipfile.ZIP_STORED for item in archive.infolist())
                )
                self.assertEqual(
                    archive.read(f"audios/{SURVEY_ID}/seg1.m4a"),
                    content,
                )
                survey_csv = archive.read("encuestas.csv").decode("utf-8-sig")
                survey_rows = list(csv.reader(io.StringIO(survey_csv)))
                self.assertEqual(survey_rows[0], generator.HEADERS)
                self.assertEqual(len(survey_rows[1]), 53)
                self.assertTrue(survey_rows[1][3].startswith("'="))
                self.assertEqual(survey_rows[1][4], "2026-08-12T15:30:00.000Z")
                manifest_csv = archive.read("manifiesto-audios.csv").decode("utf-8-sig")
                manifest_rows = list(csv.DictReader(io.StringIO(manifest_csv)))
                self.assertEqual(
                    manifest_rows[0]["recibido_en"],
                    "2026-08-12T15:30:00.000Z",
                )
                self.assertEqual(manifest_rows[0]["faltante"], "0")
                self.assertEqual(manifest_rows[0]["archivo"], f"audios/{SURVEY_ID}/seg1.m4a")
                self.assertEqual(manifest_rows[1]["faltante"], "1")
                self.assertEqual(manifest_rows[1]["archivo"], "")
            self.assertFalse(
                any(name.endswith(".manifest.csv") for name in os.listdir(output_dir))
            )


if __name__ == "__main__":
    unittest.main()
