# Founding-hostel pilot: account provisioning and password requirements

Status: **requirements, not implemented.** This lists the minimum needed for one real hostel (one organization,
a handful of staff). It deliberately excludes anything a single-hostel pilot can run without.

## What exists today (verified in code, 2026-11-02)

- Passwords are hashed with scrypt and compared in constant time. Unknown e-mails are verified against a dummy hash,
  so response timing does not reveal which accounts exist.
- Login requires an ACTIVE user, an ACTIVE membership and an ACTIVE organization. Sessions last at most 8 hours
  with an idle timeout, are revocable in the database, and the cookie is HttpOnly and SameSite=Strict. The Secure
  flag follows the runtime configuration.
- Sign-in, sign-out, session expiry handling and route protection exist in the web app.

## What does not exist

1. No way to create an organization, a user or a membership except hand-written SQL.
2. No way for a user to change their password, and no way to reset one.
3. No way to revoke a person's access except editing the database (and their live session keeps working until it
   ends unless it is also revoked).
4. **No login throttling or lockout.** An attacker can try passwords without limit.
5. **No audit events for authentication** (login success or failure, sign-out, password changes, provisioning).

## Minimum requirements for the pilot

Must have before the pilot is reachable from the internet:

- **R1 Login throttling.** Limit failed sign-ins per account and per source address (for example 5 failures in
  15 minutes, then a cooling-off period), persisted so a restart does not reset it, with a neutral message that
  does not reveal whether the account exists.
- **R2 Authentication audit trail.** Record successful and failed sign-ins, sign-outs, password changes and resets,
  provisioning and access revocation in `audit_events`, never storing passwords or hashes.
- **R3 Operator provisioning procedure.** One reviewed, repeatable procedure (a script run by the operator with the
  migrator credential, not a public endpoint) that creates the organization, the owner user and the membership,
  generates a random temporary password, shows it once to the operator and never logs or stores it in clear text.
- **R4 Change own password.** An authenticated endpoint and screen: current password, new password (minimum
  12 characters), CSRF protected, revokes the user's other sessions, writes an audit event. The first sign-in with a
  temporary password must be followed by this step.
- **R5 Operator-initiated reset.** The same script path can set a new temporary password for a named user and
  revoke all of that user's sessions, with an audit event. An e-mail based self-service reset is not needed for one
  hostel and is deferred.
- **R6 Revoke access.** A procedure that marks a membership REVOKED and revokes the person's live sessions
  immediately, with an audit event.

Should have, but not blocking the first pilot week:

- A visible account page (name, organization, role, sign-out everywhere).
- Documented password policy and a break-glass recovery procedure for a locked-out owner.

Deferred (not required for one hostel): e-mail self-service reset, multi-factor authentication, single sign-on,
invitation links, role management screens, multiple organizations per user.

## Operational prerequisites

- Serve the web app and API over HTTPS only, with the Secure cookie flag on (production configuration).
- Never reuse the development database credentials; the pilot uses its own migrator and runtime roles.
- Keep the temporary-password hand-off out of chat and e-mail (in person or a one-time secret channel).
