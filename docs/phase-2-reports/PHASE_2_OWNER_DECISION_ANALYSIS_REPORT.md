# Phase 2 — Owner Decision Analysis and Implementation Readiness Report

**Prepared:** 2026-10-31  
**Status:** Analysis and recommendations only. No owner responses filled, no code modified, no execution performed.

---

## A. All 22 Decisions with Technical Recommendations

### Group A — Required Before Boundary Verification (7 decisions)

---

#### **V4-1 — Adopt the no-network design**

| Aspect | Detail |
|--------|--------|
| **Exact question** | Replace revision 3's bridge-network-and-published-port design with a container created with network mode `none` and no published port, where every database test runs inside the container through `docker exec` and `psql`? |
| **Why necessary** | This is the foundational architectural direction for Revision 4. It removes the external database-test path without firewall changes or installations. |
| **Available choices** | Accept direction; reject and request another design; defer |
| **Technical recommendation** | **APPROVE — direction only** |
| **Security implications** | Removes host port exposure entirely. However, network mode `none` is not proof of host isolation (kernel/VM sharing remains). The Docker socket remains root-equivalent. |
| **Operational implications** | All tests must run via `docker exec` and `psql` inside the container. No host TCP client, no Prisma CLI, no Node pool tests. Requires rewritten checks. |
| **Effect on implementation** | Sets the constraint for all downstream test design. The disposable test package is built around this direction. |
| **Consequences of choosing incorrectly** | If rejected, Revision 4 stops; Revision 3 does not auto-authorize. An alternative needs explicit review. If approved but boundary unverified, false confidence in isolation. |
| **Dependencies** | Coordinate with I-12 option B. V4-2, I-6, BV-NET-1, BV-CANARY-1, V4-8 required before boundary authorization. |
| **Blocks** | Boundary verification authorization (Group A gate) |

---

#### **I-12 — Host-service reachability**

| Aspect | Detail |
|--------|--------|
| **Exact question** | A container on Docker Desktop can normally reach host services through the host gateway; separation is not enforcement. Revision 3 could not block this. Current proposed solution: the no-network container of revision 4. Which path: A) accept residual risk and proceed with revision 3; B) keep execution blocked and pursue revision 4 and its boundary verification; C) reject the isolated approach? |
| **Why necessary** | Docker Desktop's host gateway allows containers to reach host services. Different names/passwords don't block this path. This decision chooses whether to accept that risk or pursue evidence-based isolation. |
| **Available choices** | A: accept Revision 3 with unresolved reachability risk; B: pursue no-network design and separate verification; C: reject isolated approach; defer |
| **Technical recommendation** | **APPROVE — option B only, as the path choice** |
| **Security implications** | Option B preserves the requirement for evidence instead of treating separation as enforcement. One canary endpoint cannot represent every host service. A dedicated control network may have outbound connectivity. |
| **Operational implications** | Choosing B delays testing but exposes uncertainty explicitly. Residual risk review depends on actual boundary evidence (V4-9). |
| **Effect on implementation** | Path choice precedes boundary authorization. Accepting remaining risk depends on evidence. |
| **Consequences of choosing incorrectly** | Option A proceeds with risk and no enforcement. Option C gives up isolation. Option B delays but is the only path with evidence requirement. |
| **Dependencies** | Review alongside V4-1. Resolving path precedes boundary authorization; residual-risk review after boundary evidence (V4-9). |
| **Blocks** | Boundary verification authorization (path choice required); residual risk acceptance (V4-9) blocked until evidence exists |

---

#### **V4-2 — Image identity and pinning procedure**

| Aspect | Detail |
|--------|--------|
| **Exact question** | Use the locally present `postgres:17.11-alpine`, referenced by an image ID that the owner reads with a read-only local inspect during an authorized preflight and quotes in the authorization, which the runner compares with the live local image, creates from with `--pull never`, and never pulls or modifies? |
| **Why necessary** | Binds the review to repeatable image contents and avoids a download. The exact image ID is currently unknown and recorded nowhere in the package. |
| **Available choices** | Approve local-ID pinning; reject and design alternative (including digest-pinned alternative); defer |
| **Technical recommendation** | **APPROVE — the pinning procedure only** |
| **Security implications** | A pinned defect remains a defect. Image-ID representation may differ across inspection fields (containerd image store may differ). Image-declared volumes or missing client tools could invalidate the canary proposal. |
| **Operational implications** | Requires a separately authorized read-only local metadata read: full `sha256:` ID, declared volumes, defaults, available tools. Must match eventual created container image identity without pulling. |
| **Effect on implementation** | Both canaries and database runner use the same pinned image. The concrete ID must be established before any creation authorization. |
| **Consequences of choosing incorrectly** | If the image ID form differs between `docker image inspect` and container `.Image`, the first run stops at identity check. Downloading is not a fallback. |
| **Dependencies** | V4-1/I-12 establish the path. Concrete image facts must be reviewed with I-6 and BV-CANARY-1 before V4-8. |
| **Blocks** | Boundary verification authorization (concrete ID/configuration required) |

---

#### **I-6 — Hardening flags and compatibility (unverified)**

| Aspect | Detail |
|--------|--------|
| **Exact question** | For the database runner, accept creation options: `--network none`, `--security-opt no-new-privileges`, `--memory 1g`, `--pids-limit 512`, `--restart no`, one named volume, `--pull never`, environment file with only new administrator credentials (deleted after `docker create`), no privileged mode, host mounts, Docker socket, host network or published port? For canaries: `sleep 600` entrypoint, shared image ID, same limits, no-new-privileges, default user/capabilities, no credentials, no published ports, subject uses `none`, control uses dedicated network, both propose `--tmpfs /var/lib/postgresql/data:rw,noexec,nosuid,nodev,size=64m` instead of Docker volume. |
| **Why necessary** | Flags reduce risk and weaken nothing, but none are verified as compatible with PostgreSQL entrypoint. Canary storage differs from database runner (tmpfs vs named volume). |
| **Available choices** | Approve concrete configuration with known limits; request redesign; defer pending image/storage facts |
| **Technical recommendation** | **DEFER — complete canary configuration until image/storage details established** |
| **Security implications** | Canary-only tmpfs must cover image's sole declared volume destination. Suitability unestablished. Unexpected destinations/mounts stop the plan. Default user/capabilities and security-profile behavior remain relevant. `no-new-privileges` compatibility with PostgreSQL entrypoint (which drops to `postgres` user via setuid) is general reasoning, not evidence. |
| **Operational implications** | Canary scope is V4-8 prerequisite; PostgreSQL scope must be reviewed before database authorization. Never run PostgreSQL verifier on canaries. |
| **Effect on implementation** | Two separate scopes: canary (boundary verification) and database runner (database testing). They differ in entrypoint, command, environment, identity labels, storage, and network. |
| **Consequences of choosing incorrectly** | Incompatible flag makes run fail at `docker start`; options need revising (new hash). Anonymous volume creation would violate no-volume design. |
| **Dependencies** | Concrete V4-2 image metadata first; review alongside BV-NET-1/BV-CANARY-1. |
| **Blocks** | Boundary verification authorization (canary scope); database-test authorization (PostgreSQL scope) |

---

#### **BV-NET-1 — Dedicated boundary-verification network and scope**

| Aspect | Detail |
|--------|--------|
| **Exact question** | Approve exactly three Docker resources: one dedicated network (`nook-bv-net-<runid>`), one subject (`nook-bv-subject-<runid>` with `--network none`), one control (`nook-bv-control-<runid>` attached only to recorded network ID). Run ID format: `bvYYYYMMDDtHHMMSSz-hhhh`. Labels: `com.nook.boundary-verification=true`, `com.nook.boundary-run=<runid>` plus role labels. Record full 64-char hex IDs immediately after create in `/private/tmp/nook_boundary_<runid>/records/`. Collision checks use exact names and run label only; any collision stops task. No broad enumeration fallback. Cleanup verifies all recorded identities before each stop/removal; containers before empty network. |
| **Why necessary** | Run-specific membership and identity records scope the control and cleanup. Makes ownership and cleanup reviewable. |
| **Available choices** | Approve specified three-resource scope; reject and request another reviewed design; defer |
| **Technical recommendation** | **APPROVE — design and identity rules only**, subject to open endpoint and storage prerequisites |
| **Security implications** | Dedicated bridge has `Internal=false`, `Ingress=false`, `Attachable=false`, IPv6 disabled. It may provide outbound routing — not an egress firewall or proof of host isolation. Short random suffixes can collide; labels can be imitated; check/use races remain. |
| **Operational implications** | Exact identities, scoped queries, pending-record handling, and cleanup procedure must be followed. Missing records or collisions mean stop, never adoption. |
| **Effect on implementation** | Defines the exact Docker resources for boundary verification. The runner does not implement this plan. |
| **Consequences of choosing incorrectly** | Shared default bridge, existing project network, or fourth container not permitted as fallback. Cleanup must use recorded IDs with verified identity; recovery needs separate permission. |
| **Dependencies** | V4-1/I-12 path; V4-2/I-6 and BV-CANARY-1 must be coherent before V4-8. |
| **Blocks** | Boundary verification authorization |

---

#### **BV-CANARY-1 — Exact endpoint, readiness and one-attempt protocol**

| Aspect | Detail |
|--------|--------|
| **Exact question** | Select and approve one exact numeric IP literal, address family and TCP port (never 5432, 5433, 15433), owner-managed host listener implementation/bind/process identity, dedicated-network reachability mapping, readiness/continuous-health signal, fixed request/response with run/role markers, pre-existing client and exact arguments, logs and shutdown procedure. |
| **Why necessary** | Control success is necessary to interpret subject failure. Host loopback and container loopback are different destinations. A suggested host bind is not evidence of a reachable control endpoint. |
| **Available choices** | Approve concrete details once available; reject and request amendment; defer |
| **Technical recommendation** | **DEFER — no exact endpoint, port, or executable method is established** |
| **Security implications** | Wrong target, listener outage, hidden retries, NAT attribution, missing logs, or missing client can produce misleading results. Application logs record accepted connections, not every failed packet. |
| **Operational implications** | Single positive-control test: one TCP attempt within 5 seconds, exact response, successful client exit, attributable canary log. Only on control success does subject attempt same endpoint/client/options within 30 seconds with 5-second deadline. No retries or alternate endpoints. |
| **Effect on implementation** | The canary endpoint is the linchpin of boundary verification. Without it, no meaningful boundary test can proceed. |
| **Consequences of choosing incorrectly** | A mistaken target cannot be "uncontacted"; changing endpoint requires renewed review. Control failure or unclear refusal = inconclusive, not isolation pass. |
| **Dependencies** | V4-2/I-6 image/tool facts and BV-NET-1 network scope; V4-1/I-12 direction. Concrete completion required before boundary authorization under V4-8. |
| **Blocks** | Boundary verification authorization (must be resolved in concrete form) |

---

#### **V4-8 — Boundary verification design; execution requires separate authorization**

| Aspect | Detail |
|--------|--------|
| **Exact question** | Approve the future verification design: exactly one dedicated network, a no-network subject, a control attached only to that network, an owner-managed host canary, manual configuration/namespace observations, one control attempt followed only on success by one subject attempt to the same endpoint, identity-checked cleanup, and an evidence report? |
| **Why necessary** | Reviews the whole proposed safety experiment and what its report could establish before deciding whether to commission a concrete run. |
| **Available choices** | Approve design with explicit unresolved implementation gates; reject; defer until procedure is concrete |
| **Technical recommendation** | **DEFER — final design sign-off until all six other Group A prerequisites and concrete procedure details are reviewed** |
| **Security implications** | Manual checks can be missed; the runner implements none of this plan. Missing observations or failed control cannot count as isolation. Cleanup/recovery may be interrupted. |
| **Operational implications** | Design approval ≠ execution authorization. A separate written execution authorization with exact commands/arguments, scope, identities, cleanup and stop rules is required. |
| **Effect on implementation** | This is the gate that, once all prerequisites are met and design approved, allows a separate boundary authorization to be issued. |
| **Consequences of choosing incorrectly** | Premature design approval with unresolved endpoint/tools/storage would be mistaken for a runnable plan. |
| **Dependencies** | V4-1, I-12 option B, V4-2, I-6 canary scope, BV-NET-1, BV-CANARY-1. Must address M3/L2/L5/L6 and concrete gate table. |
| **Blocks** | Boundary verification authorization (design gate) |

---

### Group B — Required Before Database-Test Authorization (14 decisions)

---

#### **V4-9 — Acceptance or rejection of residual isolation risks**

| Aspect | Detail |
|--------|--------|
| **Exact question** | After the boundary evidence is in hand, do you accept what remains: the boundary is evidence, not proof; the Docker socket is root-equivalent; the Docker VM and host kernel are shared; Docker keeps the administrator password in the container's configuration until removal; the token is a checksum, not a signature; there is a time-of-check to time-of-use window; and acceptance is incomplete? |
| **Why necessary** | A risk decision made before the measurement cannot account for its findings. A 64-hex report reference is not a verified report. |
| **Available choices** | Accept specified residual risks after evidence; reject; defer |
| **Technical recommendation** | **DEFER — no boundary evidence exists for review** |
| **Security implications** | Accepting early accepts an unmeasured risk. Docker access is root-equivalent; VM/kernel resources shared; one endpoint doesn't cover all host services; admin credential remains in container config; token is a checksum; identity checks have race windows; test acceptance incomplete. |
| **Operational implications** | Must review full report and raw artifacts, verified resource identities, successful control, interpretable subject result, continuous canary health, cleanup accounting, differences from PostgreSQL configuration, and explicit untested-path/risk statement. |
| **Effect on implementation** | Database execution stays blocked until this is resolved after boundary evidence. |
| **Consequences of choosing incorrectly** | Risk acceptance cannot reverse a later incident. Easy to withhold/revise before execution; difficult after exposure. |
| **Dependencies** | All Group A design gates, separate boundary authorization and its actual evidence; review comparability with database form of I-6 and scope under V4-6. |
| **Blocks** | Database-test authorization (after boundary evidence) |

---

#### **V4-3 — Resource naming and identity verification**

| Aspect | Detail |
|--------|--------|
| **Exact question** | Use run id `nn<UTC timestamp>-<4 hex>` chosen by owner; container `nook-nn-pg-<runid>` and volume `nook-nn-vol-<runid>`; labels `com.nook.disposable`, `com.nook.nn-run`, `com.nook.package-manifest`; built-in `none` network; preflight refuses any container/volume with disposable label, this run's label, or `nook-nn-` prefix; identities recorded as container's full ID and volume's `CreatedAt` bound into authorization of every stage after `create`; collision checks before creation and identity checks after recording; no automatic adoption of unrecorded look-alike. |
| **Why necessary** | Makes the database runner prove it uses this attempt's throwaway container and storage. Distinct labels/prefixes mean Revision 3 and 4 resources cannot be mistaken for each other. |
| **Available choices** | Approve source-defined model; reject and redesign; defer |
| **Technical recommendation** | **APPROVE — design only, with M4/L6 coverage limits** |
| **Security implications** | Verifier checks what Docker reports, not behavior. Time-of-check to time-of-use window exists. Docker output shape for `none` container unverified. Crash between create and record leaves resource for manual review. |
| **Operational implications** | Full container ID and volume `CreatedAt` recorded and bound to later stages. Unrecorded resources not adopted. Database collision queries include disposable-label and `nook-nn-` prefix scope. |
| **Effect on implementation** | Required before database-test authorization. Coordinate with V4-4, V4-5, I-5. |
| **Consequences of choosing incorrectly** | Never rename/reuse a run to hide a mismatch; later attempts need fresh identities and authorization. |
| **Dependencies** | V4-1/V4-2 and database I-6; coordinate V4-4, V4-5, I-5. Not required for boundary canaries. |
| **Blocks** | Database-test authorization |

---

#### **V4-4 — Exact allowed stage list**

| Aspect | Detail |
|--------|--------|
| **Exact question** | Allow exactly 14 stages: 11 ordinary (`preflight`, `create`, `start`, `bootstrap`, `password_pre`, `schema`, `provision`, `test_inventory`, `test_owner`, `test_app`, `test_password`), 2 closing (`cleanup`, `report`), 1 recovery (`recover`). No `all` stage; each invoked separately. Main authorization covers 13 stages (11+2); recovery needs own written authorization and token. Runner refuses `create` unless `cleanup` listed. |
| **Why necessary** | Two-phase authorization lets owner review created identities before starting/using the database. Avoids implicit permission for later stages. |
| **Available choices** | Approve exact model; reject and redesign; defer |
| **Technical recommendation** | **APPROVE — stage policy only, with written recovery separation** |
| **Security implications** | Runner does not mechanically prevent `recover` from appearing in same allowed-stage list as ordinary stages (M3) — separation is policy, not enforcement. Cleanup also removes resources. Failed ordinary stage cannot be rerun in same directory. |
| **Operational implications** | Many separate authorizations (token is two-phase: after `create`, recorded container ID and volume `CreatedAt` added). `cleanup` and `report` may repeat but earlier output moved aside. |
| **Effect on implementation** | Defines the stage execution model for the disposable test runner. |
| **Consequences of choosing incorrectly** | Later permission can be withheld but completed steps not undone by unticking them. |
| **Dependencies** | V4-3 identity model; coordinate V4-5, I-5. V4-10 must name stages and cleanup/report handling before any create permission. |
| **Blocks** | Database-test authorization |

---

#### **V4-5 — Cleanup and recovery model**

| Aspect | Detail |
|--------|--------|
| **Exact question** | Cleanup: local secrets first (reported separately), then stop and remove container and volume each after identity check against record, never forced; final listing reports anything remaining as recorded-but-present or `UNRECORDED`; no `DROP` inside cluster; no Docker network to remove. `recover` is separate stage that lists by default and removes only recorded resources when `NOOK_RECOVER_CONFIRM=remove-recorded-resources-only`. If Docker unavailable, cleanup says resources may remain and removes nothing. |
| **Why necessary** | Agrees how temporary credentials, database container, and storage would be removed, and how unresolved leftovers reported. |
| **Available choices** | Approve documented/source-qualified model; reject and redesign; defer |
| **Technical recommendation** | **APPROVE — lifecycle design only, acknowledging removal is destructive and unverified** |
| **Security implications** | Docker outages, interruption, and create-to-record crashes can leave resources. Same cleanup core serves ordinary cleanup and recovery. Source does not perform second full container check between stop and removal (M4). Error/absence handling needs careful evidence review. |
| **Operational implications** | Local secrets handled first even when Docker unavailable. Recorded container/volume identity gates removal. Unrecorded/pending resources need owner review, not adoption. |
| **Effect on implementation** | Defines the cleanup and recovery procedure for the disposable test lifecycle. |
| **Consequences of choosing incorrectly** | Removed container/volume contents lost. Preserve required evidence before disposal; changing policy later cannot restore removed data. |
| **Dependencies** | V4-3 records, V4-4 stage scope, I-5 lifecycle exception; coordinate R-3 secret handling. V4-10 must cover cleanup before any create permission. |
| **Blocks** | Database-test authorization |

---

#### **I-4 — In-container access exception (revision 4 form)**

| Aspect | Detail |
|--------|--------|
| **Exact question** | Approve one explicit exception to "no Unix sockets and no in-container access": runner may `docker exec` into the one recorded container only, re-checking ID, state, run label before every call, to run: (a) `pg_isready` on container's loopback; (b) `psql` as `nook_iso_admin` over local socket through closed `admin_op` list; (c) `psql` as `nook_migrator_test` or `nook_app_test` over local socket running only exact allow-list of reviewed SQL files (5 package files + hash-pinned draft SQL), each preceded by beacon check; (d) password checks writing 0600 `pgpass` to fixed path in container's `/tmp` via stdin, running `psql -h 127.0.0.1` with `-w`, removing files with fixed `rm -f` of four fixed paths, including fixed `-c` login queries and direct TCP read of `counts.sql`? |
| **Why necessary** | With no host connection, in-container access is the only test path. Every call is identity-checked, no free-form SQL, passwords never as arguments or environment values. |
| **Available choices** | Approve this exact scope; reject and redesign; defer |
| **Technical recommendation** | **APPROVE — source-qualified exception only** |
| **Security implications** | `nook_iso_admin` is superuser of throwaway cluster. Local-socket authentication expected to need no password (unverified), so SQL suites run as disposable roles without one. Exception wider than Revision 3 (SQL suites and file writes, not only administration). `docker exec` into `none`-network container and `psql` notice/error texts unobserved. |
| **Operational implications** | Per-exec check compares ID/state/run label; not full reinspection before every SQL statement. SQL-file allow-list validates files; role/file pairings selected at call sites, not enforced as matrix. Direct password/count paths don't all prepend SQL-file beacon guard (L1). |
| **Effect on implementation** | Enables all database test execution inside the container. Not a prerequisite for boundary verification. |
| **Consequences of choosing incorrectly** | Owner suites create/change synthetic data and scratch table; permissions cannot undo executed SQL. Alternative is a new design. |
| **Dependencies** | V4-1 and database I-6; review V4-3 identity checks and R-policy scope together. |
| **Blocks** | Database-test authorization |

---

#### **I-5 — Docker lifecycle exception (revision 4 form)**

| Aspect | Detail |
|--------|--------|
| **Exact question** | May the runner create and remove its own volume and container through the closed `docker_op` list of 13 operations (`ctx_show`, `daemon_version`, `image_id`, `list`, `vol_create`, `ctr_create`, `ctr_inspect`, `ctr_quick`, `ctr_start`, `ctr_stop`, `ctr_rm`, `vol_inspect`, `vol_rm`), where context/daemon checks name no resource, image lookup uses fixed tag, listings use label/prefix filters, creation uses derived names with collision checks and records identity afterwards, later operations use recorded identities with checks actually present in source? No network operation, port publishing, wildcard, prune, forced removal, kill, compose, pull, run, or system-wide command exists. |
| **Why necessary** | Decides whether the database runner may later create and dispose of its own container and volume through restricted Docker operations. |
| **Available choices** | A: runner manages its own resources (as designed); B: owner creates them, runner only verifies/removes nothing (not implemented); reject; defer |
| **Technical recommendation** | **APPROVE — option A as a design only** |
| **Security implications** | Docker access is powerful. List/context/image lookup and create operations do not verify already-recorded resource. Full checks at source-defined points with check/use race and no second full check between stop/removal (M4). PATH/context timing remain L5 limits. |
| **Operational implications** | Closed operation list is reviewable and avoids inventing a second manual workflow. Option B is not a safe switch that already exists. |
| **Effect on implementation** | Enables the runner to manage the full disposable database lifecycle. Boundary-network operations are outside this exception. |
| **Consequences of choosing incorrectly** | Rejecting future permission is easy; removing a volume or acting on wrong resource cannot be reversed by revising the decision. |
| **Dependencies** | V4-3 records, V4-4 stage model, V4-5 cleanup; coordinate V4-10. |
| **Blocks** | Database-test authorization |

---

#### **R-3 — Temporary migrator credentials**

| Aspect | Detail |
|--------|--------|
| **Exact question** | Give the migrator a random 128-bit password in a 0600 file, set with statement logging switched off for that session, after a negative test proves it cannot log in without one, and cleaned up first at cleanup? |
| **Why necessary** | Credential lifecycle for an authorized disposable run: negative checks first, random password, restricted files, logging suppression during password change, local-secret cleanup first. |
| **Available choices** | Approve described temporary-credential policy; reject and redesign; defer |
| **Technical recommendation** | **APPROVE — test credential policy only, with source limitations** |
| **Security implications** | 0600 files readable by other processes of same user — not an isolation boundary against that user. Server log suppression unobserved. Administrator password stays in container environment/configuration until removal, unlike tested-role passwords carried through stdin/pgpass. |
| **Operational implications** | Avoids real credentials and supports positive/negative password checks. In Revision 4, does not make every owner SQL session password-authenticated: owner suites use local socket. |
| **Effect on implementation** | Defines how temporary database credentials are generated, used, and cleaned up. |
| **Consequences of choosing incorrectly** | Deleted temporary secrets cannot be recovered from decision record and must never be printed there. |
| **Dependencies** | I-4 access paths, V4-5 cleanup, database I-6; coordinate V4-6 interpretation of password checks. |
| **Blocks** | Database-test authorization |

---

#### **R-4 — Exact least-privilege matrix**

| Aspect | Detail |
|--------|--------|
| **Exact question** | Approve this matrix for the runtime role: `SELECT`/`INSERT`/`UPDATE` on `organizations`, `users`, `memberships`, `sessions`, `properties`, `floors`, `rooms`, `beds`; `SELECT`/`INSERT` only on `audit_events`; no `DELETE`, `TRUNCATE`, `REFERENCES`, `TRIGGER` anywhere; `CONNECT` on `nook_test`, `USAGE` on `public` only; `TEMP`, database `CREATE`, schema `CREATE` not granted; no grant options, role memberships, default-ACL changes? |
| **Why necessary** | Chooses the smallest proposed set of database actions available to the application's test role. Aligns with Q-6 audit limits, N-1's no-delete direction, N-3's migrator ownership. |
| **Available choices** | Approve exact test matrix; reject and specify justified alternative; defer |
| **Technical recommendation** | **APPROVE — test-only matrix** |
| **Security implications** | Table-level UPDATE includes tenant and other sensitive columns. No row-level security: foreign keys reject invalid writes but don't enforce tenant-specific reads. Audit INSERT can contain arbitrary content. |
| **Operational implications** | Test grants, not production grant set (Q-7 records exact grants and procedure still need review). |
| **Effect on implementation** | Defines the exact GRANT statements in `provision.sql` for the disposable test. |
| **Consequences of choosing incorrectly** | Changing grants later cannot undo writes permitted earlier; new matrix needs new test evidence. |
| **Dependencies** | Existing Q-6/Q-7/N-1/N-3 directions; review R-5, R-6, R-9 together. I-4/I-5 and lifecycle decisions govern execution, not logical matrix. |
| **Blocks** | Database-test authorization |

---

#### **R-5 — No DELETE permission on sessions**

| Aspect | Detail |
|--------|--------|
| **Exact question** | Is the runtime role also refused `DELETE` on `sessions` in the test (the stricter reading of `N-1`, which excludes `sessions` from "business tables" but grants it nothing)? Option A: retain no DELETE; B: propose DELETE on sessions only. |
| **Why necessary** | Decides whether the application test role can physically erase session rows or must leave deletion to a separately justified process. |
| **Available choices** | A: retain no DELETE; B: propose DELETE on sessions only; reject; defer |
| **Technical recommendation** | **APPROVE — option A for the test** |
| **Security implications** | Retaining rows requires eventual retention/cleanup policy; allowing deletion could remove useful history. Changing `revoked_at` is not proof that authentication code enforces revocation. |
| **Operational implications** | Matches current package and grants nothing unjustified. Session lifecycle/cleanup design remains a later Slice 2.3 decision. |
| **Effect on implementation** | Enforces no DELETE on sessions in the test grant matrix. |
| **Consequences of choosing incorrectly** | An erased row cannot be restored by later revoking the permission. Easy to retain restriction; potentially destructive to grant and use deletion. |
| **Dependencies** | R-4 matrix and N-1 constraint. |
| **Blocks** | Database-test authorization |

---

#### **R-6 — Keep TEMP revoked**

| Aspect | Detail |
|--------|--------|
| **Exact question** | Keep `TEMP` revoked from `PUBLIC` and the runtime role? |
| **Why necessary** | Keeps the runtime role from creating temporary database tables during this test. |
| **Available choices** | Keep TEMP revoked; propose granting it with reason; defer |
| **Technical recommendation** | **APPROVE — keep revoked** |
| **Security implications** | Future workload may need TEMP and would fail under this policy; granting it would add object creation and resource-use capabilities that current tests don't require. |
| **Operational implications** | Current package does not need temporary tables. Avoiding unused permission keeps test scope smaller. |
| **Effect on implementation** | `provision.sql` and inventory include refusal check (A-LP8). |
| **Consequences of choosing incorrectly** | Easy at design time. Later change requires newly reviewed package and evidence; should not be toggled during run to bypass failure. |
| **Dependencies** | Review with R-4. |
| **Blocks** | Database-test authorization |

---

#### **R-7 — INFO observations do not count as enforced tests**

| Aspect | Detail |
|--------|--------|
| **Exact question** | Are observations marked `INFO` reported separately and never counted as acceptance, with `REWRITTEN` counted separately and `DEFERRED` never a pass? |
| **Why necessary** | Keeps observations, setup checks, rewritten tests, and omitted tests visibly separate so useful output is not mistaken for a proven requirement. |
| **Available choices** | Approve the classification; request justified revised classification and corresponding test design; defer |
| **Technical recommendation** | **APPROVE — reporting policy** |
| **Security implications** | An INFO result may reveal a significant weakness; ignoring it would still be wrong. ENV/FIXTURE failures invalidate context even though they add no acceptance passes. |
| **Operational implications** | Prevents inflated pass totals and makes missing coverage visible. Runner's exit code alone is not acceptance evidence (L4). |
| **Effect on implementation** | Defines how test results are classified and reported. |
| **Consequences of choosing incorrectly** | Corrections must preserve earlier reports and explicitly retract overstated conclusions. |
| **Dependencies** | Read test-class explanation and coordinate V4-6. Cannot waive A7/N-4. |
| **Blocks** | Database-test authorization |

---

#### **R-9 — Audit integrity wording and its limits**

| Aspect | Detail |
|--------|--------|
| **Exact question** | Acknowledge: "Runtime-role access to `audit_events` is limited to `INSERT` and `SELECT`. Table owners and superusers can still update, delete, truncate, disable triggers on and drop audit rows, and the runtime role can still insert rows with any content. No claim of immutability or tamper evidence is made." The proposed audit trigger stays unapproved. |
| **Why necessary** | Describes the audit table accurately: ordinary application permissions restrict edits, but the table is not an immutable or tamper-evident record. |
| **Available choices** | Acknowledge the current limit; reject as insufficient and request stronger design; defer |
| **Technical recommendation** | **APPROVE — acknowledge the limits** |
| **Security implications** | Owners/superusers can alter or remove audit rows; runtime role can insert arbitrary content. Privilege restrictions do not establish truthful events, tamper detection, or retention guarantees. |
| **Operational implications** | Matches recorded Q-6 direction and avoids promising security the grant model cannot provide. |
| **Effect on implementation** | Wording/policy acceptance only; not permission to add a trigger or function. |
| **Consequences of choosing incorrectly** | Later protections cannot establish that earlier stored events were authentic. |
| **Dependencies** | Existing Q-6 and proposed R-4 matrix. Stronger trigger/function needs separate manifest/scope decision. |
| **Blocks** | Database-test authorization (acknowledgement only) |

---

#### **V4-6 — Treatment of the network-dependent tests**

| Aspect | Detail |
|--------|--------|
| **Exact question** | Accept (a) the seven rewritten password checks as testing the same security properties by a different path, (b) their counting as a separate class from the unchanged enforced tests, and (c) the deferral of eleven tests that need Node, the Prisma adapter, the Prisma CLI or a host TCP client? |
| **Why necessary** | Accepts that this limited package tests some password properties differently and cannot run eleven checks that depend on client libraries or an external database connection. |
| **Available choices** | Accept bounded rewrites/classification and temporary gap; reject that scope; defer |
| **Technical recommendation** | **APPROVE — only the bounded rewrite/classification and explicit temporary deferral**, with qualifications; do not accept full equivalence or waived requirements |
| **Security implications** | Loopback `psql` tests useful database behavior without recreating host path. Cannot substitute for Node pool behavior, Prisma-adapter behavior, or drift comparisons. Wrong-password checks match message text, not SQLSTATE; missing-password refusals are client-side. Empty-string case absent. Neither `pg` library nor host forwarding exercised. |
| **Operational implications** | 118 unchanged + 7 rewritten + 5 deferred enforced = 130 ENFORCE ids from Revision 3. Acceptance incomplete by construction. |
| **Effect on implementation** | Defines the test matrix for Revision 4. Rewritten tests use container's own loopback via `psql` (libpq), not host port or `pg` library. |
| **Consequences of choosing incorrectly** | If rejected, current test plan insufficient for owner's intended evidence; redesign or separately authorized additional environment needed. V4-7 is not a prerequisite for a limited run that keeps the gap open. |
| **Dependencies** | V4-1 path; R-7 accounting and I-4 access semantics should be agreed with it. |
| **Blocks** | Database-test authorization |

---

#### **V4-10 — Final execution authorization**

| Aspect | Detail |
|--------|--------|
| **Exact question** | Authorize the draft in section 5 of the register, completed and signed, for named database-test stages? |
| **Why necessary** | The final gate that authorizes specific named database-test stages to run. |
| **Available choices** | Authorize; reject; defer |
| **Technical recommendation** | **DO NOT AUTHORIZE NOW. Leave unanswered.** |
| **Security implications** | Authorizing early would run an unexecuted package on an unproven boundary. Boundary unverified, image ID unknown, boundary evidence doesn't exist, no recorded identities exist yet. |
| **Operational implications** | Owner reads image ID with read-only inspect, chooses run ID and directory, supplies evidence hash, authorizes `preflight` and `create` first, reviews recorded identities, authorizes later stages separately. `recover` needs own written authorization. |
| **Effect on implementation** | This is the actual execution gate for database tests. |
| **Consequences of choosing incorrectly** | Running without boundary evidence and prerequisites reviewed would violate the authorization model. |
| **Dependencies** | All Group B prerequisites, boundary evidence reviewed, V4-9 resolved. |
| **Blocks** | Database-test execution (final gate) |

---

### Group C — Can Be Deferred (1 decision)

---

#### **V4-7 — Do the deferred tests require a separate environment?**

| Aspect | Detail |
|--------|--------|
| **Exact question** | Eleven tests need Node, the Prisma adapter, the Prisma CLI or a host TCP client. Should a second, separately designed and authorized environment run them, should they wait for a later phase, or may Slice 2.2 evidence accept their deferral? |
| **Why necessary** | Determines the disposition of 11 deferred tests (5 enforced: T-PW3, S1, S5, S6, S7; 6 informational: S2, S3, S4, D1, D2, D3) before claiming acceptance. |
| **Available choices** | Approve a second environment; wait for later phase; accept deferral; reject; defer |
| **Technical recommendation** | **DEFER the choice until the boundary evidence exists** |
| **Security implications** | Options (shared-namespace client container, another approach) each need their own design and boundary reasoning. Deferred drift comparisons (D1–D3) and pool tests (S*) were meant to support Q-4b evaluation (approved for evaluation only); that evidence won't exist from Revision 4. |
| **Operational implications** | A pass of Revision 4 must not be read as covering deferred tests. Full acceptance never claimed until deferred tests run and accepted, or deferral explicitly accepted. |
| **Effect on implementation** | Does not block initial boundary observation or limited database run. Must be addressed before acceptance considered complete. |
| **Consequences of choosing incorrectly** | Silent weakening of existing acceptance requirements. |
| **Dependencies** | Boundary evidence exists; V4-6 classification agreed. |
| **Blocks** | Slice 2.2 evidence completeness (before acceptance considered complete) |

---

## B. Dependency and Priority Matrix

### Priority 1 — Required Before Boundary Verification (Group A)

| Decision | Direct Dependencies | Blocks |
|----------|---------------------|--------|
| V4-1 | None (foundational) | All Group A, Group B |
| I-12 (option B) | V4-1 | All Group A, Group B |
| V4-2 | V4-1, I-12 | I-6 (canary), BV-CANARY-1, V4-8 |
| I-6 (canary scope) | V4-2, V4-1, I-12 | BV-CANARY-1, V4-8 |
| BV-NET-1 | V4-1, I-12, V4-2, I-6 | V4-8 |
| BV-CANARY-1 | V4-2, I-6, BV-NET-1, V4-1, I-12 | V4-8 |
| V4-8 | All above 6 decisions | Boundary execution authorization |

**Recommended resolution order for Group A:**
1. V4-1 (direction)
2. I-12 option B (path choice)
3. V4-2 (image pinning procedure)
4. I-6 canary scope (with V4-2 concrete image metadata)
5. BV-NET-1 (network/resource design)
6. BV-CANARY-1 (concrete endpoint — **critical path blocker**)
7. V4-8 (design sign-off after all 6 prerequisites concrete)

---

### Priority 2 — Required Before Database-Test Authorization (Group B)

| Decision | Direct Dependencies | Blocks |
|----------|---------------------|--------|
| V4-3 | V4-1, V4-2, database I-6 | V4-4, V4-5, I-5, V4-10 |
| V4-4 | V4-3 | V4-10 |
| V4-5 | V4-3, V4-4, I-5 | V4-10 |
| I-4 | V4-1, database I-6 | V4-10 |
| I-5 | V4-3, V4-4, V4-5 | V4-10 |
| R-3 | I-4, V4-5, database I-6 | V4-10 |
| R-4 | Q-6, Q-7, N-1, N-3 | V4-10 |
| R-5 | R-4, N-1 | V4-10 |
| R-6 | R-4 | V4-10 |
| R-7 | V4-6 | V4-10 |
| R-9 | Q-6, R-4 | V4-10 |
| V4-6 | V4-1, R-7, I-4 | V4-10 |
| V4-9 | All Group A, boundary evidence | V4-10 |
| V4-10 | All above + boundary evidence | Database-test execution |

**Recommended resolution order for Group B:**
1. V4-3 (identity model) — after Group A path established
2. V4-4 (stage list) — with V4-3
3. V4-5 (cleanup/recovery) — with V4-3, V4-4
4. I-4 (in-container access) — with V4-1, database I-6
5. I-5 (Docker lifecycle) — with V4-3, V4-4, V4-5
6. R-3 (credentials) — with I-4, V4-5
7. R-4 (privilege matrix) — with Q-6/Q-7/N-1/N-3
8. R-5 (no DELETE sessions) — with R-4
9. R-6 (TEMP revoked) — with R-4
10. R-7 (INFO classification) — with V4-6
11. R-9 (audit integrity) — with Q-6, R-4
12. V4-6 (network-dependent tests) — with V4-1, R-7, I-4
13. V4-9 (residual risk) — **after boundary evidence only**
14. V4-10 (execution auth) — **last, after all above + boundary evidence**

---

### Priority 3 — Can Be Deferred (Group C)

| Decision | Dependencies | Blocks |
|----------|--------------|--------|
| V4-7 | Boundary evidence; V4-6 | Slice 2.2 acceptance completeness |

**Resolution:** After V4-9 and V4-10, before claiming Slice 2.2 acceptance complete.

---

## C. Security and Architecture Concerns

### 1. Canary Endpoint and Tooling Feasibility (BV-CANARY-1 — **CRITICAL BLOCKER**)

**Status:** **UNRESOLVED — no exact endpoint, port, listener, or client established.**

**Concerns:**
- The boundary verification plan requires a host listener reachable from the dedicated bridge network. If the listener binds only to host loopback (127.0.0.1), the container on the dedicated bridge **cannot reach it** without additional Docker daemon configuration (host-gateway, host networking, or port proxy).
- The plan explicitly forbids firewall/daemon changes or installations to make a result pass.
- The container's `127.0.0.1` is its own namespace, not the host's.
- No pre-existing client in the pinned `postgres:17.11-alpine` image is confirmed for the chosen endpoint.
- The "earlier loopback-listener suggestion and example port are not selections" — this is a **design gap**, not a deferred detail.

**Recommendation:** This must be resolved concretely before V4-8 design sign-off. Options to investigate:
- Host listener on `0.0.0.0:<port>` reachable via Docker's internal gateway (typically 172.17.0.1 or 192.168.65.2 on Docker Desktop)
- Use of `host.docker.internal` DNS (Docker Desktop only, resolves to host)
- A dedicated host-network proxy container (but this adds a 4th resource, forbidden by BV-NET-1)
- Reconsidering whether the positive control should use a different network mode

**Risk if ignored:** Boundary verification cannot proceed; all downstream database testing stays blocked.

---

### 2. Image and Storage Isolation (V4-2, I-6)

**Status:** Image ID unknown; canary tmpfs override unvalidated.

**Concerns:**
- The `postgres:17.11-alpine` image's `Config.Volumes` must declare exactly `/var/lib/postgresql/data` for the canary tmpfs override to work. If the image declares additional or different volume destinations, anonymous volumes will be created, violating the no-volume design.
- The database runner uses a named volume at `/var/lib/postgresql/data` — different from canary tmpfs. Comparability of evidence is limited.
- `docker image inspect --format '{{.Id}}'` and container `.Image` may report different ID forms (containerd image store difference) — this would stop the first run at identity check (unverified behavior #8 in SAFETY.md).
- The image was not started, pulled, or inspected; entrypoint not read.

**Recommendation:** A separately authorized read-only image metadata inspection is required before any creation authorization. This must establish: full sha256 ID, declared volumes, default user, entrypoint, available client tools (psql, pg_isready).

---

### 3. Conflicting Authorization-Draft Wording (L2, M3, M4, L1, L5, L6, L7)

**Status:** Documented in decision sheet Section A1 — **none resolved.**

**Key conflicts:**
- **L2:** Revision 4 register says "13 stages, no `all`" and lists `recover` in same sentence; runner defines 14 stages. This sheet corrects to 11+2+1 but register wording unchanged.
- **L2:** Register says Revision 3 decisions I-1 through I-5 not re-asked, yet Revision 4 relies on modified I-4 and I-5. Both asked explicitly here and stay unresolved.
- **M3:** Recovery separation rationale overstated — cleanup performs same identity-bound removal. Runner does not mechanically enforce separation.
- **M4:** I-5 description overstates identity checks on list, image lookup, creation operations.
- **L1:** I-4 should mention fixed `-c` SQL statements and `counts.sql` read; SQL allow-list is per-file while roles paired at call sites.
- **L5:** PATH resolution, Docker-context check timing, inherited `DX_PGPASSFILE` are same-user threat-model limitations.
- **L6:** Verifier does not check every possible container configuration field.
- **L7:** SAFETY.md's "14 call sites in `docker_op`" conflates call sites and operations (13 named branches, 14 CLI invocations because `list` has container and volume variants).

**Impact:** These are documentation/code discrepancies in pinned packages. Any correction requires a new revision/hash and separate authorization. They must be explicitly acknowledged in authorization documents.

---

### 4. Deferred and Rewritten Test Acceptance (V4-6, V4-7)

**Status:** V4-6 has recommendation; V4-7 deferred.

**Concerns:**
- **7 rewritten tests (PWC1–PWC8)** use container loopback `psql` (libpq), not host port or `pg` library. They match on server message text, not SQLSTATE `28P01`. `PWC4`/`PWC5` (no password) refused client-side by libpq — weaker than server-side refusal.
- **T-PW3 (empty-string password)** has no equivalent — libpq treats empty as none — deferred rather than faked.
- **11 deferred tests total:** 5 enforced (`T-PW3`, `S1`, `S5`, `S6`, `S7`) + 6 informational (`S2`, `S3`, `S4`, `D1`, `D2`, `D3`).
- `S1`, `S5` test shared pool behavior (client-library, no database-side equivalent).
- `S6`, `S7` test Prisma adapter path (privilege covered by SQL suites, but adapter path not).
- `D1`–`D3` drift comparisons need Prisma CLI.
- **Q-4b (partial-index evaluation)** approved for evaluation only; its evidence (drift/pool tests) will not come from Revision 4.

**Recommendation:** V4-6's bounded approval is correct — accept rewrites as separate class, deferrals as open gap. V4-7 must be explicitly resolved before claiming Slice 2.2 acceptance complete. A separate environment for deferred tests needs its own design, boundary reasoning, and authorization.

---

### 5. Database Role Separation and Least Privilege (R-4, R-5, R-6, R-9, Q-7)

**Status:** R-4, R-5, R-6, R-9 have APPROVE recommendations; Q-7 direction approved but exact grants/procedure not reviewed.

**Concerns:**
- **R-4 matrix:** `UPDATE` on all columns including tenant columns. No row-level security — reads not isolated by database. Foreign keys reject invalid writes but don't enforce tenant-specific reads.
- **R-5:** No DELETE on sessions — requires eventual retention/cleanup policy (Slice 2.3).
- **R-6:** TEMP revoked — future workload needing TEMP would fail.
- **R-9:** Audit table not immutable — owners/superusers can alter/delete/truncate; runtime role can insert arbitrary content. No tamper evidence.
- **Q-7:** Exact runtime grants and provisioning procedure still need review. Application-role password handling beyond "local, never committed" open. Read-only diagnostic role proposed but not decided.
- **N-3:** Tables owned by migrator role; runtime role owns none. Migrator role name, whether container superuser `nook` stands in locally, and CI usage unresolved.

**Recommendation:** Test-only matrix approved. Production grants/provisioning (Q-7) requires separate review before production schema implementation. RLS (U-08) remains OPEN — time-boxed spike after approval.

---

### 6. Tenant Isolation and Composite Constraints

**Status:** Designed, not proven (PHASE_2_TENANT_ISOLATION.md: "Until I-1 through I-5 pass, the only honest statement is: tenant isolation is designed, not proven.")

**Concerns:**
- **Composite FKs** with overlapping columns (`organization_id` appears in multiple relations) — Prisma 7.10.1 support must be VALIDATED (V-1 in data model).
- **Cross-tenant write rejection** by PostgreSQL must be tested (V-2).
- **Partial unique indexes** with `WHERE archived_at IS NULL` — must survive `prisma migrate dev` and `migrate diff` without spurious drift (V-3).
- **RLS (U-08)** remains OPEN — if adopted, needs pool/transaction/migration-role handling worked out and tested.
- **Negative test suite (XT-01 through XT-35)** must run against real PostgreSQL with real application role, not mocks.
- **Mutation test (I-3):** Deliberately remove scope predicate and confirm suite fails.

**Dependencies:** All require disposable PostgreSQL test environment (Slice 2.1 exit) and approved schema (G-03, U-27).

---

### 7. Authentication and Session Security (U-01 through U-06)

**Status:** All UNRESOLVED in Phase 2 register; U-01 approved in decision log (1A) as server-side opaque sessions with CSRF.

**Concerns:**
- **U-01:** Decision log records APPROVE for server-side opaque sessions (not JWT). This conflicts with brief's "JWT authentication planned". Resolution: ADR-004 proposes server-side sessions; decision log 1A approves this.
- **U-02:** Idle/absolute expiry, cookie SameSite, CSRF strategy — no defaults allowed; required before any shared environment.
- **U-03:** Password hashing — argon2id (native dep) vs scrypt (node:crypto, no new dep) vs bcrypt. Decide at scaffold time.
- **U-04:** Login identifier (email) and recovery channel (BR-SEC-006) — recovery blocked until channel approved.
- **U-05:** MFA required for owners in shared environments.
- **U-06:** Rate limits — throttling dependency is U-22.

**Critical path:** U-01, U-02, U-03, U-06, U-07 (role baseline) block Slice 2.3.

---

### 8. Prisma Schema and Migration Strategy

**Status:** No schema written, no migrations exist (K-4). Generator `prisma-client-js` vs `prisma-client` unresolved (U-26).

**Concerns:**
- **U-26 (VALIDATE):** Prisma 7.10.1 CLI templates use `prisma-client`; schema uses `prisma-client-js`. No client generated in this checkout. Behavior of older generator with Prisma 7 unverified (S-05).
- **Migration generation method** unresolved: `prisma migrate dev --create-only` on `nook_dev` vs `prisma migrate diff --from-empty` — neither approved (decision log §4B item 6).
- **Partial indexes (Q-4b):** Preview feature in Prisma 7.10.1; adoption in production schema not approved. Hand-written partial indexes and plain unique indexes remain alternatives.
- **Composite FKs with overlapping columns** — Prisma support must be validated (V-1).
- **Drift detection (V-3):** Partial unique indexes, CHECK constraints, audit trigger must survive `migrate dev` and `migrate diff` without spurious drift.
- **CI guard (N-4):** PostgreSQL-service CI job added with first migration — job definition (image tag, steps) not decided.

**Critical path:** U-26 spike authorized (A8) subject to A3, A6, disk gate. Must complete before Slice 2.1 exit.

---

### 9. CI Enforcement and Disposable Database Safety

**Status:** CI never run on clean clone (S-07, G-02 unverified). Disposable test packages (Rev 2/3/4) never executed.

**Concerns:**
- **S-07:** `.github/workflows/ci.yml` exists but no hosted run verified. Lint/format fail on untracked `marketing/` files.
- **S-04:** Disk at 99% (~2.1 GiB free) — installing images, building, generating clients can fail halfway.
- **S-03:** Unrelated PostgreSQL 16 on 127.0.0.1:5432; docker-compose.yml publishes 5432 — collision.
- **C2:** Owner confirmed 5433 on 127.0.0.1 only.
- **C1:** Minimum 5 GiB free before each Docker start, image pull, or install — stricter 5.5 GiB required for boundary verification.
- **Disposable test safety:** Runner token is checksum, not signature; time-of-check/time-of-use window; cleanup depends on Docker; SQL/Docker/PostgreSQL assumptions never run.

**Recommendation:** Disk must be re-measured before every action. Tooling guard needed to refuse non-local hosts/unexpected database names (S-03). Hosted CI verification (G-02) required before any push.

---

## D. Recommended Owner Decision Order

### Phase 1: Boundary Verification Prerequisites (Group A) — **Do First**

| Order | Decision | Type | Notes |
|-------|----------|------|-------|
| 1 | V4-1 | APPROVE (direction) | Foundational; enables all else |
| 2 | I-12 | APPROVE option B | Path choice; residual risk stays open |
| 3 | V4-2 | APPROVE (procedure) | Pinning procedure; concrete ID later |
| 4 | I-6 (canary) | DEFER → APPROVE after V4-2 metadata | Need image metadata first |
| 5 | BV-NET-1 | APPROVE (design) | With I-6 canary scope coherent |
| 6 | BV-CANARY-1 | **RESOLVE CONCRETELY** | **Critical blocker — endpoint must be specified** |
| 7 | V4-8 | DEFER → APPROVE after 1–6 concrete | Design sign-off only; execution auth separate |

**Gate:** After 1–7 resolved, issue **separate written boundary authorization** with exact commands, context, evidence directory, duration, endpoint, readiness, timing, stop/cleanup conditions.

### Phase 2: Boundary Evidence Review

| Order | Decision | Type | Notes |
|-------|----------|------|-------|
| 8 | V4-9 | DEFER → RESOLVE after evidence | Accept/reject residual risks based on actual report |

### Phase 3: Database Test Prerequisites (Group B) — **After Phase 2**

| Order | Decision | Type | Notes |
|-------|----------|------|-------|
| 9 | V4-3 | APPROVE (design) | With M4/L6 limits |
| 10 | V4-4 | APPROVE (stage policy) | With written recovery separation |
| 11 | V4-5 | APPROVE (lifecycle) | Acknowledging destructive/unverified |
| 12 | I-4 | APPROVE (exception) | Source-qualified only |
| 13 | I-5 | APPROVE option A (design) | Runner-managed lifecycle |
| 14 | R-3 | APPROVE (credential policy) | With source limitations |
| 15 | R-4 | APPROVE (test-only matrix) | Production grants separate (Q-7) |
| 16 | R-5 | APPROVE option A | No DELETE on sessions |
| 17 | R-6 | APPROVE | Keep TEMP revoked |
| 18 | R-7 | APPROVE | Reporting policy |
| 19 | R-9 | APPROVE | Acknowledge audit limits |
| 20 | V4-6 | APPROVE (bounded) | Rewrites separate class; deferrals open gap |
| 21 | V4-10 | **DO NOT ANSWER UNTIL ALL ABOVE + V4-9** | Final execution authorization |

### Phase 4: Acceptance Completeness (Group C)

| Order | Decision | Type | Notes |
|-------|----------|------|-------|
| 22 | V4-7 | RESOLVE before acceptance complete | Second environment? Later phase? Accept deferral? |

---

## E. Remaining Phase 2 Implementation Roadmap

Adapted to actual dependencies and current state:

### Milestone 0: Close Mandatory Owner Decisions (Current)
- [ ] **Group A decisions (7)** — resolve for boundary verification design
- [ ] **Boundary verification separate authorization** — after Group A concrete
- [ ] **Execute boundary verification** — collect evidence
- [ ] **V4-9** — resolve residual risks from evidence
- [ ] **Group B decisions (14)** — resolve for database-test authorization
- [ ] **V4-10** — authorize named database-test stages

### Milestone 1: Slice 2.1 — Environment and Database Foundation
**Entry conditions (from implementation plan):**
- G-01 subset: ADR-001, ADR-003, ADR-011 approved (decision log: A2, A3, A4 APPROVED with amendments)
- U-20 (local PostgreSQL route) — decision log: A5 APPROVED option A, subject to isolation/disk checks
- U-22 (dependency approvals) — decision log: A6 APPROVED list
- U-26 (Prisma generator spike) — decision log: A8 AUTHORIZED subject to A3, A6, disk gate
- G-02 choice — decision log: C1 (5 GiB), C2 (5433 on 127.0.0.1), C3 (minor-version tag)

**Work:**
1. Resolve disk space (need ≥5.5 GiB for boundary, ≥5 GiB for Slice 2.1)
2. Edit `docker-compose.yml` host port to 5433 (per C2)
3. Start Docker, run `postgres:17-alpine` on port 5433 with dedicated volume
4. Run Prisma spike in throwaway directory: generator choice, driver adapter, client import under `tsx`/`tsc`, composite FKs with overlapping columns
5. Approve and install `@prisma/adapter-pg@7.10.1` + dependencies, run audit
6. Add database tooling guard (refuse non-local hosts/unexpected DB names)

**Exit:** `GET /api/v1/health/database` returns `ok` against project-dedicated DB; throwaway migration applies/discarded; audit 0 vulnerabilities; U-20, U-22, U-26 recorded.

### Milestone 2: Slice 2.2 — Identity, Tenancy, Audit Schema
**Entry conditions:**
- G-01, G-03 approved
- Slice 2.1 exit
- U-04, U-07 (shape), U-08, U-09, U-10, U-16, U-18, **U-27** (scope guard replacement written and tested **first**)

**Work:**
1. Write and test Phase 2 scope guard (U-27) — allow-list approved tables, fail on resident/stay/booking/payment/charge/deposit models
2. Migration `0001`: `organizations`, `users`, `memberships`, `membership_property_grants` (if U-07 keeps), `sessions`, `audit_events` with composite keys, audit immutability trigger, role grants
3. Controlled provisioning script
4. Synthetic seed for Orgs A and B
5. Database-level isolation tests XT-20…XT-23
6. Schema lint XT-25

**Exit:** Migrations apply to empty DB in CI and locally; XT-20…XT-23, XT-25 pass against real PostgreSQL; scope guard rejects deliberately added resident model; `prisma validate` passes.

### Milestone 3: Slice 2.3 — Authentication and Tenant Context
**Entry conditions:**
- Slice 2.2 exit
- U-01 (session mechanism), U-02 (session params), U-03 (password hashing), U-05 (MFA for shared env), U-06 (rate limits), U-07 (approved role baseline)

**Work:**
1. Login, logout, `me`, organisation current/switch, member list/update, recovery stub (`RULE_NOT_CONFIGURED`)
2. Session store, CSRF, tenant-context guard, deny-by-default permission guard, scoped repository base
3. Lint rule against importing Prisma client outside repositories
4. Audit emission, log redaction

**Exit:** XT-06, XT-07, XT-12, XT-13…XT-19, XT-24…XT-31, XT-33, XT-35 pass; session rotation/revocation/disablement effective next request; mutation test shows router-enumerated suite fails when scope predicate removed.

### Milestone 4: Slice 2.4 — Inventory Structure
**Entry conditions:**
- Slice 2.3 exit
- G-06 for BR-LIF-002/004 and BR-003 **or** owner decision to proceed with `OUT_OF_SERVICE` only (U-13)
- U-11, U-14, U-15, U-19, U-25

**Work:**
1. Migration for `properties`, `floors`, `rooms`, `beds`
2. Endpoints with validation, `rowVersion`, soft archive, inventory summary, audit
3. Partial unique indexes and `CHECK` constraints

**Exit:** XT-01…XT-05, XT-08, XT-09, XT-10, XT-27, XT-28, XT-32, XT-34 pass; inventory counts reconcile; no endpoint reports available/occupied.

### Milestone 5: Slice 2.5 — Spatial Layout and Floor-Plan Read (Gated by G-04)
**Entry conditions:**
- Slice 2.4 exit
- **G-04 decided**
- U-12, U-17
- Inventory contract approved (G-03, U-13, U-14, U-15) with Slice 2.4 endpoints passing

**Work:**
1. Migration for `floor_layouts`, `layout_zones`, `room_placements`, `bed_placements`
2. Geometry validator mirroring Phase 1 `isFloorLayoutValid`
3. Seed converting `demoFloors` geometry
4. `GET /properties/{id}/floor-plan` — **no authoring/publish endpoints**

**Exit:** XT-11 passes; contract test shows seeded floor plan matches Phase 1 component expectations; validator agrees with Phase 1 on valid/broken data; response states `availability: NOT_COMPUTED`.

### Milestone 6: Slice 2.6 — Web Integration (Only if U-24 Approved)
**Entry conditions:** U-24 approved

**Work:** Data-source boundary in web app; honest "status not computed" presentation; demo data stays labelled.

### Milestone 7: Slice 2.7 — Hardening and Acceptance
**Work:**
1. Re-run dependency audit and signatures
2. Run full negative suite
3. Time-boxed RLS spike with bypass tests (U-08)
4. Local backup/restore rehearsal of synthetic DB (practice, not ADR-016 evidence)
5. Update documentation
6. Write acceptance report (ACCEPT / ACCEPT WITH LIMITATIONS / NOT ACCEPTED) with explicit remaining blockers
7. **Must not claim RG-2 satisfied unless router-enumerated suite runs in verified hosted CI (G-02)**

---

## F. Accurate Progress Accounting

| Category | Status | Evidence |
|----------|--------|----------|
| **Already implemented** | Minimal | Only Milestone 0 health routes (`GET /api/v1/health`, `GET /api/v1/health/database`) exist. No domain models, no migrations, no auth, no tenant context, no inventory endpoints. |
| **Published documentation** | Complete | All Phase 2 design docs: Data Model, Tenant Isolation, API Contract, Security Review, Implementation Plan, Decision Log, Unresolved Decisions, Disposable Test packages (v2/v3/v4), Boundary Verification Plan, Owner Decision Guide/Sheet/Register. |
| **Approved design decisions** | 8 decisions (from decision log) | A1–A8 (2026-10-29): canonical package v0.2, ADR-001/003/011 with amendments, U-20 option A, U-22 list, U-26 spike auth, G-02 evidence gathering, disk/port/tag confirmations. Plus 4A batch: D-2 auth, D-3 9-table model, D-4 scope guard, U-26 generator. Plus 4B batch: Q-1, Q-2, Q-4, Q-4b, Q-5, Q-6, Q-7, N-1, N-2, N-3, N-4, N-6. |
| **Unresolved owner decisions** | 22 (Revision 4 sheet) + Phase 2 register (U-01..U-27, G-01..G-06) | All 22 Revision 4 decisions blank. Phase 2 register: G-01..G-06 not met; U-01..U-27 mostly PROPOSED/UNRESOLVED (except U-20, U-22, U-23, U-26 authorized in log). |
| **Not implemented** | All backend code | No schema, no migrations, no auth, no tenant context, no inventory endpoints, no audit emission, no scoped repositories, no permission guards, no seed script, no CI database job. |
| **Not tested** | All negative isolation tests (XT-01..XT-35), all disposable test stages, all Prisma operations, all migrations, all API contracts | No test has run. Revision 2/3/4 packages never executed. Prisma spike not run. Hosted CI never verified. |
| **Blocked** | Everything downstream of Group A | Boundary verification blocked on BV-CANARY-1 (no endpoint), V4-2 (image ID unknown), I-6 (storage unvalidated). Database testing blocked on all Group A + Group B + boundary evidence. Production schema blocked on G-01, G-03, U-27. |

**Key finding:** The informal "60% estimate" is **not verified completion**. Actual implementation progress is **0%** — only planning documents and 8 owner decisions exist. All code, schema, migrations, tests, and verification are pending.

---

## G. Exact List of Actions Blocked Pending Owner Approval

### Blocked by Group A (Boundary Verification Prerequisites)
- [ ] Any Docker resource creation for boundary verification (network, subject container, control container)
- [ ] Any host canary listener startup
- [ ] Any boundary verification evidence collection
- [ ] Reading local image metadata (requires separately scoped read-only permission — not covered by "documentation preparation")

### Blocked by Group B (Database-Test Prerequisites) + Boundary Evidence
- [ ] Any database container creation (`docker create` with `--network none`)
- [ ] Any database start (`docker start`)
- [ ] Any `docker exec` into database container
- [ ] Any SQL execution (`psql`, `provision.sql`, test suites)
- [ ] Any Prisma operations against disposable database (`validate`, `generate`, `migrate diff`, `migrate dev`)
- [ ] Any schema migration creation or application
- [ ] Any database constraint testing (XT-20..XT-23)
- [ ] Any cleanup/recovery operations for database resources

### Blocked by Phase 2 Gates (G-01..G-06)
- [ ] Writing `prisma/schema.prisma` models (G-01, G-03)
- [ ] Creating any migration (G-01, G-03, U-27)
- [ ] Implementing authentication/session code (U-01, U-02, U-03, G-06)
- [ ] Implementing inventory endpoints (G-03, U-11, U-13, U-14, U-15, G-06)
- [ ] Implementing spatial layout (G-04)
- [ ] Installing any new dependencies (U-22)
- [ ] Running Prisma generator (U-26)
- [ ] Pointing any tool at the unrelated PostgreSQL 16 (U-20, S-03)

### Blocked by Unresolved Phase 2 Register Decisions
- [ ] Session mechanism finalization (U-01 — decision log 1A approves server-side, but register still PROPOSED)
- [ ] Session parameters (U-02)
- [ ] Password hashing (U-03)
- [ ] Recovery channel (U-04 / BR-SEC-006)
- [ ] MFA (U-05)
- [ ] Rate limits (U-06)
- [ ] Role-permission baseline (U-07 / BR-SEC-001..003)
- [ ] RLS adoption (U-08)
- [ ] Provisioning script design (U-09)
- [ ] Organization states (U-10)
- [ ] Building level (U-11)
- [ ] Layout scope (U-12 — gated by G-04)
- [ ] Bed status semantics (U-13 — gated by BR-LIF-002/003/004)
- [ ] Label uniqueness (U-14 / BR-003)
- [ ] Archive vs delete (U-15)
- [ ] ID format (U-16)
- [ ] Coordinate units (U-17)
- [ ] Property fields (U-25)
- [ ] Pagination/rate limits/versioning (U-19)
- [ ] UI wiring (U-24)
- [ ] Hosting/backup/RPO/RTO (U-21 — production only)

---

## H. Final Recommendation for Next Implementation Milestone

### **Immediate Next Step: Resolve Group A Decisions (7 decisions)**

The **single most critical blocker** is **BV-CANARY-1** — no concrete canary endpoint, port, listener, or client exists. Without this, boundary verification cannot be designed, let alone authorized or executed.

**Recommended owner action sequence:**

1. **This week:** Resolve V4-1, I-12 (option B), V4-2 (procedure), I-6 (canary scope pending image metadata)
2. **Before boundary authorization:** 
   - Authorize a **read-only image metadata inspection** (separate scope) to get exact `sha256:` ID, declared volumes, entrypoint, available tools
   - Resolve **BV-CANARY-1 concretely** — select numeric IP, port, listener implementation, client, readiness method
   - Resolve BV-NET-1 (design)
   - Resolve V4-8 (design sign-off after 1–6 concrete)
3. **Issue separate written boundary authorization** with exact commands, context, evidence directory, timing, cleanup
4. **Execute boundary verification** — collect evidence report
5. **Resolve V4-9** based on actual evidence
6. **Resolve Group B (14 decisions)** — can be reviewed in parallel with boundary execution but not authorized until V4-9 done
7. **Resolve V4-10** — authorize named database-test stages

**Do not proceed to Slice 2.1 implementation until:**
- Boundary verification evidence exists and V4-9 resolved
- Group B decisions resolved
- V4-10 authorized for at least `preflight` and `create` stages
- U-26 spike completes (generator/adapter validation)
- Disk space ≥ 5.5 GiB confirmed

**The critical path is:** BV-CANARY-1 → V4-8 → Boundary Authorization → Boundary Execution → V4-9 → Group B → V4-10 → Slice 2.1 database foundation.

All other Phase 2 work (schema, migrations, auth, inventory, API, tests) is downstream of this path.

---

## Appendix: Decision Recommendation Summary Table

| Decision ID | Recommended Choice | Reason | Risk if Rejected | Blocks |
|-------------|-------------------|--------|------------------|--------|
| V4-1 | APPROVE (direction) | Only option without privileged changes/installation | Revision 4 stops; no auto-fallback to Rev 3 | All Group A/B |
| I-12 | APPROVE option B | Preserves evidence requirement; exposes uncertainty | Option A: risk without enforcement; Option C: no isolation | All Group A/B |
| V4-2 | APPROVE (procedure) | Binds to repeatable image; avoids download | Pinned defect remains defect; ID form may differ | I-6, BV-CANARY-1, V4-8 |
| I-6 (canary) | DEFER → APPROVE after V4-2 metadata | Shared limits reasonable; storage facts missing | Anonymous volume creation; incompatible flags | BV-CANARY-1, V4-8 |
| BV-NET-1 | APPROVE (design) | Run-specific identity/cleanup scope | Bridge not isolation proof; collision races | V4-8 |
| BV-CANARY-1 | **RESOLVE CONCRETELY** | Control success required to interpret subject failure | No meaningful boundary test possible | **V4-8 (critical)** |
| V4-8 | DEFER → APPROVE after 1-6 concrete | Endpoint/tools/storage unresolved | Premature sign-off mistaken for runnable plan | Boundary auth |
| V4-9 | DEFER until evidence | Cannot accept unmeasured risk | Early acceptance = unmeasured risk | V4-10 |
| V4-3 | APPROVE (design) | Distinct labels prevent Rev 3/4 confusion | Verifier checks reports not behavior; TOCTOU | V4-4, V4-5, V4-10 |
| V4-4 | APPROVE (stage policy) | Two-phase auth reviews identities before use | Recovery separation policy not mechanical (M3) | V4-10 |
| V4-5 | APPROVE (lifecycle) | Removes whole container; no guesswork | Docker outages leave resources; create-to-record crash | V4-10 |
| I-4 | APPROVE (exception) | Only test path without host connection | Admin superuser; socket no-password unverified | V4-10 |
| I-5 | APPROVE option A | Closed op list reviewable; Option B unimplemented | Docker access powerful; check/use race; no 2nd check | V4-10 |
| R-3 | APPROVE (policy) | Avoids real creds; supports pos/neg checks | 0600 files readable by same user; log suppression unverified | V4-10 |
| R-4 | APPROVE (test matrix) | Aligns with Q-6/N-1/N-3; retains positive checks | UPDATE includes tenant cols; no RLS; audit INSERT arbitrary | V4-10 |
| R-5 | APPROVE option A | Matches package; grants nothing unjustified | Retention policy needed later; deletion loses history | V4-10 |
| R-6 | APPROVE (keep revoked) | Package doesn't need TEMP; smaller scope | Future workload needing TEMP would fail | V4-10 |
| R-7 | APPROVE (reporting) | Prevents inflated passes; visible gaps | INFO may reveal weakness; ENV/FIXTURE invalidates context | V4-10 |
| R-9 | APPROVE (acknowledge) | Matches Q-6; avoids false promises | Audit not tamper-evident; superusers can alter | V4-10 |
| V4-6 | APPROVE (bounded) | Loopback psql tests real TCP/auth; gap explicit | Not equivalent to pg lib/host forwarding/Prisma | V4-10 |
| V4-10 | **DO NOT ANSWER** | Boundary unverified; image ID unknown; no evidence | Early auth runs unexecuted pkg on unproven boundary | DB execution |
| V4-7 | DEFER until evidence | Options need own design/boundary reasoning | Silent weakening of acceptance criteria | Acceptance complete |

---

**End of Report**

*This analysis is based solely on reading existing repository documents. No owner responses have been filled, no code modified, no Docker/PostgreSQL/Prisma commands executed, no Git mutations performed. All existing work preserved.*