#!/bin/sh
# Makes PostgreSQL reject network connections that do not use TLS, by adding the rule
#
#     hostnossl all all all reject
#
# to pg_hba.conf in the one place where it is both effective and safe, then proving it through pg_hba_file_rules.
# Run it INSIDE the PostgreSQL container as the superuser's OS context (for example through the platform's remote shell).
#
#   sh require_tls.sh            apply (idempotent), validate, roll back by itself on any error
#   sh require_tls.sh --check    report only; changes nothing; exit 0 only if the rule is active and correctly placed
#   sh require_tls.sh --rollback restore the pg_hba.conf saved before the first change and reload
#
# Where the rule goes, and why:
#   * `hostnossl` matches only TCP connections WITHOUT TLS. Unix-socket (`local`) connections can never match it, so
#     administration through the local socket is unaffected wherever the rule sits.
#   * It goes AFTER the `local` rules and the loopback rules (127.0.0.1, ::1), and BEFORE the first rule that admits
#     any other address (the catch-all `host all all all <method>`). Loopback stays usable inside the container;
#     every network client (the API, the migration job, anything on the private network) must use TLS.
#   * Connections over TLS still match the original `host` rule and still need a valid password (scram-sha-256).
# Safety: the previous file is saved once as pg_hba.conf.pre-nook-tls; the script refuses to start if pg_hba_file_rules
# already reports errors; after the reload it re-reads pg_hba_file_rules and restores the saved file if anything is wrong.
# (PostgreSQL itself keeps the old rules if a new file cannot be parsed, so a reload cannot lock anyone out.)
set -eu

MODE="${1:-apply}"
RULE='hostnossl all all all reject'
PSQL="psql -w -P pager=off -X -At -U ${PGUSER:-postgres} -d postgres"

q() { $PSQL -c "$1"; }
fail() { echo "STOP: $1" >&2; exit 1; }

# Replace pg_hba.conf atomically: stage a copy in the same directory (cp -p keeps owner and mode), fill it, then rename it
# over the original. A failure at any step leaves the original file untouched and removes the staged copy.
write_hba() {
  _stage="${HBA}.nook-new.$$"
  if cp -p "$HBA" "$_stage" && cat "$1" > "$_stage" && mv -f "$_stage" "$HBA"; then return 0; fi
  rm -f "$_stage"; return 1
}
# Put the saved file back and reload. Never aborts half way: every step is reported, and a failure to restore is loud.
restore_and_fail() {
  echo "$1; restoring the previous file" >&2
  if write_hba "$BACKUP"; then
    q "SELECT pg_reload_conf()" >/dev/null 2>&1 || echo "WARNING: could not reload after restoring; run SELECT pg_reload_conf() yourself" >&2
    sleep 1; show_rules 2>/dev/null || true
    fail "the change was undone; the previous pg_hba.conf is back in place"
  fi
  echo "CRITICAL: could not restore $HBA; copy $BACKUP over it by hand and run SELECT pg_reload_conf()" >&2
  exit 2
}

command -v psql >/dev/null 2>&1 || fail "psql is not available in this container"
HBA="$(q 'SHOW hba_file')" || fail "cannot read hba_file (is this the database container and is the superuser reachable over the local socket?)"
[ -f "$HBA" ] || fail "hba_file $HBA not found"
BACKUP="${HBA}.pre-nook-tls"

errors() { q "SELECT count(*) FROM pg_hba_file_rules WHERE error IS NOT NULL"; }
# rules that come from an included file (include / include_dir / include_if_exists): this script cannot prove ordering across files
includes() { q "SELECT count(*) FROM pg_hba_file_rules WHERE file_name <> current_setting('hba_file')"; }
active_rule_line() {
  q "SELECT line_number FROM pg_hba_file_rules WHERE file_name = current_setting('hba_file') AND type = 'hostnossl' AND database = '{all}' AND user_name = '{all}' AND address = 'all' AND auth_method = 'reject' AND error IS NULL ORDER BY line_number LIMIT 1"
}
# the first line (by file order) of a rule that admits a non-loopback network address
first_open_line() {
  q "SELECT line_number FROM pg_hba_file_rules WHERE file_name = current_setting('hba_file') AND type IN ('host','hostssl','hostnossl','hostgssenc','hostnogssenc') AND error IS NULL AND (address IS NULL OR address NOT IN ('127.0.0.1','::1','localhost')) ORDER BY line_number LIMIT 1"
}
show_rules() {
  echo "pg_hba_file_rules (line | type | database | user | address | method | error):"
  q "SELECT line_number || ' | ' || type || ' | ' || database::text || ' | ' || user_name::text || ' | ' || coalesce(address,'') || ' | ' || auth_method || ' | ' || coalesce(error,'') FROM pg_hba_file_rules ORDER BY line_number" | sed 's/^/  /'
}
verdict() {
  if [ "$(includes)" != "0" ]; then echo "RESULT: pg_hba.conf uses include directives; the position of the rule across files cannot be proven by this script"; return 1; fi
  rule="$(active_rule_line)"; open="$(first_open_line)"
  if [ -z "$rule" ]; then echo "RESULT: the rule is NOT active"; return 1; fi
  # the rule must come before every rule that admits a non-loopback address (other than itself)
  other="$(q "SELECT line_number FROM pg_hba_file_rules WHERE file_name = current_setting('hba_file') AND type IN ('host','hostssl','hostnossl','hostgssenc','hostnogssenc') AND error IS NULL AND (address IS NULL OR address NOT IN ('127.0.0.1','::1','localhost')) AND NOT (type = 'hostnossl' AND auth_method = 'reject') ORDER BY line_number LIMIT 1")"
  if [ -n "$other" ] && [ "$rule" -gt "$other" ]; then echo "RESULT: the rule is active but sits AFTER an open rule (line $other); it would never match"; return 1; fi
  if [ "$(errors)" != "0" ]; then echo "RESULT: pg_hba_file_rules reports errors"; return 1; fi
  echo "RESULT: OK - non-TLS network connections are rejected (rule at line $rule)"
}

case "$MODE" in
  --check)
    show_rules; verdict; exit $? ;;
  --rollback)
    [ -f "$BACKUP" ] || fail "no saved file $BACKUP; nothing to roll back"
    write_hba "$BACKUP" || fail "could not restore $BACKUP (pg_hba.conf was not changed)"
    q "SELECT pg_reload_conf()" >/dev/null || fail "restored the file but could not reload; run SELECT pg_reload_conf()"
    sleep 1; echo "restored $BACKUP"; show_rules; exit 0 ;;
  apply) ;;
  *) fail "usage: sh require_tls.sh [--check | --rollback]" ;;
esac

[ "$(errors)" = "0" ] || { show_rules; fail "pg_hba_file_rules already reports errors; fix them first (nothing was changed)"; }
[ "$(includes)" = "0" ] || fail "pg_hba.conf uses include directives; add the rule by hand in the right place (before every rule that admits a non-loopback address) and check it with --check (nothing was changed)"
if [ -n "$(active_rule_line)" ]; then echo "the rule is already present"; show_rules; verdict; exit $?; fi

[ -f "$BACKUP" ] || cp -p "$HBA" "$BACKUP"
t0="$(q 'SELECT clock_timestamp()')"
target="$(first_open_line)"
tmp="$(mktemp)"; trap 'rm -f "$tmp" "${HBA}.nook-new.$$"' EXIT INT TERM
if [ -n "$target" ]; then
  awk -v n="$target" -v rule="$RULE" 'NR == n { print rule } { print }' "$HBA" > "$tmp"
else
  { cat "$HBA"; echo "$RULE"; } > "$tmp"
fi
write_hba "$tmp" || fail "could not write pg_hba.conf (nothing was changed)"
q "SELECT pg_reload_conf()" >/dev/null || restore_and_fail "the reload failed"
# pg_hba_file_rules reads the file from disk; also prove the running server reloaded it after our change
loaded=f; i=0
while [ "$i" -lt 10 ]; do
  [ "$(q "SELECT pg_conf_load_time() >= timestamptz '$t0'")" = "t" ] && { loaded=t; break; }
  sleep 1; i=$((i + 1))
done

if [ "$loaded" = "t" ] && verdict >/dev/null 2>&1; then
  show_rules; verdict
  echo "saved the previous file as $BACKUP (restore with: sh require_tls.sh --rollback)"
  echo "now prove it from a client on the private network: a plaintext attempt (PGSSLMODE=disable) must fail with 'no encryption'"
  exit 0
fi
restore_and_fail "validation failed after the change"
