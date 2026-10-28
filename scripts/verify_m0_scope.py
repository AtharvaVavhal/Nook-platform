#!/usr/bin/env python3
"""Static checks that the scaffold remains within the approved Milestone 0 boundary."""
from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parents[1]
checks: list[tuple[str, bool, str]] = []

def check(name: str, condition: bool, detail: str = "") -> None:
    checks.append((name, bool(condition), detail))

required = [
    "README.md",
    ".env.example",
    ".gitignore",
    "docker-compose.yml",
    ".github/workflows/ci.yml",
    "apps/api/src/main.ts",
    "apps/api/src/config.ts",
    "apps/api/src/health.controller.ts",
    "apps/api/src/database/database.service.ts",
    "apps/web/src/main.tsx",
    "apps/web/src/tokens.css",
    "prisma/schema.prisma",
    "docs/MILESTONE_0_SCOPE.md",
    "scripts/secret_scan.py",
]
for rel in required:
    check(f"required file exists: {rel}", (ROOT / rel).is_file())

schema = (ROOT / "prisma/schema.prisma").read_text()
check("Prisma schema has no domain models", re.search(r"(?m)^\s*model\s+\w+", schema) is None)
migrations = ROOT / "prisma/migrations"
check("No schema migrations are present in M0", not migrations.exists() or not any(migrations.rglob("migration.sql")))

scope = (ROOT / "docs/MILESTONE_0_SCOPE.md").read_text()
readme = (ROOT / "README.md").read_text()
guardrail_text = (scope + "\n" + readme).lower()
for label, phrase in [
    ("real resident data is excluded", "real resident data"),
    ("production deployment is excluded", "production deployment"),
    ("domain models/schema are intentionally absent", "no domain models or migrations"),
]:
    check(f"M0 guardrail documented: {label}", phrase in guardrail_text)

example = (ROOT / ".env.example").read_text()
check("Environment example uses local placeholder database credentials", "nook_local_only" in example and "localhost" in example)
check("No real .env file is present", not (ROOT / ".env").exists())
package = (ROOT / "package.json").read_text()
check("No obsolete verify:docs command points to a missing file", "docs/verify_reconciliation.py" not in package)

failed = [name for name, ok, _ in checks if not ok]
for name, ok, detail in checks:
    print(("PASS" if ok else "FAIL") + "\t" + name + ("\t" + detail if detail else ""))
print(f"SUMMARY\t{len(checks) - len(failed)}/{len(checks)} checks passed")
if failed:
    sys.exit(1)
