import json
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[3]


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
        tracked = guard.index('stopped_services+=("$service")', loop)
        stopped = guard.index(
            '"${compose[@]}" stop --timeout "$stop_timeout" "$service"', loop
        )

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


if __name__ == "__main__":
    unittest.main()
