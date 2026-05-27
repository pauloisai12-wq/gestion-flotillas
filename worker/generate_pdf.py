# Archivo: /flotillas/worker/generate_pdf.py
# REEMPLAZA: Archivo existente completo
# Generador de reportes PDF mensuales — Nombres de columnas corregidos

import os
import calendar
from datetime import datetime, date

import pandas as pd
from jinja2 import Environment, FileSystemLoader
from weasyprint import HTML

from db import query_to_dataframe, query_single_value

# Carpeta donde se guardan los PDFs generados
REPORTS_DIR = "/app/storage/reports"

# Nombres de meses en español
MONTH_NAMES = {
    1: "Enero", 2: "Febrero", 3: "Marzo", 4: "Abril",
    5: "Mayo", 6: "Junio", 7: "Julio", 8: "Agosto",
    9: "Septiembre", 10: "Octubre", 11: "Noviembre", 12: "Diciembre"
}

# Nombres legibles de tipos de documento
DOC_TYPE_NAMES = {
    "INSURANCE": "Poliza de Seguro",
    "VERIFICATION": "Verificacion Vehicular",
    "CIRCULATION_CARD": "Tarjeta de Circulacion",
    "SCT_PERMIT": "Permiso SCT"
}


def get_summary(month, year):
    """
    Obtiene las metricas principales del mes para el resumen ejecutivo.
    """
    first_day = f"{year}-{str(month).zfill(2)}-01"
    last_day_num = calendar.monthrange(year, month)[1]
    last_day = f"{year}-{str(month).zfill(2)}-{last_day_num}"

    # Total de vehiculos
    total_vehicles = query_single_value('SELECT COUNT(*) FROM vehicles') or 0

    # Vehiculos operativos vs bloqueados
    operative = query_single_value(
        """SELECT COUNT(*) FROM vehicles WHERE status = 'OPERATIVE'"""
    ) or 0
    blocked = query_single_value(
        """SELECT COUNT(*) FROM vehicles WHERE status = 'BLOCKED'"""
    ) or 0

    # Cargas del mes
    fuel_data = query_to_dataframe(
        """
        SELECT
            COUNT(*) as total_loads,
            COALESCE(SUM(liters), 0) as total_liters,
            COALESCE(SUM(amount), 0) as total_spent,
            COALESCE(AVG("kmPerLiter"), 0) as avg_kml
        FROM fuel_loads
        WHERE "loadDate" >= %s AND "loadDate" <= %s
            AND "kmPerLiter" IS NOT NULL
        """,
        (first_day, last_day + " 23:59:59")
    )

    total_loads = int(fuel_data["total_loads"].iloc[0]) if len(fuel_data) > 0 else 0
    total_liters = float(fuel_data["total_liters"].iloc[0]) if len(fuel_data) > 0 else 0
    total_spent = float(fuel_data["total_spent"].iloc[0]) if len(fuel_data) > 0 else 0
    avg_kml = float(fuel_data["avg_kml"].iloc[0]) if len(fuel_data) > 0 else 0

    # Presupuesto del mes
    budget_total = query_single_value(
        """
        SELECT COALESCE("globalAmount", 0)
        FROM fuel_budgets
        WHERE month = %s AND year = %s
        """,
        (month, year)
    ) or 0

    # Documentos vencidos y por vencer
    expired_docs = query_single_value(
        """SELECT COUNT(*) FROM documents WHERE "expiresAt" < CURRENT_DATE"""
    ) or 0

    expiring_docs = query_single_value(
        """
        SELECT COUNT(*) FROM documents
        WHERE "expiresAt" >= CURRENT_DATE
            AND "expiresAt" <= (CURRENT_DATE + INTERVAL '30 days')
        """
    ) or 0

    return {
        "total_vehicles": total_vehicles,
        "operative_vehicles": operative,
        "blocked_vehicles": blocked,
        "total_loads": total_loads,
        "total_liters": total_liters,
        "total_spent": total_spent,
        "avg_kml": avg_kml,
        "budget_total": float(budget_total),
        "expired_docs": expired_docs,
        "expiring_docs": expiring_docs
    }


def get_fuel_by_type(month, year):
    """
    Gasto de combustible agrupado por tipo de vehiculo.
    """
    first_day = f"{year}-{str(month).zfill(2)}-01"
    last_day_num = calendar.monthrange(year, month)[1]
    last_day = f"{year}-{str(month).zfill(2)}-{last_day_num}"

    df = query_to_dataframe(
        """
        SELECT
            vt.name as vehicle_type,
            COUNT(fl.id) as total_loads,
            COALESCE(SUM(fl.liters), 0) as total_liters,
            COALESCE(SUM(fl.amount), 0) as total_spent,
            COALESCE(AVG(fl."kmPerLiter"), 0) as avg_kml,
            vt."expectedKmPerLiter" as expected_kml
        FROM fuel_loads fl
        JOIN vehicles v ON fl."vehicleId" = v.id
        JOIN vehicle_types vt ON v."vehicleTypeId" = vt.id
        WHERE fl."loadDate" >= %s AND fl."loadDate" <= %s
        GROUP BY vt.name, vt."expectedKmPerLiter"
        ORDER BY total_spent DESC
        """,
        (first_day, last_day + " 23:59:59")
    )
    return df.to_dict("records")


def get_top_consumers(month, year, limit=10):
    """
    Top N vehiculos con mayor gasto de combustible en el mes.
    """
    first_day = f"{year}-{str(month).zfill(2)}-01"
    last_day_num = calendar.monthrange(year, month)[1]
    last_day = f"{year}-{str(month).zfill(2)}-{last_day_num}"

    df = query_to_dataframe(
        """
        SELECT
            v."economicNumber" as economic_number,
            v.plate,
            vt.name as vehicle_type,
            COUNT(fl.id) as total_loads,
            COALESCE(SUM(fl.liters), 0) as total_liters,
            COALESCE(SUM(fl.amount), 0) as total_spent,
            COALESCE(AVG(fl."kmPerLiter"), 0) as avg_kml
        FROM fuel_loads fl
        JOIN vehicles v ON fl."vehicleId" = v.id
        JOIN vehicle_types vt ON v."vehicleTypeId" = vt.id
        WHERE fl."loadDate" >= %s AND fl."loadDate" <= %s
        GROUP BY v."economicNumber", v.plate, vt.name
        ORDER BY total_spent DESC
        LIMIT %s
        """,
        (first_day, last_day + " 23:59:59", limit)
    )
    return df.to_dict("records")


def get_kml_ranking(month, year):
    """
    Ranking de vehiculos por rendimiento km/l.
    Retorna los 10 mejores y 10 peores.
    """
    first_day = f"{year}-{str(month).zfill(2)}-01"
    last_day_num = calendar.monthrange(year, month)[1]
    last_day = f"{year}-{str(month).zfill(2)}-{last_day_num}"

    df = query_to_dataframe(
        """
        SELECT
            v."economicNumber" as economic_number,
            v.plate,
            vt.name as vehicle_type,
            AVG(fl."kmPerLiter") as avg_kml,
            vt."expectedKmPerLiter" as expected_kml
        FROM fuel_loads fl
        JOIN vehicles v ON fl."vehicleId" = v.id
        JOIN vehicle_types vt ON v."vehicleTypeId" = vt.id
        WHERE fl."loadDate" >= %s AND fl."loadDate" <= %s
            AND fl."kmPerLiter" IS NOT NULL
            AND fl."kmPerLiter" > 0
        GROUP BY v."economicNumber", v.plate, vt.name, vt."expectedKmPerLiter"
        HAVING COUNT(fl.id) >= 2
        ORDER BY avg_kml DESC
        """,
        (first_day, last_day + " 23:59:59")
    )

    if len(df) == 0:
        return [], []

    # Calcular desviacion porcentual vs esperado
    df["deviation"] = ((df["avg_kml"] - df["expected_kml"]) / df["expected_kml"]) * 100

    best = df.head(10).to_dict("records")
    worst = df.tail(10).sort_values("avg_kml", ascending=True).to_dict("records")

    return best, worst


def get_docs_summary():
    """
    Resumen del estado de documentos: vigentes, por vencer, vencidos.
    """
    valid = query_single_value(
        """
        SELECT COUNT(*) FROM documents
        WHERE "expiresAt" > (CURRENT_DATE + INTERVAL '30 days')
        """
    ) or 0

    expiring = query_single_value(
        """
        SELECT COUNT(*) FROM documents
        WHERE "expiresAt" >= CURRENT_DATE
            AND "expiresAt" <= (CURRENT_DATE + INTERVAL '30 days')
        """
    ) or 0

    expired = query_single_value(
        """SELECT COUNT(*) FROM documents WHERE "expiresAt" < CURRENT_DATE"""
    ) or 0

    return {"valid": valid, "expiring": expiring, "expired": expired}


def get_expired_docs_list():
    """
    Lista detallada de documentos vencidos con datos del vehiculo.
    """
    df = query_to_dataframe(
        """
        SELECT
            v."economicNumber" as economic_number,
            v.plate,
            d.type as doc_type,
            d."expiresAt" as expires_at,
            (CURRENT_DATE - d."expiresAt"::date) as days_overdue
        FROM documents d
        JOIN vehicles v ON d."vehicleId" = v.id
        WHERE d."expiresAt" < CURRENT_DATE
        ORDER BY days_overdue DESC
        """
    )

    if len(df) == 0:
        return []

    # Traducir tipos de documento al espanol
    df["doc_type"] = df["doc_type"].map(DOC_TYPE_NAMES).fillna(df["doc_type"])
    df["expires_at"] = pd.to_datetime(df["expires_at"]).dt.strftime("%d/%m/%Y")
    df["days_overdue"] = df["days_overdue"].apply(
        lambda x: x.days if hasattr(x, "days") else int(x)
    )

    return df.to_dict("records")


def get_maintenance_done(month, year):
    """
    Mantenimientos realizados durante el mes.
    """
    first_day = f"{year}-{str(month).zfill(2)}-01"
    last_day_num = calendar.monthrange(year, month)[1]
    last_day = f"{year}-{str(month).zfill(2)}-{last_day_num}"

    df = query_to_dataframe(
        """
        SELECT
            v."economicNumber" as economic_number,
            v.plate,
            sc.name as service_name,
            mr."serviceDate" as performed_at,
            mr.odometer as odometer_km,
            mr.cost,
            mr.provider
        FROM maintenance_records mr
        JOIN vehicles v ON mr."vehicleId" = v.id
        JOIN service_catalog sc ON mr."serviceId" = sc.id
        WHERE mr."serviceDate" >= %s AND mr."serviceDate" <= %s
        ORDER BY mr."serviceDate" DESC
        """,
        (first_day, last_day + " 23:59:59")
    )

    if len(df) == 0:
        return []

    df["performed_at"] = pd.to_datetime(df["performed_at"]).dt.strftime("%d/%m/%Y")
    df["cost"] = df["cost"].astype(float)
    df["odometer_km"] = df["odometer_km"].apply(lambda x: f"{int(x):,}")

    return df.to_dict("records")


def get_maintenance_pending():
    """
    Mantenimientos pendientes o vencidos para todos los vehiculos.
    Solo muestra los que estan al 80% o mas del intervalo.
    """
    df = query_to_dataframe(
        """
        SELECT
            v."economicNumber" as economic_number,
            v.plate,
            sc.name as service_name,
            v."currentOdometer" as current_km,
            sc."intervalKm" as interval_km,
            COALESCE(
                (SELECT MAX(mr.odometer) FROM maintenance_records mr
                 WHERE mr."vehicleId" = v.id AND mr."serviceId" = sc.id),
                0
            ) as last_service_km
        FROM vehicles v
        JOIN vehicle_types vt ON v."vehicleTypeId" = vt.id
        JOIN service_catalog sc ON sc."vehicleTypeId" = vt.id
        ORDER BY v."economicNumber", sc.name
        """
    )

    if len(df) == 0:
        return []

    # Calcular proximo servicio y porcentaje de avance
    df["next_service_km"] = df["last_service_km"] + df["interval_km"]
    df["progress"] = (df["current_km"] - df["last_service_km"]) / df["interval_km"]

    # Filtrar: solo los que estan al 80% o mas
    df = df[df["progress"] >= 0.80].copy()

    if len(df) == 0:
        return []

    # Determinar estado
    df["status"] = df["progress"].apply(
        lambda p: "OVERDUE" if p >= 1.0 else "DUE_SOON"
    )

    # Formatear numeros
    df["current_km"] = df["current_km"].apply(lambda x: f"{int(x):,}")
    df["next_service_km"] = df["next_service_km"].apply(lambda x: f"{int(x):,}")

    result = df[["economic_number", "plate", "service_name",
                  "current_km", "next_service_km", "status"]].to_dict("records")

    return result


def generate_pdf(month, year, requested_by="sistema"):
    """
    Funcion principal: genera el reporte PDF del mes indicado.
    
    Parametros:
        month: Numero del mes (1-12)
        year: Ano (ej: 2026)
        requested_by: Email del usuario que solicito el reporte
    
    Retorna:
        Ruta del archivo PDF generado
    """
    print(f"  [PDF] Recopilando datos para {month}/{year}...")

    # 1. Recopilar todos los datos
    summary = get_summary(month, year)
    fuel_by_type = get_fuel_by_type(month, year)
    top_consumers = get_top_consumers(month, year)
    best_kml, worst_kml = get_kml_ranking(month, year)
    docs_summary = get_docs_summary()
    expired_docs_list = get_expired_docs_list()
    maintenance_done = get_maintenance_done(month, year)
    maintenance_pending = get_maintenance_pending()

    print(f"  [PDF] Datos recopilados. Renderizando plantilla...")

    # 2. Preparar variables para la plantilla
    last_day_num = calendar.monthrange(year, month)[1]
    template_data = {
        "month_name": MONTH_NAMES[month],
        "month_str": str(month).zfill(2),
        "year": year,
        "last_day": last_day_num,
        "generated_at": datetime.now().strftime("%d/%m/%Y %H:%M hrs"),
        "requested_by": requested_by,
        "summary": summary,
        "fuel_by_type": fuel_by_type,
        "top_consumers": top_consumers,
        "best_kml": best_kml,
        "worst_kml": worst_kml,
        "docs_summary": docs_summary,
        "expired_docs_list": expired_docs_list,
        "maintenance_done": maintenance_done,
        "maintenance_pending": maintenance_pending
    }

    # 3. Cargar y renderizar la plantilla con Jinja2
    template_dir = os.path.join(os.path.dirname(__file__), "templates")
    env = Environment(loader=FileSystemLoader(template_dir))
    template = env.get_template("report_template.html")
    html_content = template.render(**template_data)

    # 4. Generar PDF con WeasyPrint
    os.makedirs(REPORTS_DIR, exist_ok=True)
    filename = f"reporte_mensual_{year}_{str(month).zfill(2)}.pdf"
    filepath = os.path.join(REPORTS_DIR, filename)

    print(f"  [PDF] Generando PDF: {filename}...")
    HTML(string=html_content).write_pdf(filepath)

    print(f"  [PDF] PDF generado: {filepath}")
    return filepath


# --- Prueba directa ---
if __name__ == "__main__":
    print("=== PRUEBA DE GENERACION DE PDF ===")
    path = generate_pdf(month=3, year=2026, requested_by="admin@flotillas.com")
    print(f"\nArchivo generado en: {path}")