#!/usr/bin/env python3
"""Self-tests for scripts/verify_phase_scope.py (rules S1-S14).

Run: python3 -m unittest scripts/test_phase_scope.py

Each test builds a scratch copy of the files the guard reads, applies ONE violation and
asserts that exactly the intended rule fails. The clean copy must pass. No network, no database.
"""
import hashlib
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
    "docs/nook-phase-3/PHASE_3_SCOPE_REGISTER.md",
    "docs/phase-4/IMPLEMENTATION_AUTHORIZATION.md",
    "docs/resident-portal/PHASE_1_RESIDENT_AUTH_SCOPE.md",
    "docs/resident-portal/PHASE_2_RESIDENT_APIS.md",
    "scripts/secret_scan.py", "scripts/verify_m0_scope.py", "scripts/verify_phase_scope.py",
    "scripts/phase_scope.json", "scripts/test_phase_scope.py", "scripts/db_guard.py",
    "package.json", "apps/api/package.json", "apps/web/package.json",
]
APPROVED_REF = "docs/nook-phase-2/PHASE_2_DECISION_LOG.md"

# Governance states are tested in isolated temporary copies only. The real manifest is never written by these tests:
# its hash is taken at import and checked again when the module finishes (tearDownModule), pass or fail.
REAL_MANIFEST = REAL / "scripts/phase_scope.json"
REAL_MANIFEST_SHA256 = hashlib.sha256(REAL_MANIFEST.read_bytes()).hexdigest()
PENDING_STATUS = "pending-owner-signoff"
# Obviously fake approval metadata, used ONLY inside a temporary fixture to build the approved state. It is not an approval.
FIXTURE_APPROVER = "TEST FIXTURE ONLY - not an owner approval"
FIXTURE_DATE = "2000-01-01"
RESIDENT_SELF_ROUTES = {
    "GET /api/v1/me",
    "GET /api/v1/me/stay",
    "GET /api/v1/me/rent-summary",
    "GET /api/v1/me/invoices",
    "GET /api/v1/me/invoices/:id",
    "GET /api/v1/me/payments",
    "GET /api/v1/me/receipts/:id",
}


def tearDownModule():
    now = hashlib.sha256(REAL_MANIFEST.read_bytes()).hexdigest()
    assert now == REAL_MANIFEST_SHA256, "the self-tests modified the real scripts/phase_scope.json"


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
        self.addCleanup(self.tmp.cleanup)  # restored even when setUp or an assertion fails
        # Baseline = the real manifest with any slice that is still pending owner sign-off APPROVED IN THIS TEMPORARY COPY ONLY,
        # so that each test can apply ONE violation and see exactly one rule fail. Pending behaviour has its own tests below.
        self.manifest(self.approve_pending_in_fixture)
        git(self.root, "init", "-q")
        git(self.root, "add", "-A")
        git(self.root, "commit", "-q", "-m", "base")

    @staticmethod
    def approve_pending_in_fixture(data):
        for sl in data["slices"].values():
            if sl.get("status") != "approved":
                sl.update(status="approved", approver=FIXTURE_APPROVER, date=FIXTURE_DATE)

    def pend(self, with_metadata=False):
        """Put slice 5.2 into the pending state inside the temporary fixture (the real manifest is untouched)."""
        def mutate(d):
            sl = d["slices"]["5.2"]
            sl["status"] = PENDING_STATUS
            sl["approver"] = FIXTURE_APPROVER if with_metadata else ""
            sl["date"] = FIXTURE_DATE if with_metadata else ""
        self.manifest(mutate)

    def add_resident_self_routes(self):
        """Copy the real resident self-service controller so the guard sees the real seven routes."""
        src = REAL / "apps/api/src/resident-self/resident-self.controller.ts"
        dest = self.root / "apps/api/src/resident-self/resident-self.controller.ts"
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy(src, dest)

    def failures(self):
        return {r.rule: r for r in self.results() if not r.ok}

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
        """Real tree: only an EXPECTED governance failure (slice 5.2 pending) or the local .env may fail, and nothing else."""
        bad = [r for r in guard.run_checks(REAL) if not r.ok]
        # ENVIRONMENT-specific: a developer's git-ignored local .env is normal. A clean checkout (CI) has none, and
        # test_S1_env_file_present proves the rule, so only that one environment-dependent check is set aside, and only
        # when the file really is git-ignored.
        ignored = subprocess.run(["git", "-C", str(REAL), "check-ignore", "-q", ".env"]).returncode == 0
        env_failures = [r for r in bad if r.name == "no real .env file"]
        if not ignored:
            self.assertEqual(env_failures, [], "a .env that is not git-ignored is a real failure")
        governance = [r for r in bad if r not in env_failures]
        slice_52 = json.loads(REAL_MANIFEST.read_text())["slices"]["5.2"]
        if slice_52["status"] == "approved":
            self.assertEqual(governance, [], governance)
        else:
            # GOVERNANCE-expected: pending owner sign-off fails exactly the approval-dependent rules, for exactly that reason.
            by_rule = {r.rule: r for r in governance}
            self.assertEqual(sorted(by_rule), ["S11", "S8"], governance)
            self.assertEqual(by_rule["S11"].detail, "slice 5.2: status is not 'approved'")
            self.assertEqual(set(by_rule["S8"].detail.split(", ")), RESIDENT_SELF_ROUTES)

    def test_real_slice_5_2_state_is_consistent_and_its_scope_is_exact(self):
        """Read-only: no half-approved state, no invented approval, and the approved scope is exactly what was reviewed."""
        data = json.loads(REAL_MANIFEST.read_text())
        sl = data["slices"]["5.2"]
        self.assertIn(sl["status"], ("approved", PENDING_STATUS))
        if sl["status"] == PENDING_STATUS:
            self.assertEqual((sl["approver"], sl["date"]), ("", ""), "pending means no approver and no date")
        else:
            self.assertTrue(sl["approver"].strip() and sl["date"].strip())
            self.assertNotEqual(sl["approver"], FIXTURE_APPROVER, "fixture metadata must never reach the real manifest")
            self.assertNotEqual(sl["date"], FIXTURE_DATE)
        self.assertEqual(set(sl["routes"]), RESIDENT_SELF_ROUTES)
        self.assertEqual(len(sl["routes"]), 7)
        for key in ("models", "enums", "tables", "functions", "extensions", "allowsVocabulary", "allowsTypes"):
            self.assertEqual(sl[key], [], key)
        self.assertEqual(data["allowedIdentifiers"], ["_api_v1_me_rent"])

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

    def test_S3_manifest_mapping_replaces_the_first_line_tag(self):
        self.migration("20261101999999_mapped", 'CREATE INDEX "x" ON "residents"("id");\n')
        self.assertOnly("S3")  # unmapped and untagged
        self.manifest(lambda d: d.setdefault("migrationSlices", {}).update({"20261101999999_mapped": "3.1"}))
        self.assertEqual(self.failed(), [])

    def test_S3_mapping_to_an_unapproved_slice_fails(self):
        self.migration("20261101999999_mapped", 'CREATE INDEX "x" ON "residents"("id");\n')
        self.manifest(lambda d: d.setdefault("migrationSlices", {}).update({"20261101999999_mapped": "9.9"}))
        self.assertOnly("S3")

    def test_S1_env_example_must_carry_the_placeholder_not_a_password(self):
        self.write(".env.example", "DATABASE_URL=postgresql://nook:realpassword@localhost:5433/nook_dev\n")
        self.assertOnly("S1")

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
        self.write("apps/api/src/refund.controller.ts", "export class X {}\n")
        self.assertOnly("S6")

    def test_S6_forbidden_schema_identifier(self):
        self.write("prisma/schema.prisma", "\nmodel Organization {\n  id String @id\n  refundStatus String\n}\n", "a")
        self.assertOnly("S6")

    def test_S6_words_beyond_the_approved_slices_stay_forbidden(self):
        # ledger, settlement, kyc, aadhaar and whatsapp are not declared by any slice (otp and sms are, by slice 5.1 only)
        for word in ("ledger", "settlement", "kyc", "aadhaar", "whatsapp"):
            with self.subTest(word=word):
                self.write("apps/api/src/" + word + ".util.ts", "export const a = 1;\n")
                self.assertOnly("S6")
                (self.root / "apps/api/src" / (word + ".util.ts")).unlink()

    def test_S6_otp_and_sms_are_allowed_only_through_slice_5_1(self):
        def drop(d):
            d["slices"]["5.1"]["allowsVocabulary"] = [w for w in d["slices"]["5.1"]["allowsVocabulary"] if w not in ("otp", "sms")]
        self.manifest(drop)
        self.assertIn("S6", self.failed())

    def test_S6_approved_vocabulary_is_allowed_only_through_a_slice(self):
        def drop(d):
            for sl in d["slices"].values():
                sl.pop("allowsVocabulary", None)
        self.manifest(drop)
        self.assertIn("S6", self.failed())

    def test_S6_whole_word_matching_has_no_false_positive(self):
        self.write("apps/api/src/threshold.util.ts", "export const a = 1;\n")
        self.assertEqual(self.failed(), [])

    # S7 money types
    def test_S7_decimal_and_float(self):
        # Float and Money are never approved
        for typ in ("Float", "Money"):
            with self.subTest(typ=typ):
                shutil.copy(REAL / "prisma/schema.prisma", self.root / "prisma/schema.prisma")
                self.write("prisma/schema.prisma", f"\nmodel Organization {{\n  id String @id\n  size {typ}\n}}\n", "a")
                self.assertIn("S7", self.failed())

    def test_S7_decimal_requires_an_approved_slice(self):
        def drop(d):
            for sl in d["slices"].values():
                sl.pop("allowsTypes", None)
        self.manifest(drop)
        self.assertOnly("S7")

    # S8 route allow-list
    def test_S8_unlisted_route(self):
        self.write("apps/api/src/extra.controller.ts",
                   "@Controller('extras')\nexport class E {\n  @Get('list')\n  l() {}\n}\n")
        self.assertOnly("S8")

    # S8 / S11 governance states of the resident self-service slice (5.2), each in an isolated temporary fixture
    def test_S8_pending_slice_fails_approval_rules_only_for_the_approval_reason(self):
        self.add_resident_self_routes()
        self.pend()
        failures = self.failures()
        self.assertEqual(sorted(failures), ["S11", "S8"], "no unrelated rule may fail")
        self.assertEqual(failures["S11"].detail, "slice 5.2: status is not 'approved'")
        self.assertEqual(set(failures["S8"].detail.split(", ")), RESIDENT_SELF_ROUTES)
        # the .env protection is not involved: it neither fails here nor is it weakened
        self.assertFalse(any(r.name == "no real .env file" and not r.ok for r in self.results()))
        # and the guard never approves anything by itself
        self.assertEqual(json.loads((self.root / "scripts/phase_scope.json").read_text())["slices"]["5.2"]["status"], PENDING_STATUS)

    def test_S11_pending_slice_stays_unapproved_even_with_metadata_filled_in(self):
        self.add_resident_self_routes()
        self.pend(with_metadata=True)  # approver and date present but status is not approved
        failures = self.failures()
        self.assertEqual(sorted(failures), ["S11", "S8"])
        self.assertEqual(failures["S11"].detail, "slice 5.2: status is not 'approved'")

    def test_S11_approved_slice_without_approver_or_date_fails(self):
        for field in ("approver", "date"):
            with self.subTest(field=field):
                self.manifest(lambda d, f=field: d["slices"]["5.2"].update({f: ""}))
                self.assertIn("S11", self.failed())
                self.manifest(lambda d: self.approve_pending_in_fixture(d) or d["slices"]["5.2"].update(approver=FIXTURE_APPROVER, date=FIXTURE_DATE))

    def test_S8_approved_fixture_allows_exactly_the_seven_resident_routes(self):
        self.add_resident_self_routes()
        self.assertEqual({r for r in guard.declared_routes(self.root) if "/me" in r}, RESIDENT_SELF_ROUTES)
        self.assertEqual(self.failed(), [], [r for r in self.results() if not r.ok])

    def test_S8_approved_fixture_still_rejects_routes_and_verbs_beyond_the_seven(self):
        self.add_resident_self_routes()
        self.write("apps/api/src/resident-self/extra.controller.ts", (
            "@Controller('me')\nexport class Extra {\n"
            "  @Get('rent-history')\n  a() {}\n"
            "  @Post('payments')\n  b() {}\n"
            "  @Put('stay')\n  c() {}\n"
            "  @Patch()\n  d() {}\n"
            "  @Delete('invoices/:id')\n  e() {}\n}\n"))
        failures = self.failures()
        self.assertEqual(sorted(failures), ["S8"])
        self.assertEqual(set(failures["S8"].detail.split(", ")), {
            "GET /api/v1/me/rent-history", "POST /api/v1/me/payments", "PUT /api/v1/me/stay",
            "PATCH /api/v1/me", "DELETE /api/v1/me/invoices/:id"})

    def test_S6_rent_exception_is_the_exact_route_token_and_nothing_broader(self):
        self.add_resident_self_routes()
        data = json.loads((self.root / "scripts/phase_scope.json").read_text())
        self.assertEqual(data["slices"]["5.2"]["allowsVocabulary"], [], "no broad vocabulary exception")
        self.assertEqual(data["allowedIdentifiers"], ["_api_v1_me_rent"])
        self.assertEqual(self.failed(), [])
        # remove the exact-token exception: the rent-summary route is rejected again
        self.manifest(lambda d: d.update(allowedIdentifiers=[]))
        self.assertOnly("S6")

    def test_S6_rent_stays_forbidden_everywhere_else_while_the_exception_exists(self):
        self.add_resident_self_routes()
        self.manifest(lambda d: d["slices"]["5.2"]["routes"].append("GET /api/v1/rent"))
        self.write("apps/api/src/rent.controller.ts", "@Controller('rent')\nexport class R {\n  @Get()\n  a() {}\n}\n")
        failures = self.failures()
        self.assertEqual(sorted(failures), ["S6"])  # the route is listed (S8 passes) but the vocabulary is still forbidden
        self.assertIn("_api_v1_rent", failures["S6"].detail)
        self.assertNotIn("_api_v1_me_rent", failures["S6"].detail)

    def test_S8_S11_cli_pending_fails_nonzero_for_approval_and_approved_fixture_passes(self):
        script = str(HERE / "verify_phase_scope.py")
        self.add_resident_self_routes()
        approved = subprocess.run([sys.executable, script, "--root", str(self.root)], capture_output=True, text=True)
        self.assertEqual(approved.returncode, 0, approved.stdout)
        self.pend()
        pending = subprocess.run([sys.executable, script, "--root", str(self.root)], capture_output=True, text=True)
        self.assertEqual(pending.returncode, 1)
        failing = sorted(line.split("\t")[1] for line in pending.stdout.splitlines() if line.startswith("FAIL"))
        self.assertEqual(failing, ["S11", "S8"])

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
        self.assertOnly("S11", "S2")

    def test_S11_missing_reference_file(self):
        self.manifest(lambda d: d["slices"]["2.2"].update(ref="docs/missing.md#x"))
        self.assertOnly("S11", "S2")

    def test_S11_missing_anchor(self):
        self.manifest(lambda d: d["slices"]["2.2"].update(ref=f"{APPROVED_REF}#no-such-heading"))
        self.assertOnly("S11", "S2")

    # S12 the guard's own tests exist for every rule
    def test_S12_missing_self_tests(self):
        self.write("scripts/test_phase_scope.py", "import unittest\n")
        self.assertOnly("S12")

    # S13 legacy guard integrity
    def test_S13_edited_legacy_guard(self):
        self.manifest(lambda d: d["legacyGuard"].update(retired=False))
        self.write("scripts/verify_m0_scope.py", "\n# one extra comment\n", "a")
        self.assertOnly("S13", "S14")

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
