# Slice 2.2 — Owner review: decision register and execution authorization draft (package revision 2)

**Status:** review draft for the owner, updated 2026-10-29 for **package revision 2**. **Nothing in this document is approved.** Every `APPROVE` / `REJECT` / `DEFER` field is left empty on purpose, the authorization in section 6 is a **draft, not an authorization**, and nothing was executed to prepare it or the package: no database connection, no SQL, no Docker or network operation, no Prisma command, no Git operation, no stage of the disposable test runner.
**Companions:** [Decision log](PHASE_2_DECISION_LOG.md) (§4B records the twelve decisions approved _for planning only_) · [Disposable test plan](PHASE_2_SLICE_2_2_DISPOSABLE_TEST_PLAN.md) · [Test package README](disposable-test/README.md) · [Slice 2.2 implementation plan](PHASE_2_SLICE_2_2_IMPLEMENTATION_PLAN.md).
**What changed since the first version of this document:** the runner and README were revised (see section 4). The SQL, test, Node and drift files are byte-identical, so the privilege matrix (`R-4`) did not change.
**Revision 3 note (2026-10-29): this register and its section 6 draft describe package revision 2 only, which is preserved unchanged as evidence and is not the package proposed for execution.** An isolated package, **revision 3**, now exists in [`disposable-test-v3/`](disposable-test-v3/README.md) and has its own register: [OWNER_REVIEW_ISOLATED_ENVIRONMENT.md](OWNER_REVIEW_ISOLATED_ENVIRONMENT.md). There, `R-1` is answered by `I-1` and `R-2` is replaced by `I-4`/`I-5` (all still unapproved); `R-3` to `R-7` and `R-9` are carried over, `R-15` and `R-16` are re-asked for revision 3, and the authorization draft in section 6 and the manifest hash in section 5 below **must not be used to authorize revision 3**. Nothing in this document is approved, and nothing was executed.

How to answer: for each decision tick **one** box in its field. A recommendation is my reading, not a decision. If a box is left empty the item stays unresolved and, where marked "required before the test", execution stays blocked.

## 1. Where things stand

### 1.1 Already approved _for planning only_ (decision log §4B; unchanged by this document)

`Q-1` legacy-guard retirement · `Q-2` organisation status values · `Q-4` partial uniqueness _in principle_ · `Q-4b` _evaluate_ the preview `partialIndexes` feature · `Q-5` initial fields · `Q-6` audit privileges `INSERT`/`SELECT` for the runtime role · `Q-7` separate provisioning of roles and grants · `N-1` no `DELETE` on business tables · `N-2` user and membership status values · `N-3` migrator owns tables · `N-4` PostgreSQL CI job with the first migration · `N-6` login normalisation. Their caveats (exact scopes, exact grants, lifecycle semantics) are **still open** and are not changed here. Production implementation is **not** authorized.

### 1.2 Decisions essential before the disposable test can be authorized

`R-1` cluster-level access · `R-2` the admin provisioning exception · `R-3` temporary migrator password · `R-4` privilege matrix · `R-5` `sessions` deletion · `R-6` `TEMP` · `R-7` informational tests · `R-9` acknowledgement of the audit limit · `R-15` the revised runner-enforced controls · `R-16` the authorization itself (section 6).

### 1.3 Decisions that can safely wait until production schema design

`R-8` second-run migration test · `R-10` initial fields · `R-11` read-only role · `R-12` migration-generation method · `R-13` per-entity uniqueness and the preview feature · `R-14a`–`R-14i` the remaining items.

## 2. Decisions essential before the test

### R-1 — Cluster-level access of the two disposable roles

**Question.** `nook_migrator_test` and `nook_app_test` are cluster roles. With default privileges, `PUBLIC` holds `CONNECT` on every database whose access list is unchanged, so these roles can probably connect to `nook_dev` and `postgres` for the minutes they exist. Do you accept that, or require another design?
**Facts.** No stage connects to either database with them; they hold no table privileges there; the runner records `nook_dev`'s oid, access list and connect flag before and after and fails if they change; the roles are dropped by identity. **New in revision 2:** after each stage that uses the roles, and at the start of cleanup, the runner reads `pg_stat_activity` through the admin path (a catalogue read; it connects to nothing it should not) and saves `out/role_sessions_<label>.txt`. A session of a disposable role on any database other than `nook_test` creates `EXPOSURE_OBSERVED.flag` and makes `report` fail. **This is a point-in-time view only:** a connection that opened and closed between snapshots is invisible, and this package cannot see connection history. Whether `nook_dev`'s access list is currently the default is **not verified**, and `nook_dev` is expected to be empty but that is not verified either.
**Options.**

- **A. Accept the bounded exposure** for the run window, with the controls above. The exposure is _observed at snapshot points_, not eliminated; the roles still have `CONNECT`.
- **B. Mitigate by revoking `PUBLIC` `CONNECT`** on `nook_dev` and `postgres`. Rejected by the task rules (it modifies protected databases' grants). Not proposed.
- **C. Mitigate in `pg_hba.conf`.** Changes cluster configuration. Not proposed.
- **D. A design that grants no new access to protected databases:** a throwaway disposable PostgreSQL container (not the Nook container), needing a new package, port and hash, which the earlier approval of "option A" for the existing container did not cover. **Option D is now designed in [the isolated environment plan](PHASE_2_SLICE_2_2_ISOLATED_TEST_ENVIRONMENT_PLAN.md) and its [decision register](OWNER_REVIEW_ISOLATED_ENVIRONMENT.md); nothing is approved.**

**Recommendation.** No mitigation can be established without touching protected databases or cluster configuration, so **execution remains blocked until you choose A or D.** Option D is the only one that truly avoids the access; A is the practical, bounded one, and revision 2 makes it observable. **Unresolved risk if A:** a short-lived connection between snapshots would go unseen.
**Required before the test:** yes.
**Owner decision:** `[ ] APPROVE option ___ (A or D)` `[ ] REJECT` `[ ] DEFER` Notes: `____________`

### R-2 — The admin provisioning exception (Class 2 connection)

**Question.** A database cannot be created or dropped from inside itself. Do you approve one explicit exception to "no Unix sockets and no `postgres`": `docker exec` into the recorded Nook container, the container's local Unix socket, maintenance database `postgres`, user `nook`, limited to a closed list of operations?
**The two connection classes (nothing else exists).** **Class 1, application and test:** TCP to `127.0.0.1:5433`, database `nook_test` only, no Unix socket, no `nook_dev`, no `postgres`, no port `5432`. **Class 2, admin provisioning (this exception):** reached only through `dx` → `admin_psql` → `admin_op`; `admin_op` has **no free-form operation**, validates every role name, object identity and password, and accepts only: catalogue reads of `pg_database`, `pg_roles`, `pg_hba_file_rules` and `pg_stat_activity`; `show server_version`; the `nook_dev` identity snapshot (a catalogue read, not a connection to `nook_dev`); `CREATE ROLE` ×2; `CREATE DATABASE nook_test … TEMPLATE template0`; `ALTER ROLE … PASSWORD` ×2; identity-bound `DROP DATABASE nook_test` and `DROP ROLE` ×2. Revision 2 confirms by text search that no other code reaches `docker exec`.
**Options.** **A.** Approve this named exception with exactly that list. **B.** Require a package revision that does the admin work over the allow-listed TCP path as the documented local superuser; it still connects to `postgres`, adds a superuser TCP login, and needs a new hash.
**Recommendation.** **A**: smaller, already reviewed, structurally closed, every statement identity-bound.
**Required before the test:** yes.
**Owner decision:** `[ ] APPROVE option ___ (A or B)` `[ ] REJECT` `[ ] DEFER` Notes: `____________`

### R-3 — Temporary migrator password

**Question.** The package gives the migrator a random password so all owner-level tests go through the audited TCP allow-list instead of a Unix socket. Do you approve?
**Necessity.** Without it the owner tests would need a Unix socket beyond the Class 2 list. **Generation:** `openssl rand -hex 16` (128 bits), a 0600 file in the run directory (refused if it already exists), never an environment variable or argument; set by sending `ALTER ROLE` on standard input with error output discarded. **Order:** a negative test first proves the migrator cannot log in over TCP without it. **Exposure:** other processes of the same macOS user can read the 0600 file; `pg_authid` holds only a scram hash. **Revision 2:** the `ALTER ROLE` session first turns statement logging off (`log_min_error_statement = panic`, `log_statement = 'none'`, `log_min_duration_statement = -1`) so a failure is not kept in the server log; this is **unverified on a real server**. **Cleanup:** revision 2 deletes the password files **first**, before the container is even checked, so they are removed even when remote cleanup cannot be verified.
**Recommendation.** **Approve**, accepting the residual exposure for a disposable role that lives for minutes.
**Required before the test:** yes.
**Owner decision:** `[ ] APPROVE` `[ ] REJECT` `[ ] DEFER` Notes: `____________`

### R-4 — Exact privilege matrix

**Question.** Do you approve this matrix, exactly, for the runtime role `nook_app_test`? (`E` explicit grant, `—` none; the migrator is the owner and has every privilege on its own objects.)

| Table              | SELECT | INSERT | UPDATE | DELETE | TRUNCATE | REFERENCES | TRIGGER |
| ------------------ | ------ | ------ | ------ | ------ | -------- | ---------- | ------- |
| `organizations`    | E      | E      | E      | —      | —        | —          | —       |
| `users`            | E      | E      | E      | —      | —        | —          | —       |
| `memberships`      | E      | E      | E      | —      | —        | —          | —       |
| `sessions`         | E      | E      | E      | —      | —        | —          | —       |
| `properties`       | E      | E      | E      | —      | —        | —          | —       |
| `floors`           | E      | E      | E      | —      | —        | —          | —       |
| `rooms`            | E      | E      | E      | —      | —        | —          | —       |
| `beds`             | E      | E      | E      | —      | —        | —          | —       |
| **`audit_events`** | E      | E      | —      | —      | —        | —          | —       |

Also: `CONNECT` on `nook_test` (explicit), `USAGE` on schema `public` (explicit), `TEMP`, database `CREATE` and schema `CREATE` **not** granted, no grant options, no role memberships, no default-ACL changes, no sequences. `UPDATE` covers every column, including `memberships.role` and the tenant columns; column-level restriction is a later design point. **Revision 2 did not change `provision.sql` or any test file** (their hashes are identical to revision 1).
**Risk.** Because there is no row-level security, the database does not isolate _reads_; only writes that cross the composite keys are rejected.
**Recommendation.** Approve exactly this matrix for the **test**. It is proposed grants only, not the production grant set (`Q-7` still needs its own review).
**Required before the test:** yes.
**Owner decision:** `[ ] APPROVE` `[ ] REJECT` `[ ] DEFER` Notes: `____________`

### R-5 — Does the no-`DELETE` rule include `sessions`?

**Question.** `N-1` says business tables get no `DELETE` and that session cleanup must be separately justified. In the test, is `sessions` also refused `DELETE`?
**Consequence.** The package refuses it (test `A-LP17`, privilege check `V08`). I did **not** add any cleanup exception. Expired sessions would then be ended by `UPDATE` of `revoked_at`, or purged by a privileged job; the application design (slice 2.3) must say which.
**Options.** **A.** No `DELETE` on `sessions` for the test (recommended: the stricter reading, matches the package). **B.** Grant `DELETE` on `sessions` only — needs a justification, a package change and a new hash.
**Required before the test:** yes (the tests encode one answer).
**Owner decision:** `[ ] APPROVE option ___ (A or B)` `[ ] REJECT` `[ ] DEFER` Notes: `____________`

### R-6 — `TEMP`

**Question.** Keep `TEMP` revoked from `PUBLIC` and the runtime role, or grant it?
**Recommendation.** Keep it revoked. Nothing in the package needs it (results are collected client-side, and test `A-LP8` asserts the refusal). Granting it would need a stated justification and your explicit approval.
**Required before the test:** yes (confirm).
**Owner decision:** `[ ] APPROVE keep revoked` `[ ] REJECT (grant it; justification: ____)` `[ ] DEFER` Notes: `____________`

### R-7 — Informational observations

**Question.** Do you accept that observations marked `INFO` are reported separately and **never counted** as enforced acceptance tests? They are: the owner can rewrite audit rows (`O-AUD1`, `O-AUD2`); an audit actor is not tied to an organisation (`A-AU8`); a revoked membership is still accepted by the session key (`O-FK5`, `A-SES5`); the permuted-column foreign-key probe (`O-FK7*`); connect rights on other databases (`A-INFO1`, `A-INFO2`, `V19`, `V20`); recorded access lists (`V17`, `V18`); the three drift comparisons; three adapter dispose-option observations (`S2`–`S4`); and the role-session snapshots, which are saved files, not test results.
**Recommendation.** Approve. The acceptance count is the 130 `ENFORCE` ids only; `ENV` and `FIXTURE` results are reported separately; an `INFO` result reported as a pass is a failure.
**Required before the test:** yes (low risk).
**Owner decision:** `[ ] APPROVE` `[ ] REJECT` `[ ] DEFER` Notes: `____________`

### R-9 — Audit integrity wording (acknowledgement required; document edits can wait)

**Question.** Do you acknowledge the `Q-6` limit as follows, and that proposed triggers or stronger immutability language are _not_ approved?
**Proposed wording.** "Runtime-role access to `audit_events` is limited to `INSERT` and `SELECT`. Table owners and superusers can still update, delete, truncate, disable triggers on and drop audit rows, and the runtime role can still insert rows with any content. No claim of immutability or tamper evidence is made."
**Conflict.** The data-model document proposes a trigger that rejects updates and deletes; a trigger needs a function that the scope manifest does not allow. The trigger stays unapproved.
**Recommendation.** Approve the wording and defer any trigger or function to schema design (it needs a manifest decision).
**Required before the test:** acknowledgement only.
**Owner decision:** `[ ] APPROVE` `[ ] REJECT` `[ ] DEFER` Notes: `____________`

### R-15 — The revised runner-enforced controls (package revision 2)

**Question.** The first review found that the runner could not enforce the stage list or run directory, overwrote saved output, and left password files when the container was unreachable. **Revision 2 implements the fixes.** Do you approve the revised controls as prepared, in the package whose manifest hash is in section 5?
**What revision 2 adds (all static, none executed):**

- **Authorization token.** `NOOK_DISPOSABLE_TEST_AUTH` must equal the SHA-256 of `manifest=<manifest hash>;stages=<sorted, unique, comma-joined allowed stages>;rundir=<run directory>`. Changing the package, the stage list or the directory is refused.
- **Hard-coded closed stage set and an explicit allow-list.** A stage runs only if listed. `all` runs only if **listed** and only if every stage it runs is also listed. `create` and `all` require `cleanup` to be listed.
- **New run directory.** `preflight` and `all` refuse an existing run directory; other stages require it to exist.
- **Evidence never overwritten.** A stage with saved output is refused; a rerun needs a new, separately reviewed run directory. `cleanup`, `recover` and `report` may repeat, moving earlier output aside under a timestamped name.
- **Cleanup order.** Local password and URL files are removed first; `cleanup.status` records `local_secrets` and `remote_cleanup` separately (`verified`, `NOT-VERIFIED`, `INCOMPLETE-OR-AMBIGUOUS`); remote cleanup is never claimed unless verified.
- **Role-session snapshots** (`R-1`), the closed admin operation list (`R-2`), password-statement log suppression (`R-3`), pins for the whole compiled-client tree, the Prisma CLI entry file and the adapter entry file, and a narrower `shadow database` test in drift.

**Honest limits.** The token is a checksum, **not a signature or a secret**: anyone who can run the runner can compute a valid one, so it prevents accidental or silent drift, not deliberate misuse. The runner's own manifest check is circular, so **independent verification by the operator is mandatory** (section 6).
**Options.** **A.** Approve revision 2 as prepared. **B.** Ask for further changes (a new hash and a new review).
**Recommendation.** **A**, after you have read sections 4 and 6.
**Required before the test:** yes.
**Owner decision:** `[ ] APPROVE option ___ (A or B)` `[ ] REJECT` `[ ] DEFER` Notes: `____________`

## 3. Decisions that can wait until production schema design

### R-8 — Second-run migration test (`prisma migrate deploy`)

**Question.** Is a second test that applies a tagged migration through `prisma migrate deploy` required?
**Recommendation.** **Defer** until a real production migration exists; it needs its own package, hash and authorization, and today it would exercise a migration that does not exist.
**Required before the test:** no.
**Owner decision:** `[ ] APPROVE defer` `[ ] REJECT (require it)` `[ ] DEFER` Notes: `____________`

### R-10 — Initial fields (`Q-5`)

**Question.** Confirm that address, city, timezone and any property status or `row_version` (proposed in the data-model document) are **not** added by this work.
**Facts.** `Q-5` approves `code`, `name` (plus archive and timestamp columns). The draft schema has none of the others. It **does** contain `beds.out_of_service_reason`, which is not approved (`Q-8` is open); because the draft SQL is hash-pinned I did not change it, and no test depends on it.
**Recommendation.** Leave the draft as pinned for the test; decide the reason column in `Q-8`; add other fields only later as additive migrations.
**Required before the test:** no.
**Owner decision:** `[ ] APPROVE` `[ ] REJECT` `[ ] DEFER` Notes: `____________`

### R-11 — Read-only role

**Question.** Is the read-only diagnostic role from the data-model document out of scope for the current two-role model?
**Recommendation.** Yes: a future-scope item. The package creates no read-only role.
**Required before the test:** no.
**Owner decision:** `[ ] APPROVE (future scope)` `[ ] REJECT` `[ ] DEFER` Notes: `____________`

### R-12 — Migration-generation method

**Question.** Which method will produce the production migration? **Unresolved; not chosen here.**
**Alternatives.** (1) `prisma migrate dev --create-only` on `nook_dev` (named in older proposals; needs a shadow database and a connection to the development database). (2) `prisma migrate diff --from-empty --to-schema … --script` (database-free; shown to run offline with exit 0 in the earlier spike; its output lacks the scope guard's first-line tag, which must be added by hand before commit). (3) Hand-written SQL. (4) Another method you name.
**My recommendation, for you to accept or reject:** (2), as it needs no database.
**Required before the test:** no (the test applies the pinned draft SQL).
**Owner decision:** `[ ] APPROVE option ___` `[ ] REJECT` `[ ] DEFER` Notes: `____________`

### R-13 — Per-entity uniqueness and the preview `partialIndexes` feature (`Q-4`, `Q-4b`)

**Question.** Are these uniqueness scopes approved: property `code` per organisation; floor `ordinal` and `label` per property; room `label` per property (even across floors); bed `label` per room — all among non-archived rows — and may the preview feature be adopted?
**Status.** **Neither is approved.** `Q-4b` approves only evaluating the feature, subject to disposable PostgreSQL and drift tests. The test exercises the mechanism on the draft's scopes; a pass proves neither the scopes nor the feature.
**Alternatives to the preview feature.** Hand-written partial indexes in the migration; plain unique indexes (no label reuse after archiving). Open: reuse after un-archiving, case and whitespace beyond `N-6`, and what archiving a parent does to active children (slice 2.4).
**Required before the test:** no (acknowledge that a pass approves neither).
**Owner decision:** `[ ] APPROVE the scopes as drafted` `[ ] REJECT` `[ ] DEFER` Notes: `____________`

### R-14 — Other unresolved items

Each item below is independent.

- **R-14a — `Q-3`:** commit the generated client, or generate at build and ignore it. Recommendation: build-time, with the import extension pinned (the spike showed the default works under the repository's `tsconfig`). Defer to the wiring step. `[ ] APPROVE ___ [ ] REJECT [ ] DEFER`
- **R-14b — `Q-8`:** `rowVersion`, the bed-reason field and its `CHECK`, session `CHECK`s. Recommendation: defer; add nothing without an approved business rule. `[ ] APPROVE ___ [ ] REJECT [ ] DEFER`
- **R-14c — `Q-9`:** seed data. Recommendation: after Slice 2.2 (the MVP plan lists it inside 2.2; that plan needs an annotation). `[ ] APPROVE ___ [ ] REJECT [ ] DEFER`
- **R-14d — `Q-10`:** the lint fix, README and hero assets, and the public `marketing/` and handbook content. Recommendation: split into two decisions; commit only the already-verified lint and format fix on its own; publishing content is a separate call. `[ ] APPROVE ___ [ ] REJECT [ ] DEFER`
- **R-14e — `N-5`:** does `A3` need a separate `nook_dev` run? The `A3` text says "the spike and the project database". Recommendation: defer; disposable runs would not by themselves settle it. `[ ] APPROVE ___ [ ] REJECT [ ] DEFER`
- **R-14f — Lifecycle semantics** of `DISABLED` and `REVOKED` (`Q-2`, `N-2`). Recommendation: slice 2.3. `[ ] APPROVE ___ [ ] REJECT [ ] DEFER`
- **R-14g — Older `PROPOSED` entries** (decision log §5, register rows): add a one-sentence supersession note pointing to §4B, as §4A did. Needs your authorization to edit the log. `[ ] APPROVE ___ [ ] REJECT [ ] DEFER`
- **R-14h — `F-2` / `F-5` wording** in the implementation plan, to match the spike: `F-2` "Default output uses `.js` imports and loads from `dist/` when a `tsconfig` exists; forced `.ts` compiles but fails at load." `F-5` "Partial unique indexes need the `partialIndexes` preview flag in 7.10.1; there is no `@@check`; drift is untested." Needs your authorization to edit that plan. `[ ] APPROVE ___ [ ] REJECT [ ] DEFER`
- **R-14i — Implementation-plan conflicts with the approved directions:** its section 7 step 6 grants `DELETE` on eight tables (conflicts with `N-1`); its `T-D5` expects `23503` from a delete as the runtime role (it would be `42501`; the test package shows `RESTRICT` as the owner); it still lists `Q-1`–`Q-10` as open. Recommendation: annotate, not rewrite. `[ ] APPROVE ___ [ ] REJECT [ ] DEFER`

## 4. Static review of the package: status after revision 2

I read the revised runner, README, SQL, Node scripts, Prisma configuration and expected lists. **Nothing was executed**; no hash-pinned file was edited except the runner and README, deliberately, in revision 2.

| #    | Finding from the first review                                                  | Status after revision 2                                                                                                                                                                             | Still your call or a limitation |
| ---- | ------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- |
| S-1  | Unix-socket admin path conflicts with a blanket "no sockets/`postgres`" clause | Now an explicit **Class 2 exception** with a closed operation list enforced in code (`R-2`)                                                                                                         | `R-2`                           |
| S-2  | Stage list and run directory not enforced; reruns overwrote output             | **Fixed (static):** token binds manifest + stage list + run directory; per-stage allow-list; `all` only if listed with all constituents; new run directory required; saved output never overwritten | `R-15`                          |
| S-3  | Password files survived when the container was unreachable                     | **Fixed (static):** local secrets are removed first; `cleanup.status` separates local and remote results; remote success is never claimed unless verified                                           | —                               |
| S-4  | A failed `ALTER ROLE` could stay in the server log                             | **Mitigated (static):** statement logging is switched off for that session first. **Unverified on a real server**                                                                                   | residual                        |
| S-5  | No evidence about disposable-role sessions on protected databases              | **Partly addressed:** read-only `pg_stat_activity` snapshots; a hit raises `EXPOSURE_OBSERVED` and fails `report`. **Point-in-time only; history invisible**                                        | **`R-1`: unresolved risk**      |
| S-6  | Compose labels and Docker context assumptions unverified                       | Unchanged; they fail closed and the message says so                                                                                                                                                 | limitation                      |
| S-7  | Compiled client pinned by one file, Prisma by version only                     | **Fixed for key files:** whole 34-file client tree, Prisma CLI entry file and adapter entry file are pinned by hash; other package files by version only                                            | limitation                      |
| S-8  | The runner's self-check is circular                                            | **Documented and mandatory:** independent verification by the operator (section 6.11); the token cannot be formed without the manifest hash                                                         | relies on the operator          |
| S-9  | Local probes not named                                                         | **Fixed (documentation):** listed in section 6.6                                                                                                                                                    | —                               |
| S-10 | A harmless "shadow" word could fail drift                                      | **Fixed (static):** needs the phrase `shadow database` with any separator                                                                                                                           | —                               |
| S-11 | _New:_ the token is a checksum, not a signature                                | Documented: it prevents silent drift, not deliberate misuse; the control is the written authorization and the operator following it                                                                 | limitation                      |

**Confirmed present by reading:** exact loopback target hard-coded in `sql_exec.mjs`, `tcp_password_test.mjs` and `shared_pool_test.mjs`; a Prisma configuration that refuses any other target and reads the URL from a 0600 file; exact URL strings in the runner; inherited routing variables removed and `DOCKER_HOST`/`DOCKER_CONTEXT`/`DOCKER_CONFIG` refused; container ID recorded at preflight and re-checked before every stage and in cleanup; an absence check, pending record, attribute check and stored oid for every creation; cleanup that drops only on a matching name **and** oid, treating a mismatch as "NOT OURS" and a pending record as "AMBIGUOUS"; post-cleanup verification of databases, roles, `nook_dev` identity and the retained volume.
**Checked statically in this revision:** `bash -n`; a scan showing `docker exec` is reached only by `dx` ← `admin_psql` ← `admin_op`; no docker start/stop/run/compose, no `rm -rf`, no `eval`, no `migrate dev`/`deploy`/`reset` or `db push` command; and a scratch test of the extracted pure functions (the admin path stubbed to print its SQL) showing that a token computed independently is accepted while a widened stage list, another run directory, the old plain hash and an empty token are refused, and that role names, object identities and passwords are validated.
**Still unverified because nothing was run:** the SQL on a real server, the effect of the log suppression, `psql` meta-command behaviour in cleanup, the Docker `inspect` templates and compose-label assumption, `pg_hba` behaviour through Docker Desktop, introspection by the runtime role in the Prisma CLI, the `28P01` error-code assumption, and the `pg_stat_activity` query.

## 5. Independent hash verification

Done with plain hash tools **while writing this document**; the runner and its own `verify_package` command were **not** run.

| Check                                                                     | Result                                                                                                    |
| ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| SHA-256 of `disposable-test/MANIFEST.sha256` (**revision 2**)             | `30df85941c508147452655b7f8582f82a176d16a024bdc764e253e97422f51b9`                                        |
| Revision 1 manifest hash, now **superseded and void**                     | `8a1048a0f57a1d039d9124e396b0803e900a17a37dbcdc78f7af2333a4827d35`                                        |
| Files that changed since revision 1                                       | `run_disposable_test.sh` and `README.md`; every other file is byte-identical (see the plan for each hash) |
| SHA-256 of each of the 15 files against the manifest (`shasum -a 256 -c`) | 15 `OK`; no file missing; no file in the folder outside the manifest                                      |
| This document and the test plan                                           | Outside the manifest; editing them does not change the manifest                                           |

This is a point-in-time check of the working tree. It does **not** replace the operator's check immediately before execution (section 6.11), and any later edit to a package file voids the hash. An authorization that quoted the revision 1 hash is void.

## 6. Proposed execution authorization — a draft, not an authorization

> **DRAFT. NOT AN AUTHORIZATION.** The owner must edit it, choose the options, fill every placeholder and sign. Until then nothing may run. Drafting it is not permission to execute it.

**6.1 Package, stage list, run directory and token.** I authorize the disposable test package in `docs/nook-phase-2/disposable-test/` whose `MANIFEST.sha256` has SHA-256 `30df85941c508147452655b7f8582f82a176d16a024bdc764e253e97422f51b9`, the stages ticked in 6.2, and the run directory in 6.3, and **only** those. The three are bound together by one token: the SHA-256 of the exact text `manifest=<that hash>;stages=<the ticked stages, sorted, comma-joined>;rundir=<the run directory>`. The operator computes it with an ordinary tool, reads it back to me, and passes it in `NOOK_DISPOSABLE_TEST_AUTH`. Any change to the package, the stage list or the directory voids this authorization. _(If `R-15` option B is chosen, replace the hash with the revised manifest's.)_ Token: `<OPERATOR COMPUTES; OWNER CONFIRMS: ____________>`

**6.2 Permitted stages, individually.** Tick only those the owner permits. Unticked stages must not be run. `all` is permitted only if it is ticked **and** every other box below, including `cleanup` and `report`, is ticked. Creation (`create` or `all`) is refused unless `cleanup` is ticked. I recommend always ticking `cleanup` and `report`.

`[ ] preflight` `[ ] create` `[ ] migrator_login` `[ ] schema` `[ ] provision` `[ ] inventory` `[ ] test_owner` `[ ] test_app` `[ ] test_tcp` `[ ] drift` `[ ] test_pool` `[ ] cleanup` `[ ] report` `[ ] all` — `recover` is **not** included and needs its own authorization (its own token).

**6.3 Run directory.** Exactly `<OWNER CHOOSES: /private/tmp/.../disposable_pg_<name>>`, which must not exist yet (the runner refuses an existing one), must be outside the repository, and is used for **one** attempt. Saved stage output is never overwritten; a retry needs a new directory, a new token and a new authorization.

**6.4 Connection classes and the explicit exception.**

- **Class 1 (application and test):** TCP to `127.0.0.1:5433`, database `nook_test`, as `nook_migrator_test` or `nook_app_test`, and nothing else. No Unix socket, no `nook_dev`, no `postgres`, no port `5432`, no remote host, no shadow database.
- **Class 2 (the single named exception, decision `R-2`):** `docker exec` into the one recorded container, its local Unix socket, maintenance database `postgres`, user `nook`, for the closed operation list in `R-2` only. `<OWNER CHOOSES: option A or B>`.

**6.5 Maximum creation and cleanup.** Exactly two roles (`nook_migrator_test`, `nook_app_test`) and one database (`nook_test`, owner the migrator, `TEMPLATE template0`); inside `nook_test`, the draft's 9 tables, 5 enum types, indexes and synthetic rows plus the scratch probe table the owner suite creates and drops; in the run directory, `out/`, `records/`, `secrets/` (0600 files) and `drift/` copies. **Nothing else may be created**, and nothing written to the spike directories, the repository, `nook_dev` or `postgres`. Cleanup first deletes this run's local password and URL files, then drops only objects with a creation record **and** a matching oid, and never anything else.

**6.6 Permitted local operations.** TCP to `127.0.0.1:5433` by the package's Node scripts and by the Prisma CLI as the runtime role; Docker CLI calls to the local daemon (`context show`, `ps`, `inspect`, `port`, `volume inspect`, and `exec` into the one recorded container, only through the Class 2 path); `lsof` on port 5433; `ipconfig`; one `nc -z -w 3` to the host's own LAN address on port 5433 (expected to be refused); `df`; `openssl rand`; `shasum`; `python3` for `db_guard.py` only.

**6.7 Forbidden.** Any connection to `nook_dev` or to `postgres` by any application, test or Prisma path; host port `5432` or the Homebrew PostgreSQL; any remote host; any Unix-socket connection other than the single named Class 2 path; shadow databases; `prisma migrate dev`, `migrate deploy`, `migrate reset`, `db push`; any change to `nook_dev`, its grants, the existing cluster configuration, the Docker volume `nook_nook_postgres_data`, other containers, volumes or projects; starting, stopping or restarting Docker; dependency installs; edits to repository files; Git operations; reuse of a run directory; running any stage not ticked.

**6.8 Known unverified behaviours the owner accepts.** The SQL has never run on a real server; the effect of the log suppression on `ALTER ROLE`; `psql` meta-command behaviour in cleanup; the Docker `inspect` templates and the compose-label assumption (the check fails closed); `pg_hba` behaviour for connections arriving through Docker Desktop; introspection by the runtime role in the Prisma CLI (a failure is reported as BLOCKED, not retried with more privilege); the Node scripts' error-code assumptions (`28P01`); the `pg_stat_activity` snapshot query. A failure in any of these stops the run, is reported as found, and is never a reason to widen privileges or targets.

**6.9 Stop conditions.** Any item in section 11 of the test plan, in particular: a hash or token difference; a stage not in the authorized list; an existing run directory or existing stage output; the container not the exact expected one or its identity changing; a port mapping other than exactly `127.0.0.1:5433`; a disk reading below 5.5 GiB; any database other than `nook_dev` and `postgres`, or any role other than `nook`, before the run; any disposable object already existing; a failed or ambiguous creation; an identity mismatch; any missing, duplicate, unexpected or failing result; a shadow-database mention; `EXPOSURE_OBSERVED`; anything ambiguous. After a stop, only `cleanup` runs; if the state is ambiguous or the container is unreachable, **nothing is dropped by guesswork** and the resource is reported to the owner.

**6.10 Required post-cleanup evidence.** The saved `out/` files and `report` output; the cleanup lines showing each drop by name and oid; the verification lines showing databases exactly `nook_dev,postgres`, roles exactly `nook`, `nook_dev` identity unchanged, and the volume present; `out/cleanup.rc` and `out/cleanup.status` (`local_secrets=removed`, `remote_cleanup=verified`); every `out/role_sessions_*.txt` and the absence of `EXPOSURE_OBSERVED.flag`; test and cleanup results reported **separately**; every skipped or failed check and why; and a statement of what was **not** proven (sections 1 and 12 of the test plan, and the point-in-time limit of the session snapshots).

**6.11 Operator procedure — independent verification is mandatory.** (1) Before **every** session, in the package folder, run `shasum -a 256 MANIFEST.sha256`, `shasum -a 256 -c MANIFEST.sha256`, and list the folder's files against the manifest, using ordinary tools and **not** the runner's own `verify_package` (its self-check is circular). Compare with 6.1. (2) Compute the token with `printf 'manifest=%s;stages=%s;rundir=%s' … | shasum -a 256` and read it back to the owner. (3) Invoke only the ticked stages, one per invocation, with the exact run directory, stage list and token. (4) Never invoke `all` unless ticked. (5) After a failed stage do not rerun it; run `cleanup`, then `report`, and ask for a new authorization. (6) Never print or log a password. (7) If anything is unclear, stop and ask.

**6.12 Residual risks accepted** (tick each): `[ ] R-1 cluster-level connect exposure, observed only at snapshot points (option ___)` `[ ] the token is a checksum, not a signature` `[ ] password files on disk until cleanup` `[ ] a first run may fail on an unexecuted script` `[ ] logging suppression on ALTER ROLE is unverified`.

**Owner:** `____________` **Date:** `____________` **Decision:** `[ ] AUTHORIZE the above` `[ ] DO NOT AUTHORIZE`

## 7. What this review did not do

It did not run any stage, SQL, Prisma, Docker, database or network command. It changed no decision and did not touch the decision log. It edited only the runner and README of the package (revision 2), regenerated the manifest, and updated this document and the test plan. The execution authorization is a template; no field is filled.
