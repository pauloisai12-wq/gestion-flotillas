import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import textwrap
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[3]
LINUX_BASH = shutil.which("bash") if os.name != "nt" else None


class DeploySafetyTests(unittest.TestCase):
    def test_deploy_and_scheduled_backup_share_one_operation_lock(self):
        deploy = (ROOT / "deploy-common.sh").read_text(encoding="utf-8")
        scheduled = (ROOT / "scripts/ops/backup-public.sh").read_text(encoding="utf-8")
        guard = (ROOT / "scripts/ops/predeploy-guard.sh").read_text(encoding="utf-8")
        backup = (ROOT / "scripts/ops/backup.sh").read_text(encoding="utf-8")
        lock_helper = (ROOT / "scripts/ops/operation-lock.sh").read_text(encoding="utf-8")

        self.assertIn(".flotillas-operation.lock", lock_helper)
        self.assertIn('flotillas_acquire_operation_lock "$backup_dir"', deploy)
        self.assertIn('flotillas_acquire_operation_lock "$backup_dir"', scheduled)
        self.assertIn('flotillas_verify_inherited_operation_lock "$backup_dir"', guard)
        self.assertIn('flotillas_verify_inherited_operation_lock "$backup_dir"', backup)
        self.assertLess(
            deploy.index('flotillas_acquire_operation_lock "$backup_dir"'),
            deploy.index('"${COMPOSE[@]}" build'),
        )
        self.assertLess(
            deploy.index('flotillas_acquire_operation_lock "$backup_dir"'),
            deploy.index('if ! guard_result="$('),
        )

    def test_scheduled_backup_rejects_a_different_lock_namespace_override(self):
        scheduled = (ROOT / "scripts/ops/backup-public.sh").read_text(encoding="utf-8")

        configured = scheduled.index(
            'configured_backup_dir="$(read_env_setting BACKUP_DIR "$env_file")"'
        )
        rejection = scheduled.index("difiere del env-file")
        lock = scheduled.index('flotillas_acquire_operation_lock "$backup_dir"')

        self.assertNotIn('backup_dir="$(setting BACKUP_DIR', scheduled)
        self.assertNotIn('chmod 700 "$backup_dir"', scheduled[:lock])
        self.assertLess(configured, rejection)
        self.assertLess(rejection, lock)

    def test_predeploy_tracks_service_before_attempting_stop(self):
        guard = (ROOT / "scripts/ops/predeploy-guard.sh").read_text(encoding="utf-8")
        loop = guard.index("for service in caddy web api worker-python; do")
        captured = guard.index(
            'service_container_ids="$("${compose[@]}" ps -q "$service")"', loop
        )
        stored = guard.index('stopped_container_ids["$service"]=', loop)
        tracked = guard.index('stopped_services+=("$service")', loop)
        stopped = guard.index(
            '"${compose[@]}" stop --timeout "$stop_timeout" "$service"', loop
        )

        self.assertLess(captured, stored)
        self.assertLess(stored, tracked)
        self.assertLess(tracked, stopped)

    def test_hetzner_units_match_the_protected_root_checkout(self):
        runbook = (ROOT / "docs/runbook-hetzner.md").read_text(encoding="utf-8")

        self.assertNotIn("/opt/flotillas-v2", runbook)
        self.assertNotIn("User=flotillas", runbook)
        self.assertNotIn("Group=docker", runbook)
        self.assertEqual(
            runbook.count("WorkingDirectory=/root/gestion-flotillas"), 2
        )
        self.assertIn(
            "--env-file /root/gestion-flotillas/.env", runbook
        )

    def test_maintenance_cleanup_is_confined_to_the_backup_marker(self):
        scheduled = (ROOT / "scripts/ops/backup-public.sh").read_text(encoding="utf-8")

        self.assertIn(
            'select_maintenance_file "$backup_dir" "$requested_maintenance_file"',
            scheduled,
        )
        cleanup_start = scheduled.index("clear_maintenance() {")
        cleanup_end = scheduled.index("\ncleanup_on_exit()", cleanup_start)
        cleanup = scheduled[cleanup_start:cleanup_end]
        validation = cleanup.index(
            'select_maintenance_file "$backup_dir" "$maintenance_file"'
        )
        first_remove = cleanup.index("rm -f --")

        self.assertLess(validation, first_remove)
        self.assertIn("OPS_MAINTENANCE_FILE aceptó .env", scheduled)
        self.assertIn("OPS_MAINTENANCE_FILE aceptó un symlink", scheduled)

    def test_backup_guard_precedes_storage_hook_and_migrations(self):
        deploy = (ROOT / "deploy-common.sh").read_text(encoding="utf-8")

        guard = deploy.index('if ! guard_result="$(')
        token = deploy.index('export FLOTILLAS_PREDEPLOY_GUARD=')
        storage_hook = deploy.index("prepare_persistent_storage")
        final_up = deploy.index('"${COMPOSE[@]}" up -d --wait --wait-timeout 240')

        self.assertLess(guard, token)
        self.assertLess(token, storage_hook)
        self.assertLess(storage_hook, final_up)

    def test_public_storage_is_only_run_by_guarded_compose_graph(self):
        public_deploy = (ROOT / "deploy-public.sh").read_text(encoding="utf-8")
        public_compose = (ROOT / "docker-compose.public.yml").read_text(encoding="utf-8")

        self.assertNotIn("prepare_persistent_storage", public_deploy)
        storage = public_compose.index("  storage-init:")
        storage_guard = public_compose.index("grep -Fvxq UNGUARDED", storage)
        storage_chown = public_compose.index("chown -R 10001:10001", storage)
        migrate = public_compose.index("  migrate:")
        migrate_dependency = public_compose.index("      storage-init:", migrate)

        self.assertLess(storage_guard, storage_chown)
        self.assertGreater(migrate_dependency, migrate)

    def test_backup_reads_legacy_uid_volumes_as_root(self):
        guard = (ROOT / "scripts/ops/predeploy-guard.sh").read_text(encoding="utf-8")
        backup = (ROOT / "scripts/ops/backup.sh").read_text(encoding="utf-8")
        root_reader = "run --rm --no-deps -T --user 0:0 --entrypoint sh api"

        self.assertIn(root_reader, guard)
        self.assertEqual(backup.count(root_reader), 4)

    def test_node_images_match_declared_runtime_floor(self):
        for application in ("api", "web"):
            with self.subTest(application=application):
                directory = ROOT / application
                dockerfile = (directory / "Dockerfile").read_text(encoding="utf-8")
                package = json.loads((directory / "package.json").read_text(encoding="utf-8"))
                lockfile = json.loads((directory / "package-lock.json").read_text(encoding="utf-8"))

                self.assertNotIn("node:20-alpine", dockerfile)
                self.assertEqual(dockerfile.count("node:22-alpine"), 4)
                self.assertIn("npm ci --engine-strict", dockerfile)
                self.assertEqual(package["engines"]["node"], ">=22")
                self.assertEqual(lockfile["packages"][""]["engines"]["node"], ">=22")


@unittest.skipUnless(LINUX_BASH, "las pruebas operativas de shell requieren Bash en Linux")
class OpsShellBehaviorTests(unittest.TestCase):
    def test_backup_crossing_minute_keeps_bundle_manifest_and_receipt_coherent(self):
        key = "receipt-test-key-32-bytes-minimum-value"
        fake_compose_source = """#!/usr/bin/env bash
set -Eeuo pipefail
case "${1:-}" in
  ps)
    exit 0
    ;;
  exec)
    if [[ "$*" == *pg_restore* ]]; then
      cat >/dev/null
      printf '1; 0 0 TABLE public sample postgres\\n'
    elif [[ "$*" == *pg_dump* ]]; then
      printf 'stub-postgresql-custom-archive\\n'
    else
      exit 91
    fi
    ;;
  run)
    tar -cf - --files-from /dev/null
    ;;
  *)
    exit 92
    ;;
esac
"""
        fake_age_source = """#!/usr/bin/env bash
set -Eeuo pipefail
output=''
input=''
while [ "$#" -gt 0 ]; do
  case "$1" in
    --encrypt)
      shift
      ;;
    --recipient)
      shift 2
      ;;
    --output)
      output="$2"
      shift 2
      ;;
    *)
      input="$1"
      shift
      ;;
  esac
done
[ -n "$output" ]
if [ -n "$input" ]; then
  cp -- "$input" "$output"
else
  cat > "$output"
fi
"""
        fake_date_source = """#!/usr/bin/env bash
set -Eeuo pipefail
counter=0
if [ -f "$FAKE_DATE_COUNTER" ]; then
  read -r counter < "$FAKE_DATE_COUNTER"
fi
counter=$((counter + 1))
printf '%s\\n' "$counter" > "$FAKE_DATE_COUNTER"
case "$*" in
  '-u +%Y%m%dT%H%M%SZ')
    printf '20000101T235959Z\\n'
    ;;
  '-u +%Y-%m-%dT%H:%M:%SZ')
    if [ "$counter" -eq 1 ]; then
      printf '2000-01-02T00:00:00Z\\n'
    else
      printf '2000-01-02T00:00:01Z\\n'
    fi
    ;;
  *)
    exit 93
    ;;
esac
"""

        with tempfile.TemporaryDirectory() as temporary:
            temporary_path = Path(temporary)
            fake_bin = temporary_path / "bin"
            fake_bin.mkdir()
            for name, source in {
                "fake-compose": fake_compose_source,
                "age": fake_age_source,
                "date": fake_date_source,
            }.items():
                executable = fake_bin / name
                executable.write_text(source, encoding="utf-8")
                executable.chmod(0o755)

            backup_dir = temporary_path / "backups"
            date_counter = temporary_path / "date-counter"
            date_counter.write_text("0\n", encoding="utf-8")
            harness = r"""
                set -Eeuo pipefail
                source "$1"
                flotillas_acquire_operation_lock "$2"
                exec bash "$3" -- "$4"
            """
            command = [
                LINUX_BASH,
                "-c",
                harness,
                "bash",
                str(ROOT / "scripts/ops/operation-lock.sh"),
                str(backup_dir),
                str(ROOT / "scripts/ops/backup.sh"),
                str(fake_bin / "fake-compose"),
            ]
            environment = {
                **os.environ,
                "PATH": f"{fake_bin}{os.pathsep}{os.environ['PATH']}",
                "BACKUP_DIR": str(backup_dir),
                "BACKUP_AGE_RECIPIENT": "age1-test-recipient",
                "BACKUP_PROFILE": "public",
                "BACKUP_RECEIPT_HMAC_KEY": key,
                "FAKE_DATE_COUNTER": str(date_counter),
            }
            result = subprocess.run(
                command,
                cwd=ROOT,
                env=environment,
                text=True,
                capture_output=True,
                check=False,
            )
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(date_counter.read_text(encoding="utf-8"), "1\n")

            bundle = backup_dir / "flotillas-public-20000102T000000Z"
            self.assertEqual(result.stdout.strip(), str(bundle))
            self.assertTrue(bundle.is_dir())
            manifest = (bundle / "manifest.txt.age").read_text(encoding="utf-8")
            self.assertIn("created_utc=2000-01-02T00:00:00Z\n", manifest)
            self.assertFalse((bundle / "manifest.txt").exists())
            self.assertEqual(list(backup_dir.glob(".*.partial")), [])

            sys.path.insert(0, str(ROOT / "scripts/ops"))
            try:
                from backup_receipt import verify_receipt

                verified = verify_receipt(bundle / "receipt.json", key, bundle.name)
            finally:
                sys.path.pop(0)
            self.assertEqual(verified["bundle"], bundle.name)
            self.assertEqual(verified["created_utc"], "2000-01-02T00:00:00Z")

            original_receipt = (bundle / "receipt.json").read_bytes()
            date_counter.write_text("0\n", encoding="utf-8")
            duplicate = subprocess.run(
                command,
                cwd=ROOT,
                env=environment,
                text=True,
                capture_output=True,
                check=False,
            )
            self.assertNotEqual(duplicate.returncode, 0)
            self.assertIn("ya existe el respaldo", duplicate.stderr)
            self.assertEqual((bundle / "receipt.json").read_bytes(), original_receipt)
            self.assertEqual(list(backup_dir.glob(".*.partial")), [])

    def test_age_recipient_preflight_propagates_failures_without_output(self):
        for filename in ("backup-public.sh", "predeploy-guard.sh"):
            with self.subTest(script=filename):
                source = (ROOT / "scripts/ops" / filename).read_text(encoding="utf-8")
                start = source.index("validate_age_recipient() {")
                end = source.index("\n}\n", start) + len("\n}\n")
                function = source[start:end]
                self.assertIn("</dev/null >/dev/null 2>&1", function)
                self.assertNotIn("mktemp", function)

                harness = f"""
                    set -Eeuo pipefail
                    {function}
                    age() {{
                      [ "$1" = --encrypt ] || return 91
                      [ "$2" = --recipient ] || return 92
                      [ "$3" = "$EXPECTED_RECIPIENT" ] || return 93
                      if IFS= read -r unexpected; then
                        return 94
                      fi
                      printf 'ciphertext descartado\n'
                      printf 'diagnostico con recipient: %s\n' "$3" >&2
                      return "$AGE_STATUS"
                    }}
                    validate_age_recipient "$EXPECTED_RECIPIENT"
                """
                base_env = {
                    **os.environ,
                    "EXPECTED_RECIPIENT": "age1-no-imprimir-este-valor",
                }
                valid = subprocess.run(
                    [LINUX_BASH, "-c", harness],
                    cwd=ROOT,
                    env={**base_env, "AGE_STATUS": "0"},
                    text=True,
                    capture_output=True,
                    check=False,
                )
                self.assertEqual(valid.returncode, 0, valid.stderr)
                self.assertEqual(valid.stdout, "")
                self.assertEqual(valid.stderr, "")

                invalid = subprocess.run(
                    [LINUX_BASH, "-c", harness],
                    cwd=ROOT,
                    env={**base_env, "AGE_STATUS": "37"},
                    text=True,
                    capture_output=True,
                    check=False,
                )
                self.assertEqual(invalid.returncode, 37)
                self.assertEqual(invalid.stdout, "")
                self.assertEqual(invalid.stderr, "")

    def test_age_recipient_preflight_precedes_service_stops(self):
        scripts = {
            "backup-public.sh": "for command_name in age bash",
            "predeploy-guard.sh": "command -v age >/dev/null 2>&1",
        }
        for filename, age_requirement in scripts.items():
            with self.subTest(script=filename):
                source = (ROOT / "scripts/ops" / filename).read_text(encoding="utf-8")
                requirement = source.index(age_requirement)
                preflight = source.index('if ! validate_age_recipient "$recipient"; then')
                failure_end = source.index("\nfi", preflight) + len("\nfi")
                failure_block = source[preflight:failure_end]
                stop_commands = [
                    match.start()
                    for match in re.finditer(
                        r'"\$\{compose\[@\]\}"\s+stop\b',
                        source,
                    )
                ]

                self.assertTrue(
                    stop_commands,
                    f"{filename} debe contener al menos un compose stop protegido",
                )
                self.assertLess(requirement, preflight)
                self.assertTrue(all(preflight < stop for stop in stop_commands))
                self.assertIn(
                    'die "BACKUP_AGE_RECIPIENT no es aceptado por age"',
                    failure_block,
                )

    def test_first_deploy_authorization_runs_age_preflight_before_exit(self):
        source = (ROOT / "scripts/ops/predeploy-guard.sh").read_text(encoding="utf-8")
        block_start = source.index('recipient_requirement=""')
        action_case = source.index('case "$decision" in', block_start)
        authorization_block = source[block_start:action_case]
        preflight = authorization_block.index(
            'if ! validate_age_recipient "$recipient"; then'
        )
        skip_assignment = authorization_block.index(
            'recipient_requirement="BACKUP_AGE_RECIPIENT es obligatorio incluso en el primer despliegue"'
        )

        self.assertLess(skip_assignment, preflight)
        self.assertIn(
            'recipient_requirement="BACKUP_AGE_RECIPIENT es obligatorio antes de migrar una instalación existente"',
            authorization_block,
        )
        self.assertNotIn("mkdir", authorization_block)
        skip_branch = source.index("SKIP_VERIFIED_FIRST_DEPLOY)", action_case)
        skip_exit = source.index("exit 0", skip_branch)
        self.assertLess(action_case, skip_exit)
        self.assertLess(block_start + preflight, skip_exit)

        harness = f"""
            set -Eeuo pipefail
            die() {{
              printf 'DIE:%s\\n' "$*" >&2
              exit 70
            }}
            age() {{ :; }}
            validate_age_recipient() {{ return "$AGE_STATUS"; }}
            decision=SKIP_VERIFIED_FIRST_DEPLOY
            backup_dir=/tmp/no-crear-backup
            recipient="$TEST_RECIPIENT"
            {authorization_block}
            printf 'AUTHORIZED\\n'
        """
        cases = {
            "missing": ("", "0", 70),
            "invalid": ("age1-invalid", "37", 70),
            "valid": ("age1-valid", "0", 0),
        }
        for label, (recipient, age_status, expected_status) in cases.items():
            with self.subTest(case=label):
                result = subprocess.run(
                    [LINUX_BASH, "-c", harness],
                    cwd=ROOT,
                    env={
                        **os.environ,
                        "TEST_RECIPIENT": recipient,
                        "AGE_STATUS": age_status,
                    },
                    text=True,
                    capture_output=True,
                    check=False,
                )
                self.assertEqual(result.returncode, expected_status, result.stderr)
                if expected_status == 0:
                    self.assertEqual(result.stdout, "AUTHORIZED\n")
                else:
                    self.assertNotIn("AUTHORIZED", result.stdout)

    def test_pg_restore_validator_drains_large_stream_and_preserves_failures(self):
        backup = (ROOT / "scripts/ops/backup.sh").read_text(encoding="utf-8")
        match = re.search(
            r"exec -T postgres sh -ceu '\n(?P<body>\s*restore_status=0.*?"
            r'exit "\$drain_status"\n\s*)\' \|',
            backup,
            flags=re.DOTALL,
        )
        self.assertIsNotNone(match)
        validator = textwrap.dedent(match.group("body"))

        with tempfile.TemporaryDirectory() as temporary:
            fake_pg_restore = Path(temporary) / "pg_restore"
            fake_pg_restore.write_text(
                "#!/bin/sh\n"
                "dd bs=1 count=1 of=/dev/null 2>/dev/null\n"
                "entry=1\n"
                "while [ \"$entry\" -le 307 ]; do\n"
                "  printf '%s; 0 0 TABLE public sample postgres\\n' \"$entry\"\n"
                "  entry=$((entry + 1))\n"
                "done\n"
                'exit "${FAKE_PG_RESTORE_STATUS:-0}"\n',
                encoding="utf-8",
            )
            fake_pg_restore.chmod(0o755)
            pipeline = r"""
                set -o pipefail
                dd if=/dev/zero bs=1048576 count=8 2>/dev/null |
                  PATH="$2:$PATH" FAKE_PG_RESTORE_STATUS="$3" sh -ceu "$1" |
                  awk '!/^;/ && NF { count++ } END { print count + 0 }'
            """

            valid = subprocess.run(
                [LINUX_BASH, "-c", pipeline, "bash", validator, temporary, "0"],
                cwd=ROOT,
                text=True,
                capture_output=True,
                check=False,
            )
            self.assertEqual(valid.returncode, 0, valid.stderr)
            self.assertEqual(valid.stdout.strip(), "307")

            restore_failure = subprocess.run(
                [LINUX_BASH, "-c", pipeline, "bash", validator, temporary, "7"],
                cwd=ROOT,
                text=True,
                capture_output=True,
                check=False,
            )
            self.assertEqual(restore_failure.returncode, 7, restore_failure.stderr)

            producer_failure_pipeline = pipeline.replace(
                "dd if=/dev/zero bs=1048576 count=8 2>/dev/null |",
                "( dd if=/dev/zero bs=1048576 count=8 2>/dev/null; exit 9 ) |",
            )
            producer_failure = subprocess.run(
                [
                    LINUX_BASH,
                    "-c",
                    producer_failure_pipeline,
                    "bash",
                    validator,
                    temporary,
                    "0",
                ],
                cwd=ROOT,
                text=True,
                capture_output=True,
                check=False,
            )
            self.assertEqual(producer_failure.returncode, 9, producer_failure.stderr)

    def test_restore_paths_start_only_the_recorded_container_ids(self):
        scripts = {
            "predeploy": ("predeploy-guard.sh", "cleanup_on_exit()"),
            "scheduled": ("backup-public.sh", "publish_maintenance()"),
        }
        for label, (filename, next_function) in scripts.items():
            with self.subTest(script=label):
                source = (ROOT / "scripts/ops" / filename).read_text(encoding="utf-8")
                start = source.index("array_contains() {")
                end = source.index(f"\n{next_function}", start)
                functions = source[start:end]
                harness = f"""
                    set -Eeuo pipefail
                    {functions}
                    docker() {{
                      case "$1" in
                        start)
                          shift
                          printf '%s\\n' "$@" >> "$LOG_FILE"
                          ;;
                        inspect) printf 'running|none\\n' ;;
                        *) return 90 ;;
                      esac
                    }}
                    fake_compose() {{
                      case "${{1:-}}" in
                        exec) return 0 ;;
                        ps) printf 'caddy\\n'; return 0 ;;
                        *) return 91 ;;
                      esac
                    }}
                    compose=(fake_compose)
                    stopped_services=(api caddy)
                    declare -A stopped_container_ids=(
                      [api]=$'api-id-a\\napi-id-b'
                      [caddy]='caddy-id'
                    )
                    sleep() {{ :; }}
                    restore_services
                """
                with tempfile.TemporaryDirectory() as temporary:
                    log_file = Path(temporary) / "docker-start.log"
                    result = subprocess.run(
                        [LINUX_BASH, "-c", harness],
                        cwd=ROOT,
                        env={**os.environ, "LOG_FILE": str(log_file)},
                        text=True,
                        capture_output=True,
                        check=False,
                    )
                    self.assertEqual(result.returncode, 0, result.stderr)
                    self.assertEqual(
                        log_file.read_text(encoding="utf-8").splitlines(),
                        ["api-id-a", "api-id-b", "caddy-id"],
                    )

    def test_scheduled_restore_attempts_all_ids_after_partial_start_failure(self):
        source = (ROOT / "scripts/ops/backup-public.sh").read_text(encoding="utf-8")
        start = source.index("array_contains() {")
        end = source.index("\npublish_maintenance()", start)
        functions = source[start:end]
        harness = f"""
            set -Eeuo pipefail
            {functions}
            docker() {{
              local command="$1"
              shift
              case "$command" in
                start)
                  printf 'start:%s\\n' "$1" >> "$LOG_FILE"
                  [ "$1" != api-id-b ] || return 42
                  ;;
                inspect)
                  printf 'inspect:%s\\n' "${{!#}}" >> "$LOG_FILE"
                  printf 'running|healthy\\n'
                  ;;
                *) return 90 ;;
              esac
            }}
            stopped_services=(api)
            declare -A stopped_container_ids=(
              [api]=$'api-id-a\\napi-id-b\\napi-id-c'
            )
            restore_services
        """
        with tempfile.TemporaryDirectory() as temporary:
            log_file = Path(temporary) / "docker.log"
            result = subprocess.run(
                [LINUX_BASH, "-c", harness],
                cwd=ROOT,
                env={**os.environ, "LOG_FILE": str(log_file)},
                text=True,
                capture_output=True,
                check=False,
            )
            self.assertEqual(result.returncode, 1, result.stderr)
            self.assertEqual(
                log_file.read_text(encoding="utf-8").splitlines(),
                ["start:api-id-a", "start:api-id-b", "start:api-id-c"],
            )

    def test_scheduled_restore_accepts_legacy_and_healthy_exact_ids(self):
        source = (ROOT / "scripts/ops/backup-public.sh").read_text(encoding="utf-8")
        start = source.index("array_contains() {")
        end = source.index("\npublish_maintenance()", start)
        functions = source[start:end]
        self.assertNotIn('"${compose[@]}" exec', functions)
        self.assertNotIn('"${compose[@]}" ps', functions)

        harness = f"""
            set -Eeuo pipefail
            {functions}
            docker() {{
              local command="$1"
              shift
              case "$command" in
                start)
                  printf 'start:%s\\n' "$@" >> "$LOG_FILE"
                  ;;
                inspect)
                  local container_id="${{!#}}"
                  printf 'inspect:%s\\n' "$container_id" >> "$LOG_FILE"
                  case "$container_id" in
                    legacy-worker-id) printf 'running|none\\n' ;;
                    api-with-health-id)
                      if [ "$(grep -c '^inspect:api-with-health-id$' "$LOG_FILE")" -eq 1 ]; then
                        printf 'running|starting\\n'
                      else
                        printf 'running|healthy\\n'
                      fi
                      ;;
                    *) return 90 ;;
                  esac
                  ;;
                *) return 91 ;;
              esac
            }}
            sleep() {{ :; }}
            stopped_services=(worker-python api)
            declare -A stopped_container_ids=(
              [worker-python]='legacy-worker-id'
              [api]='api-with-health-id'
            )
            restore_services
        """
        with tempfile.TemporaryDirectory() as temporary:
            log_file = Path(temporary) / "docker.log"
            result = subprocess.run(
                [LINUX_BASH, "-c", harness],
                cwd=ROOT,
                env={**os.environ, "LOG_FILE": str(log_file)},
                text=True,
                capture_output=True,
                check=False,
            )
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(
                log_file.read_text(encoding="utf-8").splitlines(),
                [
                    "start:api-with-health-id",
                    "start:legacy-worker-id",
                    "inspect:legacy-worker-id",
                    "inspect:api-with-health-id",
                    "inspect:legacy-worker-id",
                    "inspect:api-with-health-id",
                ],
            )

    def test_scheduled_restore_fails_closed_on_bad_inspection(self):
        source = (ROOT / "scripts/ops/backup-public.sh").read_text(encoding="utf-8")
        start = source.index("array_contains() {")
        end = source.index("\npublish_maintenance()", start)
        functions = source[start:end]
        cases = {
            "unhealthy": "printf 'running|unhealthy\\n'; return 0",
            "not-running": "printf 'exited|none\\n'; return 0",
            "inspect-failure": "printf 'running|healthy\\n'; return 42",
        }
        for label, inspect_behavior in cases.items():
            with self.subTest(case=label):
                harness = f"""
                    set -Eeuo pipefail
                    {functions}
                    docker() {{
                      case "$1" in
                        start) return 0 ;;
                        inspect) {inspect_behavior} ;;
                        *) return 90 ;;
                      esac
                    }}
                    sleep() {{ :; }}
                    stopped_services=(api)
                    declare -A stopped_container_ids=([api]='bad-api-id')
                    restore_services
                """
                result = subprocess.run(
                    [LINUX_BASH, "-c", harness],
                    cwd=ROOT,
                    text=True,
                    capture_output=True,
                    check=False,
                )
                self.assertEqual(result.returncode, 1, result.stderr)


if __name__ == "__main__":
    unittest.main()
