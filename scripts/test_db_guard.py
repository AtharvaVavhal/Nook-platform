#!/usr/bin/env python3
"""Tests for scripts/db_guard.py. Run: python3 -m unittest scripts/test_db_guard.py"""
import subprocess
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import db_guard  # noqa: E402

GOOD = "postgresql://nook:nook_local_only@127.0.0.1:5433/nook_dev?schema=public"


class DbGuardTests(unittest.TestCase):
    def refused(self, url):
        reasons = db_guard.check(url)
        self.assertTrue(reasons, f"expected a refusal for {url!r}")
        return reasons

    def test_allows_the_project_database_on_loopback(self):
        self.assertEqual(db_guard.check(GOOD), [])

    def test_allows_localhost_and_the_test_database(self):
        self.assertEqual(db_guard.check("postgres://nook:x@localhost:5433/nook_test"), [])

    def test_refuses_port_5432(self):
        self.assertTrue(any("5432" in r for r in self.refused(GOOD.replace("5433", "5432"))))

    def test_refuses_any_other_port(self):
        self.refused(GOOD.replace("5433", "5434"))

    def test_refuses_a_missing_port(self):
        self.refused("postgresql://nook:x@127.0.0.1/nook_dev")

    def test_refuses_non_loopback_hosts(self):
        for host in ("0.0.0.0", "10.1.2.3", "db.example.com", "[::1]"):
            with self.subTest(host=host):
                self.refused(f"postgresql://nook:x@{host}:5433/nook_dev")

    def test_refuses_unexpected_database_names(self):
        for name in ("nook", "postgres", "production", "nook_prod", "nook_dev2"):
            with self.subTest(name=name):
                self.refused(f"postgresql://nook:x@127.0.0.1:5433/{name}")

    def test_refuses_a_missing_database_name(self):
        self.refused("postgresql://nook:x@127.0.0.1:5433")

    def test_refuses_other_schemes(self):
        self.refused("mysql://nook:x@127.0.0.1:5433/nook_dev")

    def test_refuses_query_parameters_that_override_the_target(self):
        for param in ("host=db.example.com", "hostaddr=10.1.2.3", "port=5432", "dbname=prod", "service=x"):
            with self.subTest(param=param):
                self.refused(GOOD + "&" + param)

    def test_refuses_an_empty_or_malformed_url(self):
        self.refused("")
        self.refused("not a url")

    def test_never_prints_the_password(self):
        secret = "S3cretPassw0rd"
        url = f"postgresql://nook:{secret}@10.1.2.3:5432/prod"
        out = subprocess.run(
            [sys.executable, str(Path(db_guard.__file__)), url], capture_output=True, text=True
        )
        self.assertEqual(out.returncode, 1)
        self.assertNotIn(secret, out.stdout + out.stderr)

    def test_cli_exit_codes(self):
        script = str(Path(db_guard.__file__))
        ok = subprocess.run([sys.executable, script, GOOD], capture_output=True, text=True)
        self.assertEqual(ok.returncode, 0)
        bad = subprocess.run(
            [sys.executable, script, GOOD.replace("5433", "5432")], capture_output=True, text=True
        )
        self.assertEqual(bad.returncode, 1)


if __name__ == "__main__":
    unittest.main()
