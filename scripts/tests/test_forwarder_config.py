"""Non-networking tests for fail-closed forwarder configuration validation."""

import importlib.util
from pathlib import Path
import sys
import types
import unittest
from unittest.mock import Mock, patch


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

    def test_suricata_defaults_monitor_both_lab_interfaces(self):
        self.assertEqual(forwarder._pfsense_suricata_log_paths(), [
            "/var/log/suricata/suricata_em1.*/eve.json",
            "/var/log/suricata/suricata_em2.*/eve.json",
        ])

    def test_suricata_explicit_paths_override_defaults(self):
        self.assertEqual(
            forwarder._pfsense_suricata_log_paths("/tmp/public.json, /tmp/internal.json"),
            ["/tmp/public.json", "/tmp/internal.json"],
        )

    def test_legacy_root_log_enables_both_interface_patterns(self):
        self.assertEqual(
            forwarder._pfsense_suricata_log_paths("", "/var/log/suricata/eve.json"),
            forwarder._pfsense_suricata_log_paths(),
        )

    def test_heartbeat_posts_before_first_sleep(self):
        """Boot recovery must not wait 15 seconds before reporting online."""
        response = Mock(status_code=200)
        with (
            patch.object(forwarder, "get_local_ip", return_value="10.30.30.10"),
            patch.object(forwarder, "get_mac_address", return_value="00:00:00:00:00:01"),
            patch.object(forwarder, "get_open_ports", return_value="22"),
            patch.object(forwarder, "get_os_info", return_value="Ubuntu"),
            patch.object(forwarder.socket, "gethostname", return_value="aegis-admin"),
            patch.object(forwarder.requests, "post", return_value=response, create=True) as post,
            patch.object(forwarder.time, "monotonic", side_effect=[100.0, 100.0]),
            patch.object(forwarder.time, "sleep", side_effect=RuntimeError("stop")) as sleep,
        ):
            with self.assertRaisesRegex(RuntimeError, "stop"):
                forwarder.heartbeat_loop()

        post.assert_called_once()
        self.assertEqual(post.call_args.kwargs["json"]["status"], "online")
        sleep.assert_called_once_with(forwarder.HEARTBEAT_INTERVAL_SECS)

    def test_heartbeat_timeout_is_shorter_than_interval(self):
        """A single slow request must not consume the full heartbeat period."""
        self.assertLess(
            forwarder.HEARTBEAT_REQUEST_TIMEOUT_SECS,
            forwarder.HEARTBEAT_INTERVAL_SECS,
        )


if __name__ == "__main__":
    unittest.main()
