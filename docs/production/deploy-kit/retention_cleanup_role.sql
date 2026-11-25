-- REVIEW TEMPLATE for the resident sign-in retention cleanup role (owner decision OD-04, 2026-11-22). NOT EXECUTED anywhere.
-- Run only through a separately authorized operator procedure, as the superuser, after the OTP migration exists, with the
-- password supplied as a SCRAM verifier (see provision.sql and scram_verifier.py). It never appears in this file.
--
-- nook_cleanup may SELECT and DELETE on exactly the three resident sign-in tables and nothing else. It cannot touch audit_events,
-- accounts, finance data or the migration ledger. The runtime role nook_app keeps NO DELETE privilege (grants.sql is unchanged).
\set ON_ERROR_STOP on

CREATE ROLE nook_cleanup LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD :'v_cleanup';
GRANT CONNECT ON DATABASE nook TO nook_cleanup;
GRANT USAGE ON SCHEMA public TO nook_cleanup;
GRANT SELECT, DELETE ON TABLE public.resident_otp_challenges, public.resident_sessions, public.resident_auth_throttles TO nook_cleanup;
-- Needs a verification query (to be added to verify_privileges.sql when this is approved): nook_cleanup has no other table
-- privilege, no CREATE, no ownership, and no membership in any role.
