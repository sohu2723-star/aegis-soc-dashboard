"""Non-networking tests for fail-closed forwarder configuration validation."""

import importlib.util
from pathlib import Path
import sys
import types
import unittest


MODULE_PATH = Path(__file__).parents[1] / "src" / "aegis_forwarder.py"
# Configuration validation does not use HTTP. Stub the optional runtime package
# so this unit test also runs in a clean developer checkout before `pip install`.
sys.modules.setdefault("requests", types.ModuleType("requests"))
SPEC = importlib.util.spec_from_file_location("aegis_forwarder", MODULE_PATH)
assert SPEC and SPEC.loader
forwarder = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(forwarder)


class ForwarderConfigTests(unittest.TestCase):
    def setUp(self):
        self.url = forwarder.AEGIS_URL
        self.key = forwarder.AEGIS_KEY
        self.admin = forwarder.DEFENSE_HEADERS["X-AEGIS-Admin-Key"]
        self.poll = forwarder.DEFENSE_POLL_SECS

    def tearDown(self):
        forwarder.AEGIS_URL = self.url
        forwarder.AEGIS_KEY = self.key
        forwarder.DEFENSE_HEADERS["X-AEGIS-Admin-Key"] = self.admin
        forwarder.DEFENSE_POLL_SECS = self.poll

    def configure_valid(self):
        forwarder.AEGIS_URL = "https://api.invalid.example/api"
        forwarder.AEGIS_KEY = "test-ingest-key"
        forwarder.DEFENSE_HEADERS["X-AEGIS-Admin-Key"] = "test-admin-key"
        forwarder.DEFENSE_POLL_SECS = 5

    def test_valid_configuration(self):
        self.configure_valid()
        self.assertEqual(forwarder.validate_runtime_config(), [])

    def test_placeholders_and_default_key_fail_closed(self):
        forwarder.AEGIS_URL = "http://<YOUR_AEGIS_DOMAIN>/api"
        forwarder.AEGIS_KEY = "aegis-demo-key-change-me"
        errors = forwarder.validate_runtime_config()
        self.assertTrue(any("AEGIS_URL" in error for error in errors))
        self.assertTrue(any("AEGIS_KEY" in error for error in errors))

    def test_admin_key_required_only_with_defense(self):
        self.configure_valid()
        forwarder.DEFENSE_HEADERS["X-AEGIS-Admin-Key"] = ""
        self.assertTrue(any("AEGIS_ADMIN_KEY" in error for error in forwarder.validate_runtime_config(True)))
        self.assertEqual(forwarder.validate_runtime_config(False), [])

    def test_poll_interval_is_bounded(self):
        self.configure_valid()
        forwarder.DEFENSE_POLL_SECS = 0
        self.assertTrue(any("DEFENSE_POLL_SECS" in error for error in forwarder.validate_runtime_config()))


if __name__ == "__main__":
    unittest.main()
