import ast
import unittest
from pathlib import Path


SOURCE = Path(__file__).resolve().parents[1].joinpath("main.py").read_text(
    encoding="utf-8"
)


def function_source(name):
    tree = ast.parse(SOURCE)
    node = next(
        item for item in tree.body
        if isinstance(item, (ast.FunctionDef, ast.AsyncFunctionDef))
        and item.name == name
    )
    return ast.get_source_segment(SOURCE, node)


class ReportProtocolTests(unittest.TestCase):
    def test_claim_complete_and_fail_are_owned_by_run_token(self):
        claim = function_source("claim_report_history")
        complete = function_source("complete_report_history")
        fail = function_source("fail_report_history")

        self.assertIn('"runToken" = %s::uuid', claim)
        self.assertIn('"leaseExpiresAt" < NOW()', claim)
        self.assertIn("NOT EXISTS", claim)
        self.assertIn("newer.id > target.id", claim)
        self.assertIn('status = \'COMPLETED\'', claim)
        self.assertIn('"already_completed": True', claim)
        self.assertIn('AND "runToken" = %s::uuid', complete)
        self.assertIn('AND "runToken" = %s::uuid', fail)

    def test_rendering_runs_off_event_loop_and_validates_both_files(self):
        process = function_source("process_report")
        self.assertIn("await asyncio.to_thread", process)
        self.assertIn('validate_artifact(pdf_path, ".pdf")', process)
        self.assertIn('validate_artifact(excel_path, ".xlsx")', process)
        self.assertIn("run_token", process)


if __name__ == "__main__":
    unittest.main()
