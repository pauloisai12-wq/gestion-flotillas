#!/usr/bin/env python3
"""Valida invariantes operativas del merge Compose público emitido como JSON."""

import argparse
import json
import sys


SERVICES = {
    "storage-init",
    "postgres",
    "redis",
    "api",
    "web",
    "worker-python",
    "migrate",
    "caddy",
}
LONG_LIVED = {"postgres", "redis", "api", "web", "worker-python", "caddy"}


def validate(config):
    errors = []
    services = config.get("services", {})
    missing = SERVICES - set(services)
    if missing:
        errors.append(f"servicios ausentes: {', '.join(sorted(missing))}")

    for name in sorted(SERVICES & set(services)):
        service = services[name]
        for key in ("mem_limit", "cpus", "pids_limit"):
            if not service.get(key):
                errors.append(f"{name}: falta {key}")
        logging = service.get("logging", {})
        if logging.get("driver") not in {"json-file", "local"}:
            errors.append(f"{name}: driver de logs sin rotación conocida")
        options = logging.get("options", {})
        if not options.get("max-size") or not options.get("max-file"):
            errors.append(f"{name}: faltan max-size/max-file de logs")
        if name in LONG_LIVED and service.get("restart") != "unless-stopped":
            errors.append(f"{name}: restart debe ser unless-stopped")

    for name in ("postgres", "redis", "api", "web", "worker-python"):
        if name in services and not services[name].get("healthcheck"):
            errors.append(f"{name}: falta healthcheck")

    redis_env = services.get("redis", {}).get("environment", {})
    if not redis_env.get("REDISCLI_AUTH"):
        errors.append("redis: falta REDISCLI_AUTH para métricas sin secreto en argv")

    storage = services.get("storage-init", {})
    if str(storage.get("user")) != "0:0":
        errors.append("storage-init: debe ejecutar como 0:0")
    storage_env = storage.get("environment", {})
    if storage_env.get("FLOTILLAS_PREDEPLOY_GUARD") != "UNGUARDED":
        errors.append("storage-init: falta default fail-closed UNGUARDED")
    storage_command = storage.get("command", [])
    if isinstance(storage_command, list):
        storage_command = "\n".join(str(part) for part in storage_command)
    else:
        storage_command = str(storage_command)
    guard_position = storage_command.find("grep -Fvxq UNGUARDED")
    chown_position = storage_command.find("chown -R 10001:10001")
    if guard_position < 0 or chown_position < 0 or guard_position > chown_position:
        errors.append("storage-init: la guardia debe preceder al chown")

    migrate_dependencies = services.get("migrate", {}).get("depends_on", {})
    storage_dependency = migrate_dependencies.get("storage-init", {})
    if storage_dependency.get("condition") != "service_completed_successfully":
        errors.append("migrate: debe depender de storage-init completado")

    worker = services.get("worker-python", {})
    worker_env = worker.get("environment", {})
    if worker_env.get("QA_EXTERNA_DIR") != "/app/uploads/qa-externa":
        errors.append("worker-python: QA_EXTERNA_DIR no apunta al volumen de uploads")
    uploads_mounts = [
        volume
        for volume in worker.get("volumes", [])
        if volume.get("target") == "/app/uploads"
    ]
    if len(uploads_mounts) != 1 or uploads_mounts[0].get("source") != "uploads_data":
        errors.append("worker-python: falta volumen uploads_data en /app/uploads")
    elif not uploads_mounts[0].get("read_only"):
        errors.append("worker-python: uploads_data debe montarse read-only")

    for name, service in services.items():
        if name != "caddy" and service.get("ports"):
            errors.append(f"{name}: publica puertos en el perfil público")
    caddy_ports = {
        (str(port.get("published")), int(port.get("target", 0)), port.get("protocol", "tcp"))
        for port in services.get("caddy", {}).get("ports", [])
    }
    if caddy_ports != {("80", 80, "tcp"), ("443", 443, "tcp")}:
        errors.append(f"caddy: puertos efectivos inesperados {sorted(caddy_ports)}")
    return errors


def self_check():
    service = {
        "mem_limit": "1",
        "cpus": 1,
        "pids_limit": 10,
        "restart": "unless-stopped",
        "logging": {"driver": "json-file", "options": {"max-size": "10m", "max-file": "5"}},
        "healthcheck": {"test": ["CMD", "true"]},
    }
    config = {"services": {name: dict(service) for name in SERVICES}}
    config["services"]["storage-init"]["restart"] = "no"
    config["services"]["storage-init"]["user"] = "0:0"
    config["services"]["storage-init"]["environment"] = {
        "FLOTILLAS_PREDEPLOY_GUARD": "UNGUARDED",
    }
    config["services"]["storage-init"]["command"] = [
        "grep -Fvxq UNGUARDED; chown -R 10001:10001 /app/uploads",
    ]
    config["services"]["migrate"]["restart"] = "no"
    config["services"]["migrate"]["depends_on"] = {
        "storage-init": {"condition": "service_completed_successfully"},
    }
    config["services"]["redis"]["environment"] = {"REDISCLI_AUTH": "secret"}
    config["services"]["worker-python"]["environment"] = {
        "QA_EXTERNA_DIR": "/app/uploads/qa-externa",
    }
    config["services"]["worker-python"]["volumes"] = [
        {"source": "uploads_data", "target": "/app/uploads", "read_only": True},
    ]
    config["services"]["caddy"]["ports"] = [
        {"published": "80", "target": 80, "protocol": "tcp"},
        {"published": "443", "target": 443, "protocol": "tcp"},
    ]
    assert validate(config) == []
    config["services"]["api"].pop("pids_limit")
    assert "api: falta pids_limit" in validate(config)
    print("OK validate_public_compose --check: cuotas, guardias, health y puertos verificados")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", "--self-test", action="store_true")
    args = parser.parse_args()
    if args.check:
        self_check()
        return 0
    try:
        config = json.load(sys.stdin)
    except json.JSONDecodeError as exc:
        print(f"ERROR compose JSON inválido: {exc}", file=sys.stderr)
        return 2
    errors = validate(config)
    if errors:
        for error in errors:
            print(f"ERROR public compose: {error}", file=sys.stderr)
        return 1
    print("OK public compose: cuotas, rotación, healthchecks y exposición validados")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
