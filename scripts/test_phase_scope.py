#!/usr/bin/env python3
"""Self-tests for scripts/verify_phase_scope.py (rules S1-S14).

Run: python3 -m unittest scripts/test_phase_scope.py

Each test builds a scratch copy of the files the guard reads, applies ONE violation and
asserts that exactly the intended rule fails. The clean copy must pass. No network, no database.
"""
import json
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
REAL = HERE.parent
sys.path.insert(0, str(HERE))
import verify_phase_scope as guard  # noqa: E402

FILES = [
    "README.md", ".env.example", ".gitignore", "docker-compose.yml", ".github/workflows/ci.yml",
    "apps/api/src/main.ts", "apps/api/src/config.ts", "apps/api/src/health.controller.ts",
    "apps/api/src/app.module.ts", "apps/api/src/database/database.service.ts",
    "apps/web/src/main.tsx", "apps/web/src/tokens.css", "prisma/schema.prisma",
    "docs/MILESTONE_0_SCOPE.md", "docs/nook-phase-2/PHASE_2_DECISION_LOG.md",
    "scripts/secret_scan.py", "scripts/verify_m0_scope.py", "scripts/verify_phase_scope.py",
    "scripts/phase_scope.json", "scripts/test_phase_scope.py", "scripts/db_guard.py",
    "package.json", "apps/api/package.json", "apps/web/package.json",
]
APPROVED_REF = "docs/nook-phase-2/PHASE_2_DECISION_LOG.md"


def git(root, *args):
    subprocess.run(
        ["git", "-c", "user.name=t", "-c", "user.email=t@example.invalid", *args],
        cwd=root, check=True, capture_output=True,
    )


class ScopeGuardTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        for rel in FILES:
            dest = self.root / rel
            dest.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy(REAL / rel, dest)
        git(self.root, "init", "-q")
        git(self.root, "add", "-A")
        git(self.root, "commit", "-q", "-m", "base")

    def tearDown(self):
        self.tmp.cleanup()

    # helpers
    def results(self):
        return guard.run_checks(self.root)

    def failed(self):
        return sorted({r.rule for r in self.results() if not r.ok})

    def write(self, rel, text, mode="w"):
        p = self.root / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        with open(p, mode, encoding="utf-8") as fh:
            fh.write(text)

    def manifest(self, mutate):
        path = self.root / "scripts/phase_scope.json"
        data = json.loads(path.read_text())
        mutate(data)
        path.write_text(json.dumps(data, indent=2))

    def migration(self, name, sql):
        self.write(f"prisma/migrations/{name}/migration.sql", sql)

    def assertOnly(self, *rules):
        self.assertEqual(self.failed(), sorted(rules))

    # clean tree
    def test_clean_tree_passes(self):
        self.assertEqual(self.failed(), [], [r for r in self.results() if not r.ok])

    def test_real_repository_passes(self):
        bad = [r for r in guard.run_checks(REAL) if not r.ok]
        self.assertEqual(bad, [], bad)

    # S1 retained Milestone 0 checks
    def test_S1_env_file_present(self):
        self.write(".env", "X=1\n")
        self.assertOnly("S1")

    def test_S1_required_file_missing(self):
        (self.root / "docker-compose.yml").unlink()
        self.assertOnly("S1")

    # S2 schema allow-list
    def test_S2_unlisted_model(self):
        self.write("prisma/schema.prisma", "\nmodel Widget {\n  id Int @id\n}\n", "a")
        self.assertOnly("S2")

    def test_S2_unlisted_enum(self):
        self.write("prisma/schema.prisma", "\nenum Mood {\n  HAPPY\n}\n", "a")
        self.assertOnly("S2")

    def test_S2_approved_model_is_allowed(self):
        self.write("prisma/schema.prisma", "\nmodel Organization {\n  id String @id\n}\n", "a")
        self.assertEqual(self.failed(), [])

    # S3 migration SQL allow-list
    def test_S3_unlisted_table_in_migration(self):
        self.migration("20260101000000_x", '-- phase-scope: slice-2.2\nCREATE TABLE "widgets" (id int);\n')
        self.assertOnly("S3")

    def test_S3_untagged_migration(self):
        self.migration("20260101000000_x", 'CREATE TABLE "organizations" (id int);\n')
        self.assertOnly("S3")

    def test_S3_approved_table_is_allowed(self):
        self.migration("20260101000000_x", '-- phase-scope: slice-2.2\nCREATE TABLE "organizations" (id int);\n')
        self.assertEqual(self.failed(), [])

    def test_S3_unlisted_reference_target(self):
        self.migration(
            "20260101000000_x",
            '-- phase-scope: slice-2.2\nALTER TABLE "rooms" ADD CONSTRAINT c FOREIGN KEY (a) REFERENCES "widgets"(id);\n',
        )
        self.assertOnly("S3")

    # S4 destructive SQL
    def test_S4_drop_table(self):
        self.migration("20260101000000_x", '-- phase-scope: slice-2.2\nDROP TABLE "organizations";\n')
        self.assertOnly("S4")

    def test_S4_other_destructive_forms(self):
        for sql in ('TRUNCATE "organizations";', 'DELETE FROM "organizations";',
                    'ALTER TABLE "organizations" DROP COLUMN name;',
                    'ALTER TABLE "organizations" ALTER COLUMN name TYPE text;'):
            with self.subTest(sql=sql):
                self.migration("20260101000000_x", f"-- phase-scope: slice-2.2\n{sql}\n")
                self.assertIn("S4", self.failed())

    def test_S4_marker_with_resolvable_reference_passes(self):
        self.migration(
            "20260101000000_x",
            f'-- phase-scope: slice-2.2\n-- destructive-approved: {APPROVED_REF}\nDROP TABLE "organizations";\n',
        )
        self.assertEqual(self.failed(), [])

    def test_S4_marker_with_missing_reference_fails(self):
        self.migration(
            "20260101000000_x",
            '-- phase-scope: slice-2.2\n-- destructive-approved: docs/does-not-exist.md\nDROP TABLE "organizations";\n',
        )
        self.assertOnly("S4")

    # S5 migration immutability
    def test_S5_edited_committed_migration(self):
        self.migration("20260101000000_x", '-- phase-scope: slice-2.2\nCREATE TABLE "organizations" (id int);\n')
        git(self.root, "add", "-A")
        git(self.root, "commit", "-q", "-m", "add migration")
        self.migration("20260101000000_x", '-- phase-scope: slice-2.2\nCREATE TABLE "organizations" (id bigint);\n')
        self.assertOnly("S5")

    def test_S5_deleted_committed_migration(self):
        self.migration("20260101000000_x", '-- phase-scope: slice-2.2\nCREATE TABLE "organizations" (id int);\n')
        git(self.root, "add", "-A")
        git(self.root, "commit", "-q", "-m", "add migration")
        (self.root / "prisma/migrations/20260101000000_x/migration.sql").unlink()
        self.assertOnly("S5")

    # S6 forbidden vocabulary
    def test_S6_forbidden_file_name(self):
        self.write("apps/api/src/resident.controller.ts", "export class X {}\n")
        self.assertOnly("S6")

    def test_S6_forbidden_schema_identifier(self):
        self.write("prisma/schema.prisma", "\nmodel Organization {\n  id String @id\n  paymentStatus String\n}\n", "a")
        self.assertOnly("S6")

    def test_S6_whole_word_matching_has_no_false_positive(self):
        self.write("apps/api/src/threshold.util.ts", "export const a = 1;\n")
        self.assertEqual(self.failed(), [])

    # S7 money types
    def test_S7_decimal_and_float(self):
        for typ in ("Decimal", "Float"):
            with self.subTest(typ=typ):
                self.write("prisma/schema.prisma", f"\nmodel Organization {{\n  id String @id\n  size {typ}\n}}\n", "w")
                shutil.copy(REAL / "prisma/schema.prisma", self.root / "prisma/schema.prisma")
                self.write("prisma/schema.prisma", f"\nmodel Organization {{\n  id String @id\n  size {typ}\n}}\n", "a")
                self.assertIn("S7", self.failed())

    # S8 route allow-list
    def test_S8_unlisted_route(self):
        self.write("apps/api/src/extra.controller.ts",
                   "@Controller('extras')\nexport class E {\n  @Get('list')\n  l() {}\n}\n")
        self.assertOnly("S8")

    # S9 raw SQL
    def test_S9_raw_sql(self):
        self.write("apps/api/src/db.util.ts", "export const q = (p: any) => p.$queryRawUnsafe('select 1');\n")
        self.assertOnly("S9")

    # S10 dependencies
    def test_S10_forbidden_sdk(self):
        self._add_dep("razorpay", "1.0.0")
        self.assertIn("S10", self.failed())

    def test_S10_unapproved_and_ranged(self):
        self._add_dep("zod", "^4.6.7")
        self.assertIn("S10", self.failed())

    def test_S10_unapproved_exact_pin(self):
        self._add_dep("left-pad", "1.3.0")
        self.assertOnly("S10")

    def test_S10_approved_addition_is_allowed(self):
        self.assertEqual(self.failed(), [])

    def _add_dep(self, name, version):
        p = self.root / "apps/api/package.json"
        data = json.loads(p.read_text())
        data["dependencies"][name] = version
        p.write_text(json.dumps(data, indent=2))

    # S11 approval completeness
    def test_S11_blank_approver(self):
        self.manifest(lambda d: d["slices"]["2.2"].update(approver=""))
        self.assertOnly("S11")

    def test_S11_missing_reference_file(self):
        self.manifest(lambda d: d["slices"]["2.2"].update(ref="docs/missing.md#x"))
        self.assertOnly("S11")

    def test_S11_missing_anchor(self):
        self.manifest(lambda d: d["slices"]["2.2"].update(ref=f"{APPROVED_REF}#no-such-heading"))
        self.assertOnly("S11")

    # S12 the guard's own tests exist for every rule
    def test_S12_missing_self_tests(self):
        self.write("scripts/test_phase_scope.py", "import unittest\n")
        self.assertOnly("S12")

    # S13 legacy guard integrity
    def test_S13_edited_legacy_guard(self):
        self.write("scripts/verify_m0_scope.py", "\n# one extra comment\n", "a")
        self.assertOnly("S13")

    # S14 a guard always runs in package scripts and CI
    def test_S14_ci_without_guard_step(self):
        ci = self.root / ".github/workflows/ci.yml"
        text = ci.read_text().replace("npm run verify:scope", "echo skipped")
        ci.write_text(text)
        self.assertOnly("S14")

    def test_S14_script_missing(self):
        p = self.root / "package.json"
        data = json.loads(p.read_text())
        del data["scripts"]["verify:scope"]
        p.write_text(json.dumps(data, indent=2))
        self.assertOnly("S14")

    def test_S14_self_tests_must_run_before_the_guard(self):
        ci = self.root / ".github/workflows/ci.yml"
        text = ci.read_text().replace("unittest scripts/test_phase_scope.py", "unittest scripts/test_db_guard.py")
        ci.write_text(text)
        self.assertOnly("S14")

    # CLI
    def test_cli_exit_codes(self):
        script = str(HERE / "verify_phase_scope.py")
        ok = subprocess.run([sys.executable, script, "--root", str(self.root)], capture_output=True, text=True)
        self.assertEqual(ok.returncode, 0, ok.stdout)
        (self.root / ".env").write_text("X=1\n")
        bad = subprocess.run([sys.executable, script, "--root", str(self.root)], capture_output=True, text=True)
        self.assertEqual(bad.returncode, 1)
        self.assertIn("FAIL", bad.stdout)


if __name__ == "__main__":
    unittest.main()
