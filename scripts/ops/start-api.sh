#!/bin/sh
# Production start command for the API on Railway.
#
# Railway has no file mounts, so the database's pinned CA certificate (public, not a secret) arrives in the DB_CA_PEM
# variable and is written to the path that DATABASE_URL names in its sslrootcert parameter. The API itself then
# refuses to start unless that URL demands verified TLS and the file is a readable PEM certificate (apps/api/src/config.ts),
# so a missing or empty variable here can only ever stop the service, never weaken the connection.
#
#   start command:  sh scripts/ops/start-api.sh
#   DATABASE_URL:   postgresql://nook_app:<password>@<private-host>:5432/nook?uselibpqcompat=true&sslmode=verify-ca&sslrootcert=/tmp/db-ca.pem
set -eu

CA_FILE="${DB_CA_FILE:-/tmp/db-ca.pem}"

if [ -z "${DB_CA_PEM:-}" ]; then
  echo '{"level":"error","message":"DB_CA_PEM is not set; the API will not start without the pinned database CA","context":"bootstrap"}' >&2
  exit 1
fi

umask 077
printf '%s\n' "$DB_CA_PEM" > "$CA_FILE"
# The certificate text is not needed again; do not leave it in the environment of the long-running process.
unset DB_CA_PEM

exec node apps/api/dist/main.js
