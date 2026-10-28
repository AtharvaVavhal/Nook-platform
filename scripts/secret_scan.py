#!/usr/bin/env python3
"""Small baseline scanner for obvious committed secrets; not a replacement for a dedicated scanner."""
from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parents[1]
EXCLUDED = {'.git', 'node_modules', 'dist', 'coverage'}
PATTERNS = [
    re.compile(r'(?i)\bAKIA[0-9A-Z]{16}\b'),
    re.compile(r'(?i)\b(?:ghp|github_pat)_[A-Za-z0-9_]{20,}\b'),
    re.compile(r'(?i)\bsk_live_[A-Za-z0-9]{12,}\b'),
    re.compile(r'(?i)-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----'),
]
# Local-only placeholder credentials in .env.example/docker-compose are explicitly allowed.
ALLOW_FILES = {'.env.example', 'docker-compose.yml'}
violations = []
for path in ROOT.rglob('*'):
    if not path.is_file() or any(part in EXCLUDED for part in path.parts):
        continue
    if path.suffix in {'.png', '.jpg', '.jpeg', '.zip', '.lock'}:
        continue
    try:
        content = path.read_text(errors='ignore')
    except OSError:
        continue
    for pattern in PATTERNS:
        if pattern.search(content):
            violations.append(str(path.relative_to(ROOT)))
            break
if violations:
    print('Potential hard-coded secret patterns found in: ' + ', '.join(violations))
    sys.exit(1)
print('PASS: no known high-signal secret patterns found (baseline scanner only).')
