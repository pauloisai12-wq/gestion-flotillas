"""Heartbeat atómico y métricas mínimas del worker de reportes."""

import json
import os
import time


HEALTHY_STATES = {"ready", "busy"}


class WorkerHeartbeat:
    def __init__(self, path, queue_names):
        self.path = path
        queues = [queue_names] if isinstance(queue_names, str) else list(queue_names)
        if not queues:
            raise ValueError("el worker debe declarar al menos una cola")
        self._data = {
            "format": "flotillas-worker-heartbeat-v1",
            "pid": os.getpid(),
            # `queue` conserva compatibilidad con consumidores v1; `queues`
            # representa todos los Workers que comparten este event loop.
            "queue": queues[0],
            "queues": queues,
            "state": "starting",
            "started_epoch": time.time(),
            "heartbeat_epoch": 0,
            "active_jobs": 0,
            "processed_total": 0,
            "failed_total": 0,
            "last_job_id": None,
            "last_queue": None,
            "last_job_started_epoch": None,
            "last_job_finished_epoch": None,
            "last_failure_type": None,
        }

    def _write(self):
        directory = os.path.dirname(os.path.abspath(self.path))
        os.makedirs(directory, mode=0o700, exist_ok=True)
        temporary = f"{self.path}.{os.getpid()}.tmp"
        with open(temporary, "w", encoding="utf-8") as handle:
            json.dump(self._data, handle, sort_keys=True, separators=(",", ":"))
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.chmod(temporary, 0o600)
        os.replace(temporary, self.path)

    def touch(self, state=None):
        if state is not None:
            self._data["state"] = state
        self._data["heartbeat_epoch"] = time.time()
        self._write()

    def mark_ready(self):
        self.touch("ready")

    def mark_job_started(self, job_id, queue_name=None):
        self._data["state"] = "busy"
        self._data["active_jobs"] += 1
        self._data["last_job_id"] = None if job_id is None else str(job_id)
        self._data["last_queue"] = queue_name
        self._data["last_job_started_epoch"] = time.time()
        self._data["last_failure_type"] = None
        self.touch()

    def mark_job_finished(self, succeeded, failure_type=None, queue_name=None):
        self._data["active_jobs"] = max(0, self._data["active_jobs"] - 1)
        self._data["state"] = "busy" if self._data["active_jobs"] else "ready"
        self._data["processed_total"] += 1
        if queue_name is not None:
            self._data["last_queue"] = queue_name
        self._data["last_job_finished_epoch"] = time.time()
        if not succeeded:
            self._data["failed_total"] += 1
            self._data["last_failure_type"] = failure_type or "Error"
        self.touch()

    def mark_stopping(self):
        self.touch("stopping")


def inspect_heartbeat(path, max_age_seconds, now=None):
    """Lee y valida el heartbeat sin depender de Redis o PostgreSQL."""
    current_time = time.time() if now is None else float(now)
    try:
        stat = os.stat(path)
        if not os.path.isfile(path) or stat.st_size > 64 * 1024:
            raise ValueError("heartbeat no es un archivo regular pequeño")
        with open(path, "r", encoding="utf-8") as handle:
            data = json.load(handle)
        if data.get("format") != "flotillas-worker-heartbeat-v1":
            raise ValueError("formato de heartbeat desconocido")
        heartbeat_epoch = float(data["heartbeat_epoch"])
        age_seconds = max(0, int(current_time - heartbeat_epoch))
        state = data.get("state")
        healthy = state in HEALTHY_STATES and age_seconds <= max_age_seconds
        return {
            "healthy": healthy,
            "state": state,
            "age_seconds": age_seconds,
            "queue": data.get("queue"),
            "queues": data.get("queues", [data.get("queue")]),
            "active_jobs": int(data.get("active_jobs", 0)),
            "processed_total": int(data.get("processed_total", 0)),
            "failed_total": int(data.get("failed_total", 0)),
            "last_job_id": data.get("last_job_id"),
            "last_queue": data.get("last_queue"),
            "last_failure_type": data.get("last_failure_type"),
        }
    except (OSError, ValueError, TypeError, KeyError, json.JSONDecodeError) as exc:
        return {
            "healthy": False,
            "state": "unavailable",
            "age_seconds": None,
            "error": type(exc).__name__,
        }
