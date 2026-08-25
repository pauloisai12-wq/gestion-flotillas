import os
import tempfile
import unittest

from encuestas_export_policy import (
    MAX_ENCUESTAS_EXPORT_RECORDS,
    MAX_ENCUESTAS_EXPORT_SOURCE_BYTES,
    EncuestasExportValidationError,
    archive_audio_name,
    artifact_download_name,
    checked_source_bytes,
    confined_audio_path,
    public_encuestas_export_error,
    validate_export_payload,
)


def payload(**overrides):
    value = {
        "dateFrom": "2026-08-01T00:00:00.000Z",
        "dateToExclusive": "2026-09-01T00:00:00.000Z",
        "dateTo": "2026-08-31",
        "maxRecords": MAX_ENCUESTAS_EXPORT_RECORDS,
    }
    value.update(overrides)
    return value


class EncuestasExportPolicyTests(unittest.TestCase):
    def test_validates_filters_and_filename(self):
        parsed = validate_export_payload(
            payload(estado="noElegible", conAudio=False, dispositivo="equipo-1")
        )
        self.assertEqual(parsed["estado"], "noElegible")
        self.assertIs(parsed["con_audio"], False)
        self.assertEqual(
            artifact_download_name(parsed),
            "encuestas-2026-08-01_2026-08-31-sin-audio.zip",
        )

    def test_rejects_oversized_range_limit_and_filter_types(self):
        with self.assertRaises(EncuestasExportValidationError):
            validate_export_payload(payload(maxRecords=MAX_ENCUESTAS_EXPORT_RECORDS + 1))
        with self.assertRaises(EncuestasExportValidationError):
            validate_export_payload(payload(conAudio="false"))
        with self.assertRaises(EncuestasExportValidationError):
            validate_export_payload(payload(estado="otro"))
        with self.assertRaises(EncuestasExportValidationError):
            validate_export_payload(payload(dateTo="2026-08-30"))

    def test_source_bytes_are_bounded(self):
        self.assertEqual(
            checked_source_bytes(MAX_ENCUESTAS_EXPORT_SOURCE_BYTES - 1, 1),
            MAX_ENCUESTAS_EXPORT_SOURCE_BYTES,
        )
        with self.assertRaises(EncuestasExportValidationError):
            checked_source_bytes(MAX_ENCUESTAS_EXPORT_SOURCE_BYTES, 1)

    def test_confines_blob_and_archive_components(self):
        sha = "a" * 64
        survey_id = "00000000-0000-4000-8000-000000000001"
        with tempfile.TemporaryDirectory() as directory:
            expected = os.path.join(directory, f"{sha}.m4a")
            self.assertEqual(
                confined_audio_path(
                    directory,
                    f"encuestas-audio/{sha}.m4a",
                    sha,
                ),
                expected,
            )
            self.assertIsNone(confined_audio_path(directory, "../../etc/passwd", sha))
        self.assertEqual(
            archive_audio_name(survey_id, "seg1.m4a"),
            f"audios/{survey_id}/seg1.m4a",
        )
        self.assertIsNone(archive_audio_name(survey_id, "../seg1.m4a"))

    def test_raw_exceptions_are_not_public(self):
        leaked = RuntimeError("postgresql://user:secret@db/private")
        self.assertNotIn("secret", public_encuestas_export_error(leaked))


if __name__ == "__main__":
    unittest.main()
