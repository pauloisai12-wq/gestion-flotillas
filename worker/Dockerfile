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

# UID/GID estable y compartido con API. Evita carreras de ownership en reports
# y permite que getpwuid/HOME funcionen para WeasyPrint/fontconfig.
RUN groupadd --gid 10001 appuser \
    && useradd --uid 10001 --gid appuser --create-home \
      --home-dir /home/appuser --shell /usr/sbin/nologin appuser \
    && chown -R appuser:appuser /app/storage /home/appuser
ENV HOME=/home/appuser
USER appuser

# Comando: ejecutar el worker que escucha jobs de BullMQ
CMD ["python", "main.py"]
