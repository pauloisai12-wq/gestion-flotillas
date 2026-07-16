#!/usr/bin/env python3
"""Monitor ligero del perfil público Hetzner; solo usa la biblioteca estándar."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

from backup_receipt import ReceiptError, validate_key, verify_receipt


ROOT = Path(__file__).resolve().parents[2]
LONG_LIVED_SERVICES = ("postgres", "redis", "api", "web", "worker-python", "caddy")
HEALTH_REQUIRED = {"postgres", "redis", "api", "web", "worker-python"}
MAINTENANCE_STOPPABLE = {"api", "web", "worker-python", "caddy"}
DEFAULT_QUEUE_NAMES = (
    "reports",
    "data-jobs",
    "vehicle-imports",
    "media-processing",
    "report-dispatch",
    "compliance",
    "refresh-views",
    "budget-rollover",
)
QUEUE_METRICS = ("waiting", "active", "delayed", "failed", "prioritized")


class MonitorError(RuntimeError):
    pass


def load_env_file(path: Path) -> None:
    """Carga KEY=VALUE sin ejecutar el archivo como shell."""
    if not path.is_file():
        raise MonitorError(f"env file inexistente: {path}")
    for line_number, raw in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        if "=" not in line:
            raise MonitorError(f"línea inválida en env file: {line_number}")
        key, value = line.split("=", 1)
        key = key.strip()
        if not key or not key.replace("_", "").isalnum() or key[0].isdigit():
            raise MonitorError(f"clave inválida en env file: línea {line_number}")
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in {'"', "'"}:
            value = value[1:-1]
        else:
            marker = value.find(" #")
            if marker >= 0:
                value = value[:marker].rstrip()
        os.environ.setdefault(key, value)


def env_int(name: str, default: int, minimum: int, maximum: int) -> int:
    raw = os.environ.get(name, str(default))
    try:
        value = int(raw)
    except ValueError as exc:
        raise MonitorError(f"{name} debe ser entero") from exc
    if value < minimum or value > maximum:
        raise MonitorError(f"{name} debe estar entre {minimum} y {maximum}")
    return value


def run(command: list[str], timeout: int = 30, check: bool = True) -> subprocess.CompletedProcess:
    try:
        completed = subprocess.run(
            command,
            cwd=ROOT,
            capture_output=True,
            text=True,
            timeout=timeout,
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise MonitorError(f"no se pudo ejecutar {command[0]}: {type(exc).__name__}") from exc
    if check and completed.returncode != 0:
        detail = (completed.stderr or completed.stdout).strip().splitlines()
        summary = detail[-1][:300] if detail else f"exit {completed.returncode}"
        raise MonitorError(f"{command[0]} falló: {summary}")
    return completed


def parse_compose_ps(raw: str) -> dict[str, dict]:
    text = raw.strip()
    if not text:
        return {}
    try:
        if text.startswith("["):
            rows = json.loads(text)
        else:
            rows = [json.loads(line) for line in text.splitlines() if line.strip()]
    except json.JSONDecodeError as exc:
        raise MonitorError("docker compose ps devolvió JSON inválido") from exc
    result = {}
    for row in rows:
        service = row.get("Service") or row.get("service")
        if service:
            result[service] = {
                "state": (row.get("State") or row.get("state") or "unknown").lower(),
                "health": (row.get("Health") or row.get("health") or "").lower(),
            }
    return result


def compose_command(env_file: Path) -> list[str]:
    return [
        "docker",
        "compose",
        "--env-file",
        str(env_file),
        "-p",
        "flotillas",
        "-f",
        "docker-compose.yml",
        "-f",
        "docker-compose.public.yml",
    ]


def configured_queue_names() -> tuple[str, ...]:
    raw = os.environ.get("OPS_QUEUE_NAMES", ",".join(DEFAULT_QUEUE_NAMES))
    names = tuple(item.strip() for item in raw.split(",") if item.strip())
    if not names or len(names) > 20 or len(set(names)) != len(names):
        raise MonitorError("OPS_QUEUE_NAMES debe contener 1..20 nombres únicos")
    allowed = set("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789._-")
    if any(len(name) > 64 or not set(name) <= allowed for name in names):
        raise MonitorError("OPS_QUEUE_NAMES contiene un nombre inválido")
    return names


def collect_queue_metrics(compose: list[str]) -> tuple[dict, dict]:
    """Obtiene todas las colas en un solo exec/EVAL para no sondear Docker 40 veces."""
    names = configured_queue_names()
    script = (
        "local out={} "
        "for i=1,#ARGV do "
        "local b='bull:'..ARGV[i]..':' "
        "out[#out+1]=redis.call('LLEN',b..'wait') "
        "out[#out+1]=redis.call('LLEN',b..'active') "
        "out[#out+1]=redis.call('ZCARD',b..'delayed') "
        "out[#out+1]=redis.call('ZCARD',b..'failed') "
        "out[#out+1]=redis.call('ZCARD',b..'prioritized') "
        "end return out"
    )
    result = run(
        compose
        + [
            "exec",
            "-T",
            "redis",
            "redis-cli",
            "--raw",
            "--no-auth-warning",
            "EVAL",
            script,
            "0",
            *names,
        ],
    )
    raw_values = [line.strip() for line in result.stdout.splitlines() if line.strip()]
    if len(raw_values) != len(names) * len(QUEUE_METRICS) or any(
        not value.isdigit() for value in raw_values
    ):
        raise MonitorError("Redis devolvió métricas de cola inválidas")
    values = [int(value) for value in raw_values]
    queues = {}
    for index, name in enumerate(names):
        start = index * len(QUEUE_METRICS)
        queues[name] = dict(zip(QUEUE_METRICS, values[start : start + len(QUEUE_METRICS)]))
    aggregate = {
        metric: sum(queue[metric] for queue in queues.values())
        for metric in QUEUE_METRICS
    }
    return queues, aggregate


def collect_worker_metrics(compose: list[str]) -> dict:
    result = run(
        compose + ["exec", "-T", "worker-python", "python", "healthcheck.py", "--json"],
        check=False,
    )
    try:
        metrics = json.loads(result.stdout.strip())
    except json.JSONDecodeError:
        return {"healthy": False, "state": "unavailable", "error": "invalid-health-output"}
    if result.returncode != 0:
        metrics["healthy"] = False
    return metrics


def collect_https_metrics(url: str) -> dict:
    if not url:
        return {"configured": False, "healthy": None}
    started = time.monotonic()
    try:
        request = urllib.request.Request(url, headers={"User-Agent": "flotillas-ops-monitor/1"})
        with urllib.request.urlopen(request, timeout=10) as response:
            payload = json.loads(response.read(128 * 1024).decode("utf-8"))
            healthy = response.status == 200 and payload.get("status") == "ok"
            return {
                "configured": True,
                "healthy": healthy,
                "status_code": response.status,
                "latency_ms": int((time.monotonic() - started) * 1000),
            }
    except (OSError, ValueError, urllib.error.URLError, json.JSONDecodeError) as exc:
        return {
            "configured": True,
            "healthy": False,
            "error": type(exc).__name__,
            "latency_ms": int((time.monotonic() - started) * 1000),
        }


def collect_backup_metrics(backup_dir: Path, now: float, receipt_key: str) -> dict:
    bundles = [
        item
        for item in backup_dir.glob("flotillas-public-*")
        if item.is_dir() and not item.is_symlink() and (item / "encrypted.sha256").is_file()
    ] if backup_dir.is_dir() else []
    valid = []
    invalid_receipts = 0
    for bundle in bundles:
        try:
            metadata = verify_receipt(bundle / "receipt.json", receipt_key, bundle.name)
            valid.append((bundle, metadata))
        except ReceiptError:
            invalid_receipts += 1
    if not valid:
        return {
            "available": False,
            "age_hours": None,
            "bundle": None,
            "invalid_receipts": invalid_receipts,
        }
    newest, metadata = max(valid, key=lambda item: item[1]["created_epoch"])
    age_hours = max(0.0, (now - metadata["created_epoch"]) / 3600)
    return {
        "available": True,
        "age_hours": round(age_hours, 2),
        "bundle": newest.name,
        "created_utc": metadata["created_utc"],
        "invalid_receipts": invalid_receipts,
    }


def collect_maintenance_metrics(path: Path, now: float) -> dict:
    """Acepta solo la ventana acotada que publica backup-public.sh."""
    if not path.exists():
        return {"present": False, "active": False}
    try:
        stat = path.stat()
        if path.is_symlink() or not path.is_file() or stat.st_size > 4096:
            raise ValueError("marcador no es archivo regular pequeño")
        data = json.loads(path.read_text(encoding="utf-8"))
        created = int(data["created_epoch"])
        expires = int(data["expires_epoch"])
        valid = (
            data.get("format") == "flotillas-maintenance-v1"
            and data.get("reason") == "consistent-backup"
            and created <= now + 60
            and expires >= now
            and 0 < expires - created <= 7200
        )
        return {
            "present": True,
            "active": valid,
            "reason": data.get("reason"),
            "created_epoch": created,
            "expires_epoch": expires,
            **({} if valid else {"error": "invalid-or-expired"}),
        }
    except (OSError, ValueError, TypeError, KeyError, json.JSONDecodeError) as exc:
        return {
            "present": True,
            "active": False,
            "error": type(exc).__name__,
        }


def evaluate(metrics: dict, thresholds: dict) -> list[str]:
    problems = []
    maintenance = metrics.get("maintenance", {"present": False, "active": False})
    for service in LONG_LIVED_SERVICES:
        if maintenance.get("active") and service in MAINTENANCE_STOPPABLE:
            continue
        status = metrics["containers"].get(service)
        if not status or status.get("state") != "running":
            problems.append(f"container {service} no está running")
        elif service in HEALTH_REQUIRED and status.get("health") != "healthy":
            problems.append(f"container {service} health={status.get('health') or 'none'}")

    queue_items = metrics.get("queues", {}).items()
    if not metrics.get("queues"):
        queue_items = (("aggregate", metrics["queue"]),)
    for queue_name, queue in queue_items:
        for name in ("waiting", "delayed", "failed"):
            if queue[name] > thresholds[f"queue_{name}_max"]:
                problems.append(
                    f"queue {queue_name} {name}={queue[name]} > "
                    f"{thresholds[f'queue_{name}_max']}",
                )
        if queue["active"] > thresholds["queue_active_max"]:
            problems.append(
                f"queue {queue_name} active={queue['active']} > "
                f"{thresholds['queue_active_max']}",
            )

    if not maintenance.get("active") and not metrics["worker"].get("healthy"):
        problems.append(
            f"worker heartbeat {metrics['worker'].get('state', 'unavailable')} "
            f"age={metrics['worker'].get('age_seconds')}",
        )
    if metrics["disk"]["used_percent"] >= thresholds["disk_used_max_percent"]:
        problems.append(
            f"disk used={metrics['disk']['used_percent']}% >= {thresholds['disk_used_max_percent']}%",
        )
    backup = metrics["backup"]
    if not backup["available"]:
        problems.append("no existe backup public con receipt HMAC válido")
    elif backup["age_hours"] > thresholds["backup_max_age_hours"]:
        problems.append(
            f"backup age={backup['age_hours']}h > {thresholds['backup_max_age_hours']}h",
        )
    if backup.get("invalid_receipts", 0):
        problems.append(f"backup receipts inválidos={backup['invalid_receipts']}")
    if (
        not maintenance.get("active")
        and metrics["https"].get("configured")
        and not metrics["https"].get("healthy")
    ):
        problems.append("HTTPS /api/health no responde ok")
    if maintenance.get("present") and not maintenance.get("active"):
        problems.append(
            f"maintenance marker inválido: {maintenance.get('error', 'unknown')}",
        )
    return problems


def collect_metrics(env_file: Path) -> tuple[dict, dict]:
    compose = compose_command(env_file)
    now = time.time()
    containers = parse_compose_ps(run(compose + ["ps", "--all", "--format", "json"]).stdout)
    queues, queue = collect_queue_metrics(compose)
    worker = collect_worker_metrics(compose)

    disk_path = os.environ.get("OPS_DISK_PATH", "").strip()
    if not disk_path:
        disk_path = run(["docker", "info", "--format", "{{.DockerRootDir}}"]).stdout.strip()
    try:
        usage = shutil.disk_usage(disk_path)
    except OSError as exc:
        raise MonitorError(f"no se pudo medir el disco: {disk_path}") from exc
    disk = {
        "path": disk_path,
        "used_percent": round((usage.used / usage.total) * 100, 1),
        "free_bytes": usage.free,
    }
    backup_dir = Path(os.environ.get("BACKUP_DIR", "/var/backups/flotillas"))
    receipt_key = os.environ.get("BACKUP_RECEIPT_HMAC_KEY", "")
    try:
        validate_key(receipt_key)
    except ReceiptError as exc:
        raise MonitorError("BACKUP_RECEIPT_HMAC_KEY ausente o débil") from exc
    backup = collect_backup_metrics(backup_dir, now, receipt_key)
    maintenance = collect_maintenance_metrics(
        Path(os.environ.get("OPS_MAINTENANCE_FILE", str(backup_dir / ".maintenance.json"))),
        now,
    )
    https = collect_https_metrics(os.environ.get("OPS_PUBLIC_HEALTH_URL", "").strip())
    thresholds = {
        "queue_waiting_max": env_int("OPS_QUEUE_WAITING_MAX", 20, 0, 1_000_000),
        "queue_active_max": env_int("OPS_QUEUE_ACTIVE_MAX", 1, 1, 1000),
        "queue_delayed_max": env_int("OPS_QUEUE_DELAYED_MAX", 20, 0, 1_000_000),
        "queue_failed_max": env_int("OPS_QUEUE_FAILED_MAX", 0, 0, 1_000_000),
        "disk_used_max_percent": env_int("OPS_DISK_USED_MAX_PERCENT", 85, 1, 99),
        "backup_max_age_hours": env_int("OPS_BACKUP_MAX_AGE_HOURS", 8, 1, 8760),
    }
    metrics = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "containers": containers,
        "queues": queues,
        "queue": queue,
        "worker": worker,
        "disk": disk,
        "backup": backup,
        "maintenance": maintenance,
        "https": https,
    }
    return metrics, thresholds


def read_state(path: Path) -> dict:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {}
    except (OSError, json.JSONDecodeError):
        return {}


def write_state(path: Path, state: dict) -> None:
    temporary = path.with_name(f".{path.name}.{os.getpid()}.tmp")
    try:
        path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        temporary.write_text(json.dumps(state, sort_keys=True) + "\n", encoding="utf-8")
        os.chmod(temporary, 0o600)
        os.replace(temporary, path)
    except OSError as exc:
        try:
            temporary.unlink(missing_ok=True)
        except OSError:
            pass
        raise MonitorError(f"no se pudo persistir estado de alertas: {path}") from exc


def send_webhook(url: str, text: str) -> bool:
    if not url:
        return True
    payload = json.dumps({"text": text}).encode("utf-8")
    request = urllib.request.Request(
        url,
        data=payload,
        method="POST",
        headers={"Content-Type": "application/json", "User-Agent": "flotillas-ops-monitor/1"},
    )
    try:
        with urllib.request.urlopen(request, timeout=10) as response:
            return 200 <= response.status < 300
    except (OSError, urllib.error.URLError):
        return False


def process_alerts(problems: list[str]) -> bool:
    webhook = os.environ.get("OPS_ALERT_WEBHOOK_URL", "").strip()
    state_path = Path(
        os.environ.get(
            "OPS_ALERT_STATE_FILE",
            str(Path.home() / ".local/state/flotillas/monitor.json"),
        ),
    )
    cooldown = env_int("OPS_ALERT_COOLDOWN_SECONDS", 1800, 60, 86400)
    previous = read_state(state_path)
    now = int(time.time())
    fingerprint = hashlib.sha256("\n".join(sorted(problems)).encode("utf-8")).hexdigest() if problems else ""
    delivered = True

    try:
        previous_alert_epoch = int(previous.get("last_alert_epoch", 0))
    except (TypeError, ValueError):
        previous_alert_epoch = 0

    if problems:
        should_send = (
            previous.get("fingerprint") != fingerprint
            or previous.get("webhook_configured") != bool(webhook)
            or (bool(webhook) and now - previous_alert_epoch >= cooldown)
        )
        if should_send:
            message = "[flotillas][ALERTA] " + "; ".join(problems)
            delivered = send_webhook(webhook, message)
            if webhook and not delivered:
                print("ERROR: no se pudo entregar el webhook de alerta", file=sys.stderr)
        write_state(
            state_path,
            {
                "status": "firing",
                "fingerprint": fingerprint,
                "webhook_configured": bool(webhook),
                # Una entrega fallida se reintenta en el siguiente ciclo. El
                # modo journal sin URL tampoco consume cooldown externo: si se
                # configura un webhook durante la alerta, se envía de inmediato.
                "last_alert_epoch": (
                    now if webhook and should_send and delivered else previous_alert_epoch
                ),
            },
        )
    else:
        if previous.get("status") == "firing":
            delivered = send_webhook(webhook, "[flotillas][RECUPERADO] checks operativos en estado normal")
            if webhook and not delivered:
                # Conservar firing para reintentar la recuperación en el
                # siguiente ciclo; no declarar silencio como entrega.
                write_state(state_path, previous)
                return False
        write_state(
            state_path,
            {
                "status": "ok",
                "fingerprint": "",
                "webhook_configured": bool(webhook),
                "last_alert_epoch": now if webhook else 0,
            },
        )
    return delivered


def self_check() -> None:
    parsed = parse_compose_ps(
        '[{"Service":"api","State":"running","Health":"healthy"},'
        '{"Service":"caddy","State":"running","Health":""}]',
    )
    assert parsed["api"]["health"] == "healthy"
    containers = {
        service: {"state": "running", "health": "healthy" if service in HEALTH_REQUIRED else ""}
        for service in LONG_LIVED_SERVICES
    }
    metrics = {
        "containers": containers,
        "queue": {"waiting": 0, "active": 0, "delayed": 0, "failed": 0, "prioritized": 0},
        "worker": {"healthy": True, "state": "ready", "age_seconds": 1},
        "disk": {"used_percent": 20.0},
        "backup": {"available": True, "age_hours": 1.0},
        "https": {"configured": True, "healthy": True},
    }
    thresholds = {
        "queue_waiting_max": 20,
        "queue_active_max": 1,
        "queue_delayed_max": 20,
        "queue_failed_max": 0,
        "disk_used_max_percent": 85,
        "backup_max_age_hours": 8,
    }
    assert evaluate(metrics, thresholds) == []
    metrics["queue"]["failed"] = 1
    metrics["worker"]["healthy"] = False
    metrics["disk"]["used_percent"] = 90.0
    problems = evaluate(metrics, thresholds)
    assert len(problems) == 3
    print("OK public_monitor --check: parser, métricas y umbrales verificados sin Docker")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", "--self-test", action="store_true")
    parser.add_argument("--env-file", default=".env")
    args = parser.parse_args()
    if args.check:
        self_check()
        return 0

    env_file = (ROOT / args.env_file).resolve() if not Path(args.env_file).is_absolute() else Path(args.env_file)
    env_loaded = False
    try:
        load_env_file(env_file)
        env_loaded = True
        metrics, thresholds = collect_metrics(env_file)
        problems = evaluate(metrics, thresholds)
        metrics["status"] = (
            "degraded"
            if problems
            else "maintenance"
            if metrics["maintenance"].get("active")
            else "ok"
        )
        metrics["problems"] = problems
        delivered = process_alerts(problems)
        print(json.dumps(metrics, sort_keys=True, separators=(",", ":")))
        if not delivered:
            return 2
        return 0 if not problems else 1
    except MonitorError as exc:
        if env_loaded:
            try:
                process_alerts([f"monitor failure: {exc}"])
            except MonitorError:
                pass
        print(json.dumps({"status": "error", "error": str(exc)}, separators=(",", ":")))
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
