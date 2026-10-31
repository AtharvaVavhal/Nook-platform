# Isolated throwaway environment — owner decisions (package revision 3)

**Status:** decision register, version 0.2, updated 2026-10-29 for **package revision 3**. **Nothing here is approved.** Every field is left empty on purpose, and the authorization in section 5 is a **draft, not an authorization**. Nothing was executed to prepare revision 3 or this register: no Docker command, no database connection, no SQL, no Prisma command, no network probe, no Git operation, and no stage of any runner. No container, volume, network, role or database was created, inspected or removed.
**Companions:** [Isolated environment design (v0.1, with a revision 3 note)](PHASE_2_SLICE_2_2_ISOLATED_TEST_ENVIRONMENT_PLAN.md) · [Revision 3 README](disposable-test-v3/README.md) · [Revision 3 SAFETY.md](disposable-test-v3/SAFETY.md) · [Earlier register (revision 2)](OWNER_REVIEW_SLICE_2_2.md).
**Revision 4 note (2026-10-29): a no-network proposal now exists** ([`disposable-test-v4/`](disposable-test-v4/README.md), [its register](OWNER_REVIEW_REVISION_4.md), [its boundary verification plan](PHASE_2_SLICE_2_2_REV4_BOUNDARY_VERIFICATION_PLAN.md)). It answers the options analysis's recommendation but **does not resolve `I-12`**, which stays unresolved here. Revision 3 is unchanged, and this register's authorization draft applies to revision 3 only and must not be used for revision 4.
**Relationship to revision 2.** [Revision 2](disposable-test/README.md) (manifest `30df85941c508147452655b7f8582f82a176d16a024bdc764e253e97422f51b9`) is unchanged and preserved as evidence of what was reviewed. It is **not** the package proposed for execution, and its authorization draft must not be used for revision 3.

How to answer: tick one box per decision. A recommendation is my reading, not a decision. An empty box leaves the item unresolved; where marked "required before the test", execution stays blocked.

## 1. Revision 3 and what it means for the decisions

| Item                                         | Value                                                                                                                                                                                                                                                                        |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Folder                                       | `docs/nook-phase-2/disposable-test-v3/` (19 files plus `MANIFEST.sha256`)                                                                                                                                                                                                    |
| SHA-256 of `MANIFEST.sha256` (point in time) | `8c1e0b8c1afc65ac979bbbc7ec790e9dff65c6c81fc715b6498c0a550409c619`                                                                                                                                                                                                           |
| Per-file hashes                              | In `disposable-test-v3/MANIFEST.sha256` (and in the report that accompanied this register)                                                                                                                                                                                   |
| Verified how                                 | `shasum -a 256 -c MANIFEST.sha256` → 19 `OK`; file list compared with the manifest; the runner and its own `verify_package` were **not** run                                                                                                                                 |
| Files reused unchanged from revision 2       | `sql/provision.sql`, `sql/tests_owner.sql`, `sql/counts.sql`, `drift/schema_no_partial.prisma`, `expected/expected_inventory.txt` (byte-identical)                                                                                                                           |
| Files changed                                | `run_disposable_test.sh` (rewritten), `README.md` (rewritten), `sql/inventory.sql`, `sql/tests_app.sql`, `expected/expected_results.txt`, `tools/generate_sql.py`, `node/sql_exec.mjs`, `node/tcp_password_test.mjs`, `node/shared_pool_test.mjs`, `drift/prisma.config.mjs` |
| Files new                                    | `SAFETY.md`, `node/iso_common.mjs`, `node/inspect_check.mjs`, `tools/selftest_inspect.mjs`                                                                                                                                                                                   |

This hash is a point-in-time reading of the working tree. Any later edit to a package file voids it and any authorization that quoted it. The owner documents are outside the manifest, so editing them does not change it.

**What is not resolved by revision 3:** host-service reachability from the throwaway container is **not blocked** and cannot be, by design, without a privileged change or a live experiment (`I-12`); every container hardening flag and every Docker behaviour is **unverified** (`I-6`, [SAFETY.md](disposable-test-v3/SAFETY.md) sections 7–8). **Execution stays blocked** until the decisions marked "required" are answered and `I-12` is decided.

## 2. All decisions, and their status

Every status below is **UNRESOLVED**. Nothing is approved.

| ID     | Subject                                                                                       | Required before the test | Status     |
| ------ | --------------------------------------------------------------------------------------------- | ------------------------ | ---------- |
| `I-1`  | Isolated container design instead of the shared container                                     | yes                      | UNRESOLVED |
| `I-2`  | Image pinned by locally observed image ID, no pull                                            | yes                      | UNRESOLVED |
| `I-3`  | Loopback port `15433`                                                                         | yes                      | UNRESOLVED |
| `I-4`  | Narrow admin exception (`docker exec` into the isolated container only)                       | yes                      | UNRESOLVED |
| `I-5`  | Docker lifecycle operations (closed list)                                                     | yes                      | UNRESOLVED |
| `I-6`  | Container hardening flags and limits                                                          | yes                      | UNRESOLVED |
| `I-7`  | Read-only look at existing Nook resources (recommend none)                                    | no                       | UNRESOLVED |
| `I-8`  | Identity-bound cleanup model                                                                  | no (follows `I-1`)       | UNRESOLVED |
| `I-9`  | Resources with a look-alike name or label but no record (recommend **no** automatic adoption) | no                       | UNRESOLVED |
| `I-10` | Separate revision 3 folder; revision 2 preserved                                              | no                       | UNRESOLVED |
| `I-11` | Extended authorization fields (token, lists)                                                  | yes                      | UNRESOLVED |
| `I-12` | **Host-service reachability: unresolved residual risk**                                       | **yes**                  | UNRESOLVED |
| `R-3`  | Temporary migrator credential                                                                 | yes                      | UNRESOLVED |
| `R-4`  | Exact runtime privilege matrix                                                                | yes                      | UNRESOLVED |
| `R-5`  | No `DELETE` on `sessions`                                                                     | yes                      | UNRESOLVED |
| `R-6`  | `TEMP` stays revoked                                                                          | yes                      | UNRESOLVED |
| `R-7`  | `INFO` observations are never counted                                                         | yes                      | UNRESOLVED |
| `R-9`  | Audit-event wording (not immutable against owners/superusers)                                 | acknowledgement          | UNRESOLVED |
| `R-15` | The runner-enforced package controls, for revision 3                                          | yes                      | UNRESOLVED |
| `R-16` | The execution authorization itself (section 5)                                                | yes                      | UNRESOLVED |

**Superseded by this register (also unapproved):** `R-1` (cluster-level access of the disposable roles) is answered by `I-1`; `R-2` (the admin exception) is replaced by `I-4` and `I-5`.

### Explicitly not decided, not approved, and not affected

`Q-3`, `Q-8`, `Q-9`, `Q-10`, `N-5`, the per-entity partial-unique-index scopes (and the preview `partialIndexes` feature), the lifecycle semantics, and the migration-generation strategy remain **open**. This task and this package approve none of them, and no result of the disposable test would approve them either. The twelve decisions recorded in the decision log (§4B) as approved _for planning only_ are unchanged.

## 3. Decisions

### I-1 — Run against a separate throwaway container instead of the existing Nook container

**Question.** Do you approve replacing the shared-container design (revision 2) with a separate, throwaway PostgreSQL container, volume and network, so the disposable roles exist only in a cluster that holds no protected data? (This is `R-1` option D.)
**Recommendation.** **Approve**, provided `I-2` to `I-6` and `I-12` are acceptable. It removes the cluster-level `CONNECT` exposure by construction, makes the admin path target only a cluster that holds nothing to protect, and replaces "drop objects inside a shared cluster" with "remove whole resources this run created".
**Risks and consequences.** A new class of side effect (creating and removing Docker resources); unobserved Docker behaviour ([SAFETY.md](disposable-test-v3/SAFETY.md) section 8); the residual risks in the design's section 8 (Docker socket power, shared VM resources, **host-gateway reachability, which revision 3 does not mitigate: see `I-12`**). Approving `I-1` does **not** approve running anything.
**Required before the test:** yes.
**Owner decision:** `[ ] APPROVE` `[ ] REJECT` `[ ] DEFER` Notes: `____________`

### I-2 — The image

**Question.** Use the locally present image `postgres:17.11-alpine`, pinned by its **image ID** and created with `--pull never` (no download), or pull a digest-pinned image?
**Recommendation.** Reuse the local image. No network, no extra disk, the same version as the development database. The owner reads the ID with a read-only local inspect at authorization time and quotes it; the token binds it; the runner compares it with the live local image and creates the container from that exact ID. **Unverified:** that `docker image inspect` and a container's `.Image` report the same ID form on this Docker Desktop (a containerd image store may differ), which would make the first run stop at the identity check. A pull is a separate, owner-gated action and is not designed here.
**Risk.** The image is shared read-only with the development container; pinning detects substitution but not a defect common to both.
**Required before the test:** yes.
**Owner decision:** `[ ] APPROVE reuse the local image` `[ ] REJECT (pull; digest: ____)` `[ ] DEFER` Notes: `____________`

### I-3 — The host port

**Question.** Which loopback port should the throwaway container publish? It is hard-coded in the package and in the token, must not be `5432` or `5433` (rejected in the runner, every Node script and the drift configuration), and must be free at preflight.
**Recommendation.** `15433`. Changing it later means a new manifest.
**Required before the test:** yes.
**Owner decision:** `[ ] APPROVE 15433` `[ ] REJECT (use: ______)` `[ ] DEFER` Notes: `____________`

### I-4 — The administrative connection (replaces `R-2`)

**Question.** Do you approve one explicit exception to "no Unix sockets": `docker exec` into the **recorded isolated container only**, its local socket, maintenance database `postgres` of that cluster, user `nook_iso_admin`, limited to the closed `admin_op` list ([SAFETY.md](disposable-test-v3/SAFETY.md) section 4: catalogue reads, `CREATE ROLE` ×2, `CREATE DATABASE`, `ALTER ROLE … PASSWORD` ×2, the beacon setting and its read-back)? Before every call the runner re-reads the container's ID, state and run label and refuses on any difference. There is no free-form SQL and no `DROP`.
**Why it is lower-risk than revision 2.** The cluster is new and empty, so the `postgres` database it reaches holds nothing to protect, and no `nook_dev` exists in it. **Residual:** `nook_iso_admin` is a superuser of that cluster, and local-socket access inside the container needs no password (unverified).
**Alternative.** Do the admin work over the TCP path as `nook_iso_admin`, which needs a new package design and still logs in as a superuser.
**Recommendation.** Approve the named exception.
**Required before the test:** yes.
**Owner decision:** `[ ] APPROVE the exception` `[ ] REJECT (TCP alternative)` `[ ] DEFER` Notes: `____________`

### I-5 — The Docker lifecycle exception

**Question.** May the runner create and remove **its own** network, volume and container through the closed `docker_op` list ([SAFETY.md](disposable-test-v3/SAFETY.md) section 3), where every operation names only a recorded full ID or an exact run-derived name, is preceded by an identity check before any state change, and where no wildcard, `prune`, forced removal, `kill`, `compose`, `pull`, `run` or system-wide command exists?
**Options.** **A.** The runner does it (as designed). **B.** You create the three resources yourself with reviewed commands and the runner only verifies them and removes nothing; this lowers the runner's side effects but moves risk to manual steps and leaves cleanup to you (and is not implemented: it would need another revision).
**Recommendation.** **A.** A static scan shows the Docker CLI is called from exactly three functions and that no forbidden verb, flag or wildcard exists. **Limit:** there is a time-of-check to time-of-use window between an identity check and the following command.
**Required before the test:** yes.
**Owner decision:** `[ ] APPROVE option ___ (A or B)` `[ ] REJECT` `[ ] DEFER` Notes: `____________`

### I-6 — Container hardening and limits

**Question.** Accept these creation options: `--restart no`, `--memory 1g`, `--pids-limit 512`, `--security-opt no-new-privileges`, one loopback publish, one dedicated network, one named volume, `--pull never`, no privileged mode, no host mounts, no links, and an environment file with only the new administrator credentials (deleted right after `docker create`)?
**Recommendation.** Approve as a starting point, **knowing that none of it is verified**: the image was not started and its entrypoint was not read ([SAFETY.md](disposable-test-v3/SAFETY.md) section 7). `no-new-privileges` is generally compatible with an entrypoint that drops privileges by `setuid`, but that is general reasoning, not evidence for this image. If any flag is incompatible, the run fails at `docker start` or readiness, stops safely, and the options must be revised (a new hash). `--cap-drop`, `--read-only`, `--user`, `--tmpfs`, ulimits and log options are deliberately **not** included.
**Required before the test:** yes.
**Owner decision:** `[ ] APPROVE` `[ ] REJECT` `[ ] DEFER` Notes: `____________`

### I-7 — Any look at the existing Nook resources

**Question.** The design makes no stage depend on, inspect or require the existing Nook container, volume or database. Should it additionally take an optional, read-only, `INFO`-only snapshot of the existing container's identity before and after?
**Options.** **A.** No snapshot (cleanest boundary; non-interference rests on structure: a static scan shows no command names an existing resource, and the new container shares no network, mount or port). **B.** Optional `INFO` snapshot, never blocking (not implemented: it would need another revision).
**Recommendation.** **A.** Revision 3 implements A.
**Required before the test:** no (default A).
**Owner decision:** `[ ] APPROVE option ___ (A or B)` `[ ] REJECT` `[ ] DEFER` Notes: `____________`

### I-8 — Cleanup model

**Question.** Is cleanup "stop and remove the container, then the volume, then the network, each after an identity check against its record, plus the local files, then a final listing", with **no** `DROP DATABASE` or `DROP ROLE` inside the cluster? Local secrets are removed **first** and reported separately from Docker cleanup (`local_secrets=` and `docker_resources=` in `out/cleanup.status`). If Docker is unavailable, cleanup says resources may remain and removes nothing; `recover` (separately authorized) lists them and removes only recorded ones.
**Recommendation.** Yes. Removing the whole container removes every role and database it held, so inner drops would only add admin operations.
**Required before the test:** no (follows from `I-1`; confirm).
**Owner decision:** `[ ] APPROVE` `[ ] REJECT` `[ ] DEFER` Notes: `____________`

### I-9 — Resources that carry a look-alike name or label but have no record

**Question.** If the runner crashes between a Docker create and writing its record, or anything else with a `nook-iso-` name or this run's label exists without a matching record, should the runner ever **adopt** it for cleanup, or only report it and require a manual owner review?
**Recommendation (revised from v0.1): reject automatic adoption.** An unrecorded resource cannot be proven to be this run's; even an exact label could in principle be copied by someone else. Revision 3 therefore reports it as `UNRECORDED` or `AMBIGUOUS`, leaves it untouched, marks cleanup `INCOMPLETE-OR-AMBIGUOUS`, and gives the owner no command that removes it. The same rule makes preflight refuse to start when any such resource already exists. **Consequence:** after a crash in that narrow window, the owner reviews and removes the resource by hand.
**Required before the test:** no (the package already implements the recommendation).
**Owner decision:** `[ ] NO automatic adoption (report only; recommended)` `[ ] ADOPT only when the exact name AND the exact run label match (needs another revision)` `[ ] DEFER` Notes: `____________`

### I-10 — Revision 3 and the fate of revision 2

**Question.** Revision 3 lives in the new folder `docs/nook-phase-2/disposable-test-v3/` and revision 2 stays byte-identical in `disposable-test/` as evidence of what was reviewed. Once revision 3 passes review, is revision 2 retired (never executed), or kept as a possible fallback?
**Recommendation.** New folder as built; revision 2 retired and never executed, but kept in place as evidence.
**Required before the test:** no.
**Owner decision:** `[ ] APPROVE` `[ ] REJECT` `[ ] DEFER` Notes: `____________`

### I-11 — Extended authorization

**Question.** Should the authorization token bind, in addition to the manifest, the stage list and the run directory: the unique run id, the PostgreSQL image ID, the port, the exact container, volume and network names, and the egress acknowledgement? The exact text is `manifest=<hash>;stages=<sorted list>;rundir=<dir>;runid=<run id>;image=<image id>;port=15433;container=nook-iso-pg-<run id>;volume=nook-iso-vol-<run id>;network=nook-iso-net-<run id>;egress=residual-risk-unresolved`.
**The token is a checksum, not a digital signature and not a secret.** It detects accidental or unauthorized drift only when combined with this written authorization. It does **not** protect against a malicious operator who can recompute it, and the runner treats a valid token as nothing more than the explicit written authorization it quotes.
**Permitted and forbidden operation lists, stop conditions and evidence:** see the draft in section 5.
**Recommendation.** Approve.
**Required before the test:** yes.
**Owner decision:** `[ ] APPROVE` `[ ] REJECT` `[ ] DEFER` Notes: `____________`

### I-12 — Host-service reachability from the throwaway container (new; unresolved residual risk)

**Question.** On Docker Desktop a container can normally reach host services through the host gateway, including `127.0.0.1:5433` (the existing Nook development database). A new network and a new port do not change that. Revision 3 examined the static options ([SAFETY.md](disposable-test-v3/SAFETY.md) section 6): an internal network or no network would probably remove the loopback test path and needs a live experiment; host firewall or Docker-VM rules need a privileged change that is forbidden here; the other ideas are not egress controls. **Egress isolation cannot be established by design.** What do you decide?
**Options.**

- **A. Accept the residual risk** and allow the test to proceed, with these compensating measures that reduce likelihood but enforce nothing: the container gets no development credential or URL (the verifier refuses any such marker in its environment), the credentials are random and new, only reviewed SQL runs and there is no free-form SQL path, the package contains no code that connects anywhere but `127.0.0.1:15433` and the throwaway container, and every test connection verifies the beacon. The authorization must then carry the acknowledgement `NOOK_EGRESS_RISK_ACK=residual-risk-unresolved`. If the image or PostgreSQL were abused, nothing here would stop an outbound connection to a host service.
- **B. Keep execution blocked** and authorize a separate, bounded design (and experiment) for a network-restricted approach. This needs another package and its own authorization.
- **C. Reject the isolated approach.**

**Options analysis (2026-10-29).** [A separate analysis](PHASE_2_SLICE_2_2_I12_EGRESS_OPTIONS_ANALYSIS.md) compared a no-network container, a shared-namespace client, an internal network, a separate VM, host firewall rules, and non-enforcing measures. **None could be established as enforceable from the available evidence, and nothing was observed.** The only option that offers a boundary by construction without a privileged change or installation is a **container with no network (`--network none`) whose tests run inside it** (a "revision 4"). It removes the host TCP path, so it needs a redesign that defers or rewrites up to 12 of the 130 `ENFORCE` ids (`T-PW1`–`T-PW8`, `S1`, `S5`, `S6`, `S7`); the 118 SQL-suite ids are unaffected. Host firewall or Docker-VM changes are forbidden here. Separation (a new network, port, volume or credential) is not enforcement.
**Option B, made concrete:** keep execution blocked; separately authorize a revision 4 design based on the no-network container; then separately authorize a bounded verification of the boundary (network mode `none` seen in an inspect before start, an in-container routing table and interface list, a refused connection to an owner-started canary listener that is **not** `5433`) before any test package is run. **I-12 cannot be resolved without a separate authorization.**
**Recommendation.** **B.** I do **not** recommend treating this as settled by revision 3. **A** is the only way to proceed with revision 3, and it proceeds with the risk, not without it. **C** is available if you do not want to invest in isolation.
**Required before the test:** **yes. Until this is decided, execution stays blocked.**
**Owner decision:** `[ ] APPROVE option ___ (A, B or C)` `[ ] REJECT` `[ ] DEFER` Notes: `____________`

## 4. Carried-over decisions (unchanged text in the [earlier register](OWNER_REVIEW_SLICE_2_2.md), re-asked for revision 3)

These decisions keep their meaning. Their full question, options and recommendation are in the earlier register; only what revision 3 changes is stated here. Revision 3 did **not** change `sql/provision.sql`, `sql/tests_owner.sql` or `sql/counts.sql`, so the privilege matrix is unchanged.

### R-3 — Temporary migrator credential

The migrator gets a random 128-bit password in a 0600 file, set with statement logging switched off for that session (**still unverified on a real server**), after a negative test proves it cannot log in without one. Revision 3 adds a second credential: the isolated cluster's administrator `nook_iso_admin`, whose random password lives in an environment file that is deleted right after `docker create` (Docker keeps it in the container's configuration until the container is removed). Local secrets are removed first at cleanup and reported separately. **Recommendation:** approve, as before.
**Required before the test:** yes. **Owner decision:** `[ ] APPROVE` `[ ] REJECT` `[ ] DEFER` Notes: `____________`

### R-4 — Exact runtime privilege matrix

Unchanged and byte-identical: `nook_app_test` has `SELECT`/`INSERT`/`UPDATE` on the eight business tables, **`SELECT`/`INSERT` only** on `audit_events`, and **no `DELETE`, `TRUNCATE`, `REFERENCES` or `TRIGGER`** anywhere; `CONNECT` on `nook_test` and `USAGE` on schema `public` only; `TEMP` not granted. Proposed grants for the test only, not the production grant set. **Recommendation:** approve for the test.
**Required before the test:** yes. **Owner decision:** `[ ] APPROVE` `[ ] REJECT` `[ ] DEFER` Notes: `____________`

### R-5 — No `DELETE` on `sessions`

Unchanged (tests `A-LP17`, `V08`). **Recommendation:** option A, no `DELETE` on `sessions` for the test; expired sessions end by `UPDATE` of `revoked_at` or a privileged job, to be decided in slice 2.3.
**Required before the test:** yes. **Owner decision:** `[ ] APPROVE option ___ (A or B)` `[ ] REJECT` `[ ] DEFER` Notes: `____________`

### R-6 — `TEMP` stays revoked

Unchanged (test `A-LP8`). Results come back client-side, so nothing needs `TEMP`. **Recommendation:** keep it revoked.
**Required before the test:** yes. **Owner decision:** `[ ] APPROVE keep revoked` `[ ] REJECT (grant it; justification: ____)` `[ ] DEFER` Notes: `____________`

### R-7 — Informational observations are never counted

Changed list for revision 3: `A-INFO1` and `V19` now record connect rights on `template1` of the throwaway cluster (they no longer name the development database); `V17`, `V18`, `V20`, `A-INFO2`, `O-AUD1`/`O-AUD2`, `A-AU8`, `O-FK5`, `A-SES5`, `O-FK7*`, the three drift comparisons and `S2`–`S4` remain `INFO`; the role-session snapshots **no longer exist**; a new `ISO-BEACON` result is class `ENV` (must pass, reported separately). The acceptance count is the same **130 `ENFORCE` ids**; `ENV`, `FIXTURE` and `INFO` are never counted, and an `INFO` result reported as a pass is a failure. **Recommendation:** approve.
**Required before the test:** yes. **Owner decision:** `[ ] APPROVE` `[ ] REJECT` `[ ] DEFER` Notes: `____________`

### R-9 — Audit-event wording

Acknowledge: runtime-role access to `audit_events` is limited to `INSERT` and `SELECT`. **The table is not immutable:** its owners and superusers can still update, delete, truncate, disable triggers on and drop audit rows, and the runtime role can still insert rows with any content. No claim of immutability or tamper evidence is made, and the trigger proposed elsewhere stays unapproved. **Recommendation:** approve the wording.
**Required before the test:** acknowledgement only. **Owner decision:** `[ ] APPROVE` `[ ] REJECT` `[ ] DEFER` Notes: `____________`

### R-15 — The runner-enforced controls of revision 3

**Question.** Do you approve these controls as prepared, in the package whose manifest hash is in section 1? All are static and none was executed.

| Control                     | Revision 3                                                                                                                                                                                                                                                                                                                      |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Authorization token         | Binds manifest, stages, run directory, run id, image ID, port, the three resource names and the egress acknowledgement                                                                                                                                                                                                          |
| Stage allow-list            | Hard-coded stage set; a stage runs only if listed; `all` only if listed with every constituent; `env_up`, `create` and `all` require `cleanup`                                                                                                                                                                                  |
| Run directory               | Exactly `disposable_pg_<run id>`; new for `preflight` and `all`; existing and bound to the same run id otherwise                                                                                                                                                                                                                |
| Evidence                    | A stage with saved output is refused; a rerun needs a new run id, directory and authorization; `cleanup`, `recover` and `report` move earlier output aside under a timestamp                                                                                                                                                    |
| Docker and admin operations | Closed `docker_op` and `admin_op` lists; the Docker CLI is called from three functions only; arguments validated; no wildcard, forced removal, `prune`, `compose`, `pull`, `run`                                                                                                                                                |
| Identity checks             | Container, network and volume compared with their records (ID, labels, image ID, mounts, networks, loopback port, `CreatedAt`, no host mounts, no development markers) before creation completes, before start, at each stage and before each removal; the logic is a pure function with an offline self-test (62 expectations) |
| Unrecorded look-alikes      | Reported, never adopted, never removed (`I-9`); preflight refuses if any exist                                                                                                                                                                                                                                                  |
| Cleanup and recovery        | Local secrets first and reported separately; identity-checked removal only; Docker unavailable is reported as not performed; `recover` is separate and list-only unless confirmed                                                                                                                                               |
| Beacon                      | Every test connection reads `nook.iso_run_id` back and must equal the recorded run id; the Prisma CLI's own connection is bracketed by two separate checks                                                                                                                                                                      |
| Independent verification    | Mandatory before every session with ordinary tools; the runner's own check is circular                                                                                                                                                                                                                                          |

**Honest limits.** The token is a checksum (see `I-11`). Time-of-check to time-of-use windows remain. Nothing in the package blocks host-service egress (`I-12`). Every Docker and PostgreSQL behaviour in [SAFETY.md](disposable-test-v3/SAFETY.md) section 8 is unverified.
**Options.** **A.** Approve revision 3 as prepared. **B.** Ask for changes (a new hash and a new review).
**Recommendation.** **A**, after reading `I-12` and SAFETY.md.
**Required before the test:** yes. **Owner decision:** `[ ] APPROVE option ___ (A or B)` `[ ] REJECT` `[ ] DEFER` Notes: `____________`

### R-16 — The execution authorization itself

The draft in section 5 is a **template, not an authorization**. It replaces the draft in section 6 of the earlier register for revision 3.
**Required before the test:** yes. **Owner decision:** `[ ] AUTHORIZE (section 5, completed and signed)` `[ ] DO NOT AUTHORIZE` `[ ] DEFER` Notes: `____________`

## 5. Proposed execution authorization — a draft, not an authorization

> **DRAFT. NOT AN AUTHORIZATION.** The owner must edit it, choose the options, fill every placeholder and sign. Until then nothing may run. Drafting it is not permission to execute it, and a valid token is never permission beyond what is written and signed here.

**5.1 Package and token.** I authorize the package in `docs/nook-phase-2/disposable-test-v3/` whose `MANIFEST.sha256` has SHA-256 `<OWNER CONFIRMS: ____________ (point in time: 8c1e0b8c…c619; re-verify)>`, the stages ticked in 5.2, the run id and run directory in 5.3, the image ID and port in 5.4, and the resources in 5.5, and **only** those. They are bound by one token: the SHA-256 of the exact text in `I-11`. The operator computes it with an ordinary tool, reads it back to me, and passes it as `NOOK_DISPOSABLE_TEST_AUTH`. Any change to any of them voids this authorization. Token: `<OPERATOR COMPUTES; OWNER CONFIRMS: ____________>`. _The token is a checksum, not a signature._

**5.2 Permitted stages, individually.** `[ ] preflight` `[ ] env_up` `[ ] create` `[ ] migrator_login` `[ ] schema` `[ ] provision` `[ ] inventory` `[ ] test_owner` `[ ] test_app` `[ ] test_tcp` `[ ] drift` `[ ] test_pool` `[ ] cleanup` `[ ] report` `[ ] all`. `all` is permitted only if it and every other box above are ticked. `env_up`, `create` and `all` are refused unless `cleanup` is ticked; always tick `cleanup` and `report`. `recover` is **not** included and needs its own authorization and token.

**5.3 Run id and directory.** Run id `<OWNER CHOOSES: iso<UTC yyyymmddThhmmssZ>-<4 hex>>`; directory exactly `/private/tmp/disposable_pg_<run id>`, which must not exist yet, is used for **one** attempt, and is never reused.

**5.4 Image and port.** Image `postgres:17.11-alpine`, image ID `<OWNER READS WITH A READ-ONLY LOCAL INSPECT: sha256:____________>`, created with `--pull never`; port `127.0.0.1:15433`.

**5.5 Maximum creation and cleanup.** Exactly one network `nook-iso-net-<run id>`, one volume `nook-iso-vol-<run id>` and one container `nook-iso-pg-<run id>`; inside the cluster, the administrator `nook_iso_admin`, two roles, `nook_test` with the draft's 9 tables, 5 enum types, indexes and synthetic rows plus the scratch probe table the owner suite creates and drops; in the run directory, `out/`, `records/`, `secrets/` (0600 files) and `drift/` copies. **Nothing else may be created.** Cleanup first deletes this run's local secret files, then stops and removes only the container, volume and network whose identities match their records, then lists what remains.

**5.6 Connection classes.** Class 1 (TCP `127.0.0.1:15433`, `nook_test`, the two roles, beacon verified); Class 2 (`docker exec` into the one recorded container, closed `admin_op` list; decision `I-4`: `<OWNER CHOOSES>`); Class 3 (the closed `docker_op` list; decision `I-5`: `<OWNER CHOOSES: A or B>`).

**5.7 Permitted operations.** The Docker operations in the SAFETY.md section 3 table against the recorded IDs and names; `docker context show`; `docker info`; local `docker image inspect` of the pinned tag; label and name filtered `ps`, `volume ls` and `network ls`; `lsof` on port `15433`; `ipconfig`; one `nc -z -w 3` to the host's own LAN address on port `15433` (expected refused); `df`; `openssl rand`; `shasum`; TCP to `127.0.0.1:15433` by the package's Node scripts and by the Prisma CLI as the runtime role.

**5.8 Forbidden.** Any Docker operation naming an existing Nook resource; running a container; forced removal; `kill`; any `prune`; `compose`; `pull`; `system`; `cp`; `commit`; wildcards or command substitution over resource lists; any use of port `5432` or `5433`; any `nook_dev` credential or URL; any connection to `nook_dev` or the host PostgreSQL; shadow databases; `prisma migrate dev`, `deploy`, `reset`, `db push`; changes to firewall rules, Docker daemon configuration, the existing database, its grants, volume, network or container; starting Docker; dependency installs; repository edits; Git operations; reuse of a run directory; running any stage not ticked; any step when a precondition in the design's section 5 does not hold.

**5.9 Egress (`I-12`).** Host-service reachability from the throwaway container is **not blocked**. Owner's choice: `[ ] A. I accept the residual risk; NOOK_EGRESS_RISK_ACK=residual-risk-unresolved` `[ ] B or C: do not run`.

**5.10 Known unverified behaviours the owner accepts.** Every item in SAFETY.md section 8, every hardening flag in section 7 (`I-6`), the effect of the log suppression on `ALTER ROLE`, `psql` behaviour, introspection by the runtime role in the Prisma CLI (a failure is reported as BLOCKED, not retried with more privilege), and the `28P01` assumption. A failure in any of these stops the run, is reported as found, and is never a reason to widen privileges or targets.

**5.11 Stop conditions.** A hash or token difference; a stage not in the authorized list; an existing run directory or stage output; a Docker context other than `desktop-linux` or `default`; an unreachable daemon; an image ID that differs from the authorization; any container, volume or network carrying the disposable label, this run's label or the `nook-iso-` prefix before creation; a port in use; a disk reading below 5.5 GiB; an identity difference at any check; a published port other than exactly `127.0.0.1:15433`; a cluster that is not fresh; a beacon mismatch; a failed or ambiguous creation; any missing, duplicate, unexpected or failing result; a shadow-database mention; anything ambiguous. After a stop, only `cleanup` runs; nothing is removed by guesswork, and an `UNRECORDED` or `AMBIGUOUS` resource is left for the owner.

**5.12 Required post-cleanup evidence.** The saved `out/` files and `report` output; the cleanup lines showing each resource's identity check and removal; `out/cleanup.rc` and `out/cleanup.status` with `local_secrets=` and `docker_resources=` reported **separately** (`docker_resources=verified` only if nothing labelled with the run id or the `nook-iso-` prefix remains); the image ID unchanged; no container, volume or network named by the run other than the three; test results and cleanup results reported separately; every skipped or failed check and why; and what was **not** proven (including egress isolation).

**5.13 Operator procedure.** (1) Before **every** session, in the package folder, run `shasum -a 256 MANIFEST.sha256`, `shasum -a 256 -c MANIFEST.sha256` and a file-list comparison with ordinary tools, **not** the runner's `verify_package`; compare with 5.1. (2) Compute the token with the `printf … | shasum -a 256` command in the package README and read it back to the owner. (3) Invoke only ticked stages, one per invocation, with the exact environment. (4) Never invoke `all` unless ticked. (5) After a failed stage do not rerun it; run `cleanup`, then `report`, and ask for a new authorization. (6) Never print or log a password. (7) If anything is unclear, stop and ask.

**5.14 Residual risks accepted** (tick each): `[ ] host-service egress is not blocked (I-12 option A)` `[ ] the token is a checksum, not a signature` `[ ] password and environment files on disk until cleanup, and the administrator password in the container configuration until removal` `[ ] Docker and PostgreSQL behaviours are unverified and a first run may fail` `[ ] hardening flags are unverified` `[ ] the Docker socket is root-equivalent and the Docker VM is shared with the development container` `[ ] a crash between a Docker create and its record leaves a resource for manual review`.

**Owner:** `____________` **Date:** `____________` **Decision:** `[ ] AUTHORIZE the above` `[ ] DO NOT AUTHORIZE`

## 6. What this register did not do

It did not run any stage, SQL, Prisma, Docker, database or network command and did not create, inspect or remove any resource. It did not edit revision 2, `scripts/db_guard.py`, the scope manifest, the decision log or any production file. It approved nothing, and it does not authorize or execute the test.
