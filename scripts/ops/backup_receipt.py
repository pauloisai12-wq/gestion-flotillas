#!/usr/bin/env python3
"""Receipt HMAC no sensible para fechar backups sin descifrar el manifiesto."""

from __future__ import annotations

import argparse
import hashlib
import hmac
import json
import os
import re
import stat
from datetime import datetime, timezone
from pathlib import Path


FORMAT = "flotillas-backup-receipt-v1"
RECEIPT_NAME = "receipt.json"
PROFILE_RE = re.compile(r"^[A-Za-z0-9._-]+$")
UTC_RE = re.compile(r"^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$")
PAYLOAD_FIELDS = {
    "format",
    "created_utc",
    "profile",
    "bundle",
    "encrypted_checksums_sha256",
}


class ReceiptError(ValueError):
    pass


def validate_key(key: str) -> bytes:
    if not isinstance(key, str) or len(key.encode("utf-8")) < 32:
        raise ReceiptError("BACKUP_RECEIPT_HMAC_KEY ausente o menor a 32 bytes")
    if key.strip().upper().startswith("CAMBIA"):
        raise ReceiptError("BACKUP_RECEIPT_HMAC_KEY conserva un placeholder CAMBIA...")
    return key.encode("utf-8")


def parse_created_utc(value: str) -> datetime:
    if not isinstance(value, str) or not UTC_RE.fullmatch(value):
        raise ReceiptError("created_utc inválido")
    try:
        return datetime.strptime(value, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
    except ValueError as exc:
        raise ReceiptError("created_utc inválido") from exc


def canonical_payload(payload: dict) -> bytes:
    if set(payload) != PAYLOAD_FIELDS:
        raise ReceiptError("campos de receipt inválidos")
    return json.dumps(payload, sort_keys=True, separators=(",", ":")).encode("utf-8")


def sha256_regular_file(path: Path, maximum_bytes: int = 64 * 1024) -> str:
    try:
        info = path.lstat()
        if not stat.S_ISREG(info.st_mode) or info.st_size > maximum_bytes:
            raise ReceiptError(f"archivo inválido: {path.name}")
        digest = hashlib.sha256()
        with path.open("rb") as handle:
            for chunk in iter(lambda: handle.read(64 * 1024), b""):
                digest.update(chunk)
        return digest.hexdigest()
    except OSError as exc:
        raise ReceiptError(f"archivo ilegible: {path.name}") from exc


def validated_payload(created_utc: str, profile: str, bundle_name: str, checksum_hash: str) -> dict:
    created = parse_created_utc(created_utc)
    if not isinstance(profile, str) or not PROFILE_RE.fullmatch(profile):
        raise ReceiptError("profile inválido")
    expected_name = f"flotillas-{profile}-{created.strftime('%Y%m%dT%H%M%SZ')}"
    if bundle_name != expected_name:
        raise ReceiptError("bundle no coincide con profile/created_utc")
    if not re.fullmatch(r"[a-f0-9]{64}", checksum_hash):
        raise ReceiptError("hash de checksums inválido")
    return {
        "format": FORMAT,
        "created_utc": created_utc,
        "profile": profile,
        "bundle": bundle_name,
        "encrypted_checksums_sha256": checksum_hash,
    }


def create_receipt(bundle_dir: Path, created_utc: str, profile: str, bundle_name: str, key: str) -> Path:
    key_bytes = validate_key(key)
    checksum_hash = sha256_regular_file(bundle_dir / "encrypted.sha256")
    payload = validated_payload(created_utc, profile, bundle_name, checksum_hash)
    document = {
        **payload,
        "hmac_sha256": hmac.new(key_bytes, canonical_payload(payload), hashlib.sha256).hexdigest(),
    }
    receipt = bundle_dir / RECEIPT_NAME
    temporary = bundle_dir / f".{RECEIPT_NAME}.{os.getpid()}.tmp"
    try:
        with temporary.open("x", encoding="utf-8") as handle:
            json.dump(document, handle, sort_keys=True, separators=(",", ":"))
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.chmod(temporary, 0o600)
        os.replace(temporary, receipt)
        return receipt
    except OSError as exc:
        try:
            temporary.unlink(missing_ok=True)
        except OSError:
            pass
        raise ReceiptError("no se pudo publicar receipt atómico") from exc


def verify_receipt(receipt: Path, key: str, expected_bundle_name: str | None = None) -> dict:
    key_bytes = validate_key(key)
    try:
        info = receipt.lstat()
        if not stat.S_ISREG(info.st_mode) or info.st_size > 4096:
            raise ReceiptError("receipt no es archivo regular pequeño")
        document = json.loads(receipt.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ReceiptError("receipt ausente o ilegible") from exc
    if not isinstance(document, dict) or set(document) != PAYLOAD_FIELDS | {"hmac_sha256"}:
        raise ReceiptError("campos de receipt inválidos")
    supplied_mac = document.pop("hmac_sha256")
    payload = validated_payload(
        document.get("created_utc"),
        document.get("profile"),
        document.get("bundle"),
        document.get("encrypted_checksums_sha256"),
    )
    if expected_bundle_name is not None and payload["bundle"] != expected_bundle_name:
        raise ReceiptError("receipt pertenece a otro bundle")
    expected_mac = hmac.new(key_bytes, canonical_payload(payload), hashlib.sha256).hexdigest()
    if not isinstance(supplied_mac, str) or not hmac.compare_digest(supplied_mac, expected_mac):
        raise ReceiptError("HMAC de receipt inválido")
    actual_checksum_hash = sha256_regular_file(receipt.parent / "encrypted.sha256")
    if not hmac.compare_digest(payload["encrypted_checksums_sha256"], actual_checksum_hash):
        raise ReceiptError("receipt no coincide con encrypted.sha256")
    created = parse_created_utc(payload["created_utc"])
    return {**payload, "created_epoch": int(created.timestamp())}


def self_check() -> None:
    key = "k" * 32
    payload = validated_payload(
        "2000-01-01T00:00:00Z",
        "public",
        "flotillas-public-20000101T000000Z",
        "a" * 64,
    )
    signature = hmac.new(validate_key(key), canonical_payload(payload), hashlib.sha256).hexdigest()
    assert len(signature) == 64
    assert not hmac.compare_digest(signature, "0" * 64)
    try:
        validate_key("CAMBIA_ESTO_CLAVE_PUBLICA_CON_LONGITUD_SUFICIENTE")
    except ReceiptError:
        pass
    else:
        raise AssertionError("un placeholder CAMBIA... superó la validación")
    print("OK backup_receipt --check: payload canónico, nombre temporal y HMAC verificados")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", "--self-test", action="store_true")
    subparsers = parser.add_subparsers(dest="command")
    create = subparsers.add_parser("create")
    create.add_argument("--bundle-dir", required=True)
    create.add_argument("--created-utc", required=True)
    create.add_argument("--profile", required=True)
    create.add_argument("--bundle-name", required=True)
    verify = subparsers.add_parser("verify")
    verify.add_argument("--receipt", required=True)
    args = parser.parse_args()
    if args.check:
        self_check()
        return 0
    key = os.environ.get("BACKUP_RECEIPT_HMAC_KEY", "")
    try:
        if args.command == "create":
            print(create_receipt(Path(args.bundle_dir), args.created_utc, args.profile, args.bundle_name, key))
        elif args.command == "verify":
            print(json.dumps(verify_receipt(Path(args.receipt), key), sort_keys=True))
        else:
            parser.error("falta create o verify")
    except ReceiptError as exc:
        print(f"ERROR backup receipt: {exc}", file=os.sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
