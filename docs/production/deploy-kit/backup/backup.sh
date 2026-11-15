#!/usr/bin/env bash
# Nook logical backup: pg_dump -> age (client-side, public keys only) -> S3 (ap-south-1) with a SHA-256 manifest.
# Prepared and NOT deployed. Nothing here has uploaded anything. Secrets come only from Railway variables on the
# backup service; nothing is printed except sizes, hashes and object keys.
#
# Required variables
#   BACKUP_DB_HOST BACKUP_DB_PORT(5432) BACKUP_DB_NAME BACKUP_DB_USER BACKUP_DB_PASSWORD   the read-only nook_backup role
#   DB_CA_PEM                       pinned database CA (public); libpq verifies it with sslmode=verify-ca
#   AGE_RECIPIENTS                  one or more age PUBLIC keys, whitespace separated (the private keys stay offline)
#   S3_BUCKET  S3_PREFIX(daily)     AWS_REGION(ap-south-1) AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY   write-only uploader
# Optional
#   HEARTBEAT_URL                   pinged with a GET only after a verified upload (dead-man's switch for monitoring)
#   BACKUP_TMPDIR                   default /tmp
set -Eeuo pipefail
umask 077

fail() { echo "{\"level\":\"error\",\"message\":\"backup failed: $1\",\"context\":\"backup\"}" >&2; exit 1; }
need() { [ -n "${!1:-}" ] || fail "missing variable $1"; }

for v in BACKUP_DB_HOST BACKUP_DB_NAME BACKUP_DB_USER BACKUP_DB_PASSWORD DB_CA_PEM AGE_RECIPIENTS S3_BUCKET \
         AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY; do need "$v"; done
case "$BACKUP_DB_USER" in postgres|root|admin|nook_app|nook_migrator) fail "refusing to run as $BACKUP_DB_USER; use the read-only backup role";; esac
for tool in pg_dump psql age aws openssl sha256sum base64; do command -v "$tool" >/dev/null || fail "required tool missing: $tool"; done

work="$(mktemp -d "${BACKUP_TMPDIR:-/tmp}/nook-backup.XXXXXX")"
trap 'rm -rf "$work"' EXIT
printf '%s\n' "$DB_CA_PEM" > "$work/ca.pem"

export PGHOST="$BACKUP_DB_HOST" PGPORT="${BACKUP_DB_PORT:-5432}" PGDATABASE="$BACKUP_DB_NAME" PGUSER="$BACKUP_DB_USER"
export PGPASSWORD="$BACKUP_DB_PASSWORD" PGSSLMODE=verify-ca PGSSLROOTCERT="$work/ca.pem"
export AWS_DEFAULT_REGION="${AWS_REGION:-ap-south-1}"

# Server must be PostgreSQL 17 (a v17 client cannot dump a newer server) and the role must be read-only.
server_major="$(psql -X -At -c 'SHOW server_version_num' | cut -c1-2)"
[ "$server_major" = "17" ] || fail "unexpected server major version"
can_write="$(psql -X -At -c "SELECT has_table_privilege('audit_events','INSERT') OR has_table_privilege('payments','UPDATE')")"
[ "$can_write" = "f" ] || fail "the backup role has write privileges"

stamp="$(date -u +%Y%m%dT%H%M%SZ)"
name="nook-${stamp}.dump.age"
recipients=()
for key in $AGE_RECIPIENTS; do recipients+=(-r "$key"); done

# Dump straight into encryption: no plaintext dump is ever written to disk.
pg_dump --format=custom --serializable-deferrable --no-owner --no-acl | age "${recipients[@]}" -o "$work/$name"
[ -s "$work/$name" ] || fail "the encrypted dump is empty"

size="$(wc -c < "$work/$name" | tr -d ' ')"
sha="$(sha256sum "$work/$name" | cut -d' ' -f1)"
b64sha="$(openssl dgst -sha256 -binary "$work/$name" | base64 -w0)"
key="${S3_PREFIX:-daily}/$name"

# S3 recomputes the SHA-256 on upload and rejects a mismatch.
aws s3api put-object --bucket "$S3_BUCKET" --key "$key" --body "$work/$name" --checksum-sha256 "$b64sha" \
  --server-side-encryption AES256 --output text --query ETag >/dev/null
printf '{"object":"%s","bytes":%s,"sha256":"%s","server_version":"17","taken_at":"%s"}\n' "$key" "$size" "$sha" "$stamp" > "$work/manifest.json"
aws s3api put-object --bucket "$S3_BUCKET" --key "${key}.manifest.json" --body "$work/manifest.json" \
  --server-side-encryption AES256 --output text --query ETag >/dev/null

echo "{\"level\":\"info\",\"message\":\"backup uploaded\",\"object\":\"$key\",\"bytes\":$size,\"sha256\":\"$sha\",\"context\":\"backup\"}"
[ -z "${HEARTBEAT_URL:-}" ] || curl -fsS -m 10 "$HEARTBEAT_URL" >/dev/null || fail "heartbeat ping failed"
