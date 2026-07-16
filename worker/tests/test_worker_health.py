import os
import shutil
import time
import unittest
import uuid

from worker_health import WorkerHeartbeat, inspect_heartbeat


class WorkerHealthTests(unittest.TestCase):
    def setUp(self):
        root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        self.directory = os.path.join(root, f".health-test-{uuid.uuid4().hex}")
        os.mkdir(self.directory)
        self.path = os.path.join(self.directory, "heartbeat.json")

    def tearDown(self):
        shutil.rmtree(self.directory)

    def test_ready_and_job_metrics_are_published_atomically(self):
        heartbeat = WorkerHeartbeat(self.path, "reports")
        heartbeat.mark_ready()
        ready = inspect_heartbeat(self.path, 60)
        self.assertTrue(ready["healthy"])
        self.assertEqual(ready["active_jobs"], 0)

        heartbeat.mark_job_started("job-7")
        busy = inspect_heartbeat(self.path, 60)
        self.assertTrue(busy["healthy"])
        self.assertEqual(busy["active_jobs"], 1)
        self.assertEqual(busy["last_job_id"], "job-7")

        heartbeat.mark_job_finished(False, "RuntimeError")
        failed = inspect_heartbeat(self.path, 60)
        self.assertEqual(failed["processed_total"], 1)
        self.assertEqual(failed["failed_total"], 1)
        self.assertEqual(failed["last_failure_type"], "RuntimeError")
        self.assertEqual(os.listdir(self.directory), ["heartbeat.json"])

    def test_stale_or_stopping_heartbeat_is_unhealthy(self):
        heartbeat = WorkerHeartbeat(self.path, "reports")
        heartbeat.mark_ready()
        stale = inspect_heartbeat(self.path, 10, now=time.time() + 11)
        self.assertFalse(stale["healthy"])

        heartbeat.mark_stopping()
        stopping = inspect_heartbeat(self.path, 60)
        self.assertFalse(stopping["healthy"])
        self.assertEqual(stopping["state"], "stopping")

    def test_two_queues_keep_busy_until_both_jobs_finish(self):
        heartbeat = WorkerHeartbeat(self.path, ("reports", "data-jobs"))
        heartbeat.mark_ready()
        heartbeat.mark_job_started("report-1", "reports")
        heartbeat.mark_job_started("export-1", "data-jobs")
        concurrent = inspect_heartbeat(self.path, 60)
        self.assertEqual(concurrent["queues"], ["reports", "data-jobs"])
        self.assertEqual(concurrent["active_jobs"], 2)
        self.assertEqual(concurrent["state"], "busy")

        heartbeat.mark_job_finished(True, queue_name="reports")
        one_left = inspect_heartbeat(self.path, 60)
        self.assertEqual(one_left["active_jobs"], 1)
        self.assertEqual(one_left["state"], "busy")

        heartbeat.mark_job_finished(False, "ValueError", "data-jobs")
        complete = inspect_heartbeat(self.path, 60)
        self.assertEqual(complete["active_jobs"], 0)
        self.assertEqual(complete["processed_total"], 2)
        self.assertEqual(complete["failed_total"], 1)
        self.assertEqual(complete["last_queue"], "data-jobs")

    def test_missing_or_malformed_file_fails_closed(self):
        self.assertFalse(inspect_heartbeat(self.path, 60)["healthy"])
        with open(self.path, "w", encoding="utf-8") as handle:
            handle.write("not-json")
        self.assertFalse(inspect_heartbeat(self.path, 60)["healthy"])


if __name__ == "__main__":
    unittest.main()
