"""Healthcheck de Compose basado en el heartbeat del event loop del worker."""

import argparse
import json
import os

from worker_health import inspect_heartbeat


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--json", action="store_true", help="imprime métricas JSON")
    args = parser.parse_args()

    path = os.environ.get(
        "WORKER_HEARTBEAT_FILE",
        "/tmp/flotillas-worker/heartbeat.json",
    )
    max_age = max(15, int(os.environ.get("WORKER_HEARTBEAT_MAX_AGE_SECONDS", "60")))
    result = inspect_heartbeat(path, max_age)
    if args.json:
        print(json.dumps(result, sort_keys=True, separators=(",", ":")))
    elif result["healthy"]:
        print(f"worker healthy state={result['state']} age={result['age_seconds']}s")
    else:
        print(
            f"worker unhealthy state={result.get('state')} "
            f"age={result.get('age_seconds')} error={result.get('error', '-')}",
        )
    return 0 if result["healthy"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
