#!/usr/bin/env python3
"""Refuse any database URL that is not the project's own loopback database.

Run before migrations, seeds or other tooling that writes to a database:
    python3 scripts/db_guard.py [URL]      # defaults to $DATABASE_URL

It only parses the URL. It never connects to anything and never prints the password.
Exit 0 = allowed, exit 1 = refused (with reasons).
"""
import os
import re
import sys
from urllib.parse import parse_qs, urlsplit

ALLOWED_SCHEMES = {"postgres", "postgresql"}
ALLOWED_HOSTS = {"127.0.0.1", "localhost"}
# The project's own database is published on loopback port 5433. Port 5432 is reserved for an
# unrelated PostgreSQL on developer machines and must never be used by this project's tooling.
ALLOWED_PORT = 5433
FORBIDDEN_PORT = 5432
DATABASE_NAME = re.compile(r"^nook_(dev|test)$")
# libpq lets these query parameters silently override the host, port or database in the URL.
OVERRIDING_PARAMS = {"host", "hostaddr", "port", "dbname", "service", "servicefile", "passfile"}


def check(url: str) -> list[str]:
    """Return the reasons the URL is refused; an empty list means it is allowed."""
    if not url or not url.strip():
        return ["DATABASE_URL is empty or not set"]
    try:
        parts = urlsplit(url.strip())
        port = parts.port
        host = parts.hostname
    except ValueError:
        return ["URL is malformed"]
    reasons: list[str] = []
    if parts.scheme not in ALLOWED_SCHEMES:
        reasons.append("scheme must be postgres:// or postgresql://")
    if host not in ALLOWED_HOSTS:
        reasons.append("host must be 127.0.0.1 or localhost (loopback only)")
    if port is None:
        reasons.append(f"port must be given explicitly ({ALLOWED_PORT})")
    elif port == FORBIDDEN_PORT:
        reasons.append("port 5432 is refused: it may belong to an unrelated PostgreSQL")
    elif port != ALLOWED_PORT:
        reasons.append(f"only the project port {ALLOWED_PORT} is permitted")
    name = parts.path.lstrip("/")
    if not DATABASE_NAME.match(name):
        reasons.append("database name must be nook_dev or nook_test")
    overriding = sorted(OVERRIDING_PARAMS & {k.lower() for k in parse_qs(parts.query)})
    if overriding:
        reasons.append("query parameters may not override the target: " + ", ".join(overriding))
    return reasons


def main(argv: list[str]) -> int:
    url = argv[1] if len(argv) > 1 else os.environ.get("DATABASE_URL", "")
    reasons = check(url)
    if reasons:
        print("REFUSE: database URL is not the project's loopback database")
        for reason in reasons:
            print(f"  - {reason}")
        return 1
    print("ALLOW: loopback project database")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
