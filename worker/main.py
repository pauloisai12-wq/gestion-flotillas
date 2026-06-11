# Worker de reportería — Genera PDF y Excel, guarda historial

import asyncio
import json
import os
import signal
from datetime import datetime
from urllib.parse import urlparse

from bullmq import Worker

from db import get_connection
from generate_pdf import generate_pdf
from generate_excel import generate_excel

# --- Configuración ---
REDIS_URL = os.environ.get("REDIS_URL", "redis://localhost:6379")
QUEUE_NAME = "reports"

# Parseo robusto de la URL (soporta redis://[:password@]host[:port]).
# El split manual anterior ignoraba la contraseña; si Redis corre con
# --requirepass el worker debe autenticarse o no podrá consumir la cola.
_redis = urlparse(REDIS_URL)
REDIS_HOST = _redis.hostname or "localhost"
REDIS_PORT = _redis.port or 6379
REDIS_PASSWORD = _redis.password or None


def save_report_history(month, year, requested_by, pdf_path, excel_path,
                        pdf_size, excel_size, status, error_message=None):
    """
    Guarda el registro del reporte generado en la tabla report_history.
    """
    conn = get_connection()
    try:
        cursor = conn.cursor()
        cursor.execute(
            """
            INSERT INTO report_history
                (month, year, "pdfPath", "excelPath", "pdfSize", "excelSize",
                 status, "requestedBy", "errorMessage", "startedAt", "completedAt",
                 "createdAt", "updatedAt")
            VALUES
                (%s, %s, %s, %s, %s, %s,
                 %s, %s, %s, NOW(), NOW(),
                 NOW(), NOW())
            RETURNING id
            """,
            (month, year, pdf_path, excel_path, pdf_size, excel_size,
             status, requested_by, error_message)
        )
        result = cursor.fetchone()
        conn.commit()
        report_id = list(result.values())[0]
        print(f"  [DB] Registro guardado en report_history (ID: {report_id})")
        return report_id
    except Exception as e:
        conn.rollback()
        print(f"  [DB] Error al guardar historial: {e}")
        return None
    finally:
        conn.close()


def create_notification(user_id, notif_type, title, message, entity_ref=None):
    """
    Crea una notificación interna para un usuario.
    """
    conn = get_connection()
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
    finally:
        conn.close()


def get_admin_user_ids():
    """
    Obtiene los IDs de todos los usuarios con rol ADMIN.
    """
    conn = get_connection()
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
    finally:
        conn.close()


def get_file_size(filepath):
    """
    Retorna el tamaño del archivo en bytes, o None si no existe.
    """
    try:
        return os.path.getsize(filepath)
    except OSError:
        return None


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

# Si viene del cron automático, calcular el mes anterior
    if job.data.get("autoCalculateMonth"):
        today = datetime.now()
        if today.month == 1:
            month = 12
            year = today.year - 1
        else:
            month = today.month - 1
            year = today.year
        requested_by = "cron-mensual"
    else:
        month = job.data.get("month")
        year = job.data.get("year")
        requested_by = job.data.get("requestedBy", "sistema")

    if not month or not year:
        raise ValueError("Faltan datos: 'month' y 'year' son obligatorios")

    print(f"  Generando reportes para: {month}/{year}")
    print(f"  Solicitado por: {requested_by}")

    pdf_path = None
    excel_path = None
    pdf_size = None
    excel_size = None

    try:
        # --- Generar PDF ---
        await job.updateProgress(10)
        pdf_path = generate_pdf(month, year, requested_by)
        pdf_size = get_file_size(pdf_path) or 0  # 0 si stat falla; evita TypeError en formato ':,'
        print(f"  [PDF] Tamano: {pdf_size:,} bytes")
        await job.updateProgress(50)

        # --- Generar Excel ---
        excel_path = generate_excel(month, year, requested_by)
        excel_size = get_file_size(excel_path) or 0
        print(f"  [Excel] Tamano: {excel_size:,} bytes")
        await job.updateProgress(80)

        # --- Guardar en historial ---
        report_id = save_report_history(
            month=month,
            year=year,
            requested_by=requested_by,
            pdf_path=pdf_path,
            excel_path=excel_path,
            pdf_size=pdf_size,
            excel_size=excel_size,
            status="COMPLETED"
        )
        if report_id is None:
            # report_history es la fuente de verdad (lista + descarga). Si no se
            # guardó, NO reportar éxito: propagar para marcar FAILED y reintentar.
            raise RuntimeError("No se pudo guardar report_history; el reporte no quedó registrado.")
        await job.updateProgress(90)

        # --- Notificar a los admins ---
        admin_ids = get_admin_user_ids()
        month_names = {
            1: "Enero", 2: "Febrero", 3: "Marzo", 4: "Abril",
            5: "Mayo", 6: "Junio", 7: "Julio", 8: "Agosto",
            9: "Septiembre", 10: "Octubre", 11: "Noviembre", 12: "Diciembre"
        }
        month_name = month_names.get(month, str(month))

        for admin_id in admin_ids:
            create_notification(
                user_id=admin_id,
                notif_type="REPORT_READY",
                title=f"Reporte {month_name} {year} listo",
                message=f"El reporte mensual de {month_name} {year} se genero exitosamente. "
                        f"PDF ({pdf_size:,} bytes) y Excel ({excel_size:,} bytes) disponibles para descarga.",
                entity_ref=str(report_id) if report_id else None
            )

        await job.updateProgress(100)

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

        # Guardar el error en historial
        save_report_history(
            month=month,
            year=year,
            requested_by=requested_by,
            pdf_path=pdf_path,
            excel_path=excel_path,
            pdf_size=pdf_size,
            excel_size=excel_size,
            status="FAILED",
            error_message=str(e)
        )

        raise e


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

    worker = Worker(
        QUEUE_NAME,
        process_report,
        {
            "connection": connection,
            "concurrency": 1
        }
    )

    print("Escuchando jobs en la cola 'reports'...")
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

    await stop.wait()
    print("\nDeteniendo worker (señal recibida)...")
    await worker.close()
    print("Worker detenido.")


if __name__ == "__main__":
    asyncio.run(main())