import os
import shutil
import unittest
import uuid
from contextlib import contextmanager

from artifact_storage import atomic_write, immutable_report_path


@contextmanager
def workspace_tempdir():
    # Python 3.13 crea TemporaryDirectory con una ACL 0700 especial en Windows;
    # bajo runners aislados esa ACL puede impedir que el mismo test reabra la
    # carpeta. os.mkdir usa permisos portables y conserva aislamiento por UUID.
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    directory = os.path.join(root, f".artifact-test-{uuid.uuid4().hex}")
    os.mkdir(directory)
    try:
        yield directory
    finally:
        shutil.rmtree(directory)


def write_bytes(path, payload):
    with open(path, "wb") as handle:
        handle.write(payload)


class ArtifactStorageTests(unittest.TestCase):
    def test_history_ids_produce_distinct_immutable_names(self):
        with workspace_tempdir() as directory:
            first = immutable_report_path(directory, 2026, 7, 101, "pdf")
            second = immutable_report_path(directory, 2026, 7, 102, "pdf")
            self.assertNotEqual(first, second)
            self.assertTrue(first.endswith("reporte_mensual_2026_07_r101.pdf"))
            self.assertTrue(second.endswith("reporte_mensual_2026_07_r102.pdf"))

    def test_attempts_for_same_history_produce_distinct_names(self):
        with workspace_tempdir() as directory:
            first = immutable_report_path(
                directory,
                2026,
                7,
                101,
                "pdf",
                "11111111-1111-1111-1111-111111111111",
            )
            second = immutable_report_path(
                directory,
                2026,
                7,
                101,
                "pdf",
                "22222222-2222-2222-2222-222222222222",
            )
            self.assertNotEqual(first, second)

    def test_atomic_write_never_overwrites_published_artifact(self):
        with workspace_tempdir() as directory:
            final_path = os.path.join(directory, "report.pdf")
            atomic_write(final_path, lambda path: write_bytes(path, b"first"))

            with self.assertRaises(FileExistsError):
                atomic_write(final_path, lambda path: write_bytes(path, b"second"))

            with open(final_path, "rb") as handle:
                self.assertEqual(handle.read(), b"first")

    def test_atomic_write_publishes_only_complete_file(self):
        with workspace_tempdir() as directory:
            final_path = os.path.join(directory, "report.pdf")

            def writer(temp_path):
                self.assertFalse(os.path.exists(final_path))
                with open(temp_path, "wb") as handle:
                    handle.write(b"complete")

            atomic_write(final_path, writer)

            with open(final_path, "rb") as handle:
                self.assertEqual(handle.read(), b"complete")
            self.assertEqual(os.listdir(directory), ["report.pdf"])

    def test_atomic_write_removes_partial_file_on_failure(self):
        with workspace_tempdir() as directory:
            final_path = os.path.join(directory, "report.xlsx")

            def writer(temp_path):
                with open(temp_path, "wb") as handle:
                    handle.write(b"partial")
                raise RuntimeError("writer failed")

            with self.assertRaisesRegex(RuntimeError, "writer failed"):
                atomic_write(final_path, writer)

            self.assertFalse(os.path.exists(final_path))
            self.assertEqual(os.listdir(directory), [])


if __name__ == "__main__":
    unittest.main()
