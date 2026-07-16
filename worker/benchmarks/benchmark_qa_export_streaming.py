"""Benchmark reproducible del escritor XLSX write-only usado por QA export."""

import json
import os
import shutil
import sys
import time
import tracemalloc
import uuid
import zipfile

from openpyxl import Workbook


MAX_ROWS = 50_000
MAX_SECONDS = float(os.environ.get("SPRINT3_QA_BENCH_MAX_SECONDS", "30"))
MAX_PEAK_MIB = float(os.environ.get("SPRINT3_QA_BENCH_MAX_PEAK_MIB", "128"))


def run(rows):
    if rows < 1 or rows > MAX_ROWS:
        raise ValueError(f"rows debe estar entre 1 y {MAX_ROWS}")
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    directory = os.path.join(root, f".qa-export-benchmark-{uuid.uuid4().hex}")
    os.mkdir(directory)
    xlsx_path = os.path.join(directory, "datos.xlsx")
    zip_path = os.path.join(directory, "export.zip")
    tracemalloc.start()
    started = time.perf_counter()
    try:
        workbook = Workbook(write_only=True)
        sheet = workbook.create_sheet("Evidencia")
        sheet.append(["registro_id", "tipo", "capturado_at", "archivos"])
        for index in range(rows):
            sheet.append([index + 1, "lona", "2026-07-15T12:00:00Z", "foto.jpg"])
        workbook.save(xlsx_path)
        with zipfile.ZipFile(
            zip_path,
            "w",
            compression=zipfile.ZIP_DEFLATED,
            compresslevel=1,
            allowZip64=True,
        ) as archive:
            archive.write(xlsx_path, "datos.xlsx")
        elapsed = time.perf_counter() - started
        _, peak = tracemalloc.get_traced_memory()
        return {
            "rows": rows,
            "elapsedSeconds": round(elapsed, 3),
            "peakPythonMiB": round(peak / (1024 * 1024), 2),
            "xlsxMiB": round(os.path.getsize(xlsx_path) / (1024 * 1024), 2),
            "zipMiB": round(os.path.getsize(zip_path) / (1024 * 1024), 2),
            "batchSizeProduction": 250,
            "maxRowsProduction": MAX_ROWS,
            "thresholds": {
                "maxSeconds": MAX_SECONDS,
                "maxPeakPythonMiB": MAX_PEAK_MIB,
            },
        }
    finally:
        tracemalloc.stop()
        shutil.rmtree(directory)


if __name__ == "__main__":
    requested = int(sys.argv[1]) if len(sys.argv) > 1 else 10_000
    if MAX_SECONDS <= 0 or MAX_PEAK_MIB <= 0:
        raise SystemExit("Los umbrales del benchmark deben ser positivos")
    result = run(requested)
    print(json.dumps(result, indent=2))
    regressions = []
    if result["elapsedSeconds"] > MAX_SECONDS:
        regressions.append(
            f"elapsedSeconds={result['elapsedSeconds']} > {MAX_SECONDS}"
        )
    if result["peakPythonMiB"] > MAX_PEAK_MIB:
        regressions.append(
            f"peakPythonMiB={result['peakPythonMiB']} > {MAX_PEAK_MIB}"
        )
    if regressions:
        raise SystemExit("REGRESION Sprint 3: " + "; ".join(regressions))
