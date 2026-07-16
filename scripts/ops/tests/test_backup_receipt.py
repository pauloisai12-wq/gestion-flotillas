import json
import os
import shutil
import sys
import unittest
import uuid
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from backup_receipt import ReceiptError, create_receipt, verify_receipt


class BackupReceiptTests(unittest.TestCase):
    def setUp(self):
        parent = Path(__file__).resolve().parent
        self.directory = parent / f".receipt-test-{uuid.uuid4().hex}"
        os.mkdir(self.directory)
        self.bundle = self.directory / "flotillas-public-20000101T000000Z"
        os.mkdir(self.bundle)
        (self.bundle / "encrypted.sha256").write_text("a" * 64 + "  database.dump.age\n", encoding="utf-8")
        self.key = "receipt-test-key-32-bytes-minimum-value"

    def tearDown(self):
        shutil.rmtree(self.directory)

    def test_atomic_receipt_verifies_independently_of_directory_mtime(self):
        receipt = create_receipt(
            self.bundle,
            "2000-01-01T00:00:00Z",
            "public",
            self.bundle.name,
            self.key,
        )
        os.utime(self.bundle, (2_000_000_000, 2_000_000_000))
        verified = verify_receipt(receipt, self.key, self.bundle.name)
        self.assertEqual(verified["created_utc"], "2000-01-01T00:00:00Z")
        self.assertEqual(list(self.bundle.glob(f".{receipt.name}.*.tmp")), [])

    def test_tampered_receipt_or_checksum_fails_closed(self):
        receipt = create_receipt(
            self.bundle,
            "2000-01-01T00:00:00Z",
            "public",
            self.bundle.name,
            self.key,
        )
        document = json.loads(receipt.read_text(encoding="utf-8"))
        document["created_utc"] = "2000-01-01T00:01:00Z"
        receipt.write_text(json.dumps(document), encoding="utf-8")
        with self.assertRaises(ReceiptError):
            verify_receipt(receipt, self.key, self.bundle.name)

        receipt = create_receipt(
            self.bundle,
            "2000-01-01T00:00:00Z",
            "public",
            self.bundle.name,
            self.key,
        )
        (self.bundle / "encrypted.sha256").write_text("changed\n", encoding="utf-8")
        with self.assertRaises(ReceiptError):
            verify_receipt(receipt, self.key, self.bundle.name)

    def test_missing_or_weak_key_is_rejected(self):
        for invalid_key in ("weak", "CAMBIA_ESTO_CLAVE_PUBLICA_CON_LONGITUD_SUFICIENTE"):
            with self.subTest(invalid_key=invalid_key), self.assertRaises(ReceiptError):
                create_receipt(
                    self.bundle,
                    "2000-01-01T00:00:00Z",
                    "public",
                    self.bundle.name,
                    invalid_key,
                )


if __name__ == "__main__":
    unittest.main()
