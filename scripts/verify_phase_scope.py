#!/usr/bin/env python3
"""Phase 2 scope guard: allow-lists exactly the approved scope and fails on everything else.

Run: python3 scripts/verify_phase_scope.py [--root DIR]

Rules S1-S14 are proven by scripts/test_phase_scope.py. The approved scope lives in
scripts/phase_scope.json. The legacy scripts/verify_m0_scope.py is never edited; rule S13
detects any change to it and rule S14 guarantees some guard always runs.
Static and pattern-based: it cannot prove an approval is genuine and cannot see semantic scope
creep inside an approved table. Human review and the isolation tests cover those.
"""
import argparse
import hashlib
import json
import re
import subprocess
import sys
from pathlib import Path
from typing import Callable, NamedTuple


class Result(NamedTuple):
    rule: str
    name: str
    ok: bool
    detail: str = ""


# ---------- helpers ----------

def slug(heading: str) -> str:
    heading = re.sub(r"[`*_]", "", heading.strip().lower())
    heading = re.sub(r"[^\w\- ]", "", heading, flags=re.UNICODE)
    return heading.replace(" ", "-")


def resolve_ref(root: Path, ref: str) -> tuple[bool, str]:
    """A reference is 'path' or 'path#anchor' and must resolve to an existing file and heading."""
    if not ref or not ref.strip():
        return False, "empty reference"
    path, _, anchor = ref.partition("#")
    file = root / path
    if not file.is_file():
        return False, f"missing file {path}"
    if anchor:
        headings = {slug(m) for m in re.findall(r"^#{1,6}\s+(.+)$", file.read_text(encoding="utf-8"), flags=re.M)}
        if anchor not in headings:
            return False, f"missing heading #{anchor} in {path}"
    return True, ""


def slice_complete(root: Path, s: dict) -> tuple[bool, str]:
    if s.get("status") != "approved":
        return False, "status is not 'approved'"
    for key in ("approver", "date", "ref"):
        if not str(s.get(key, "")).strip():
            return False, f"empty {key}"
    return resolve_ref(root, s["ref"])


def approved(root: Path, manifest: dict) -> dict:
    return {k: v for k, v in manifest.get("slices", {}).items() if slice_complete(root, v)[0]}


def union(slices: dict, key: str) -> set:
    return {x for s in slices.values() for x in s.get(key, [])}


def read(root: Path, rel: str) -> str:
    p = root / rel
    return p.read_text(encoding="utf-8", errors="replace") if p.is_file() else ""


def strip_prisma_comments(text: str) -> str:
    return "\n".join(line.split("//")[0] for line in text.splitlines())


def strip_sql(text: str) -> str:
    text = re.sub(r"--[^\n]*", "", text)
    text = re.sub(r"/\*.*?\*/", "", text, flags=re.S)
    return re.sub(r"'(?:[^']|'')*'", "''", text)


def words(token: str) -> set[str]:
    parts = [w.lower() for w in re.findall(r"[A-Z]?[a-z]+|[A-Z]+(?![a-z])|\d+", token.replace("_", " "))]
    out = set(parts)
    out |= {w[:-1] for w in parts if len(w) > 3 and w.endswith("s")}
    return out


def tokens(text: str) -> set[str]:
    return set(re.findall(r"[A-Za-z_][A-Za-z0-9_]*", text))


def migrations(root: Path) -> list[Path]:
    return sorted((root / "prisma/migrations").glob("*/migration.sql"))


def api_sources(root: Path) -> list[Path]:
    base = root / "apps/api/src"
    if not base.is_dir():
        return []
    return sorted(p for p in base.rglob("*.ts") if "generated" not in p.relative_to(base).parts)


def declared_routes(root: Path) -> set[str]:
    found = set()
    for f in api_sources(root):
        text = f.read_text(encoding="utf-8", errors="replace")
        prefix = re.search(r"@Controller\(\s*(?:'([^']*)'|\"([^\"]*)\")?\s*\)", text)
        if not prefix:
            continue
        base = (prefix.group(1) or prefix.group(2) or "").strip("/")
        for m in re.finditer(r"@(Get|Post|Put|Patch|Delete)\(\s*(?:'([^']*)'|\"([^\"]*)\")?\s*[,)]", text):
            sub = (m.group(2) or m.group(3) or "").strip("/")
            path = "/api/v1" + (f"/{base}" if base else "") + (f"/{sub}" if sub else "")
            found.add(f"{m.group(1).upper()} {path}")
    return found


# ---------- rules ----------

def s1(root, m):
    missing = [f for f in m["requiredFiles"] if not (root / f).is_file()]
    out = [Result("S1", "required files exist", not missing, ", ".join(missing))]
    out.append(Result("S1", "no real .env file", not (root / ".env").exists()))
    example = read(root, ".env.example")
    out.append(Result("S1", "env example uses local placeholder credentials",
                      "nook_local_only" in example and "localhost" in example))
    out.append(Result("S1", "no obsolete verify:docs reference", "docs/verify_reconciliation.py" not in read(root, "package.json")))
    corpus = (read(root, "docs/MILESTONE_0_SCOPE.md") + "\n" + read(root, "README.md")).lower()
    gone = [p for p in m["scopeDocPhrases"] if p not in corpus]
    out.append(Result("S1", "scope documents keep the resident-data and deployment exclusions", not gone, ", ".join(gone)))
    return out


def s2(root, m):
    schema = strip_prisma_comments(read(root, "prisma/schema.prisma"))
    declared = {(k, n) for k, n in re.findall(r"^\s*(model|enum|view|type)\s+(\w+)", schema, flags=re.M)}
    ok_slices = approved(root, m)
    allowed = union(ok_slices, "models") | union(ok_slices, "enums")
    extra = sorted(f"{k} {n}" for k, n in declared if n not in allowed)
    return [Result("S2", "schema declares only approved models, enums, views and types", not extra, ", ".join(extra))]


def s3(root, m):
    ok_slices = approved(root, m)
    tables, enums = union(ok_slices, "tables"), union(ok_slices, "enums")
    funcs, exts = union(ok_slices, "functions"), union(ok_slices, "extensions")
    ident = r'(?:"?\w+"?\.)?"?(\w+)"?'
    bad: list[str] = []
    for f in migrations(root):
        raw = f.read_text(encoding="utf-8", errors="replace")
        label = f.parent.name
        first = next((ln.strip() for ln in raw.splitlines() if ln.strip()), "")
        tag = re.match(r"^--\s*phase-scope:\s*slice-([\d.]+)\s*$", first)
        if not tag:
            bad.append(f"{label}: missing first-line '-- phase-scope: slice-<n>' tag")
        elif tag.group(1) not in ok_slices:
            bad.append(f"{label}: slice {tag.group(1)} is not approved")
        sql = strip_sql(raw)
        targets = []
        for pat in (rf"(?:CREATE|ALTER)\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:ONLY\s+)?{ident}",
                    rf"CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?\S+\s+ON\s+(?:ONLY\s+)?{ident}",
                    rf"CREATE\s+(?:CONSTRAINT\s+)?TRIGGER\s+\S+[^;]*?\sON\s+{ident}",
                    rf"CREATE\s+POLICY\s+\S+\s+ON\s+{ident}",
                    rf"GRANT\s+[^;]*?\sON\s+(?:TABLE\s+)?{ident}",
                    rf"REFERENCES\s+{ident}"):
            targets += re.findall(pat, sql, flags=re.I)
        bad += [f"{label}: table {t} is not approved" for t in sorted(set(targets) - tables)]
        for t in re.findall(rf"CREATE\s+TYPE\s+{ident}", sql, flags=re.I):
            if t not in enums:
                bad.append(f"{label}: type {t} is not approved")
        for fn in re.findall(rf"CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+{ident}", sql, flags=re.I):
            if fn not in funcs:
                bad.append(f"{label}: function {fn} is not approved")
        for ex in re.findall(rf"CREATE\s+EXTENSION\s+(?:IF\s+NOT\s+EXISTS\s+)?{ident}", sql, flags=re.I):
            if ex not in exts:
                bad.append(f"{label}: extension {ex} is not approved")
    return [Result("S3", "migration SQL touches only approved objects and is slice-tagged", not bad, "; ".join(bad))]


def s4(root, m):
    destructive = re.compile(
        r"\bDROP\s+(?:TABLE|COLUMN|TYPE)\b|\bTRUNCATE\b|\bDELETE\s+FROM\b|\bALTER\s+COLUMN\b[^;]*?\bTYPE\b", re.I)
    bad = []
    for f in migrations(root):
        raw = f.read_text(encoding="utf-8", errors="replace")
        if not destructive.search(strip_sql(raw)):
            continue
        marker = re.search(r"^--\s*destructive-approved:\s*(\S+)", raw, flags=re.M)
        ok, why = resolve_ref(root, marker.group(1)) if marker else (False, "no '-- destructive-approved: <ref>' marker")
        if not ok:
            bad.append(f"{f.parent.name}: destructive SQL without a resolvable approval ({why})")
    return [Result("S4", "no destructive migration SQL without an approved reference", not bad, "; ".join(bad))]


def s5(root, m):
    if not (root / ".git").exists():
        return [Result("S5", "committed migrations are immutable", True, "WARN: not a git checkout, skipped")]
    try:
        head = subprocess.run(["git", "-C", str(root), "rev-parse", "--verify", "-q", "HEAD"], capture_output=True)
        if head.returncode != 0:
            return [Result("S5", "committed migrations are immutable", True, "WARN: no commits yet, skipped")]
        diff = subprocess.run(["git", "-C", str(root), "diff", "--name-status", "HEAD", "--", "prisma/migrations"],
                              capture_output=True, text=True, check=True).stdout.splitlines()
    except (OSError, subprocess.CalledProcessError) as exc:
        return [Result("S5", "committed migrations are immutable", False, f"git failed: {exc}")]
    bad = [ln for ln in diff if not ln.startswith("A")]
    return [Result("S5", "committed migrations are immutable (only additions)", not bad, "; ".join(bad))]


def s6(root, m):
    forbidden = set(m["forbiddenWords"])
    allowed = set(m.get("allowedIdentifiers", []))
    hits: list[str] = []

    def scan(source: str, toks: set[str]):
        for t in sorted(toks - allowed):
            bad = words(t) & forbidden
            if bad:
                hits.append(f"{source}: {t} ({', '.join(sorted(bad))})")

    scan("schema", tokens(strip_prisma_comments(read(root, "prisma/schema.prisma"))))
    for f in migrations(root):
        scan(f"migration {f.parent.name}", tokens(strip_sql(f.read_text(encoding='utf-8', errors='replace'))))
    base = root / "apps/api/src"
    for f in api_sources(root):
        scan(f"file {f.relative_to(base)}", tokens("_".join(f.relative_to(base).parts)))
    for route in declared_routes(root):
        scan(f"route {route}", tokens(route.split(" ", 1)[1].replace("/", "_")))
    return [Result("S6", "no forbidden domain vocabulary in schema, SQL, files or routes", not hits, "; ".join(hits[:6]))]


def s7(root, m):
    found = sorted(set(re.findall(r"\b(Decimal|Float|Money)\b", strip_prisma_comments(read(root, "prisma/schema.prisma")))))
    return [Result("S7", "schema uses no Decimal, Float or Money types", not found, ", ".join(found))]


def s8(root, m):
    allowed = set(m["baselineRoutes"]) | union(approved(root, m), "routes")
    extra = sorted(declared_routes(root) - allowed)
    return [Result("S8", "API routes are all in the approved route list", not extra, ", ".join(extra))]


def s9(root, m):
    allowed = set(m.get("rawSqlAllowedFiles", []))
    base = root / "apps/api/src"
    bad = [str(f.relative_to(base)) for f in api_sources(root)
           if re.search(r"\$(?:query|execute)Raw(?:Unsafe)?\b", f.read_text(encoding="utf-8", errors="replace"))
           and str(f.relative_to(root)) not in allowed]
    return [Result("S9", "no raw SQL calls outside approved files", not bad, ", ".join(bad))]


def s10(root, m):
    problems = []
    additions = {(a["file"], a["name"]): a for a in m.get("approvedDependencyAdditions", [])}
    patterns = [re.compile(p, re.I) for p in m["forbiddenDependencyPatterns"]]
    for rel, baseline in m["dependencies"].items():
        pkg_path = root / rel
        if not pkg_path.is_file():
            continue
        data = json.loads(pkg_path.read_text(encoding="utf-8"))
        current: dict[str, str] = {}
        for sec in ("dependencies", "devDependencies", "optionalDependencies"):
            current.update(data.get(sec, {}))
        for name, version in sorted(current.items()):
            if any(p.search(name) for p in patterns):
                problems.append(f"{rel}: {name} matches a forbidden SDK pattern")
            if re.search(r"[\^~<>*]|\bx\b|latest|\|\|", version):
                problems.append(f"{rel}: {name} {version} is not an exact pin")
            add = additions.get((rel, name))
            if add:
                ok, why = resolve_ref(root, add["ref"])
                if version != add["version"] or not ok:
                    problems.append(f"{rel}: approved addition {name} mismatch ({version} vs {add['version']}; {why or 'ok'})")
            elif baseline.get(name) != version:
                problems.append(f"{rel}: {name} {version} is not in the approved baseline")
        for name in baseline:
            if name not in current:
                problems.append(f"{rel}: baseline dependency {name} was removed")
    return [Result("S10", "dependencies match the approved baseline, exact pins, no payment or messaging SDKs", not problems, "; ".join(problems[:6]))]


def s11(root, m):
    bad = []
    for name, s in m.get("slices", {}).items():
        ok, why = slice_complete(root, s)
        if not ok:
            bad.append(f"slice {name}: {why}")
    return [Result("S11", "every approved slice has an approver, date and resolvable reference", not bad, "; ".join(bad))]


def s12(root, m):
    text = read(root, "scripts/test_phase_scope.py")
    missing = [f"S{n}" for n in range(1, 15) if not re.search(rf"def test_S{n}_", text)]
    return [Result("S12", "self-tests exist for every rule S1-S14", not missing, ", ".join(missing))]


def s13(root, m):
    lg = m["legacyGuard"]
    if lg.get("retired"):
        ok, why = resolve_ref(root, lg.get("replacementRef", ""))
        return [Result("S13", "legacy guard retirement is approved", ok, why)]
    p = root / lg["path"]
    if not p.is_file():
        return [Result("S13", "legacy guard exists", False, "missing")]
    digest = hashlib.sha256(p.read_bytes()).hexdigest()
    return [Result("S13", "legacy guard is unmodified", digest == lg["sha256"], "" if digest == lg["sha256"] else "hash differs")]


def s14(root, m):
    try:
        scripts = json.loads(read(root, "package.json")).get("scripts", {})
    except json.JSONDecodeError:
        scripts = {}
    ci = read(root, ".github/workflows/ci.yml")
    retired = m["legacyGuard"].get("retired")
    problems = []
    if "verify:scope" not in scripts:
        problems.append("package.json has no verify:scope script")
    if not retired and "verify:m0-scope" not in scripts:
        problems.append("package.json lost verify:m0-scope")
    i_self = ci.find("unittest scripts/test_phase_scope.py")
    i_guard = ci.find("npm run verify:scope")
    i_prisma = ci.find("prisma:validate")
    if i_self < 0:
        problems.append("CI does not run the guard self-tests")
    if i_guard < 0:
        problems.append("CI does not run verify:scope")
    if i_self >= 0 and i_guard >= 0 and i_self > i_guard:
        problems.append("CI runs the guard before its self-tests")
    if i_guard >= 0 and i_prisma >= 0 and i_guard > i_prisma:
        problems.append("CI runs the guard after Prisma checks")
    if not retired and "npm run verify:m0-scope" not in ci:
        problems.append("CI no longer runs the legacy guard")
    return [Result("S14", "a guard always runs, self-tests first, before model checks", not problems, "; ".join(problems))]


RULES: list[Callable] = [s1, s2, s3, s4, s5, s6, s7, s8, s9, s10, s11, s12, s13, s14]


def run_checks(root: Path) -> list[Result]:
    root = Path(root)
    manifest_path = root / "scripts/phase_scope.json"
    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        return [Result("S11", "manifest scripts/phase_scope.json is readable", False, str(exc))]
    results: list[Result] = []
    for rule in RULES:
        results.extend(rule(root, manifest))
    return results


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--root", default=str(Path(__file__).resolve().parents[1]))
    args = parser.parse_args(argv[1:])
    results = run_checks(Path(args.root))
    for r in results:
        print(("PASS" if r.ok else "FAIL") + f"\t{r.rule}\t{r.name}" + (f"\t{r.detail}" if r.detail else ""))
    failed = [r for r in results if not r.ok]
    print(f"SUMMARY\t{len(results) - len(failed)}/{len(results)} checks passed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
