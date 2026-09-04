"""Offline tests for the Wi-Fi lab helper scripts."""

from __future__ import annotations

import importlib.util
from pathlib import Path
import unittest


TOOLS_DIR = Path(__file__).parents[1] / "src" / "wifi_lab_tools"


def load_tool(name: str):
    path = TOOLS_DIR / f"{name}.py"
    spec = importlib.util.spec_from_file_location(name, path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


monitor_checker = load_tool("monitor_mode_checker")
password_auditor = load_tool("password_strength_auditor")
synthetic_demo = load_tool("synthetic_hash_demo")


class WifiLabToolTests(unittest.TestCase):
    def test_monitor_mode_parser(self):
        output = "Interface wlx1cbfce9caba1\n\tifindex 3\n\ttype monitor\n"
        self.assertEqual(monitor_checker.interface_type(output), "monitor")

    def test_managed_mode_parser(self):
        self.assertEqual(
            monitor_checker.interface_type("Interface wlan0\n\ttype managed\n"),
            "managed",
        )

    def test_password_auditor_flags_weak_password(self):
        report = password_auditor.audit_password("password123")
        self.assertEqual(report["rating"], "weak")
        self.assertTrue(report["issues"])

    def test_password_auditor_accepts_long_randomish_password(self):
        report = password_auditor.audit_password("N7!vQ2@pL9#xR4$kT8")
        self.assertIn(report["rating"], {"moderate", "strong"})
        self.assertEqual(report["issues"], [])

    def test_synthetic_demo_matches_only_candidate(self):
        self.assertEqual(
            synthetic_demo.find_matching_candidate(
                "secret",
                ("wrong-one", "secret", "wrong-two"),
            ),
            "secret",
        )
        self.assertIsNone(
            synthetic_demo.find_matching_candidate("secret", ("wrong-one",))
        )


if __name__ == "__main__":
    unittest.main()
