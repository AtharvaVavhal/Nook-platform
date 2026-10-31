#!/usr/bin/env python3
"""Static checks for the reviewed Phase 2 initial migration."""
from pathlib import Path
import re
import sys


ROOT = Path(__file__).resolve().parents[1]
MIGRATION = ROOT / "prisma/migrations/20261031154500_slice_2_2_foundation/migration.sql"
TEXT = MIGRATION.read_text(encoding="utf-8") if MIGRATION.is_file() else ""
checks: list[tuple[str, bool]] = []


def check(name: str, condition: bool) -> None:
    checks.append((name, condition))


tables = [
    "organizations",
    "users",
    "memberships",
    "properties",
    "floors",
    "rooms",
    "beds",
    "sessions",
    "audit_events",
]
partial_indexes = {
    "properties_organization_id_code_active_key": 'ON "properties"("organization_id", "code")',
    "floors_property_id_ordinal_active_key": 'ON "floors"("property_id", "ordinal")',
    "floors_property_id_label_active_key": 'ON "floors"("property_id", "label")',
    "rooms_property_id_label_active_key": 'ON "rooms"("property_id", "label")',
    "beds_room_id_label_active_key": 'ON "beds"("room_id", "label")',
}

check("migration exists", MIGRATION.is_file())
check("migration is tagged for slice 2.2", TEXT.startswith("-- phase-scope: slice-2.2\n"))
check(
    "only approved tables are created",
    sorted(re.findall(r'CREATE TABLE "([^"]+)"', TEXT)) == sorted(tables),
)
check(
    "all approved partial indexes are present",
    all(
        f'CREATE UNIQUE INDEX "{name}"' in TEXT
        and definition in TEXT
        and 'WHERE "archived_at" IS NULL' in TEXT[
            TEXT.index(f'CREATE UNIQUE INDEX "{name}"') :
        ]
        for name, definition in partial_indexes.items()
    ),
)
check("no production seed data is present", not re.search(r"\bINSERT\s+INTO\b", TEXT, re.I))
check("no roles or grants are present", not re.search(r"\b(CREATE|ALTER)\s+ROLE\b|\bGRANT\b", TEXT, re.I))
check("no triggers or functions are present", not re.search(r"\b(CREATE|ALTER)\s+(TRIGGER|FUNCTION)\b", TEXT, re.I))
check("no extensions are created", not re.search(r"\bCREATE\s+EXTENSION\b", TEXT, re.I))
check("deferred row_version is absent", "row_version" not in TEXT)
check("deferred checks are absent", not re.search(r"\bCHECK\s*\(", TEXT, re.I))

for name, passed in checks:
    print(("PASS" if passed else "FAIL") + "\t" + name)

failed = [name for name, passed in checks if not passed]
print(f"SUMMARY\t{len(checks) - len(failed)}/{len(checks)} checks passed")
if failed:
    sys.exit(1)
