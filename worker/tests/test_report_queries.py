import ast
import unittest
from pathlib import Path


SOURCE = Path(__file__).resolve().parents[1].joinpath("generate_pdf.py").read_text(
    encoding="utf-8"
)


def strings_in_function(name):
    tree = ast.parse(SOURCE)
    function = next(
        node for node in tree.body
        if isinstance(node, ast.FunctionDef) and node.name == name
    )
    return [
        node.value
        for node in ast.walk(function)
        if isinstance(node, ast.Constant) and isinstance(node.value, str)
    ]


class ReportQueryTests(unittest.TestCase):
    def test_summary_counts_approved_load_without_requiring_kml(self):
        fuel_sql = next(
            value for value in strings_in_function("get_summary")
            if "FROM fuel_loads" in value
        )
        self.assertIn("COUNT(*) as total_loads", fuel_sql)
        self.assertIn('status = \'APPROVED\'::"FuelLoadStatus"', fuel_sql)
        self.assertNotIn('"kmPerLiter" IS NOT NULL', fuel_sql)

    def test_current_fleet_queries_exclude_soft_deleted_vehicles(self):
        self.assertIn('COUNT(*) FROM vehicles WHERE "isActive" = true', SOURCE)
        self.assertIn(
            'WHERE v."isActive" = true\n        ORDER BY v."economicNumber"',
            SOURCE,
        )


if __name__ == "__main__":
    unittest.main()
