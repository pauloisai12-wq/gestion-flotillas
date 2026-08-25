# Worker de reportería — Genera PDF y Excel, guarda historial

import asyncio
import json
import os
import signal
import uuid
from datetime import datetime
from urllib.parse import urlparse

from bullmq import Worker
from db import connection, repeatable_read_snapshot
from encuestas_export_policy import public_encuestas_export_error
from generate_encuestas_export import generate_encuestas_export
from generate_excel import generate_excel
from generate_pdf import collect_report_data, generate_pdf
from generate_qa_export import generate_qa_export
from psycopg2.extras import Json
from qa_export_policy import public_qa_export_error
from worker_health import WorkerHeartbeat

# --- Configuración ---
REDIS_URL = os.environ.get("REDIS_URL", "redis://localhost:6379")
QUEUE_NAME = "reports"
DATA_QUEUE_NAME = "data-jobs"

# Parseo robusto de la URL (soporta redis://[:password@]host[:port]).
# El split manual anterior ignoraba la contraseña; si Redis corre con
# --requirepass el worker debe autenticarse o no podrá consumir la cola.
_redis = urlparse(REDIS_URL)
REDIS_HOST = _redis.hostname or "localhost"
REDIS_PORT = _redis.port or 6379
REDIS_PASSWORD = _redis.password or None
REPORT_LEASE_SECONDS = max(60, int(os.environ.get("REPORT_LEASE_SECONDS", "600")))
REPORT_HEARTBEAT_SECONDS = max(10, min(60, REPORT_LEASE_SECONDS // 3))
WORKER_HEARTBEAT_SECONDS = max(
    5,
    int(os.environ.get("WORKER_HEARTBEAT_SECONDS", "15")),
)
WORKER_HEARTBEAT_FILE = os.environ.get(
    "WORKER_HEARTBEAT_FILE",
    "/tmp/flotillas-worker/heartbeat.json",
)
worker_heartbeat = WorkerHeartbeat(
    WORKER_HEARTBEAT_FILE,
    (QUEUE_NAME, DATA_QUEUE_NAME),
)
# Reportes mensuales y exportaciones QA comparten el mismo proceso/contenedor.
# Aunque cada cola tenga concurrency=1, sin esta barrera podrían ejecutar a la
# vez y competir por el límite de memoria del worker.
heavy_job_semaphore = asyncio.Semaphore(1)
DATA_JOBS_DIR = os.environ.get(
    "DATA_JOBS_DIR",
    os.path.join(os.environ.get("REPORTS_DIR", "/app/storage/reports"), "data-jobs"),
)
QA_EXTERNA_DIR = os.environ.get("QA_EXTERNA_DIR", "/app/uploads/qa-externa")
ENCUESTAS_AUDIO_DIR = os.environ.get(
    "ENCUESTAS_AUDIO_DIR",
    "/app/uploads/encuestas-audio",
)


def claim_report_history(report_id, month, year, run_token):
    """Adquiere una concesión exclusiva, recuperando solo leases vencidos."""
    with connection() as conn:
        try:
            cursor = conn.cursor()
            cursor.execute(
                """
            UPDATE report_history AS target
            SET status = 'PROCESSING',
                "pdfPath" = NULL,
                "excelPath" = NULL,
                "pdfSize" = NULL,
                "excelSize" = NULL,
                "errorMessage" = NULL,
                "runToken" = %s::uuid,
                "leaseExpiresAt" = NOW() + (%s * INTERVAL '1 second'),
                "startedAt" = NOW(),
                "completedAt" = NULL,
                "updatedAt" = NOW()
            WHERE target.id = %s
              AND target.month = %s
              AND target.year = %s
              AND (
                target.status = 'FAILED'
                OR (
                  target.status = 'PROCESSING'
                  AND (
                    target."runToken" IS NULL
                    OR target."leaseExpiresAt" IS NULL
                    OR target."leaseExpiresAt" < NOW()
                  )
                )
              )
              AND NOT EXISTS (
                SELECT 1
                FROM report_history AS newer
                WHERE newer.month = target.month
                  AND newer.year = target.year
                  AND newer.id > target.id
              )
            RETURNING target.id
            """,
                (run_token, REPORT_LEASE_SECONDS, report_id, month, year)
            )
            result = cursor.fetchone()
            if not result:
                # Si PostgreSQL confirmó los artefactos pero el proceso cayó
                # antes del ACK de BullMQ, la redelivery debe ser éxito
                # idempotente y no una nueva generación.
                cursor.execute(
                    """
                    SELECT id, "pdfPath", "excelPath", "pdfSize", "excelSize"
                    FROM report_history
                    WHERE id = %s
                      AND month = %s
                      AND year = %s
                      AND status = 'COMPLETED'
                      AND "pdfPath" IS NOT NULL
                      AND "excelPath" IS NOT NULL
                    """,
                    (report_id, month, year),
                )
                completed = cursor.fetchone()
                if completed:
                    conn.commit()
                    return {"already_completed": True, **completed}
                raise RuntimeError(
                    "ReportHistory inexistente, completado o reclamado por otro intento"
                )
            conn.commit()
            print(f"  [DB] ReportHistory reclamado (ID: {report_id})")
            return {"already_completed": False}
        except Exception:
            conn.rollback()
            raise


def renew_report_history_lease(report_id, run_token):
    """Renueva la concesión únicamente si este intento sigue siendo dueño."""
    with connection() as conn:
        try:
            cursor = conn.cursor()
            cursor.execute(
                """
            UPDATE report_history
            SET "leaseExpiresAt" = NOW() + (%s * INTERVAL '1 second'),
                "updatedAt" = NOW()
            WHERE id = %s
              AND status = 'PROCESSING'
              AND "runToken" = %s::uuid
            RETURNING id
            """,
                (REPORT_LEASE_SECONDS, report_id, run_token),
            )
            renewed = cursor.fetchone() is not None
            conn.commit()
            return renewed
        except Exception:
            conn.rollback()
            raise


def complete_report_history(
    report_id,
    run_token,
    pdf_path,
    excel_path,
    pdf_size,
    excel_size,
):
    """Confirma los dos artefactos en la misma fila PROCESSING."""
    with connection() as conn:
        try:
            cursor = conn.cursor()
            cursor.execute(
                """
            UPDATE report_history
            SET "pdfPath" = %s,
                "excelPath" = %s,
                "pdfSize" = %s,
                "excelSize" = %s,
                status = 'COMPLETED',
                "errorMessage" = NULL,
                "runToken" = NULL,
                "leaseExpiresAt" = NULL,
                "completedAt" = NOW(),
                "updatedAt" = NOW()
            WHERE id = %s
              AND status = 'PROCESSING'
              AND "runToken" = %s::uuid
            RETURNING id
            """,
                (pdf_path, excel_path, pdf_size, excel_size, report_id, run_token)
            )
            if not cursor.fetchone():
                raise RuntimeError("ReportHistory dejó de estar PROCESSING")
            conn.commit()
            print(f"  [DB] ReportHistory completado (ID: {report_id})")
        except Exception:
            conn.rollback()
            raise


def fail_report_history(report_id, run_token):
    """Cierra el intento sin persistir rutas, SQL ni detalles internos."""
    with connection() as conn:
        try:
            cursor = conn.cursor()
            cursor.execute(
                """
            UPDATE report_history
            SET status = 'FAILED',
                "pdfPath" = NULL,
                "excelPath" = NULL,
                "pdfSize" = NULL,
                "excelSize" = NULL,
                "errorMessage" = %s,
                "runToken" = NULL,
                "leaseExpiresAt" = NULL,
                "completedAt" = NOW(),
                "updatedAt" = NOW()
            WHERE id = %s
              AND status = 'PROCESSING'
              AND "runToken" = %s::uuid
            RETURNING id
            """,
                ("No se pudo generar el reporte; reintenta más tarde", report_id, run_token)
            )
            failed = cursor.fetchone() is not None
            conn.commit()
            return failed
        except Exception:
            conn.rollback()
            raise


def create_notification(user_id, notif_type, title, message, entity_ref=None):
    """
    Crea una notificación interna para un usuario.
    """
    with connection() as conn:
        try:
            cursor = conn.cursor()
            cursor.execute(
                """
            INSERT INTO notifications
                ("userId", type, title, message, read, "entityRef", "createdAt")
            VALUES
                (%s, %s, %s, %s, false, %s, NOW())
            """,
                (user_id, notif_type, title, message, entity_ref)
            )
            conn.commit()
            print(f"  [Notif] Notificacion enviada a usuario ID: {user_id}")
        except Exception as e:
            conn.rollback()
            print(f"  [Notif] Error al crear notificacion: {e}")


def get_admin_user_ids():
    """
    Obtiene los IDs de todos los usuarios con rol ADMIN.
    """
    with connection() as conn:
        try:
            cursor = conn.cursor()
            cursor.execute(
                """SELECT id FROM users WHERE role = 'ADMIN' AND "isActive" = true"""
            )
            results = cursor.fetchall()
            return [list(row.values())[0] for row in results]
        except Exception as e:
            print(f"  [DB] Error al obtener admins: {e}")
            return []


def validate_artifact(filepath, expected_extension):
    """Exige un archivo regular, no vacío y del formato esperado."""
    if not filepath or not filepath.lower().endswith(expected_extension):
        raise RuntimeError(f"Ruta de artefacto {expected_extension} inválida")
    if not os.path.isfile(filepath):
        raise RuntimeError(f"Artefacto no encontrado: {filepath}")
    size = os.path.getsize(filepath)
    if size <= 0:
        raise RuntimeError(f"Artefacto vacío: {filepath}")
    return size


def collect_report_snapshot(month, year):
    """Recopila ambos formatos desde el mismo snapshot REPEATABLE READ."""
    with repeatable_read_snapshot():
        return collect_report_data(month, year)


async def maintain_report_lease(report_id, run_token, stop, lost):
    """Mantiene viva la concesión sin bloquear la renovación de BullMQ."""
    while not stop.is_set():
        try:
            await asyncio.wait_for(stop.wait(), timeout=REPORT_HEARTBEAT_SECONDS)
            return
        except TimeoutError:
            pass

        try:
            renewed = await asyncio.to_thread(
                renew_report_history_lease,
                report_id,
                run_token,
            )
        except Exception as exc:
            print(f"  [DB] Error renovando lease del reporte: {exc}")
            lost.set()
            return

        if not renewed:
            print("  [DB] Lease perdido; otro intento tomó el reporte")
            lost.set()
            return


def remove_generated_file(filepath):
    """Retira un artefacto parcial/fallido; las rutas vienen de los generadores."""
    if not filepath:
        return
    try:
        os.remove(filepath)
    except FileNotFoundError:
        pass
    except OSError as exc:
        print(f"  [FS] No se pudo retirar artefacto fallido {filepath}: {exc}")


def claim_data_job(data_job_id):
    """Reclama un export durable; BullMQ serializa la cola con concurrency=1."""
    with connection() as conn:
        try:
            cursor = conn.cursor()
            cursor.execute(
                """
                UPDATE data_jobs
                SET status = 'PROCESSING'::"DataJobStatus",
                    progress = GREATEST(progress, 1),
                    "startedAt" = COALESCE("startedAt", NOW()),
                    "errorMessage" = NULL,
                    "updatedAt" = NOW()
                WHERE id = %s
                  AND type IN (
                    'QA_EXPORT'::"DataJobType",
                    'ENCUESTAS_EXPORT'::"DataJobType"
                  )
                  AND status = 'QUEUED'::"DataJobStatus"
                RETURNING payload, "requestedById", type::text AS type
                """,
                (data_job_id,),
            )
            claimed = cursor.fetchone()
            if not claimed:
                cursor.execute(
                    """
                    SELECT status::text AS status, type::text AS type
                    FROM data_jobs
                    WHERE id = %s
                      AND type IN (
                        'QA_EXPORT'::"DataJobType",
                        'ENCUESTAS_EXPORT'::"DataJobType"
                      )
                    """,
                    (data_job_id,),
                )
                existing = cursor.fetchone()
                if existing and existing["status"] == "COMPLETED":
                    conn.commit()
                    return {"already_completed": True}
                raise RuntimeError("DataJob de exportación inexistente o no reclamable")
            conn.commit()
            return {"already_completed": False, **claimed}
        except Exception:
            conn.rollback()
            raise


def update_data_job_progress(data_job_id, progress):
    bounded = min(95, max(1, int(progress)))
    with connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            """
            UPDATE data_jobs
            SET progress = GREATEST(progress, %s), "updatedAt" = NOW()
            WHERE id = %s AND status = 'PROCESSING'::"DataJobStatus"
            """,
            (bounded, data_job_id),
        )
        conn.commit()


def complete_data_job(data_job_id, requested_by_id, data_job_type, result):
    artifact_path = result["artifactPath"]
    artifact_name = result["artifactName"]
    artifact_size = int(result["artifactBytes"])
    public_result = {
        key: value
        for key, value in result.items()
        if key not in {"artifactPath", "artifactName"}
    }
    with connection() as conn:
        try:
            cursor = conn.cursor()
            cursor.execute(
                """
                UPDATE data_jobs
                SET status = 'COMPLETED'::"DataJobStatus",
                    progress = 100,
                    "artifactPath" = %s,
                    "artifactName" = %s,
                    "artifactSize" = %s,
                    result = %s,
                    "errorMessage" = NULL,
                    "completedAt" = NOW(),
                    "updatedAt" = NOW()
                WHERE id = %s
                  AND type = %s::"DataJobType"
                  AND status = 'PROCESSING'::"DataJobStatus"
                RETURNING id
                """,
                (
                    artifact_path,
                    artifact_name,
                    artifact_size,
                    Json(public_result),
                    data_job_id,
                    data_job_type,
                ),
            )
            if not cursor.fetchone():
                raise RuntimeError("DataJob dejó de estar PROCESSING")
            cursor.execute(
                """
                INSERT INTO audit_logs
                ("userId", action, resource, "resourceId", metadata, "createdAt")
                VALUES (%s, 'EXPORT', %s, %s, %s, NOW())
                """,
                (
                    requested_by_id,
                    "Encuesta" if data_job_type == "ENCUESTAS_EXPORT" else "QaExternaRegistro",
                    str(data_job_id),
                    Json(public_result),
                ),
            )
            conn.commit()
        except Exception:
            conn.rollback()
            raise


def fail_data_job(data_job_id, data_job_type, error, final_attempt):
    public_error = (
        public_encuestas_export_error(error)
        if data_job_type == "ENCUESTAS_EXPORT"
        else public_qa_export_error(error)
    )
    with connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            """
            UPDATE data_jobs
            SET status = %s::"DataJobStatus",
                "errorMessage" = %s,
                "completedAt" = CASE WHEN %s THEN NOW() ELSE NULL END,
                "updatedAt" = NOW()
            WHERE id = %s
              AND type = %s::"DataJobType"
              AND status = 'PROCESSING'::"DataJobStatus"
            """,
            (
                "FAILED" if final_attempt else "QUEUED",
                public_error,
                final_attempt,
                data_job_id,
                data_job_type,
            ),
        )
        conn.commit()


def _is_final_attempt(job):
    options = getattr(job, "opts", {}) or {}
    if isinstance(options, dict):
        attempts = int(options.get("attempts", 1) or 1)
    else:
        attempts = int(getattr(options, "attempts", 1) or 1)
    attempts_made = int(getattr(job, "attemptsMade", 0) or 0)
    return attempts_made + 1 >= attempts


async def process_data_job(job, job_token):
    """Genera ZIPs de datos en el worker, nunca en el proceso HTTP."""
    data_job_id = int((getattr(job, "data", {}) or {}).get("dataJobId", 0))
    if data_job_id <= 0:
        raise ValueError("dataJobId inválido")
    claim = await asyncio.to_thread(claim_data_job, data_job_id)
    if claim["already_completed"]:
        return {"success": True, "dataJobId": data_job_id, "alreadyCompleted": True}

    generated = None
    data_job_type = claim["type"]
    try:
        attempt_token = str(uuid.uuid4())
        generator = (
            generate_encuestas_export
            if data_job_type == "ENCUESTAS_EXPORT"
            else generate_qa_export
        )
        storage_root = (
            ENCUESTAS_AUDIO_DIR
            if data_job_type == "ENCUESTAS_EXPORT"
            else QA_EXTERNA_DIR
        )
        generated = await asyncio.to_thread(
            generator,
            data_job_id,
            claim["payload"],
            DATA_JOBS_DIR,
            storage_root,
            attempt_token,
            lambda progress: update_data_job_progress(data_job_id, progress),
        )
        await job.updateProgress(95)
        await asyncio.to_thread(
            complete_data_job,
            data_job_id,
            claim["requestedById"],
            data_job_type,
            generated,
        )
        await job.updateProgress(100)
        return {
            "success": True,
            "dataJobId": data_job_id,
            "records": generated["records"],
            "files": generated.get("photos", generated.get("audios", 0)),
        }
    except Exception as exc:
        print(f"  [DataJob] Error interno {type(exc).__name__}: {exc}")
        if generated:
            remove_generated_file(generated.get("artifactPath"))
        await asyncio.to_thread(
            fail_data_job,
            data_job_id,
            data_job_type,
            exc,
            _is_final_attempt(job),
        )
        raise


async def process_report(job, job_token):
    """
    Función principal que procesa cada job de la cola.
    Genera PDF y Excel, guarda historial, notifica al admin.
    """
    print(f"\n{'='*60}")
    print(f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] Job recibido: {job.name}")
    print(f"  ID: {job.id}")
    print(f"  Datos: {json.dumps(job.data, indent=2)}")
    print(f"{'='*60}")

    report_id = job.data.get("reportHistoryId")
    month = job.data.get("month")
    year = job.data.get("year")
    requested_by = job.data.get("requestedBy", "sistema")

    if not report_id or not month or not year:
        raise ValueError(
            "Faltan datos: 'reportHistoryId', 'month' y 'year' son obligatorios"
        )
    report_id = int(report_id)
    if report_id <= 0:
        raise ValueError("reportHistoryId debe ser positivo")
    month = int(month)
    year = int(year)
    if month < 1 or month > 12 or year < 2000 or year > 2100:
        raise ValueError("Periodo de reporte inválido")

    print(f"  Generando reportes para: {month}/{year}")
    print(f"  Solicitado por: {requested_by}")

    pdf_path = None
    excel_path = None
    pdf_size = None
    excel_size = None
    claimed = False
    committed = False
    run_token = str(uuid.uuid4())
    lease_stop = asyncio.Event()
    lease_lost = asyncio.Event()
    lease_task = None

    try:
        claim = await asyncio.to_thread(
            claim_report_history,
            report_id,
            month,
            year,
            run_token,
        )
        if claim["already_completed"]:
            return {
                "success": True,
                "reportId": report_id,
                "month": month,
                "year": year,
                "pdf_path": claim["pdfPath"],
                "excel_path": claim["excelPath"],
                "pdf_size": claim["pdfSize"],
                "excel_size": claim["excelSize"],
                "already_completed": True,
            }
        claimed = True
        lease_task = asyncio.create_task(
            maintain_report_lease(report_id, run_token, lease_stop, lease_lost)
        )

        await job.updateProgress(10)
        report_data = await asyncio.to_thread(collect_report_snapshot, month, year)
        if lease_lost.is_set():
            raise RuntimeError("Se perdió la concesión durante la recopilación")

        # --- Generar PDF ---
        pdf_path = await asyncio.to_thread(
            generate_pdf,
            month,
            year,
            requested_by,
            report_id,
            run_token,
            report_data,
        )
        pdf_size = validate_artifact(pdf_path, ".pdf")
        print(f"  [PDF] Tamano: {pdf_size:,} bytes")
        await job.updateProgress(50)
        if lease_lost.is_set():
            raise RuntimeError("Se perdió la concesión durante el PDF")

        # --- Generar Excel ---
        excel_path = await asyncio.to_thread(
            generate_excel,
            month,
            year,
            requested_by,
            report_id,
            run_token,
            report_data,
        )
        excel_size = validate_artifact(excel_path, ".xlsx")
        print(f"  [Excel] Tamano: {excel_size:,} bytes")
        await job.updateProgress(80)

        if lease_lost.is_set():
            raise RuntimeError("Se perdió la concesión durante el Excel")

        await job.updateProgress(90)

        # La fila COMPLETED es el punto de confirmación final de los archivos.
        await job.updateProgress(100)
        await asyncio.to_thread(
            complete_report_history,
            report_id,
            run_token,
            pdf_path,
            excel_path,
            pdf_size,
            excel_size,
        )
        committed = True

        # --- Notificar a los admins (post-commit, nunca invalida artefactos) ---
        admin_ids = []
        month_names = {
            1: "Enero", 2: "Febrero", 3: "Marzo", 4: "Abril",
            5: "Mayo", 6: "Junio", 7: "Julio", 8: "Agosto",
            9: "Septiembre", 10: "Octubre", 11: "Noviembre", 12: "Diciembre"
        }
        month_name = month_names.get(month, str(month))

        try:
            admin_ids = get_admin_user_ids()
            for admin_id in admin_ids:
                create_notification(
                    user_id=admin_id,
                    notif_type="REPORT_READY",
                    title=f"Reporte {month_name} {year} listo",
                    message=f"El reporte mensual de {month_name} {year} se genero exitosamente. "
                            f"PDF ({pdf_size:,} bytes) y Excel ({excel_size:,} bytes) disponibles para descarga.",
                    entity_ref=str(report_id)
                )
        except Exception as notification_error:
            print(f"  [Notif] Fallo post-commit: {notification_error}")

        result = {
            "success": True,
            "reportId": report_id,
            "month": month,
            "year": year,
            "pdf_path": pdf_path,
            "excel_path": excel_path,
            "pdf_size": pdf_size,
            "excel_size": excel_size,
            "generated_at": datetime.now().isoformat()
        }

        print("\n  === REPORTE COMPLETADO ===")
        print(f"  PDF: {pdf_path} ({pdf_size:,} bytes)")
        print(f"  Excel: {excel_path} ({excel_size:,} bytes)")
        print(f"  Notificados: {len(admin_ids)} admin(s)")

        return result

    except Exception as e:
        print("\n  === ERROR EN REPORTE ===")
        print(f"  Error: {str(e)}")

        if committed:
            # El historial y los dos archivos ya quedaron confirmados. Un fallo
            # accesorio post-commit no debe provocar reintento ni sobrescritura.
            return {
                "success": True,
                "reportId": report_id,
                "month": month,
                "year": year,
                "pdf_path": pdf_path,
                "excel_path": excel_path,
                "pdf_size": pdf_size,
                "excel_size": excel_size,
                "generated_at": datetime.now().isoformat(),
                "post_commit_warning": str(e),
            }

        remove_generated_file(pdf_path)
        remove_generated_file(excel_path)
        if claimed:
            try:
                failed = await asyncio.to_thread(
                    fail_report_history,
                    report_id,
                    run_token,
                )
                if not failed:
                    print("  [DB] Otro intento ya tomó o cerró ReportHistory")
            except Exception as history_error:
                print(f"  [DB] No se pudo marcar FAILED: {history_error}")

        raise
    finally:
        if lease_task is not None:
            lease_stop.set()
            await lease_task


async def process_report_with_heartbeat(job, job_token):
    """Envuelve cada job para publicar actividad y fallos sin exponer mensajes."""
    async with heavy_job_semaphore:
        worker_heartbeat.mark_job_started(getattr(job, "id", None), QUEUE_NAME)
        try:
            result = await process_report(job, job_token)
        except Exception as exc:
            worker_heartbeat.mark_job_finished(False, type(exc).__name__, QUEUE_NAME)
            raise
        worker_heartbeat.mark_job_finished(True, queue_name=QUEUE_NAME)
        return result


async def process_data_job_with_heartbeat(job, job_token):
    """Incluye las exportaciones en salud y concurrencia del mismo proceso."""
    async with heavy_job_semaphore:
        worker_heartbeat.mark_job_started(getattr(job, "id", None), DATA_QUEUE_NAME)
        try:
            result = await process_data_job(job, job_token)
        except Exception as exc:
            worker_heartbeat.mark_job_finished(False, type(exc).__name__, DATA_QUEUE_NAME)
            raise
        worker_heartbeat.mark_job_finished(True, queue_name=DATA_QUEUE_NAME)
        return result


async def maintain_worker_heartbeat(stop):
    """Demuestra que el event loop sigue avanzando aunque no haya jobs."""
    while not stop.is_set():
        worker_heartbeat.touch()
        try:
            await asyncio.wait_for(stop.wait(), timeout=WORKER_HEARTBEAT_SECONDS)
        except TimeoutError:
            pass


async def main():
    """
    Función principal: inicia el worker y lo mantiene escuchando.
    """
    print(f"\n{'='*60}")
    print("  WORKER DE REPORTERIA - PLATAFORMA FLOTILLAS")
    print(f"  Conectando a Redis: {REDIS_HOST}:{REDIS_PORT}")
    print(f"  Cola: {QUEUE_NAME}")
    print(f"  Inicio: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"{'='*60}\n")

    connection = {"host": REDIS_HOST, "port": REDIS_PORT}
    if REDIS_PASSWORD:
        connection["password"] = REDIS_PASSWORD

    report_worker = Worker(
        QUEUE_NAME,
        process_report_with_heartbeat,
        {
            "connection": connection,
            "concurrency": 1
        }
    )
    data_worker = Worker(
        DATA_QUEUE_NAME,
        process_data_job_with_heartbeat,
        {
            "connection": connection,
            "concurrency": 1,
        },
    )

    print("Escuchando jobs en las colas 'reports' y 'data-jobs'...")
    print("(SIGTERM o Ctrl+C para detener)\n")

    # Cierre ordenado: Docker envía SIGTERM en `stop`/redeploy (NO SIGINT). Sin
    # capturarlo, el loop moría de golpe y el job en curso quedaba a medias
    # (fila report_history en PROCESSING + PDF/Excel parcial en storage/reports).
    loop = asyncio.get_running_loop()
    stop = asyncio.Event()
    for sig in (signal.SIGTERM, signal.SIGINT):
        try:
            loop.add_signal_handler(sig, stop.set)
        except NotImplementedError:
            # Algunas plataformas (p.ej. Windows) no soportan add_signal_handler.
            signal.signal(sig, lambda *_: stop.set())

    worker_heartbeat.mark_ready()
    heartbeat_task = asyncio.create_task(maintain_worker_heartbeat(stop))
    await stop.wait()
    print("\nDeteniendo worker (señal recibida)...")
    worker_heartbeat.mark_stopping()
    try:
        await asyncio.gather(report_worker.close(), data_worker.close())
    finally:
        await heartbeat_task
    print("Worker detenido.")


if __name__ == "__main__":
    asyncio.run(main())
