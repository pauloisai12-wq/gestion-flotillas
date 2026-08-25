import ast
import unittest
from pathlib import Path

SOURCE = Path(__file__).resolve().parents[1].joinpath("main.py").read_text(
    encoding="utf-8"
)


def function_source(name):
    tree = ast.parse(SOURCE)
    node = next(
        item
        for item in tree.body
        if isinstance(item, (ast.FunctionDef, ast.AsyncFunctionDef))
        and item.name == name
    )
    return ast.get_source_segment(SOURCE, node)


class DataJobProtocolTests(unittest.TestCase):
    def test_claim_is_limited_to_export_types_and_processing_states(self):
        claim = function_source("claim_data_job")
        self.assertIn("'QA_EXPORT'", claim)
        self.assertIn("'ENCUESTAS_EXPORT'", claim)
        self.assertIn("AND status = 'QUEUED'", claim)
        self.assertNotIn("AND status IN", claim)
        self.assertIn('RETURNING payload, "requestedById"', claim)

    def test_heavy_export_runs_off_event_loop_and_completes_same_row(self):
        process = function_source("process_data_job")
        complete = function_source("complete_data_job")
        self.assertIn("await asyncio.to_thread", process)
        self.assertIn("generate_qa_export", process)
        self.assertIn("WHERE id = %s", complete)
        self.assertIn("status = 'COMPLETED'", complete)
        self.assertIn('"artifactPath"', complete)

    def test_report_and_qa_export_share_one_heavy_job_slot(self):
        report_wrapper = function_source("process_report_with_heartbeat")
        data_wrapper = function_source("process_data_job_with_heartbeat")
        self.assertIn("heavy_job_semaphore = asyncio.Semaphore(1)", SOURCE)
        self.assertIn("async with heavy_job_semaphore", report_wrapper)
        self.assertIn("async with heavy_job_semaphore", data_wrapper)
        self.assertLess(
            report_wrapper.index("async with heavy_job_semaphore"),
            report_wrapper.index("mark_job_started"),
        )
        self.assertLess(
            data_wrapper.index("async with heavy_job_semaphore"),
            data_wrapper.index("mark_job_started"),
        )

    def test_persisted_failures_do_not_store_raw_exceptions(self):
        data_failure = function_source("fail_data_job")
        report_failure = function_source("fail_report_history")
        process_data = function_source("process_data_job")
        self.assertIn("public_qa_export_error(error)", data_failure)
        self.assertIn("public_encuestas_export_error(error)", data_failure)
        self.assertNotIn("str(error)", data_failure)
        self.assertIn("No se pudo generar el reporte", report_failure)
        self.assertNotIn("error_message", report_failure)
        self.assertIn("fail_data_job", process_data)
        self.assertIn("exc,", process_data)


if __name__ == "__main__":
    unittest.main()
