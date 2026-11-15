-- One-time provisioning of the Nook production database. Run as the PostgreSQL superuser, interactively, AFTER the
-- three password verifiers have been generated locally with scram_verifier.py (the plaintext passwords never appear
-- here, in a command line or in a server log: only verifiers are sent).
--
-- In psql, first set the three variables (each value is the printed SCRAM-SHA-256$... string, in single quotes):
--   \set v_migrator 'SCRAM-SHA-256$4096:...'
--   \set v_app      'SCRAM-SHA-256$4096:...'
--   \set v_backup   'SCRAM-SHA-256$4096:...'
-- then paste this file. Nothing here touches existing databases other than creating `nook`.
\set ON_ERROR_STOP on

-- Refuse to continue unless all three variables are real SCRAM verifiers. A value that still carries its own quotes (for
-- example from `psql -v v_app="'SCRAM-SHA-256$...'"`) would otherwise be stored as a literal password nobody can use.
-- Set the variables with `\set` exactly as shown above, or pass `-v v_app=SCRAM-SHA-256$...` without extra quotes.
SELECT :'v_migrator' ~ '^SCRAM-SHA-256\$[0-9]+:[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$'
   AND :'v_app'      ~ '^SCRAM-SHA-256\$[0-9]+:[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$'
   AND :'v_backup'   ~ '^SCRAM-SHA-256\$[0-9]+:[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$' AS verifiers_ok \gset
\if :verifiers_ok
\else
  \echo 'STOP: v_migrator, v_app and v_backup must each be a SCRAM-SHA-256 verifier without surrounding quotes. Nothing was changed.'
  SELECT 1/0 AS stopped_because_verifiers_are_invalid;
\endif

CREATE ROLE nook_migrator LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD :'v_migrator';
CREATE ROLE nook_app      LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD :'v_app';
CREATE ROLE nook_backup   LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD :'v_backup';

CREATE DATABASE nook OWNER nook_migrator;
REVOKE ALL ON DATABASE nook FROM PUBLIC;
GRANT CONNECT ON DATABASE nook TO nook_app, nook_backup;

\connect nook
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO nook_app, nook_backup;

-- Afterwards (separate step, as nook_migrator after the migrations): grants.sql, then verify_privileges.sql (0 rows).
