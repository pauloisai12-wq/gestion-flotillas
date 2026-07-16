"""Nombres inmutables y publicación atómica de artefactos de reportes."""

import os
import uuid
from collections.abc import Callable


def immutable_report_path(
    reports_dir: str,
    year: int,
    month: int,
    artifact_id: int | None,
    extension: str,
    attempt_token: str | None = None,
) -> str:
    if extension not in {"pdf", "xlsx"}:
        raise ValueError("Extensión de reporte no permitida")
    if artifact_id is None:
        token = f"u{uuid.uuid4().hex}"
    else:
        numeric_id = int(artifact_id)
        if numeric_id <= 0:
            raise ValueError("artifact_id debe ser positivo")
        token = f"r{numeric_id}"
        if attempt_token is not None:
            token += f"_a{uuid.UUID(str(attempt_token)).hex}"
    filename = f"reporte_mensual_{int(year)}_{int(month):02d}_{token}.{extension}"
    return os.path.join(reports_dir, filename)


def atomic_write(final_path: str, writer: Callable[[str], None]) -> None:
    """Publica completo y falla si la ruta inmutable ya existe."""
    directory = os.path.dirname(final_path)
    os.makedirs(directory, exist_ok=True)
    extension = os.path.splitext(final_path)[1]
    temp_path = os.path.join(
        directory,
        f".{os.path.basename(final_path)}.{uuid.uuid4().hex}.tmp{extension}",
    )
    try:
        writer(temp_path)
        # El hard-link se crea de forma atómica en el mismo filesystem y, a
        # diferencia de os.replace(), nunca sobreescribe un artefacto previo.
        os.link(temp_path, final_path)
        os.remove(temp_path)
    finally:
        try:
            os.remove(temp_path)
        except FileNotFoundError:
            pass
