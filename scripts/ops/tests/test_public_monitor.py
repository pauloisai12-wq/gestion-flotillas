import importlib.util
import json
import os
import shutil
import sys
import unittest
import uuid
from pathlib import Path
from types import SimpleNamespace
from unittest import mock


MODULE_PATH = Path(__file__).resolve().parents[1] / "public_monitor.py"
sys.path.insert(0, str(MODULE_PATH.parent))
SPEC = importlib.util.spec_from_file_location("public_monitor", MODULE_PATH)
public_monitor = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(public_monitor)


class PublicMonitorTests(unittest.TestCase):
    def setUp(self):
        # os.mkdir conserva las ACL heredadas del workspace también dentro del
        # sandbox de escritorio; TemporaryDirectory usa ACL distintas en Windows.
        self.directory = Path(__file__).resolve().parent / f".monitor-test-{uuid.uuid4().hex}"
        os.mkdir(self.directory)

    def tearDown(self):
        shutil.rmtree(self.directory)

    def test_env_parser_does_not_execute_and_respects_process_environment(self):
        env_file = self.directory / ".env"
        env_file.write_text(
            "SAFE=value # comentario\nQUOTED='dos palabras'\nNOT_SHELL=$(id)\n",
            encoding="utf-8",
        )
        with mock.patch.dict(os.environ, {"SAFE": "from-process"}, clear=False):
            public_monitor.load_env_file(env_file)
            self.assertEqual(os.environ["SAFE"], "from-process")
            self.assertEqual(os.environ["QUOTED"], "dos palabras")
            self.assertEqual(os.environ["NOT_SHELL"], "$(id)")

    def test_invalid_compose_json_fails_closed(self):
        with self.assertRaises(public_monitor.MonitorError):
            public_monitor.parse_compose_ps("{not-json}")

    def test_queue_metrics_are_batched_and_aggregated(self):
        values = "\n".join(str(value) for value in range(1, 11)) + "\n"
        with mock.patch.dict(
            os.environ,
            {"OPS_QUEUE_NAMES": "reports,data-jobs"},
            clear=False,
        ), mock.patch.object(
            public_monitor,
            "run",
            return_value=SimpleNamespace(stdout=values),
        ) as run:
            queues, aggregate = public_monitor.collect_queue_metrics(["compose"])
            self.assertEqual(queues["reports"]["waiting"], 1)
            self.assertEqual(queues["data-jobs"]["prioritized"], 10)
            self.assertEqual(aggregate["failed"], 4 + 9)
            self.assertEqual(run.call_count, 1)

        with mock.patch.dict(
            os.environ,
            {"OPS_QUEUE_NAMES": "reports,reports"},
            clear=False,
        ):
            with self.assertRaises(public_monitor.MonitorError):
                public_monitor.configured_queue_names()

    def test_only_bounded_backup_marker_enables_maintenance(self):
        marker = self.directory / ".maintenance.json"
        marker.write_text(
            json.dumps(
                {
                    "format": "flotillas-maintenance-v1",
                    "reason": "consistent-backup",
                    "created_epoch": 1_000,
                    "expires_epoch": 1_600,
                },
            ),
            encoding="utf-8",
        )
        active = public_monitor.collect_maintenance_metrics(marker, 1_100)
        self.assertTrue(active["active"])

        expired = public_monitor.collect_maintenance_metrics(marker, 1_601)
        self.assertFalse(expired["active"])
        self.assertEqual(expired["error"], "invalid-or-expired")

    def test_backup_age_comes_from_hmac_receipt_not_mtime(self):
        from backup_receipt import create_receipt

        bundle = self.directory / "flotillas-public-20000101T000000Z"
        os.mkdir(bundle)
        (bundle / "encrypted.sha256").write_text("hash list\n", encoding="utf-8")
        key = "monitor-receipt-key-at-least-32-bytes"
        create_receipt(bundle, "2000-01-01T00:00:00Z", "public", bundle.name, key)
        os.utime(bundle, (2_000_000_000, 2_000_000_000))
        metrics = public_monitor.collect_backup_metrics(bundle.parent, 946_688_400, key)
        self.assertTrue(metrics["available"])
        self.assertEqual(metrics["age_hours"], 1.0)
        self.assertEqual(metrics["created_utc"], "2000-01-01T00:00:00Z")

    def test_maintenance_suppresses_only_expected_application_outage(self):
        containers = {
            "postgres": {"state": "running", "health": "healthy"},
            "redis": {"state": "running", "health": "healthy"},
            "api": {"state": "exited", "health": ""},
            "web": {"state": "exited", "health": ""},
            "worker-python": {"state": "exited", "health": ""},
            "caddy": {"state": "exited", "health": ""},
        }
        metrics = {
            "containers": containers,
            "queue": {name: 0 for name in public_monitor.QUEUE_METRICS},
            "queues": {},
            "worker": {"healthy": False, "state": "unavailable"},
            "disk": {"used_percent": 20},
            "backup": {"available": True, "age_hours": 1},
            "https": {"configured": True, "healthy": False},
            "maintenance": {"present": True, "active": True},
        }
        thresholds = {
            "queue_waiting_max": 20,
            "queue_active_max": 1,
            "queue_delayed_max": 20,
            "queue_failed_max": 0,
            "disk_used_max_percent": 85,
            "backup_max_age_hours": 8,
        }
        self.assertEqual(public_monitor.evaluate(metrics, thresholds), [])

        metrics["containers"]["postgres"] = {"state": "exited", "health": ""}
        problems = public_monitor.evaluate(metrics, thresholds)
        self.assertIn("container postgres no está running", problems)

    def test_alerts_are_deduplicated_and_recovery_is_emitted(self):
        state_path = str(self.directory / "monitor.json")
        environment = {
            "OPS_ALERT_STATE_FILE": state_path,
            "OPS_ALERT_WEBHOOK_URL": "https://alerts.invalid/hook",
            "OPS_ALERT_COOLDOWN_SECONDS": "60",
        }
        with mock.patch.dict(os.environ, environment, clear=False), mock.patch.object(
            public_monitor,
            "send_webhook",
            return_value=True,
        ) as send:
            self.assertTrue(public_monitor.process_alerts(["worker stale"]))
            self.assertTrue(public_monitor.process_alerts(["worker stale"]))
            self.assertEqual(send.call_count, 1)
            self.assertTrue(public_monitor.process_alerts([]))
            self.assertEqual(send.call_count, 2)
            self.assertIn("RECUPERADO", send.call_args.args[1])

    def test_failed_webhook_is_retried_without_waiting_for_cooldown(self):
        environment = {
            "OPS_ALERT_STATE_FILE": str(self.directory / "monitor.json"),
            "OPS_ALERT_WEBHOOK_URL": "https://alerts.invalid/hook",
            "OPS_ALERT_COOLDOWN_SECONDS": "60",
        }
        with mock.patch.dict(os.environ, environment, clear=False), mock.patch.object(
            public_monitor,
            "send_webhook",
            side_effect=[False, True],
        ) as send:
            self.assertFalse(public_monitor.process_alerts(["disk high"]))
            self.assertTrue(public_monitor.process_alerts(["disk high"]))
            self.assertEqual(send.call_count, 2)

    def test_failed_recovery_webhook_remains_pending(self):
        environment = {
            "OPS_ALERT_STATE_FILE": str(self.directory / "monitor.json"),
            "OPS_ALERT_WEBHOOK_URL": "https://alerts.invalid/hook",
            "OPS_ALERT_COOLDOWN_SECONDS": "60",
        }
        with mock.patch.dict(os.environ, environment, clear=False), mock.patch.object(
            public_monitor,
            "send_webhook",
            side_effect=[True, False, True],
        ) as send:
            self.assertTrue(public_monitor.process_alerts(["disk high"]))
            self.assertFalse(public_monitor.process_alerts([]))
            self.assertTrue(public_monitor.process_alerts([]))
            self.assertEqual(send.call_count, 3)

    def test_enabling_webhook_during_active_alert_sends_immediately(self):
        state_path = str(self.directory / "monitor.json")
        without_webhook = {
            "OPS_ALERT_STATE_FILE": state_path,
            "OPS_ALERT_WEBHOOK_URL": "",
            "OPS_ALERT_COOLDOWN_SECONDS": "1800",
        }
        with mock.patch.dict(os.environ, without_webhook, clear=False):
            self.assertTrue(public_monitor.process_alerts(["worker stale"]))

        with_webhook = dict(without_webhook)
        with_webhook["OPS_ALERT_WEBHOOK_URL"] = "https://alerts.invalid/hook"
        with mock.patch.dict(os.environ, with_webhook, clear=False), mock.patch.object(
            public_monitor,
            "send_webhook",
            return_value=True,
        ) as send:
            self.assertTrue(public_monitor.process_alerts(["worker stale"]))
            send.assert_called_once()


if __name__ == "__main__":
    unittest.main()
