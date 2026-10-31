# Revision 4 — owner decision sheet

**Status:** a concise decision sheet for the revision 4 no-network PostgreSQL test package, written 2026-10-29, updated for the dedicated-network proposal 2026-10-30. **Nothing here is approved, no owner response is pre-filled, and no execution is authorized.** It was prepared from the current files only. **No live PostgreSQL or Docker test has ever been performed**: nothing in revision 2, 3 or 4 has run, and no test has passed. No Docker command, database connection, SQL, Prisma command, network probe, installation or Git mutation was performed for this documentation update; only read-only Git status/diffs and file validation were used.
**Sources (current files are the source of truth):** [package README](disposable-test-v4/README.md) · [SAFETY.md](disposable-test-v4/SAFETY.md) · [test matrix](disposable-test-v4/expected/test_matrix.txt) · [revision 4 register](OWNER_REVIEW_REVISION_4.md) · [revision 3 register](OWNER_REVIEW_ISOLATED_ENVIRONMENT.md) · [boundary verification plan](PHASE_2_SLICE_2_2_REV4_BOUNDARY_VERIFICATION_PLAN.md) · [decision log](PHASE_2_DECISION_LOG.md). Revision 4 manifest hash (point in time, re-verify before use): `9d328f061493ef373eb954ca83f85f6941729c4132e6e4014eed480dbe6504ef`.

**How to use it.** Each decision has the exact question, my recommendation, the rationale, the risks, **when it is needed**, and an empty response line. A recommendation is my reading, not a decision; "recommended: approve" below never means approved. Timing labels: **BV** = needed before the boundary verification can be authorized; **DB** = needed before any database test stage; **LATER** = can wait.

**Applicability.** This sheet is about **revision 4 only**. The authorization draft in the [revision 3 register](OWNER_REVIEW_ISOLATED_ENVIRONMENT.md) (its section 5) and the one in the revision 2 register apply to those packages only and **must not be used for revision 4**; a revision 4 authorization is a different document, with a different token, and does not exist. Approving a design or policy decision in this sheet **never** authorizes running any stage: running requires a separate, explicit, signed authorization that names the stages (section D).

**What the package is.** A container created with Docker network mode `none` and no published port, from the local `postgres:17.11-alpine` image, with every database test run inside it through `docker exec` and `psql`. The no-network boundary is **designed, not verified**; a separately authorized verification can provide only limited evidence for its specific endpoint and observation window, and has not happened.

**Boundary-verification prerequisites.** All remain **UNRESOLVED**: `V4-1` (no-network direction), `V4-2` (image identity), `I-6` (canary configuration and no-volume handling), `I-12` (option B path choice, without accepting residual risk), `BV-NET-1` (dedicated network and three-resource scope), `BV-CANARY-1` (exact endpoint/readiness/client), and `V4-8` (verification design). Approving these designs does not authorize execution. Before a separate boundary authorization can be issued, the owner must review concrete commands/arguments, full image ID and declared-volume handling, exact run ID/names/labels, record paths, operator environment/context, canary destination/bind/port/readiness/response, timing, evidence, collision/stop conditions and cleanup. Any read-only prerequisite inspection needs its own explicit scope; it does not authorize creation or probing. The positive control uses only the dedicated network. Shared-default-bridge acceptance is not a prerequisite and does not enable a fallback.

The owner must explicitly address L2's stale-register caveat by applying this sheet and the boundary plan to boundary work; the register's database-stage draft is not a boundary authorization. The written recovery rule and L5/L6 limitations must also be acknowledged. `V4-3`, `V4-4`, `V4-5`, `V4-6`, `I-4`, `I-5` and the database policy decisions are **not** prerequisites for boundary observation and remain separately unresolved before database stages. `V4-9` remains unanswered until actual boundary evidence is reviewed. An unresolved canary endpoint, image/storage precondition, collision or ambiguity blocks execution; no broad enumeration or fallback network is permitted.

## A. Revision 4 and the isolation design

### V4-1 — Adopt the no-network design

**Question.** Replace revision 3's bridge-network-and-published-port design with a container created with network mode `none` and no published port, where every database test runs inside the container through `docker exec` and `psql`?
**Recommended:** APPROVE **as the direction only.** **Rationale:** it is the only option examined that offers a boundary by construction without a privileged change or an installation. **Risks and trade-offs:** approving it does not establish that the boundary exists, does not resolve `I-12`, and does not authorize anything; acceptance becomes incomplete (`V4-6`); the Docker, image and `psql` behaviours it depends on have never been observed.
**Needed:** BV.
**Owner response (APPROVE / REJECT / DEFER):** `________`

### V4-2 — Image identity and pinning procedure

**Question.** Use the locally present `postgres:17.11-alpine`, referenced by an image ID that the owner reads with a read-only local inspect during an authorized preflight and quotes in the authorization, which the runner compares with the live local image, creates from with `--pull never`, and never pulls or modifies?
**Recommended:** APPROVE. **Rationale:** no download, no extra disk, same version as the development database, and any substitution becomes visible. **Risks and trade-offs:** the ID is **not known today** and is recorded nowhere in the package; pinning detects substitution, not a defect common to this image and the development container; it is unverified that `docker image inspect` and a container's `.Image` report the same ID form (a containerd image store may differ), which would stop the first run at the identity check; the alternative (pulling a digest-pinned image) is a separate owner-gated action that is not designed.
**Needed:** BV (the verification subject uses the same image).
**Owner response (APPROVE / REJECT / DEFER):** `________`

### V4-3 — Resource naming and identity verification

**Question.** Use run id `nn<UTC timestamp>-<4 hex>` chosen by the owner; container `nook-nn-pg-<runid>` and volume `nook-nn-vol-<runid>`; labels `com.nook.disposable`, `com.nook.nn-run`, `com.nook.package-manifest`; the built-in `none` network (nothing created); a preflight that refuses on **any** container or volume with the disposable label, this run's label or the `nook-nn-` prefix; identities recorded as the container's full ID and the volume's `CreatedAt` and bound into the authorization of every stage after `create`; collision checks before creation and the source-defined identity checks after recording (see I-5/M4); and **no automatic adoption** of an unrecorded look-alike (it is reported and needs a manual owner review)?
**Recommended:** APPROVE. **Rationale:** distinct labels and prefixes mean revision 3 and revision 4 resources cannot be mistaken for each other, and an identity mismatch stops the run. **Risks and trade-offs:** the verifier checks what Docker _reports_, not behaviour; there is a time-of-check to time-of-use window; the shape of Docker's output for a `none` container is unverified (the verifier tolerates an empty network list only while the container is not running); a crash between a Docker create and its record leaves a resource for manual review.
**Needed:** DB (the verification uses its own `nook-bv-` prefix and its own authorization).
**Owner response (APPROVE / REJECT / DEFER):** `________`

### V4-4 — Exact allowed stage list

**Question.** Allow exactly the 14 stages the runner defines, grouped and authorized as follows, each invoked on its own, with **no `all` stage** and no stage implying permission for another?

| Group                     | Stages                                                                                                                                          | Count | Authorization                                                                                                                                                                                                  |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Ordinary test-path stages | `preflight`, `create`, `start`, `bootstrap`, `password_pre`, `schema`, `provision`, `test_inventory`, `test_owner`, `test_app`, `test_password` | 11    | Each ticked individually in the **main authorization**. `preflight` and `create` first; after `create` the owner reviews the recorded identities and authorizes the rest                                       |
| Closing stages            | `cleanup`, `report`                                                                                                                             | 2     | Also in the main authorization. The runner **refuses `create` unless `cleanup` is listed**                                                                                                                     |
| Recovery                  | `recover`                                                                                                                                       | 1     | **Not** part of the main authorization; it needs its own written authorization and its own token. Lists by default; removes only recorded resources when `NOOK_RECOVER_CONFIRM=remove-recorded-resources-only` |

So the main authorization covers **13** stages (11 + 2) and the runner knows **14** (13 + `recover`). `drift` and `test_pool` do not exist in revision 4. **Source:** `KNOWN_STAGES` in `run_disposable_test.sh`; the stage table in the package README; SAFETY.md section 8. **Limit to know:** the runner does not mechanically prevent `recover` from appearing in the same stage list as the others; the separation is a rule of the **written authorization**, not something the code enforces. The revision 4 register's heading "13 stages, no `all`" counts the main authorization only and its `V4-4` text lists `recover` inside the same sentence; this sheet states the grouping explicitly.
**Recommended:** APPROVE. **Rationale:** the stages are the ones that can genuinely work without a host connection, and keeping recovery under its own authorization keeps a destructive-by-confirmation stage from riding along with a test run. **Risks and trade-offs:** many separate authorizations (the token is two-phase: after `create` the recorded container id and volume `CreatedAt` are added); a failed stage cannot be rerun in the same directory and needs a new run id; `cleanup` and `report` may repeat but earlier output is moved aside, not overwritten.
**Needed:** DB.
**Owner response (APPROVE / REJECT / DEFER):** `________`

### V4-5 — Cleanup and recovery model

**Question.** Is cleanup "local secrets first and reported separately; then stop and remove the container and the volume, each after an identity check against its record, never forced; then a final listing that reports anything remaining as recorded-but-present or `UNRECORDED`", with no `DROP` inside the cluster and no Docker network to remove, and is `recover` a separate stage that lists by default and removes only recorded resources when confirmed? If Docker is unavailable, cleanup says resources may remain and removes nothing.
**Recommended:** APPROVE. **Rationale:** removing the whole container removes everything inside it, and nothing is removed on guesswork. **Risks and trade-offs:** cleanup has never run; if Docker is unavailable resources can remain (a container with no network and no published port, random credentials, no real data) until recovery; after a crash in the narrow create-to-record window the owner must review and remove a resource by hand.
**Needed:** DB.
**Owner response (APPROVE / REJECT / DEFER):** `________`

### V4-6 — Treatment of the network-dependent tests

**Question.** Do you accept (a) the seven rewritten password checks as testing the same security properties by a different path, (b) their counting as a **separate class** from the unchanged enforced tests, and (c) the deferral of eleven tests that need Node, the Prisma adapter, the Prisma CLI or a host TCP client? (Detail in section C.)
**Recommended:** accept (a) and (b) **with the stated limits**; treat (c) as an open acceptance gap, not as acceptance. **Rationale:** rewriting keeps real TCP and real password authentication in the container; deferring is more honest than faking an equivalent where none exists (`T-PW3`, the pool and Prisma tests). **Risks and trade-offs:** the rewrites use `psql` over the container's own loopback, not the host port or the `pg` library, and match message text, not SQLSTATE; two of them are weaker client-side refusals; acceptance cannot be called complete.
**Needed:** DB.
**Owner response (APPROVE / REJECT / DEFER):** `________`

### V4-7 — Do the deferred tests require a separate environment?

**Question.** Eleven tests need Node, the Prisma adapter, the Prisma CLI or a host TCP client. Should a **second, separately designed and authorized** environment run them, should they wait for a later phase, or may Slice 2.2 evidence accept their deferral?
**Recommended:** DEFER the choice until the boundary evidence exists. **Rationale:** the options (a shared-namespace client container, another approach) each need their own design and boundary reasoning. **Risks and trade-offs:** the deferred `D1`–`D3` drift comparisons and the `S*` tests were intended as evidence for the partial-index evaluation approved only for evaluation (`Q-4b`) and for the Prisma adapter path; that evidence will not exist from revision 4; a pass of revision 4 must not be read as covering them.
**Needed:** LATER (before Slice 2.2 evidence is treated as complete).
**Owner response (APPROVE / REJECT / DEFER):** `________`

### V4-8 — Boundary verification design; execution requires separate authorization

**Question.** Approve the future verification design in [the plan](PHASE_2_SLICE_2_2_REV4_BOUNDARY_VERIFICATION_PLAN.md): exactly one dedicated network, a no-network subject, a control attached only to that network, an owner-managed host canary, manual configuration/namespace observations, one control attempt followed only on success by one subject attempt to the same endpoint, identity-checked cleanup and an evidence report?
**Recommended:** APPROVE as a design for a future task only, contingent on the concrete prerequisites above. **Rationale:** a report reference without reviewed evidence does not establish the boundary. **Risks and trade-offs:** the endpoint and image/storage precondition are unresolved; control failure or missing evidence is inconclusive; even a clean result supports only the tested path. The package's PostgreSQL verifier must not be used on either canary.
**Needed:** BV. This response is a design decision, not permission to inspect, create, start, probe or remove anything. A separate written authorization with exact commands and scope must follow; none exists.
**Owner response (APPROVE / REJECT / DEFER):** `________`

### BV-NET-1 — Dedicated boundary-verification network and scope

**Question.** Approve exactly these three proposed Docker resources and no others, using `<runid>` = `bvYYYYMMDDtHHMMSSz-hhhh`, a valid UTC timestamp with lowercase `t`/`z` and four random lowercase hex digits, syntax `^bv[0-9]{8}t[0-9]{6}z-[0-9a-f]{4}$` (23 ASCII characters; lowercase letters, digits and hyphen only)? All carry `com.nook.boundary-verification=true` and `com.nook.boundary-run=<runid>`:

| Resource name | Exact role label | Permitted scope |
| --- | --- | --- |
| `nook-bv-net-<runid>` | `com.nook.boundary-role=verification-network` | New local bridge network; `Internal=false`, `Ingress=false`, `Attachable=false`, IPv6 disabled, no custom driver/IPAM options or manually chosen subnet; only the recorded control may join |
| `nook-bv-subject-<runid>` | `com.nook.boundary-role=subject` | `--network none`; no existing project network or verification-network attachment |
| `nook-bv-control-<runid>` | `com.nook.boundary-role=positive-control` | Only the dedicated network, selected by recorded full ID at creation; no later connect/disconnect operation |

**Identity and cleanup.** Record each full 64-character lowercase hexadecimal ID immediately after successful creation and before any further Docker action in `records/network.json`, `records/subject.json` or `records/control.json`, under the new authorized `/private/tmp/nook_boundary_<runid>` evidence directory. Bind names, labels, context, image (containers), and control network ID to the authorization/create transcript. Pending creates without a full-ID record are ambiguous. Collision checks use only exact names and `com.nook.boundary-run=<runid>`; any collision stops the task, without adoption, removal or automatic retry. No broad enumeration fallback is allowed. Before cleanup, verify all recorded identities and permitted membership; recheck immediately before each stop/removal. Remove containers only by recorded full ID, then the network only by recorded full ID with zero members. Mismatch, unexpected absence, unknown member or unavailable verification stops remaining cleanup. Never remove a volume or broaden cleanup. Preserve evidence. Recovery requires separate written authorization, which the Revision 4 runner does not mechanically enforce.

**Recommended:** APPROVE as a design proposal only. **Rationale:** run-specific membership and identity records scope the control and cleanup. **Risks and trade-offs:** the dedicated bridge may allow outbound connectivity and is not proof of host isolation; the image-volume precondition in I-6 must prevent anonymous volumes; exact canary details are unresolved under `BV-CANARY-1`. No network, image, container, volume or database has been created for this proposal. The existing runner/verifier do not implement it.
**Needed:** BV.
**Owner response (APPROVE / REJECT / DEFER):** `________`

### BV-CANARY-1 — Exact endpoint, readiness and one-attempt protocol

**Question.** Select and approve one exact numeric IP literal, address family and TCP port (never `5432`, `5433`, `15433`), owner-managed host listener implementation/bind/process identity, dedicated-network reachability mapping, readiness/continuous-health signal, fixed request/response with run/role markers, pre-existing client and exact arguments, logs and shutdown procedure, as required by plan section 4?
**Current state:** **UNRESOLVED. No endpoint or port is established.** The earlier loopback-listener suggestion and example port are not selections; container loopback is not host loopback. The listener is an explicitly authorized host process, never a fourth container. No project service is contacted, and no firewall/daemon change or installation is permitted to obtain success.
**Protocol proposed:** readiness comes from successful bind/listen and process health/logging, with no extra readiness connection. Make one control TCP attempt (maximum 5 seconds), requiring the exact response, successful client exit and attributable canary log. Only on success make one subject attempt within 30 seconds, using the same endpoint/client/options (subject role marker) and 5-second deadline. Both fit the 600-second container lifetime. Subject connection or canary acceptance is boundary failure; control failure, unsupported tools, health/logging gaps, unclear refusal/reset or ambiguity is inconclusive. No retries or alternative endpoints. Application logs record accepted connections, not packets that never reach the listener.
**Recommended:** leave unresolved until the concrete endpoint and implementation can be reviewed. A placeholder is never permission to execute. This control validates only the tested path, not universal host-service isolation.
**Needed:** BV; must be resolved in concrete form before separate boundary authorization.
**Owner response (APPROVE / REJECT / DEFER):** `________`

### V4-9 — Acceptance or rejection of residual isolation risks

**Question.** After the boundary evidence is in hand, do you accept what remains: the boundary is evidence, not proof; the Docker socket is root-equivalent; the Docker VM and host kernel are shared; Docker keeps the administrator password in the container's configuration until removal; the token is a checksum, not a signature; there is a time-of-check to time-of-use window; and acceptance is incomplete?
**Recommended:** DEFER until the evidence exists; if it is missing or ambiguous, do not accept. **Rationale:** the decision is only meaningful with the report in hand. **Risks and trade-offs:** accepting early accepts an unmeasured risk.
**Needed:** DB (after the verification evidence).
**Owner response (APPROVE / REJECT / DEFER):** `________`

### V4-10 — Final execution authorization

**Question.** Authorize the draft in section 5 of [the register](OWNER_REVIEW_REVISION_4.md), completed and signed, for named database-test stages?
**Recommended:** **DO NOT authorize now. Leave this unanswered.** **Rationale:** the boundary is unverified, the image ID is unknown, the boundary evidence does not exist, and no recorded identities exist yet. **Risks and trade-offs:** authorizing early would run an unexecuted package on an unproven boundary. **This decision must remain unapproved until the boundary evidence and all database prerequisites in section D have been reviewed.**
**Needed:** DB, and only after the boundary evidence has been reviewed.
**Owner response (APPROVE / REJECT / DEFER):** `________`

### I-12 — Host-service reachability

**Question.** A container on Docker Desktop can normally reach host services (including the existing development database) through the host gateway; separation (a new network, port or credential) is not enforcement. Revision 3 could not block this. **Current proposed solution:** the no-network container of revision 4. **Status: unverified.** Which path do you choose: A. accept the residual risk and proceed with revision 3; B. keep execution blocked and pursue revision 4 and its boundary verification; C. reject the isolated approach?
**Recommended:** B. **Rationale:** the options analysis found no enforceable alternative that needs no privileged change or installation, and revision 4's `none` network is the only candidate by construction. **Risks and trade-offs:** B delays execution and requires a separate authorization; the result is evidence, not proof; A proceeds with the risk and no enforcement; C gives up isolation.
**Needed:** BV for the option B path choice only. Today both that choice and the residual reachability issue are **UNRESOLVED**. A future path choice permits consideration of boundary authorization, not risk acceptance; the residual issue stays unresolved pending evidence and `V4-9`.
**Owner response (APPROVE / REJECT / DEFER):** `________`

### I-6 — Hardening flags and compatibility (unverified)

**Question.** For the database runner, accept these creation options as a starting point: `--network none`, `--security-opt no-new-privileges`, `--memory 1g`, `--pids-limit 512`, `--restart no`, one named volume, `--pull never`, an environment file with only the new administrator credentials (deleted right after `docker create`), and no privileged mode, host mounts, Docker socket, host network or published port?
**Recommended:** APPROVE as a starting point, **knowing that none of it is verified**. **Rationale:** the flags reduce risk and weaken nothing. **Risks and trade-offs:** the image was not started and its entrypoint was not read; compatibility with PostgreSQL startup (including `no-new-privileges`) is general reasoning, not evidence; an incompatible flag makes the run fail at `docker start` and the options need revising (a new hash); `--cap-drop`, `--read-only`, `--user`, `--tmpfs` and ulimits are deliberately not used by the database runner.
**Boundary-specific decision.** Review both canaries' `sleep 600` entrypoint/command, shared image ID, limits, no-new-privileges, default user/capabilities, no credentials and no published ports. The subject uses `none`; the control uses only the recorded dedicated network. Unlike the runner, both propose `--tmpfs /var/lib/postgresql/data:rw,noexec,nosuid,nodev,size=64m` instead of any Docker volume. Before creation authorization, inspect only the authorized local image metadata under a separately scoped permission; require declared volume destinations to be exactly `/var/lib/postgresql/data`, and establish that the reviewed override prevents anonymous-volume creation. Different destinations or an unestablished override stop for plan amendment; no extra volume is permitted. Compatibility/behavior remains unobserved. These differences must be recorded and limit comparability with the PostgreSQL container; do not run the Revision 4 PostgreSQL verifier on the canaries. Use the manual field checklist in plan section 3.
**Needed:** BV for these canary-specific choices; DB separately for PostgreSQL startup/storage/credentials. Neither approval authorizes execution.
**Owner response (APPROVE / REJECT / DEFER):** `________`

### I-4 — In-container access exception (revision 4 form; the decision is unresolved in the revision 3 register)

**Where the controlling decision is recorded.** `I-4` in the [revision 3 register](OWNER_REVIEW_ISOLATED_ENVIRONMENT.md) (the narrow administrative exception) is **unresolved**. Revision 4 still relies on it, in a **modified and wider form**, so it is asked again here. An answer here does not change the revision 3 register.
**Question.** Do you approve one explicit exception to "no Unix sockets and no in-container access", under which the runner may `docker exec` into the **one recorded container only**, re-checking its ID, state and run label before every call, to run only: (a) `pg_isready` on the container's own loopback; (b) `psql` as `nook_iso_admin` over the local socket through the closed `admin_op` list (catalogue reads, `CREATE ROLE` ×2, `CREATE DATABASE`, the run-id beacon and its read-back, `ALTER ROLE … PASSWORD` ×2 with statement logging off); (c) **new in revision 4:** `psql` as `nook_migrator_test` or `nook_app_test` over the local socket, running only an exact allow-list of reviewed SQL files (the five package SQL files and the hash-pinned draft SQL), each preceded by the beacon check; (d) **new in revision 4:** the password checks, which write a 0600 `pgpass` file to a fixed path in the container's `/tmp` through standard input, run `psql -h 127.0.0.1` with `-w`, and remove the files with a fixed `rm -f` of four fixed paths; including the fixed `-c` login queries (`SELECT current_user` plus the beacon, and `SELECT 1`) and the direct TCP read of `counts.sql`? The SQL-file allow-list validates files; role/file pairings are selected at call sites, not enforced as a matrix. The direct password/count paths do not all prepend the SQL-file beacon guard.
**Recommended:** APPROVE the named exception, **as a design decision only.** **Rationale:** with no host connection, in-container access is the only test path; every call is identity-checked, there is no free-form SQL, and passwords never appear as arguments or environment values. **Risks and trade-offs:** `nook_iso_admin` is a superuser of the throwaway cluster; local-socket logins are expected to need no password (unverified), so the SQL suites run as the disposable roles without one; the exception is wider than revision 3's (SQL suites and file writes, not only administration); `docker exec` into a `none`-network container and the `psql` notice and error texts the runner parses are unobserved. The alternative is a new design.
**Needed:** DB. It is **not** a prerequisite for the boundary verification (`V4-8`), whose own authorization names its own commands.
**Owner response (APPROVE / REJECT / DEFER):** `________`

### I-5 — Docker lifecycle exception (revision 4 form; the decision is unresolved in the revision 3 register)

**Where the controlling decision is recorded.** `I-5` in the [revision 3 register](OWNER_REVIEW_ISOLATED_ENVIRONMENT.md) is **unresolved**. Revision 4 still relies on it, in a **narrower** form, so it is asked again here.
**Question.** May the runner create and remove **its own** volume and container through the closed `docker_op` list of 13 operations ([SAFETY.md](disposable-test-v4/SAFETY.md) section 3: `ctx_show`, `daemon_version`, `image_id`, `list`, `vol_create`, `ctr_create`, `ctr_inspect`, `ctr_quick`, `ctr_start`, `ctr_stop`, `ctr_rm`, `vol_inspect`, `vol_rm`), where context/daemon checks name no resource, the image lookup uses its fixed tag, listings use label/prefix filters, creation uses derived names with collision checks and records identity afterwards, and later operations use recorded identities with the checks actually present in the source? Full configuration checks occur at stage boundaries; the exec path rechecks ID/state/run label. Cleanup checks the container before stopping but does not perform a second full check between stop and removal. Within this closed list **no** network operation, port publishing, wildcard, `prune`, forced removal, `kill`, `compose`, `pull`, `run` or system-wide command exists?
**Options.** **A.** The runner does it (as designed). **B.** The owner creates the resources by hand with reviewed commands and the runner only verifies and removes nothing (not implemented; it would need another revision).
**Recommended:** A, as a design decision only. **Rationale:** a static scan found one `docker exec` site, the closed operation set, and no network subcommand, publish flag or forbidden verb; revision 4 has strictly fewer operations than revision 3 (no network create, inspect or removal). **Risks and trade-offs:** none of it has run; the Docker socket is root-equivalent; there is a time-of-check to time-of-use window between an identity check and the following command; the shape of Docker's output for a `none` container is unverified; a crash between a create and its record leaves a resource for manual review.
**Needed:** DB. It is **not** a prerequisite for the boundary verification (`V4-8`).
**Owner response (APPROVE / REJECT / DEFER):** `________`

## A1. Remaining findings from the Revision 4 safety review

These are recorded here without claiming that the runner, verifier, hash-pinned packages or Revision 4 register were changed. Where a source package is protected, the discrepancy requires a separately authorized correction.

| Finding | Current limitation | Recommended timing |
| --- | --- | --- |
| **M3** | The rationale for separating `recover` is overstated: `cleanup` performs the same identity-bound removal. Recovery remains separately authorized by written policy, but the runner does not mechanically enforce that separation; cleanup is equally capable of removal. | **Before boundary authorization and again before database testing:** explicitly retain separate written recovery permission; mechanical separation is a residual limitation, not a runner control. |
| **M4** | The `I-5` description overstates identity checks on list, image lookup and creation operations. | **Before database testing:** use the corrected I-5 scope above in the authorization; reconcile remaining register/package wording in a separately scoped task. Protected package changes would require a new revision/hash. |
| **L1** | `I-4` should mention the fixed `-c` SQL statements and the `counts.sql` read. The SQL allow-list is per file, while roles are paired at call sites. | **Before database testing:** use the qualified I-4 scope above; reconcile remaining source documentation separately without changing a pinned package in this task. |
| **L2** | The Revision 4 register remains stale about its “13 stages” wording (11 ordinary + 2 closing; 14 with recovery) and its blanket exclusion of `I-1` through `I-5`, despite modified I-4/I-5 decisions. | **Before boundary authorization:** explicitly apply this sheet/plan prerequisite split and acknowledge the unchanged register caveat; its DB draft cannot authorize boundary work. **Before database authorization:** reconcile the register in a separately scoped documentation task. The register is outside the manifest; package files remain hash-protected. |
| **L4** | The runner can return success while deferred tests remain unpassed. Acceptance must not be inferred from the process exit code alone. | **Before database acceptance:** inspect the stage results, deferred list, cleanup status and evidence report independently; treat the exit code as insufficient. |
| **L5** | PATH resolution, Docker-context check timing and inherited `DX_PGPASSFILE` are same-user threat-model limitations. | **Before boundary authorization:** name the operator tools/context and apply the manual checks in the plan. **Before database authorization/acceptance:** record that PATH selects executables, context is checked in preflight only, and `DX_PGPASSFILE` is not scrubbed. No boundary result fixes these source limitations. |
| **L6** | The verifier does not check every possible container configuration field. Distinguish drift-detection limitations from protections enforced by the runner. | **Before boundary authorization:** use the manual canary checklist, never the PostgreSQL verifier. **Before database testing:** distinguish configuration coverage from runner flags in authorization/evidence review; verifier changes require a separate package revision. |
| **L7** | `SAFETY.md`'s phrase “14 call sites in `docker_op`” conflates call sites and operations: 13 named operation branches contain 14 CLI invocation sites because `list` has container and volume variants; `dx_checked` adds the separate exec site. | **Documented residual risk / before database documentation is finalized:** do not treat the call-site count as a fourteenth named operation; correct the protected package only under separate authorization. |

No finding is marked resolved: this sheet corrects its own I-4/I-5 descriptions, but does not change the source behavior, stale register or pinned package documentation. None changes the blank owner-response fields above.

## B. Database test policy

These keep their meaning from the earlier registers; the SQL (`provision.sql`, the two suites, `inventory.sql`, `counts.sql`) is identical to revision 3, and `provision.sql` to revisions 2 and 3.

### R-3 — Temporary migrator credentials

**Question.** Give the migrator a random 128-bit password in a 0600 file, set with statement logging switched off for that session, after a negative test proves it cannot log in without one, and cleaned up first at cleanup?
**Recommended:** APPROVE. **Rationale:** all owner-level checks then use an explicit credential; in revision 4 no password is ever a command argument or environment value (a 0600 `pgpass` file inside the container is written through standard input). **Risks and trade-offs:** other processes of the same macOS user can read the 0600 file; the log suppression for `ALTER ROLE` is unverified on a real server; the administrator's password stays in the container configuration until removal.
**Needed:** DB.
**Owner response (APPROVE / REJECT / DEFER):** `________`

### R-4 — Exact least-privilege matrix

**Question.** Approve this matrix, exactly, for the runtime role: `SELECT`/`INSERT`/`UPDATE` on `organizations`, `users`, `memberships`, `sessions`, `properties`, `floors`, `rooms`, `beds`; `SELECT`/`INSERT` only on `audit_events`; **no `DELETE`, `TRUNCATE`, `REFERENCES` or `TRIGGER` anywhere**; `CONNECT` on `nook_test` and `USAGE` on schema `public` only; `TEMP`, database `CREATE` and schema `CREATE` not granted; no grant options, role memberships or default-ACL changes?
**Recommended:** APPROVE for the **test only**. **Rationale:** it follows the approved direction (`Q-6`, `N-1`, `N-3`, `Q-7`). **Risks and trade-offs:** these are proposed test grants, not the production grant set (`Q-7` records that the exact grants and procedure still need review); `UPDATE` covers every column, including tenant columns; there is no row-level security, so reads are not isolated by the database.
**Needed:** DB.
**Owner response (APPROVE / REJECT / DEFER):** `________`

### R-5 — No `DELETE` permission on `sessions`

**Question.** Is the runtime role also refused `DELETE` on `sessions` in the test (the stricter reading of `N-1`, which excludes `sessions` from "business tables" but grants it nothing)?
**Recommended:** APPROVE option A (no `DELETE` on `sessions`). **Rationale:** it matches the package and grants nothing unjustified. **Risks and trade-offs:** expired sessions would be ended by updating `revoked_at` or purged by a privileged job; slice 2.3 must say which; the alternative (grant `DELETE` on `sessions` only) needs a justification, a package change and a new hash.
**Needed:** DB.
**Owner response (APPROVE / REJECT / DEFER):** `________`

### R-6 — Keep `TEMP` revoked

**Question.** Keep `TEMP` revoked from `PUBLIC` and the runtime role?
**Recommended:** APPROVE (keep it revoked). **Rationale:** nothing in the package needs it, and a suite test asserts the refusal. **Risks and trade-offs:** none known; granting it would need a stated justification.
**Needed:** DB.
**Owner response (APPROVE / REJECT / DEFER):** `________`

### R-7 — `INFO` observations do not count as enforced tests

**Question.** Are observations marked `INFO` reported separately and **never counted** as acceptance, with the new classes handled as: `REWRITTEN` counted separately, `DEFERRED` never a pass?
**Recommended:** APPROVE. **Rationale:** it prevents an observation or a replacement from being read as an enforced guarantee. **Risks and trade-offs:** the reporting is more complex; an `INFO` or deferred result reported as a pass is a failure by definition.
**Needed:** DB.
**Owner response (APPROVE / REJECT / DEFER):** `________`

### R-9 — Audit integrity wording and its limits

**Question.** Acknowledge: "Runtime-role access to `audit_events` is limited to `INSERT` and `SELECT`. Table owners and superusers can still update, delete, truncate, disable triggers on and drop audit rows, and the runtime role can still insert rows with any content. No claim of immutability or tamper evidence is made." The proposed audit trigger stays unapproved.
**Recommended:** APPROVE the wording (it agrees with `Q-6`). **Rationale:** it states what privileges do and do not provide. **Risks and trade-offs:** the audit table is not tamper-evident; a trigger or function would need a separate manifest approval.
**Needed:** DB (acknowledgement only).
**Owner response (APPROVE / REJECT / DEFER):** `________`

## C. Test acceptance matrix

Source of truth: [`expected/test_matrix.txt`](disposable-test-v4/expected/test_matrix.txt) and `expected/expected_results.txt` (239 lines). **Every row below describes what is planned. No test in this table has been run, and none has passed.**

| Class                       | What it is                                                                                           | Count in revision 4       |
| --------------------------- | ---------------------------------------------------------------------------------------------------- | ------------------------- |
| **ENFORCE, unchanged**      | the SQL suites `test_owner` (42) and `test_app` (76), the same SQL as revision 3, now through `psql` | 118                       |
| **REWRITTEN**               | `PWC1`, `PWC2`, `PWC4`, `PWC5`, `PWC6`, `PWC7`, `PWC8`                                               | 7                         |
| **DEFERRED, enforced**      | `T-PW3`, `S1`, `S5`, `S6`, `S7`                                                                      | 5                         |
| **DEFERRED, informational** | `S2`, `S3`, `S4`, `D1`, `D2`, `D3`                                                                   | 6                         |
| **ENV**                     | inventory `V01`–`V16`, run-id beacon results and the suites' environment assertions                  | 33 (in the expected file) |
| **FIXTURE**                 | set-up inside the suites; must succeed; never counted                                                | 56                        |
| **INFO**                    | recorded observations (for example `O-AUD*`, `A-AU8`, `A-INFO*`, `V17`–`V20`); never counted         | 14 (not deferred)         |

### Rewritten tests and the equivalence claimed

| Revision 3 id | Revision 4 id | Property claimed                                        | Equivalence claimed, and its limit                                                                                          |
| ------------- | ------------- | ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `T-PW1`       | `PWC1`        | the runtime role logs in with its password              | same property over the container's own loopback with `psql`; **not** the host port, Docker's forwarding or the `pg` library |
| `T-PW2`       | `PWC2`        | a wrong password is refused by the server               | matched on the server's message text, **not** SQLSTATE `28P01`                                                              |
| `T-PW4`       | `PWC4`        | a login with no password is refused                     | refusal is **client-side** in libpq, as it was in the `pg` library; weaker than a server-side refusal                       |
| `T-PW5`       | `PWC5`        | the migrator cannot log in before it has a password     | same weakness as `PWC4`                                                                                                     |
| `T-PW6`       | `PWC6`        | the migrator with a wrong password is refused           | matched on the message text                                                                                                 |
| `T-PW7`       | `PWC7`        | the migrator logs in with its password                  | loopback `psql`                                                                                                             |
| `T-PW8`       | `PWC8`        | the runtime role reads the same row counts as the owner | both reads in-container: the owner over the local socket, the runtime role over loopback TCP                                |

### Deferred enforced tests (not run, not passed)

`T-PW3` (an empty-string password: libpq treats it as none, so `psql` cannot test the same case); `S1` (shared pool stays within its limit) and `S5` (the pool test exits by itself): client-library behaviour with no database-side equivalent; `S6` (Prisma delete refused) and `S7` (Prisma insert permitted): the privilege itself is covered by the SQL suites, **the Prisma-adapter path is not**. The six informational deferrals need Node, the adapter or the Prisma CLI.

### Statements that must not be softened

- **Network isolation has not been runtime-verified.** The no-network configuration is designed and has been checked only as a pure comparison against synthetic Docker output; nothing was observed on this machine.
- **The test suite is not complete and has not passed.** No claim of completeness or success may be drawn from the accounting, the matrix or the package: acceptance is incomplete by construction (eleven deferred ids), and no stage has ever executed.
- **The 130-test accounting is not evidence that 130 tests passed.** It is bookkeeping: 118 unchanged + 7 rewritten + 5 deferred = the 130 `ENFORCE` ids of revision 3. **No live PostgreSQL or Docker test has been performed.** Even the 118 unchanged SQL tests have only ever existed as files; the SQL has never run on a real server.
- **The rewritten tests require appropriate validation** (a first authorized run, and a review of whether the loopback `psql` path and message matching are acceptable evidence for the original properties) before they can be treated as equivalent.
- **Deferred tests remain unpassed** until separately executed and accepted, in a separately authorized environment, or until the owner explicitly accepts their deferral (`V4-7`).
- **Acceptance criteria are not lowered silently.** Every removed, rewritten or deferred id is recorded in the matrix with its reason; the runner's report names the deferred ids and says acceptance is incomplete.
- A pass of revision 4 would be a result on a throwaway database for a **draft** schema only. It would not approve the per-entity uniqueness scopes or the preview `partialIndexes` feature (`Q-4b` is approved for evaluation only), decide `N-5` (whether `A3` needs a `nook_dev` run), or settle `Q-3`, `Q-8`, `Q-9`, `Q-10`, lifecycle semantics or the migration-generation method, all of which stay open.

## D. Recommended decision sequence

**No approval in this sheet authorizes execution, and no stage executes merely because an earlier decision is approved.** Each step below ends at a decision or an authorization; nothing runs in between.

1. **Before boundary verification, the owner reviews and resolves only its prerequisites:** `V4-1`, `V4-2`, the canary-specific `I-6` choices, the option B path choice in `I-12`, `BV-NET-1`, `BV-CANARY-1`, and the verification design in `V4-8`. Review the exact image/storage prerequisite, endpoint, listener/client/readiness/response, timing and stop conditions. These approve a design and a verification task, not a run; they do not authorize resource creation or probing.
2. **The owner separately authorizes the specific boundary verification** after those design decisions, as its own task with exact commands/arguments, context/operator environment, three resource names/labels, immediate full-ID records, dedicated-network scope, endpoint/readiness protocol, durations, evidence and cleanup/stop conditions. Address L2 explicitly by using this sheet and the plan; any prerequisite read-only inspection has a separate scope. Nothing in this sheet or in the revision 4 package does that.
3. **Evidence and residual risks are reviewed:** read the evidence report, record its SHA-256, then decide `V4-9`. If the evidence is missing or ambiguous, the risk is retained and execution stays blocked.
4. **Before any database-test stage, the owner reviews and resolves the remaining runner and database decisions:** `V4-3`, `V4-4`, `V4-5`, `V4-6`, `I-4`, `I-5`, and `R-3`, `R-4`, `R-5`, `R-6`, `R-7`, `R-9`, while addressing the timing table in section A1. These decisions do not retroactively authorize boundary verification.
5. **Only then may the owner consider separately authorizing explicitly named test stages (`V4-10`):** the owner reads the image ID with a read-only inspect, chooses the run id and directory, supplies the evidence hash, authorizes `preflight` and `create` first, reviews the recorded identities, and authorizes the later stages separately. `recover` needs its own written authorization even though the runner does not mechanically enforce stage separation. **`V4-10` stays unanswered until the boundary evidence has been reviewed.**
6. **Deferred tests and the remaining acceptance criteria are evaluated independently (`V4-7`),** and full acceptance is never claimed until the deferred tests have run and been accepted, or their deferral has been explicitly accepted. The runner's exit code alone is not acceptance evidence.
7. **Production schema implementation requires its own separate authorization.** Nothing in revision 4, its evidence or this sheet authorizes it, and it does not decide `Q-3`, `Q-8`, `Q-9`, `Q-10`, `N-5`, the partial-unique-index scopes, lifecycle semantics or the migration-generation method.

## E. Inconsistencies found in the source documents, and their treatment

- **Stage count (corrected here).** The revision 4 register says "13 stages, no `all`" and lists `recover` in the same sentence; the runner defines **14** stages. They reconcile as 11 ordinary test-path stages + 2 closing stages (`cleanup`, `report`) = 13 in the main authorization, plus `recover` under its own authorization. `V4-4` above states this and the source. **Remaining limitation:** the register's wording is unchanged (this redesign updates this sheet and the boundary plan), and the runner does not mechanically separate `recover` from the other stages; the separation is a rule of the written authorization.
- **`I-4` and `I-5` omission (corrected here).** The revision 4 register says the revision 3 decisions `I-1` to `I-5` and `I-7` to `I-11` are not re-asked, yet revision 4 relies on modified forms of `I-4` and `I-5`. They are now asked explicitly in section A, with their revision 4 form, and both stay unresolved. The revision 3 register's own `I-4` and `I-5` entries are unchanged and unresolved.
- **Authorization drafts.** The authorization drafts in the revision 2 and revision 3 registers apply to those packages only and must not be used for revision 4; no revision 4 authorization exists. The revision 4 register's own section 5 is a template, not an authorization.
- **Deferred tests and `Q-4b`.** The deferred drift and pool tests were meant to support the `Q-4b` evaluation (approved for evaluation only); that evidence will not come from revision 4.
- Remaining source limitations are listed in A1; this sheet does not certify the README, SAFETY.md or registers as free of conflicts. The decision log records `Q-6`, `N-1`, `N-3` and `Q-7` as approved with the caveats quoted in section B, and `Q-3`, `Q-8`, `Q-9`, `Q-10` and `N-5` as unresolved.

## F. What this sheet did not do

It did not run any stage, SQL, Prisma, Docker, database, network or installation command, and did not create, inspect or remove any resource. It did not edit any revision 2, 3 or 4 package file, any manifest, `scripts/db_guard.py`, the decision log, production schema, migrations, application code, CI or a scope guard. It pre-filled no response, approved nothing, and authorizes no execution.
