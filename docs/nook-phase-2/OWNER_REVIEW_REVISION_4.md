# Revision 4 (no-network package) — owner decisions

**Status:** decision register, version 0.1, written 2026-10-29. **Nothing here is approved.** Every field is left empty on purpose, and the authorization in section 5 is a **draft, not an authorization**. Nothing was executed to prepare revision 4 or this register: no Docker command, no database connection, no SQL, no Prisma command, no network probe, no installation, no Git operation, and no stage of any runner. No container, volume, network, role or database was created, inspected or removed.
**Companions:** [Revision 4 README](disposable-test-v4/README.md) · [Revision 4 SAFETY.md](disposable-test-v4/SAFETY.md) · [Boundary verification plan](PHASE_2_SLICE_2_2_REV4_BOUNDARY_VERIFICATION_PLAN.md) · [I-12 options analysis](PHASE_2_SLICE_2_2_I12_EGRESS_OPTIONS_ANALYSIS.md) · [Revision 3 register](OWNER_REVIEW_ISOLATED_ENVIRONMENT.md).
**Relationship to earlier revisions.** Revisions 2 and 3 are preserved unchanged and are not the packages proposed for execution. Revision 4 is a **proposal** that answers the options analysis's recommendation (option B of `I-12`); it does not resolve `I-12`.

How to answer: tick one box per decision. A recommendation is my reading, not a decision. An empty box leaves the item unresolved; where marked "required before the test", execution stays blocked.

## 1. Revision 4

| Item                                         | Value                                                                                                                                                                |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Folder                                       | `docs/nook-phase-2/disposable-test-v4/` (14 files plus `MANIFEST.sha256`)                                                                                            |
| SHA-256 of `MANIFEST.sha256` (point in time) | `9d328f061493ef373eb954ca83f85f6941729c4132e6e4014eed480dbe6504ef`                                                                                                   |
| Verified how                                 | `shasum -a 256 -c MANIFEST.sha256` → 14 `OK`; file list compared with the manifest; the runner and its own `verify_package` were **not** run                         |
| Reused unchanged from revision 3             | `sql/provision.sql`, `sql/tests_owner.sql`, `sql/tests_app.sql`, `sql/inventory.sql`, `sql/counts.sql`, `expected/expected_inventory.txt` (byte-identical)           |
| New or rewritten                             | runner, README, SAFETY, `expected/expected_results.txt`, `expected/test_matrix.txt`, `node/inspect_check.mjs`, `tools/generate_sql.py`, `tools/selftest_inspect.mjs` |
| Not carried over                             | revision 3's Node clients and Prisma drift files (they need a host TCP connection)                                                                                   |

The hash is a point-in-time reading. Any later edit to a package file voids it and any authorization that quoted it. This register and the boundary plan are outside the manifest.

**Designed versus verified.** The no-network configuration is **designed**. Offline, I verified only the pure logic (the identity verifier: 54 of 54 synthetic cases; the token, allow-list and result-evaluation functions; the static scans). **No behaviour of Docker, the image, `psql` or the boundary was observed.** Execution stays blocked until the boundary verification (`V4-8`) has been authorized and run and the open decisions are answered.

## 2. All decisions, and their status

Every status below is **UNRESOLVED**. Nothing is approved.

| ID      | Subject                                                                | Required before the test | Status     |
| ------- | ---------------------------------------------------------------------- | ------------------------ | ---------- |
| `V4-1`  | Adopt the no-network design (`I-12` option B path)                     | yes                      | UNRESOLVED |
| `V4-2`  | Image identity and how it is verified                                  | yes                      | UNRESOLVED |
| `V4-3`  | Resource naming and identity rules                                     | yes                      | UNRESOLVED |
| `V4-4`  | The allowed stage list (13 stages, no `all`)                           | yes                      | UNRESOLVED |
| `V4-5`  | Cleanup and recovery behaviour                                         | yes                      | UNRESOLVED |
| `V4-6`  | Treatment of the network-dependent tests (7 rewritten, 11 deferred)    | yes                      | UNRESOLVED |
| `V4-7`  | Whether the deferred tests need a second test environment              | no (before acceptance)   | UNRESOLVED |
| `V4-8`  | Authorization of the boundary verification (a separate task)           | **yes**                  | UNRESOLVED |
| `V4-9`  | Residual isolation risk                                                | **yes**                  | UNRESOLVED |
| `V4-10` | Final execution authorization (section 5)                              | yes                      | UNRESOLVED |
| `I-12`  | Host-service reachability (unchanged; revision 4 is a proposed answer) | **yes**                  | UNRESOLVED |
| `I-6`   | Container hardening flags (carried over; all unverified)               | yes                      | UNRESOLVED |
| `R-3`   | Temporary migrator credential                                          | yes                      | UNRESOLVED |
| `R-4`   | Exact runtime privilege matrix                                         | yes                      | UNRESOLVED |
| `R-5`   | No `DELETE` on `sessions`                                              | yes                      | UNRESOLVED |
| `R-6`   | `TEMP` stays revoked                                                   | yes                      | UNRESOLVED |
| `R-7`   | `INFO` observations are never counted                                  | yes                      | UNRESOLVED |
| `R-9`   | Audit-event wording (not immutable against owners and superusers)      | acknowledgement          | UNRESOLVED |

**Not decided, not approved, not affected:** `Q-3`, `Q-8`, `Q-9`, `Q-10`, `N-5`, the per-entity partial-unique-index scopes (and the preview `partialIndexes` feature), lifecycle semantics, and the migration-generation strategy. The twelve decisions recorded in the decision log (§4B) as approved _for planning only_ are unchanged. `I-1` to `I-5` and `I-7` to `I-11` of the revision 3 register are not re-asked here; where revision 4 changes their substance it is stated below, and they stay as unresolved as they were.

## 3. Decisions

### V4-1 — Adopt the no-network design

**Question.** Replace revision 3's bridge-network-and-published-port design with a container created with network mode `none` and no published port, where every database test runs inside the container through `docker exec` and `psql`?
**Recommendation.** **Approve as the direction**, because it is the only option examined that offers a boundary by construction without a privileged change or an installation. Approving it does **not** approve running anything, does **not** establish that the boundary exists, and does not resolve `I-12`.
**Risks and consequences.** The boundary is unverified; acceptance is incomplete (`V4-6`); the SQL, the Docker forms and the PostgreSQL assumptions have never run ([SAFETY.md](disposable-test-v4/SAFETY.md) section 7).
**Required before the test:** yes.
**Owner decision:** `[ ] APPROVE` `[ ] REJECT` `[ ] DEFER` Notes: `____________`

### V4-2 — Image identity and its verification

**Question.** Use the locally present `postgres:17.11-alpine`, referenced by an **image ID that the owner reads with a read-only local inspect during an authorized preflight** and quotes in the authorization; the runner compares it with the live local image, creates from that exact ID with `--pull never`, never pulls, and never modifies the image?
**Procedure.** The ID is not known today and is not recorded anywhere in the package. Pinning detects substitution, not a defect common to this image and the development container. **Unverified:** that `docker image inspect` and a container's `.Image` report the same ID form (a containerd image store may differ), which would make the first run stop at the identity check.
**Recommendation.** Approve.
**Required before the test:** yes.
**Owner decision:** `[ ] APPROVE` `[ ] REJECT (pull a digest-pinned image; digest: ____)` `[ ] DEFER` Notes: `____________`

### V4-3 — Resource naming and identity rules

**Question.** Use run id `nn<UTC timestamp>-<4 hex>` chosen by the owner; container `nook-nn-pg-<runid>`, volume `nook-nn-vol-<runid>`; labels `com.nook.disposable`, `com.nook.nn-run`, `com.nook.package-manifest`; the built-in `none` network (nothing created); a preflight that refuses on **any** container or volume with the disposable label, this run's label or the `nook-nn-` prefix; identities recorded as the container's full ID and the volume's `CreatedAt` and bound into the authorization of every stage after `create`; and **no automatic adoption** of an unrecorded look-alike (it is reported and needs a manual owner review)?
**Recommendation.** Approve. Distinct labels and prefixes mean revision 3 and revision 4 resources can never be mistaken for each other.
**Required before the test:** yes.
**Owner decision:** `[ ] APPROVE` `[ ] REJECT` `[ ] DEFER` Notes: `____________`

### V4-4 — The allowed stage list

**Question.** Allow exactly these stages, each separately listed, each its own invocation: `preflight`, `create`, `start`, `bootstrap`, `password_pre`, `schema`, `provision`, `test_inventory`, `test_owner`, `test_app`, `test_password`, `cleanup`, `recover` (own authorization), `report`; **no `all` stage**; `create` requires `cleanup` to be listed; a stage never implies permission for another?
**Recommendation.** Approve. `drift` and `test_pool` do not exist here because they cannot work without a host TCP connection.
**Required before the test:** yes.
**Owner decision:** `[ ] APPROVE` `[ ] REJECT` `[ ] DEFER` Notes: `____________`

### V4-5 — Cleanup and recovery behaviour

**Question.** Is cleanup "local secrets first and reported separately; then stop and remove the container and the volume, each after an identity check against its record, never forced; then a final listing that reports anything remaining as recorded-but-present or `UNRECORDED`", with no `DROP` inside the cluster, no Docker network to remove, and `recover` as a separate stage that lists by default and removes only recorded resources when confirmed? If Docker is unavailable, cleanup says resources may remain and removes nothing.
**Recommendation.** Yes. After a crash between a Docker create and its record, the owner reviews and removes the resource by hand.
**Required before the test:** yes.
**Owner decision:** `[ ] APPROVE` `[ ] REJECT` `[ ] DEFER` Notes: `____________`

### V4-6 — Treatment of the network-dependent tests

**Question.** Revision 3's definitions were inspected. The options analysis's count is **confirmed**: 12 of the 130 `ENFORCE` ids need Node or a host TCP client (`T-PW1` to `T-PW8`, `S1`, `S5`, `S6`, `S7`). Six `INFO` ids also do (`S2`–`S4`, `D1`–`D3`). Revision 4 proposes:

| Revision 3 id        | Revision 4 status     | Replacement    | Property and honest limit                                                                                                      |
| -------------------- | --------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `T-PW1`              | REWRITTEN             | `PWC1`         | the runtime role logs in with its password; over the container's own loopback with psql, not the host port or the `pg` library |
| `T-PW2`              | REWRITTEN             | `PWC2`         | a wrong password is refused by the server; matched on message text, not SQLSTATE `28P01`                                       |
| `T-PW3`              | **DEFERRED**          | —              | an empty-string password; libpq treats it as none, so psql cannot test the same case                                           |
| `T-PW4`, `T-PW5`     | REWRITTEN             | `PWC4`, `PWC5` | no password at all; refused **client-side** by libpq (as the `pg` library did), weaker than a server refusal                   |
| `T-PW6`, `T-PW7`     | REWRITTEN             | `PWC6`, `PWC7` | migrator with a wrong password refused; migrator with its password accepted                                                    |
| `T-PW8`              | REWRITTEN             | `PWC8`         | the runtime role reads the same row counts as the owner (loopback read versus local-socket read)                               |
| `S1`, `S5`           | **DEFERRED**          | —              | shared-pool limit and no-hang: client-library behaviour, no database-side equivalent                                           |
| `S6`, `S7`           | **DEFERRED**          | —              | the privilege itself is covered by the SQL suite; the Prisma-adapter path is not                                               |
| `S2`–`S4`, `D1`–`D3` | **DEFERRED** (`INFO`) | —              | need Node, the adapter or the Prisma CLI                                                                                       |

Totals: **118 `ENFORCE` unchanged + 7 `REWRITTEN` + 5 deferred `ENFORCE` = 130.** The 7 rewritten are a **separate class** counted separately; deferred tests are never reported as passed; **no claim of "130 passed" is possible.** The runner's report lists the deferred ids and says acceptance is incomplete.
**Question.** Do you accept (a) the rewrites as checking the same security properties by a different path, (b) their separate counting, and (c) the deferrals as recorded? **Recommendation.** Accept (a) and (b) with the stated limits; treat (c) as an open acceptance gap (`V4-7`).
**Required before the test:** yes.
**Owner decision:** `[ ] APPROVE` `[ ] REJECT` `[ ] DEFER` Notes: `____________`

### V4-7 — Do the deferred tests need a second environment?

**Question.** Eleven tests need Node, the Prisma adapter, the Prisma CLI or a host TCP client. Should a **second, separately designed and authorized** environment run them (for example a shared-namespace client container, or a different approach), should they wait for a later phase, or may Slice 2.2 evidence accept their deferral?
**Recommendation.** Defer the choice. Do not let a pass of revision 4 be read as covering them; decide once the boundary evidence (`V4-8`) exists.
**Required before the test:** no (needed before the Slice 2.2 evidence is treated as complete).
**Owner decision:** `[ ] SECOND ENVIRONMENT` `[ ] LATER PHASE` `[ ] ACCEPT DEFERRAL` `[ ] DEFER` Notes: `____________`

### V4-8 — Authorization of the boundary verification

**Question.** Will you authorize, as a **separate task with its own exact authorization**, the verification described in [the boundary verification plan](PHASE_2_SLICE_2_2_REV4_BOUNDARY_VERIFICATION_PLAN.md) (a subject container and a positive-control container, an owner-started canary listener that is not on `5432`, `5433` or `15433`, read-only observations, identity-checked removal, and an evidence report whose SHA-256 goes into the test authorization)? The plan states what each observation shows and what it does not; **if the boundary cannot be established, the risk stays unresolved and execution stays blocked.**
**Recommendation.** Authorize it before any test. Without it the runner's `boundary=` field refers to nothing.
**Required before the test:** **yes.**
**Owner decision:** `[ ] AUTHORIZE (a separate authorization will follow)` `[ ] DO NOT AUTHORIZE` `[ ] DEFER` Notes: `____________`

### V4-9 — Residual isolation risk

**Question.** After the boundary evidence is in hand, do you accept what remains: the boundary is evidence, not proof; the Docker socket is root-equivalent; the Docker VM and host kernel are shared; Docker keeps the administrator password in the container configuration until removal; the token is a checksum; there is a time-of-check to time-of-use window; and acceptance is incomplete?
**Recommendation.** Decide only after `V4-8`. If the evidence is missing or ambiguous, do not accept.
**Required before the test:** **yes.**
**Owner decision:** `[ ] ACCEPT` `[ ] DO NOT ACCEPT` `[ ] DEFER` Notes: `____________`

### V4-10 — Final execution authorization

The draft in section 5 is a **template, not an authorization**.
**Owner decision:** `[ ] AUTHORIZE (section 5, completed and signed)` `[ ] DO NOT AUTHORIZE` `[ ] DEFER` Notes: `____________`

## 4. Carried-over decisions (substance unchanged; re-asked for revision 4)

Their full text is in the [revision 3 register](OWNER_REVIEW_ISOLATED_ENVIRONMENT.md) and the [revision 2 register](OWNER_REVIEW_SLICE_2_2.md). Revision 4 did **not** change `sql/provision.sql`, the two suites, `inventory.sql` or `counts.sql`, so the privilege matrix is unchanged.

- **`I-6` hardening flags.** `--network none`, `no-new-privileges`, `--memory 1g`, `--pids-limit 512`, `--restart no`, one volume, `--pull never`, no privileged mode, no host mounts, no Docker socket, no published port. **All unverified**; `--cap-drop`, `--read-only`, `--user`, `--tmpfs` and ulimits are not used. `[ ] APPROVE` `[ ] REJECT` `[ ] DEFER` Notes: `____________`
- **`R-3` migrator credential.** Random 128-bit passwords in 0600 files; the administrator's password is in an environment file deleted right after `docker create`; in revision 4 the password checks write a 0600 `pgpass` file inside the container through standard input, so **no password is ever a command argument or environment value**. The log-suppression for `ALTER ROLE` is still unverified. `[ ] APPROVE` `[ ] REJECT` `[ ] DEFER` Notes: `____________`
- **`R-4` privilege matrix.** Unchanged: `SELECT`/`INSERT`/`UPDATE` on eight tables; `SELECT`/`INSERT` only on `audit_events`; **no `DELETE`, `TRUNCATE`, `REFERENCES` or `TRIGGER`**; `CONNECT` and `USAGE` only; `TEMP` not granted. `[ ] APPROVE` `[ ] REJECT` `[ ] DEFER` Notes: `____________`
- **`R-5` no `DELETE` on `sessions`.** Unchanged. `[ ] APPROVE option A` `[ ] REJECT` `[ ] DEFER` Notes: `____________`
- **`R-6` `TEMP` stays revoked.** Unchanged. `[ ] APPROVE` `[ ] REJECT` `[ ] DEFER` Notes: `____________`
- **`R-7` `INFO` observations.** `INFO` results are reported separately and never counted; revision 4 adds the classes `REWRITTEN` (counted separately) and `DEFERRED` (never a pass). `[ ] APPROVE` `[ ] REJECT` `[ ] DEFER` Notes: `____________`
- **`R-9` audit wording.** Acknowledge that `audit_events` is **not** immutable against its owner and superusers, that the runtime role can still insert arbitrary rows, and that no immutability or tamper-evidence is claimed. `[ ] APPROVE` `[ ] REJECT` `[ ] DEFER` Notes: `____________`

## 5. Proposed execution authorization — a draft, not an authorization

> **DRAFT. NOT AN AUTHORIZATION.** The owner must edit it, choose the options, fill every placeholder and sign. Until then nothing may run. A valid token is never permission beyond what is written and signed here, and **the token is a checksum, not a digital signature**.

**5.1 Package.** I authorize the package in `docs/nook-phase-2/disposable-test-v4/` whose `MANIFEST.sha256` has SHA-256 `<OWNER CONFIRMS: ____________ (point in time: 9d328f06…04ef; re-verify)>`, the stages ticked in 5.2, the run id and directory in 5.3, the image in 5.4, the boundary evidence in 5.5 and the identities in 5.6, and **only** those.

**5.2 Stages, individually** (no `all`): `[ ] preflight` `[ ] create` `[ ] start` `[ ] bootstrap` `[ ] password_pre` `[ ] schema` `[ ] provision` `[ ] test_inventory` `[ ] test_owner` `[ ] test_app` `[ ] test_password` `[ ] cleanup` `[ ] report`. `recover` is **not** included and needs its own authorization. `create` is refused unless `cleanup` is ticked; always tick `cleanup` and `report`. Authorize in **two phases**: `preflight` and `create` first; after `create`, review the recorded identities and authorize the rest.

**5.3 Run id and directory.** Run id `<OWNER CHOOSES: nn<UTC yyyymmddThhmmssZ>-<4 hex>>`; directory exactly `/private/tmp/disposable_pg_<run id>`, which must not exist yet and is used for **one** attempt.

**5.4 Image.** `postgres:17.11-alpine`, image ID `<OWNER READS WITH A READ-ONLY LOCAL INSPECT: sha256:____________>`, created with `--pull never`.

**5.5 Boundary evidence (`V4-8`).** SHA-256 of the boundary-verification report: `<OWNER SUPPLIES: ____________>`. If none exists, the test must not run.

**5.6 Resource identity records.** After `create`: container id `<FROM records/container.rec: ____________>` and volume `CreatedAt` `<FROM records/volume.rec: ____________>`.

**5.7 Token.** For `preflight` and `create`: SHA-256 of `manifest=<hash>;stages=<sorted list>;rundir=<dir>;runid=<run id>;image=<image id>;container=nook-nn-pg-<run id>;volume=nook-nn-vol-<run id>;network=none;boundary=<evidence sha256>`; for every other stage, the same text followed by `;containerid=<id>;volumecreated=<CreatedAt>`. The operator computes it with an ordinary tool and reads it back to me. Token: `<OPERATOR COMPUTES; OWNER CONFIRMS: ____________>`.

**5.8 Maximum creation and cleanup.** Exactly one volume `nook-nn-vol-<run id>` and one container `nook-nn-pg-<run id>` (network mode `none`, no published port); inside the cluster, the administrator `nook_iso_admin`, two roles, `nook_test` with the draft's 9 tables, 5 enum types, indexes and synthetic rows plus the scratch probe table the owner suite creates and drops; in the run directory, `out/`, `records/`, `secrets/` (0600 files). **Nothing else may be created.** Cleanup first deletes local secret files, then stops and removes only the container and volume whose identities match their records, then lists what remains.

**5.9 Permitted operations.** The Docker operations in [SAFETY.md](disposable-test-v4/SAFETY.md) section 3 against the recorded IDs and names; `docker exec` into the one recorded container through the runner's checked path only; `df`; `openssl rand`; `shasum`.

**5.10 Forbidden.** Any Docker operation naming an existing Nook resource; any Docker network operation; publishing or using any port; running a container; forced removal; `kill`; any `prune`; `compose`; `pull`; `system`; `cp`; `commit`; wildcards or command substitution over resource lists; any use of port `5432`, `5433` or `15433`; any `nook_dev` credential or URL; any connection to a host service; Prisma commands; changes to firewall, Docker daemon configuration or any existing resource; starting Docker; installs; repository edits; Git operations; reuse of a run directory; running any stage not ticked.

**5.11 Known unverified behaviours the owner accepts.** Every item in SAFETY.md section 7 and every flag in section 6. A failure stops the run, is reported as found, and is never a reason to widen privileges or targets.

**5.12 Stop conditions.** A hash or token difference; a stage not listed; an existing run directory or stage output; a Docker context other than `desktop-linux` or `default`; an unreachable daemon; an image ID that differs; any container or volume carrying the disposable label, this run's label or the `nook-nn-` prefix before creation; a disk reading below 5.5 GiB; **any identity difference** (including a network mode other than `none` or any published port); a cluster that is not fresh; a beacon mismatch; a failed or ambiguous creation; any missing, duplicate, unexpected or failing result; anything ambiguous. After a stop, only `cleanup` runs; nothing is removed by guesswork.

**5.13 Required post-cleanup evidence.** The saved `out/` files and `report` output; the cleanup lines showing each identity check and removal; `out/cleanup.status` with `local_secrets=` and `docker_resources=` reported **separately** (`verified` only if nothing labelled with the run id or the prefix remains); the image ID unchanged; the deferred ids listed as **not run, not passed**; the enforced and rewritten counts reported separately; every skipped or failed check and why; and what was **not** proven (the boundary beyond the evidence in 5.5).

**5.14 Operator procedure.** (1) Before **every** session run `shasum -a 256 MANIFEST.sha256`, `shasum -a 256 -c MANIFEST.sha256` and a file-list comparison with ordinary tools, **not** the runner's `verify_package`. (2) Compute the token per stage as in 5.7 and read it back. (3) Invoke only ticked stages, one per invocation. (4) After a failed stage do not rerun it; run `cleanup`, then `report`, and ask for a new authorization. (5) Never print or log a password. (6) If anything is unclear, stop and ask.

**5.15 Residual risks accepted** (tick each): `[ ] the boundary is evidence, not proof (V4-9)` `[ ] the token is a checksum, not a signature` `[ ] the rewritten password tests are a different path from the originals` `[ ] 11 tests are deferred and acceptance is incomplete (V4-6, V4-7)` `[ ] Docker, PostgreSQL and psql behaviours are unverified and a first run may fail` `[ ] hardening flags are unverified` `[ ] the Docker socket is root-equivalent and the Docker VM is shared with the development container` `[ ] a crash between a Docker create and its record leaves a resource for manual review`.

**Owner:** `____________` **Date:** `____________` **Decision:** `[ ] AUTHORIZE the above` `[ ] DO NOT AUTHORIZE`

## 6. What this register did not do

It did not run any stage, SQL, Prisma, Docker, database, network or installation command, and did not create, inspect or remove any resource. It did not edit revision 2 or revision 3, `scripts/db_guard.py`, the scope manifest, the decision log or any production file. It approved nothing, and it does not authorize or execute the test.
