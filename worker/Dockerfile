# Archivo: /flotillas/worker/Dockerfile
# REEMPLAZA: Archivo existente completo
FROM python:3.11-slim

WORKDIR /app

# Instalar dependencias del sistema para WeasyPrint + fuentes profesionales
RUN apt-get update && apt-get install -y \
    libpango-1.0-0 \
    libpangocairo-1.0-0 \
    libgdk-pixbuf-2.0-0 \
    libcairo2 \
    libffi-dev \
    shared-mime-info \
    fonts-liberation \
    fonts-dejavu-core \
    && rm -rf /var/lib/apt/lists/*

# Copiar archivo de dependencias Python
COPY requirements.txt ./

# Instalar dependencias Python
RUN pip install --no-cache-dir -r requirements.txt

# Crear carpeta para reportes generados
RUN mkdir -p /app/storage/reports

# Copiar código
COPY . .

# Ejecutar como usuario no-root (defensa en profundidad). El worker solo necesita
# escribir en /app/storage/reports; le damos la propiedad para que el volumen con
# nombre (reports_data) herede ese owner al montarse vacío la primera vez.
RUN groupadd -r appuser && useradd -r -g appuser appuser \
    && chown -R appuser:appuser /app/storage
USER appuser

# Comando: ejecutar el worker que escucha jobs de BullMQ
CMD ["python", "main.py"]