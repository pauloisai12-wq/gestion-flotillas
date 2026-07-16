import os
import unittest
from pathlib import Path

from qa_export_policy import (
    EXPORT_BATCH_SIZE,
    MAX_QA_EXPORT_RECORDS,
    MAX_QA_EXPORT_SOURCE_BYTES,
    QA_EXPORT_GENERIC_ERROR,
    QaExportValidationError,
    checked_record_count,
    checked_source_bytes,
    confined_photo_path,
    public_qa_export_error,
    spreadsheet_text,
    validate_export_payload,
)


class QaExportPolicyTests(unittest.TestCase):
    def test_accepts_bounded_inclusive_366_day_range(self):
        programa, date_from, date_to, maximum = validate_export_payload(
            {
                "programa": "BUFFALO",
                "dateFrom": "2025-01-01T00:00:00.000Z",
                "dateToExclusive": "2026-01-02T00:00:00.000Z",
                "maxRecords": MAX_QA_EXPORT_RECORDS,
            }
        )
        self.assertEqual(programa, "BUFFALO")
        self.assertEqual((date_to - date_from).days, 366)
        self.assertEqual(maximum, 50_000)

    def test_rejects_range_over_366_days_and_oversized_record_limit(self):
        with self.assertRaisesRegex(QaExportValidationError, "366 días"):
            validate_export_payload(
                {
                    "programa": "LX",
                    "dateFrom": "2025-01-01T00:00:00.000Z",
                    "dateToExclusive": "2026-01-03T00:00:00.000Z",
                    "maxRecords": 50_000,
                }
            )
        with self.assertRaisesRegex(QaExportValidationError, "registros"):
            validate_export_payload(
                {
                    "programa": "LX",
                    "dateFrom": "2026-01-01T00:00:00.000Z",
                    "dateToExclusive": "2026-01-02T00:00:00.000Z",
                    "maxRecords": 50_001,
                }
            )

    def test_photo_path_is_content_addressed_and_rejects_untrusted_hash(self):
        root = os.path.abspath("qa-test-storage")
        digest = "a" * 64
        expected = os.path.realpath(os.path.join(root, "buffalo", f"{digest}.jpg"))
        self.assertEqual(confined_photo_path(root, "BUFFALO", digest), expected)
        self.assertIsNone(confined_photo_path(root, "BUFFALO", "../escape"))
        self.assertIsNone(confined_photo_path(root, "OTHER", digest))

    def test_streaming_contract_has_deterministic_limits(self):
        source = Path(__file__).resolve().parents[1].joinpath(
            "generate_qa_export.py"
        ).read_text(encoding="utf-8")
        self.assertEqual(EXPORT_BATCH_SIZE, 250)
        self.assertEqual(MAX_QA_EXPORT_SOURCE_BYTES, 1024 * 1024 * 1024)
        self.assertIn("Workbook(write_only=True)", source)
        self.assertIn("fetchmany(EXPORT_BATCH_SIZE)", source)
        self.assertIn("compress_type=zipfile.ZIP_STORED", source)
        self.assertIn("atomic_write(final_path, write_archive)", source)

    def test_neutralizes_untrusted_spreadsheet_formulas_only_for_text(self):
        for value in ("=1+1", "+cmd", "-2+3", "@SUM(A1:A2)"):
            self.assertEqual(spreadsheet_text(value), f"'{value}")
        self.assertEqual(spreadsheet_text("nota normal"), "nota normal")
        self.assertEqual(spreadsheet_text(None), "")

    def test_streaming_guards_recheck_records_and_actual_photo_bytes(self):
        self.assertEqual(checked_record_count(49, 50), 50)
        with self.assertRaises(QaExportValidationError):
            checked_record_count(50, 50)
        self.assertEqual(checked_source_bytes(90, 10, 100), 100)
        with self.assertRaises(QaExportValidationError):
            checked_source_bytes(100, 1, 100)

    def test_only_domain_validation_errors_are_safe_to_persist(self):
        domain_error = QaExportValidationError("Rango de exportación inválido")
        self.assertEqual(public_qa_export_error(domain_error), str(domain_error))
        leaked = ValueError("postgresql://user:secret@db/private/path")
        self.assertEqual(public_qa_export_error(leaked), QA_EXPORT_GENERIC_ERROR)


if __name__ == "__main__":
    unittest.main()
