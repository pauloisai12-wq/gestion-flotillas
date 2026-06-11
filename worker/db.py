# Módulo de conexión a PostgreSQL — con pool de conexiones

import os
import warnings
import atexit
import pandas as pd
from psycopg2 import pool
from psycopg2.extras import RealDictCursor
from contextlib import contextmanager

# Silenciar el UserWarning de pandas respecto a SQLAlchemy
warnings.filterwarnings('ignore', category=UserWarning, module='pandas')

DATABASE_URL = os.environ.get("DATABASE_URL")
if not DATABASE_URL:
    # Sin fallback a localhost: dentro del contenedor el host es el servicio
    # `postgres` (lo inyecta docker-compose). Fallar explícito evita conexiones
    # silenciosas a una BD equivocada si la variable no se propagó.
    raise RuntimeError(
        "DATABASE_URL es obligatorio "
        "(p.ej. postgresql://user:pass@postgres:5432/flotillas)"
    )

# Tamaño del pool. Mín 1 conexión (uso bajo en idle), máx 5 (suficiente para
# generación concurrente de reportes — el worker tiene concurrency=1, pero
# cada job dispara múltiples queries en paralelo internamente).
_POOL_MIN = int(os.environ.get("DB_POOL_MIN", 1))
_POOL_MAX = int(os.environ.get("DB_POOL_MAX", 5))

_pool: pool.SimpleConnectionPool | None = None


def _get_pool() -> pool.SimpleConnectionPool:
    """Inicializa el pool lazy. Reutiliza la misma instancia para todo el proceso."""
    global _pool
    if _pool is None:
        _pool = pool.SimpleConnectionPool(_POOL_MIN, _POOL_MAX, dsn=DATABASE_URL)
    return _pool


def _close_pool():
    """Cierra todas las conexiones al apagar el proceso."""
    global _pool
    if _pool is not None:
        _pool.closeall()
        _pool = None


atexit.register(_close_pool)


@contextmanager
def _checkout(cursor_factory=RealDictCursor):
    """
    Toma una conexión prestada del pool y la devuelve al terminar.
    Garantiza que la conexión vuelve aunque la query lance excepción.
    """
    p = _get_pool()
    conn = p.getconn()
    try:
        if cursor_factory is not None:
            conn.cursor_factory = cursor_factory
        yield conn
    finally:
        # Resetear el estado transaccional antes de devolver la conexión al pool:
        # si una query falló, la conexión queda en transacción abortada y
        # envenenaría al siguiente que la tome. Si el rollback falla, la
        # conexión está rota y se descarta del pool (close=True).
        broken = False
        try:
            conn.rollback()
        except Exception:
            broken = True
        p.putconn(conn, close=broken)


def get_connection():
    """
    DEPRECATED en favor de _checkout(). Se mantiene por compatibilidad.
    Retorna una conexión PRESTADA del pool — el caller DEBE cerrarla con
    .close(), que internamente la devuelve al pool.

    Nota: si quieres seguridad ante excepciones usa `with _checkout() as conn:`.
    """
    p = _get_pool()
    conn = p.getconn()
    conn.cursor_factory = RealDictCursor
    # Patcheamos .close() para que devuelva al pool en vez de cerrar de verdad
    original_close = conn.close
    def _putback():
        try:
            p.putconn(conn)
        except Exception:
            original_close()
    conn.close = _putback  # type: ignore[method-assign]
    return conn


def get_raw_connection():
    """
    Conexión SIN RealDictCursor (compat con pandas.read_sql_query).
    """
    p = _get_pool()
    conn = p.getconn()
    original_close = conn.close
    def _putback():
        try:
            p.putconn(conn)
        except Exception:
            original_close()
    conn.close = _putback  # type: ignore[method-assign]
    return conn


def query_to_dataframe(sql, params=None):
    """
    Ejecuta una consulta SQL y retorna el resultado como un DataFrame de pandas.
    """
    with _checkout(cursor_factory=None) as conn:
        return pd.read_sql_query(sql, conn, params=params)


def query_single_value(sql, params=None):
    """
    Ejecuta una consulta que retorna un solo valor (como COUNT o SUM).
    """
    with _checkout() as conn:
        cursor = conn.cursor()
        cursor.execute(sql, params)
        result = cursor.fetchone()
        return list(result.values())[0] if result else None


# --- Prueba de conexión ---
def _redact_url(url: str) -> str:
    """Oculta la contraseña de una URL de conexión antes de imprimirla."""
    if "://" in url and "@" in url:
        scheme, rest = url.split("://", 1)
        if "@" in rest:
            creds, host = rest.split("@", 1)
            user = creds.split(":", 1)[0]
            return f"{scheme}://{user}:***@{host}"
    return url


if __name__ == "__main__":
    print(f"Conectando a: {_redact_url(DATABASE_URL)}")
    try:
        with _checkout() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT COUNT(*) as total FROM vehicles")
            result = cursor.fetchone()
            print(f"Conexion exitosa. Vehiculos en BD: {result['total']}")
    except Exception as e:
        print(f"Error de conexion: {e}")
