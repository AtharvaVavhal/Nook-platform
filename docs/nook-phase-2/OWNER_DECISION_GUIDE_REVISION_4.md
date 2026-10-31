# Revision 4 — owner decision guide

## Current status and how to use this guide

**Status: analysis and documentation only, prepared 2026-10-31. All 22 decisions in the current [owner decision sheet](OWNER_DECISION_SHEET_REVISION_4.md) remain UNRESOLVED.** The sheet has 22 unique decision headings and 22 blank response fields. This guide contains one detailed decision entry for each; identifiers elsewhere are navigation and dependency references, not additional decisions.

**Currently authorized for this task:** reading local source files, documentation-only validation, and creating this guide. **Still unauthorized:** Docker/resource inspection or lifecycle operations, boundary verification, database/SQL/Prisma operations, test runners, recovery, dependency changes, production schema/migration implementation and Git mutations. Historical approvals in the decision log have their original scope; they do not expand this task. No owner response is supplied or changed here.

**Recommended order:** choose the isolation direction; resolve the image, canary storage, dedicated-network and endpoint details; review the complete boundary design; only then consider a separate boundary authorization. After actual evidence is available, review residual risk, resolve the database-specific policies, and only then consider named database stages under a separate authorization. Decide the deferred-test disposition before claiming acceptance. Production implementation needs its own decisions and authorization.

Every **technical recommendation** below is advice, not an owner decision. “APPROVE” recommends accepting the specified design or policy only. “DEFER” means information or evidence is missing, not that the requirement is waived. Rejection does not activate an alternative automatically. Even a future affirmative response about execution must be accompanied by the separate, complete written authorization required by the source documents.

### Source map and limits

| Source | What it controls or establishes |
| --- | --- |
| [Current decision sheet](OWNER_DECISION_SHEET_REVISION_4.md), sections A–F | The 22 questions, blank responses, timing split and remaining findings |
| [Boundary plan](PHASE_2_SLICE_2_2_REV4_BOUNDARY_VERIFICATION_PLAN.md), sections 1–7 | Proposed dedicated-network task, exact identities, manual checks, canary protocol, cleanup and evidence limits |
| [Decision log](PHASE_2_DECISION_LOG.md), A3/A7 and sections 4A–4B | Existing owner directions and their constraints; outstanding production choices; historical approvals are not new permission |
| [Revision 4 README](disposable-test-v4/README.md) and [SAFETY.md](disposable-test-v4/SAFETY.md) | Package design and unobserved assumptions, subject to the limitations identified in the sheet and source |
| [Runner](disposable-test-v4/run_disposable_test.sh) and [verifier](disposable-test-v4/node/inspect_check.mjs) | What checks and operations actually exist; read as text only, never invoked for this guide |
| [Test matrix](disposable-test-v4/expected/test_matrix.txt) and [expected results](disposable-test-v4/expected/expected_results.txt) | Exact rewrite/deferral mappings and expected result classes, not executed results |
| [Revision 4 register](OWNER_REVIEW_REVISION_4.md) | Historical questions and a draft database authorization; known stale wording needs reconciliation |
| [Revision 3 register](OWNER_REVIEW_ISOLATED_ENVIRONMENT.md) and [Revision 2 register](OWNER_REVIEW_SLICE_2_2.md) | Origins of the carried-over questions; their authorizations do not apply to Revision 4 |

The sources describe Revision 2/3/4 package execution and the new boundary check as not performed. The decision log separately records earlier spike/gate evidence; this guide does not erase that history or treat it as evidence for the unrun Revision 4 package. Reading code and matching hashes establishes file contents, not Docker or database behavior.

## Priority groups and dependencies

| Group | Decisions assigned once | Count | Milestone |
| --- | --- | ---: | --- |
| **A — Required before boundary verification** | V4-1, I-12, V4-2, I-6, BV-NET-1, BV-CANARY-1, V4-8 | 7 | Design prerequisites before considering a narrowly scoped boundary authorization |
| **B — Required before database-test authorization** | V4-9, V4-3, V4-4, V4-5, I-4, I-5, R-3, R-4, R-5, R-6, R-7, R-9, V4-6, V4-10 | 14 | Evidence/risk gate, database permissions and fixtures, lifecycle policy, then final authorization gate |
| **C — Can be deferred** | V4-7 | 1 | Does not block initial boundary observation or the limited database run; must be addressed before acceptance is considered complete |

Group A's **I-6 has two scopes**: canary configuration first, PostgreSQL startup/storage/credentials later. Its database scope must be revisited for Group B without creating a duplicate decision. Likewise, I-12's option B path choice is needed first; residual reachability risk remains open until evidence is reviewed under V4-9. Putting a decision in Group B does not mean it cannot be discussed now: it means it must not be bundled into permission for the earlier boundary task.

The source documents do not impose a strict order on every design question. The order here is a review aid. “Dependencies” distinguishes an earlier prerequisite from closely related policies that can be reviewed together. Group B execution depends on completed Group A authorization/evidence and the later risk review; Group C cannot silently weaken existing acceptance requirements.

### Minimum boundary authorization gate

The minimum decision set is exactly the seven Group A identifiers above. The current plan does **not** require database-role grants, SQL execution exceptions or database-runner lifecycle approval to observe the boundary. Seven affirmative design responses alone are still insufficient: the following concrete details must be reviewed and bound to a separate authorization.

| Required before boundary execution authorization | Current gap or fixed constraint |
| --- | --- |
| Image and canary storage | Exact local image ID and metadata are unknown. Establish the declared volume destination and suitability of the proposed tmpfs override; no anonymous or named Docker volume is permitted |
| Executable procedure | Exact commands/arguments, available client and observation tools, CLI path, environment, context/daemon identity, and evidence directory must be specified; no installation or privilege expansion |
| Resources and identity checks | Exactly one network and two containers; exact run-derived names/labels, immediate full-ID recording, scoped collision checks and no adoption of unrecorded resources |
| Canary and method | One numeric destination, address family and TCP port; host listener/bind/ownership; reachability mapping; readiness and continuous health; fixed request/response; logs; no existing service target |
| Bounds | One control attempt, then only on success one subject attempt; 5-second deadlines, subject starts within 30 seconds of control success, 600-second container lifetime; ports 5432, 5433 and 15433 forbidden |
| Failure and cleanup | Exact stop conditions, identity checks before each cleanup action, containers before empty network, no broad enumeration fallback, evidence preservation and separately authorized recovery |
| Review caveats | Address M3, L2, L5 and L6 as the sheet requires; no claim of universal host isolation or equivalence to the PostgreSQL container |

The plan also requires Docker already running and two free-disk readings of at least 5.5 GiB in a future authorized run. This task does neither. The earlier log's 5 GiB floor does not replace this stricter task-specific proposal. Any prerequisite read-only image inspection must have its own explicitly scoped permission; it must not be smuggled into “documentation preparation” or treated as permission to create resources. Missing tools, unsupported identity queries, unknown endpoint mapping or unresolved storage require stopping or amending the plan, not probing to discover a convenient alternative.

### Why database decisions stay separate

The boundary task runs sleep-based canaries and a host listener; it creates no database, users, grants, fixtures or Docker volume and invokes no Revision 4 stage. The database task would create a PostgreSQL container and a named volume, provision credentials and a draft schema, insert synthetic rows, exercise privileges and remove its recorded resources. Those are different permissions and evidence. The canary's manual checklist also exceeds/differs from the package verifier; a successful canary result cannot approve the runner's command set or database behavior.

## Group A — Required before boundary verification

### V4-1 — Adopt the no-network design

| Aspect | Owner guidance |
| --- | --- |
| Plain-English explanation | Choose a test database with no external network connection, with its tests performed from inside its container. This replaces the earlier design that exposed a host connection |
| If approved | Revision 4 becomes the accepted direction for further review. No container starts, and isolation is not certified |
| If rejected | This proposed path stops. Revision 3 does not automatically become authorized; an alternative needs explicit review |
| Available options | Accept the direction; reject and request another design; defer |
| Technical recommendation | **APPROVE — direction only** |
| Reasoning | It removes the external database-test path from the design without adding firewall changes or installations. The cost is rewritten checks and missing client-library coverage |
| Security and operational risks | Requested network mode is not proof of host isolation. Kernel/VM sharing, unverified startup and incomplete test coverage remain |
| Dependencies | No earlier decision is required to discuss direction; coordinate with I-12 option B. V4-2, I-6, both BV decisions and V4-8 are required before boundary authorization |
| Required evidence | Static runner network/port design and the rewrite/deferral matrix justify the direction. Future boundary evidence, not this decision, is needed to assess behavior |
| Timing | Before boundary verification authorization |
| Reversibility | **Easy to change before execution.** A later alternative needs a new design and authorization; it cannot reuse evidence without checking applicability |

### I-12 — Host-service reachability

| Aspect | Owner guidance |
| --- | --- |
| Plain-English explanation | Decide how to handle the possibility that a throwaway container can reach services on the computer hosting Docker. Different names and passwords do not themselves block that path |
| If approved | The response must name an option. Choosing B keeps execution blocked while pursuing the Revision 4 boundary-evidence path; it does not accept the residual risk |
| If rejected | The current path remains blocked; rejection must not be interpreted as selecting the riskier option A |
| Available options | A: consider Revision 3 while accepting its unresolved reachability risk; B: pursue the no-network design and separate verification; C: reject the isolated approach; defer. Each execution path still needs its own authorization |
| Technical recommendation | **APPROVE — option B only, as the path choice** |
| Reasoning | It preserves the requirement for evidence instead of treating separation as enforcement. It delays testing but exposes the uncertainty explicitly |
| Security and operational risks | One canary endpoint cannot represent every host service. A dedicated control network can have outbound connectivity. Revision 3 risk acceptance would not block egress |
| Dependencies | Review alongside V4-1. Resolving the path precedes boundary authorization; accepting remaining risk depends on actual evidence and V4-9 |
| Required evidence | The source options analysis and current boundary plan justify pursuing B. The risk itself requires the later bounded observations and an explicit account of untested paths |
| Timing | Path choice before boundary verification; residual-risk review after boundary evidence |
| Reversibility | **Easy as a planning choice; difficult after exposure.** Later actions cannot be undone merely by changing the recorded choice |

### V4-2 — Image identity and pinning procedure

| Aspect | Owner guidance |
| --- | --- |
| Plain-English explanation | Identify the exact local software image used to make both canaries and the later database container, rather than trusting only a name that could refer to different contents |
| If approved | Accept use of local `postgres:17.11-alpine` by its full image ID and the no-pull procedure. Approval does not supply the currently unknown ID or authorize looking it up |
| If rejected | No creation under this procedure. A different image or acquisition method needs a separately reviewed design; downloading is not a fallback |
| Available options | Approve local-ID pinning; reject and design an alternative, including the source's separately gated digest-pinned alternative; defer |
| Technical recommendation | **APPROVE — the pinning procedure only** |
| Reasoning | It binds the review to repeatable image contents and avoids a download. It does not establish that those contents are safe or suitable |
| Security and operational risks | A pinned defect remains a defect. Image-ID representation may differ across inspection fields. Image-declared volumes or missing client tools could invalidate the canary proposal |
| Dependencies | V4-1/I-12 establish the path. The concrete image facts must be reviewed with I-6 and BV-CANARY-1 before V4-8 can lead to authorization |
| Required evidence | Future separately authorized local metadata read: full `sha256:` ID, declared volumes, defaults and evidence about available tools. Match the eventual created container image identity without pulling. No such read occurs here |
| Timing | Procedure before boundary verification; concrete ID/configuration before creation authorization; confirm applicability again for database testing |
| Reversibility | **Easy before creation.** Changing the image later invalidates assumptions and may require renewed boundary evidence and authorization |

### I-6 — Hardening flags and compatibility (unverified)

| Aspect | Owner guidance |
| --- | --- |
| Plain-English explanation | Review limits on memory, processes and privilege, and how the canaries avoid creating storage resources. Also recognize that the later real database uses a different startup and storage arrangement |
| If approved | Accept the specifically reviewed canary configuration as a starting point. Database startup, named-volume storage and credentials remain a separate scope of this same decision |
| If rejected | Creation remains blocked. Different flags or storage need a plan amendment; changing the database runner would require a new reviewed package |
| Available options | Approve a concrete configuration with its known limits; request a redesign; defer pending image/storage facts |
| Technical recommendation | **DEFER — the complete canary configuration until image/storage details are established**. The shared limits are reasonable proposals, but the missing storage facts prevent an unconditional recommendation |
| Reasoning | Both canaries propose sleep for 600 seconds, no injected credentials, 1 GiB memory, 512 PIDs, no restart and no-new-privileges. They differ from the PostgreSQL process, so compatibility is not interchangeable |
| Security and operational risks | The canary-only `--tmpfs /var/lib/postgresql/data:rw,noexec,nosuid,nodev,size=64m` must cover the image's sole declared volume destination. Suitability is unestablished. Unexpected destinations/mounts stop the plan. Default user/capabilities and security-profile behavior remain relevant |
| Dependencies | Concrete V4-2 image metadata first; review alongside BV-NET-1/BV-CANARY-1. Its canary scope is a V4-8 prerequisite; its PostgreSQL scope must be reviewed before database authorization |
| Required evidence | Exact image `Config.Volumes`, reviewed override semantics and tool availability before authorization. Later live manual inspection, interfaces/routes, capability masks and `NoNewPrivs`; PostgreSQL startup evidence only in a separately authorized database run |
| Timing | Before boundary verification for canaries; before database testing for the runner's configuration. Never run the PostgreSQL verifier on the canaries |
| Reversibility | **Easy at design time; difficult after evidence collection.** Changed flags can invalidate comparisons. Future cleanup may remove disposable state |

### BV-NET-1 — Dedicated boundary-verification network and scope

| Aspect | Owner guidance |
| --- | --- |
| Plain-English explanation | Give the positive control its own short-lived network and record exactly which three Docker resources belong to this attempt |
| If approved | Accept the network/resource design only: one dedicated network, one subject and one control. No creation, connection or cleanup is permitted by the response itself |
| If rejected | The control design stops. The shared default bridge, an existing project network or a fourth container is not a fallback |
| Available options | Approve the specified three-resource scope; reject and request another reviewed design; defer |
| Technical recommendation | **APPROVE — design and identity rules only**, subject to the still-open endpoint and storage prerequisites |
| Reasoning | A unique run identity and immediate full-ID records make ownership and cleanup reviewable. They do not turn a bridge into a host-isolation firewall |
| Security and operational risks | The new local bridge has `Internal=false`, `Ingress=false`, `Attachable=false`, IPv6 disabled and no custom driver/IPAM options. It may provide outbound routing. Short random suffixes can collide; labels can be imitated; check/use races remain |
| Dependencies | V4-1/I-12 path; V4-2/I-6 and BV-CANARY-1 must be coherent with it before V4-8 and a separate authorization |
| Required evidence | Review the exact identities below, scoped queries, pending-record handling and cleanup. In a future run, capture each full ID immediately and verify identity/membership; missing records or collisions mean stop, never adoption |
| Timing | Before boundary verification authorization |
| Reversibility | **Easy before creation; potentially destructive during cleanup.** Removal must use recorded IDs with verified identity, containers first, then an empty network; recovery needs separate permission |

The identities reviewed by this decision are fixed by boundary-plan section 2:

| Item | Exact proposal |
| --- | --- |
| Run ID | `bvYYYYMMDDtHHMMSSz-hhhh`, valid UTC timestamp, lowercase `t`/`z`, four lowercase random hex digits; `^bv[0-9]{8}t[0-9]{6}z-[0-9a-f]{4}$`, 23 ASCII characters |
| Shared labels | `com.nook.boundary-verification=true`, `com.nook.boundary-run=<runid>` |
| Network | `nook-bv-net-<runid>`; `com.nook.boundary-role=verification-network` |
| Subject | `nook-bv-subject-<runid>`; `com.nook.boundary-role=subject`; network mode `none` |
| Control | `nook-bv-control-<runid>`; `com.nook.boundary-role=positive-control`; only the recorded dedicated-network ID |
| Records | Full 64-character lowercase hex IDs immediately after each create, before another Docker action; `records/network.json`, `records/subject.json`, `records/control.json` in the new authorized `/private/tmp/nook_boundary_<runid>` directory |

Exact names and the current run-label value delimit collision checks. No broad enumeration fallback, existing project-network attachment, adoption, automatic new-run retry, removal by name or removal of an unexpected network member is allowed. Before cleanup, verify all recorded identities; recheck before each stop/removal. Any mismatch, unexpected absence or uncertain ownership stops remaining cleanup. The host canary process and evidence files need explicit scope too; they are not additional Docker resources.

### BV-CANARY-1 — Exact endpoint, readiness and one-attempt protocol

| Aspect | Owner guidance |
| --- | --- |
| Plain-English explanation | Choose one harmless listener to stand in for a host service, then ensure the measurement can distinguish a blocked subject from a broken listener or client |
| If approved | Only a fully specified endpoint and method can be accepted. The response does not start a listener or permit a connection |
| If rejected | No meaningful boundary test can proceed with this method. A revised method must be designed; another host service cannot be substituted |
| Available options | Approve concrete details once available; reject and request amendment; defer |
| Technical recommendation | **DEFER — no exact endpoint, port or executable method is established** |
| Reasoning | Control success is necessary to interpret subject failure. Host loopback and container loopback are different destinations; a suggested host bind is not evidence of a reachable control endpoint |
| Security and operational risks | Wrong target, listener outage, hidden retries, NAT attribution, missing logs or a missing client can produce misleading results. Application logs record accepted connections, not every failed packet |
| Dependencies | V4-2/I-6 image/tool facts and BV-NET-1 network scope; V4-1/I-12 direction. Concrete completion is required before boundary authorization under the V4-8 design |
| Required evidence | Numeric IP/address family/TCP port; listener implementation, bind and process ownership; network-to-host mapping; bind/listen readiness and continuous health without another readiness connection; exact client/arguments, request/response markers, log paths and shutdown procedure. All are missing or not concretely established |
| Timing | Before boundary verification authorization; listener health and client/canary logs are live evidence only after authorization |
| Reversibility | **Easy before execution; potentially consequential after probing.** A mistaken target cannot be “uncontacted”; changing the endpoint requires renewed review |

The proposed control makes one connection within 5 seconds and must receive the exact response with a successful client exit and attributable canary log. Only then does the subject attempt the same endpoint/client/options with its role marker, within 30 seconds and with its own 5-second deadline. A subject connection or attributable canary acceptance is failure; a failed control, unclear refusal/reset, unsupported tool or evidence gap is inconclusive. No retries or alternate endpoints are allowed. Neither outcome proves universal host isolation.

### V4-8 — Boundary verification design; execution requires separate authorization

| Aspect | Owner guidance |
| --- | --- |
| Plain-English explanation | Review the whole proposed safety experiment and what its report could establish before deciding whether to commission a concrete run |
| If approved | Accept the design for a future separately authorized task. This is not permission to inspect, create, start, probe, stop or remove anything |
| If rejected | No boundary run under this design. Database authorization stays blocked because it lacks reviewed boundary evidence |
| Available options | Approve the design with explicit unresolved implementation gates; reject; defer until the procedure is concrete |
| Technical recommendation | **DEFER — final design sign-off until all six other Group A prerequisites and concrete procedure details are reviewed** |
| Reasoning | The sheet recommends conditional design approval. Deferring final sign-off here is a more conservative recommendation, not a change to that sheet: endpoint, tools and storage remain unresolved and must not be mistaken for a runnable plan |
| Security and operational risks | Manual checks can be missed; the runner implements none of this plan. Missing observations or failed control cannot count as isolation. Cleanup/recovery may be interrupted |
| Dependencies | V4-1, I-12 option B, V4-2, I-6 canary scope, BV-NET-1 and BV-CANARY-1. Address M3/L2/L5/L6 and the concrete gate table above |
| Required evidence | Complete reviewed procedure with exact commands/arguments, scope, identities, cleanup and stop rules before authorization. Afterwards, raw observations, control/subject outcomes, canary logs, cleanup status and the report hash support V4-9 |
| Timing | Design before boundary verification; separate written execution authorization only after details are complete |
| Reversibility | **Easy before execution; potentially destructive in the later lifecycle.** A report remains historical evidence, not transferable permission for another run |

## Group B — Required before database-test authorization

These entries can be reviewed on paper now. None grants permission to operate a database or extends boundary-task scope. For all database design entries below, eventual execution also requires completed boundary evidence, V4-9 and V4-10, even where the design itself has no prerequisite beyond the selected direction.

### V4-9 — Acceptance or rejection of residual isolation risks

| Aspect | Owner guidance |
| --- | --- |
| Plain-English explanation | After seeing what the boundary experiment actually demonstrated, decide whether its remaining limits are acceptable for the proposed disposable database run |
| If approved | Accept only the documented residual risks for the reviewed scope; database execution still needs its separate policies and authorization |
| If rejected | Database execution remains blocked. Redesign or further separately scoped evidence may be needed; do not reinterpret a failure as acceptable evidence |
| Available options | Accept specified residual risks after evidence; reject; defer |
| Technical recommendation | **DEFER — no boundary evidence exists for review** |
| Reasoning | A risk decision made before the measurement cannot account for its findings. A 64-hex report reference is not a verified report |
| Security and operational risks | Docker access is root-equivalent; VM/kernel resources are shared; one endpoint does not cover all host services; the administrator credential remains in container configuration; the token is a checksum; identity checks have race windows; test acceptance is incomplete |
| Dependencies | All Group A design gates, a separate boundary authorization and its actual evidence; review comparability with the database form of I-6 and the scope under V4-6 |
| Required evidence | Full report and raw artifacts, verified resource identities, successful control, interpretable subject result, continuous canary health, cleanup accounting, differences from the PostgreSQL configuration and an explicit untested-path/risk statement |
| Timing | After boundary evidence, before database-test authorization |
| Reversibility | **Easy to withhold or revise before execution; difficult after exposure.** Risk acceptance cannot reverse a later incident |

### V4-3 — Resource naming and identity verification

| Aspect | Owner guidance |
| --- | --- |
| Plain-English explanation | Make the database runner prove it is using this attempt's throwaway container and storage, rather than an old or similarly named resource |
| If approved | Accept the database-only naming, record and collision policy. It does not create resources or relax the distinct boundary rules |
| If rejected | The current runner's lifecycle cannot be authorized; alternative identity handling needs a separately reviewed package |
| Available options | Approve the source-defined model; reject and redesign; defer |
| Technical recommendation | **APPROVE — design only, with the M4/L6 coverage limits** |
| Reasoning | Full container ID, volume name/creation time and run labels offer stronger identification than names alone. The token also binds post-create identities |
| Security and operational risks | A crash can leave a created but unrecorded resource; labels/records are not cryptographic ownership proof; reported configuration is not behavior. Database collision queries include disposable-label and `nook-nn-` prefix scope, unlike the narrower canary queries |
| Dependencies | V4-1/V4-2 and database I-6; coordinate V4-4, V4-5 and I-5. No database-resource decision is required for boundary canaries |
| Required evidence | Review `derive_names`, `valid_run_id`, create/record/verification paths and verifier fields. Later, actual full ID and volume `CreatedAt` must match records before later stages are authorized |
| Timing | Before database-test authorization; review actual identities between create and later-stage authorizations |
| Reversibility | **Easy before creation; difficult after records exist.** Never rename/reuse a run to hide a mismatch; later attempts need fresh identities and authorization |

Database names are `nook-nn-pg-<runid>` and `nook-nn-vol-<runid>`, with run syntax `^nn[0-9]{8}T[0-9]{6}Z-[0-9a-f]{4}$` (uppercase `T`/`Z`, unlike the boundary run). Labels are `com.nook.disposable=true`, `com.nook.nn-run=<runid>` and `com.nook.package-manifest=<manifest hash>`. No database network is created; mode is `none`. The full container ID and volume `CreatedAt` are recorded and bound to later stages; unrecorded resources are not adopted.

### V4-4 — Exact allowed stage list

| Aspect | Owner guidance |
| --- | --- |
| Plain-English explanation | Decide which named steps can later be authorized, and require separate invocations instead of a “do everything” switch |
| If approved | Accept the 14-stage model: 11 ordinary stages, cleanup/report, and separately authorized recovery. No stage is thereby selected for execution |
| If rejected | No current stage authorization should be issued. A different sequencing model needs review and possibly a new package |
| Available options | Approve the exact model; reject and redesign; defer. Actual authorization can name only the appropriate subset at each phase |
| Technical recommendation | **APPROVE — stage policy only, with written recovery separation** |
| Reasoning | Two-phase authorization lets the owner review created identities before starting/using the database. It adds review overhead but avoids implicit permission for later stages |
| Security and operational risks | The code permits `recover` in the same allowed-stage list as ordinary stages: separation is policy, not enforcement (M3). Cleanup also removes resources. A failed ordinary stage cannot simply be rerun in the same directory |
| Dependencies | V4-3 identity model; coordinate V4-5/I-5. Before execution, V4-10 must name stages and cleanup/report handling, using the actual code and corrected L2 count |
| Required evidence | `KNOWN_STAGES`, stage dependency checks, allowed-list/token logic and the cleanup requirement for `create`; a reviewed two-phase authorization and separate recovery scope |
| Timing | Before database-test authorization |
| Reversibility | **Easy before execution; difficult after a stage mutates resources.** Later permission can be withheld, but completed steps are not undone by unticking them |

The 11 ordinary stages are `preflight`, `create`, `start`, `bootstrap`, `password_pre`, `schema`, `provision`, `test_inventory`, `test_owner`, `test_app`, `test_password`. Closing stages are `cleanup`, `report`. Recovery is `recover`. There is no `all`, `drift` or `test_pool` stage. The database `schema` stage applies the pinned draft inside the disposable database; it is not permission to create a production schema file or migration.

### V4-5 — Cleanup and recovery model

| Aspect | Owner guidance |
| --- | --- |
| Plain-English explanation | Agree how temporary credentials, the database container and its storage would be removed, and how unresolved leftovers would be reported |
| If approved | Accept cleanup as part of a later explicitly authorized database lifecycle. Recovery remains separately authorized and defaults to listing unless its removal confirmation is supplied |
| If rejected | Creation must remain blocked without an acceptable disposal plan; an alternative needs review |
| Available options | Approve the documented/source-qualified model; reject and redesign; defer |
| Technical recommendation | **APPROVE — lifecycle design only, acknowledging that removal is destructive and unverified** |
| Reasoning | Local secrets are handled first, even when Docker is unavailable; recorded container/volume identity gates removal. Unrecorded or pending resources need owner review, not adoption |
| Security and operational risks | Docker outages, interruption and create-to-record crashes can leave resources. The same cleanup core serves ordinary cleanup and recovery. The source does not perform a second full container check between stop and removal; error/absence handling needs careful evidence review |
| Dependencies | V4-3 records, V4-4 stage scope, I-5 lifecycle exception; coordinate R-3 secret handling. V4-10 must cover cleanup before any create permission |
| Required evidence | Read `cleanup_core`, `report_remaining` and `stage_recover`; later require local-secret and Docker-resource statuses separately, removal records and unresolved leftovers. No cleanup has been demonstrated by this review |
| Timing | Before database-test authorization; verify cleanup separately from test outcomes after any authorized attempt |
| Reversibility | **Potentially destructive.** Removed container/volume contents are lost. Preserve required evidence before disposal; changing the policy later cannot restore removed data |

### I-4 — In-container access exception (revision 4 form)

| Aspect | Owner guidance |
| --- | --- |
| Plain-English explanation | Allow the future test runner to perform narrowly listed work inside its recorded database container, including local database connections that do not leave that container |
| If approved | Accept the named exception for readiness, limited administration, reviewed SQL files and password/count checks. It does not permit arbitrary commands or SQL |
| If rejected | Revision 4 cannot run its tests as designed; a different connection design needs a new review |
| Available options | Approve this exact scope; reject and redesign; defer. The earlier register's TCP alternative is not an implemented Revision 4 option |
| Technical recommendation | **APPROVE — source-qualified exception only** |
| Reasoning | It supports tests without a host TCP connection. The administrator is restricted by the runner's closed operation list; ordinary suites use disposable roles |
| Security and operational risks | `nook_iso_admin` is a superuser in the throwaway cluster. Local-socket authentication is expected to need no password. SQL-file allow-listing does not enforce a role/file matrix. The fixed login queries and direct `counts.sql` path do not all use the SQL-file beacon guard (L1) |
| Dependencies | V4-1 and database I-6; review V4-3 identity checks and the R-policy scope together. This exception is not a prerequisite for canary observations |
| Required evidence | `dx_checked`, `admin_op`, `sql_file_allowed`, `sql_run`, password-file helpers, fixed `-c` login statements and `tcp_counts`. Later evidence must separate socket tests from password-authenticated loopback checks |
| Timing | Before database-test authorization |
| Reversibility | **Easy as a permission decision; potentially destructive once exercised.** Owner suites create/change synthetic data and a scratch table; permissions cannot undo executed SQL |

The exception includes `pg_isready`, the closed administrator operations, five package SQL files plus the hash-pinned draft SQL, fixed login queries, direct `counts.sql` input, and writes/removal of four fixed in-container password files. The per-exec check compares ID/state/run label; it is not a full reinspection before every SQL statement. These source limits must accompany the decision.

### I-5 — Docker lifecycle exception (revision 4 form)

| Aspect | Owner guidance |
| --- | --- |
| Plain-English explanation | Decide whether the database runner may later create and dispose of its own container and volume through its restricted set of Docker operations |
| If approved | Select option A's runner-managed model for future authorization, with its actual checks and limitations. No lifecycle action is permitted now |
| If rejected | The current runner cannot be used for lifecycle work. Owner-managed resources would require option B's unimplemented redesign |
| Available options | A: runner manages its own resources; B: owner creates them and a revised runner only verifies/removes nothing; reject; defer |
| Technical recommendation | **APPROVE — option A as a design only** |
| Reasoning | A closed operation list is reviewable and avoids inventing a second manual workflow. Option B is not a safe switch that already exists |
| Security and operational risks | Docker access is powerful. List/context/image lookup and create operations do not verify an already-recorded resource. Full checks occur at source-defined points, with a check/use race and no second full check between stop/removal (M4). PATH/context timing remain L5 limits |
| Dependencies | V4-3 records, V4-4 stage model and V4-5 cleanup should be reviewed together; concrete V4-10 permission comes later. Boundary-network operations are outside this exception |
| Required evidence | The 13 named `docker_op` branches and separate checked-exec path; record creation and cleanup call sites; explicit written environment/operation scope. No network-create/connect/remove or port-publishing operation exists in this runner |
| Timing | Before database-test authorization |
| Reversibility | **Potentially destructive when executed.** Rejecting future permission is easy; removing a volume or acting on a wrong resource cannot be reversed by revising the decision |

### R-3 — Temporary migrator credentials

| Aspect | Owner guidance |
| --- | --- |
| Plain-English explanation | Give the temporary database-owner role a random test password, keep it in restricted files, and exercise password behavior without reusing development credentials |
| If approved | Accept that credential lifecycle for an authorized disposable run: negative checks first, random 128-bit password, restricted files, logging suppression during the password change and local-secret cleanup first |
| If rejected | The package's password stages cannot proceed unchanged. A substitute credential policy needs review and likely a new package |
| Available options | Approve the described temporary-credential policy; reject and redesign; defer |
| Technical recommendation | **APPROVE — test credential policy only, with the source limitations below** |
| Reasoning | It avoids real credentials and supports positive/negative password checks. In Revision 4, it does not make every owner SQL session password-authenticated: owner suites use a local socket |
| Security and operational risks | Files with mode 0600 are readable by other processes of the same user; they are not an isolation boundary against that user. Server log suppression is unobserved. The administrator password is in the container environment/configuration until removal, unlike the tested-role passwords carried through stdin/pgpass |
| Dependencies | I-4 access paths, V4-5 cleanup and database I-6; coordinate V4-6's interpretation of password checks |
| Required evidence | `set_password`, `stage_password_pre`, `pw_put`, `tcp_login`, `pw_rm` and secret cleanup. Later require negative/positive outcomes and credential-cleanup evidence without revealing passwords; recognize PWC5 is a client-side no-password refusal |
| Timing | Before database-test authorization; validate behavior during the separately authorized run |
| Reversibility | **Easy before creation; potentially destructive during cleanup.** Deleted temporary secrets cannot be recovered from the decision record and must never be printed there |

### R-4 — Exact least-privilege matrix

| Aspect | Owner guidance |
| --- | --- |
| Plain-English explanation | Choose the smallest proposed set of database actions available to the application's test role, rather than letting it own or administer tables |
| If approved | Accept the exact matrix below for the disposable test only. Production grants and the provisioning procedure remain separate under Q-7 |
| If rejected | The existing grant file and expected results no longer describe an agreed policy; a different matrix needs a reviewed package and fresh hash |
| Available options | Approve the exact test matrix; reject and specify a justified alternative; defer |
| Technical recommendation | **APPROVE — test-only matrix** |
| Reasoning | It aligns with Q-6 audit limits, N-1's no-delete direction and N-3's migrator ownership while retaining positive checks for permitted application actions |
| Security and operational risks | Table-level UPDATE includes tenant and other sensitive columns. There is no row-level security: foreign keys can reject invalid writes but do not enforce tenant-specific reads. Audit INSERT can contain arbitrary content |
| Dependencies | Existing Q-6/Q-7/N-1/N-3 directions; review R-5, R-6 and R-9 together. I-4/I-5 and lifecycle decisions govern later execution, not the logical matrix |
| Required evidence | Current sheet and `sql/provision.sql`/suite definitions; later catalogue inventory, allowed-action controls and forbidden-action failures. Test policy is not proof of final application authorization behavior |
| Timing | Before database-test authorization; revisit separately before production provisioning |
| Reversibility | **Easy on paper; potentially destructive after use.** Changing grants later cannot undo writes permitted earlier; a new matrix needs new test evidence |

| Objects | Proposed runtime-role permissions |
| --- | --- |
| `organizations`, `users`, `memberships`, `sessions`, `properties`, `floors`, `rooms`, `beds` | SELECT, INSERT, UPDATE |
| `audit_events` | SELECT, INSERT only |
| All nine tables | No DELETE, TRUNCATE, REFERENCES or TRIGGER |
| Database/schema | CONNECT on `nook_test`; USAGE on `public`; no TEMP, database CREATE or schema CREATE; no grant options, role memberships or default-ACL changes |

### R-5 — No DELETE permission on sessions

| Aspect | Owner guidance |
| --- | --- |
| Plain-English explanation | Decide whether the application test role can physically erase session rows or must leave deletion to a separately justified process |
| If approved | Select option A: no DELETE on `sessions`, matching the current package. This does not implement expiration, revocation or a maintenance job |
| If rejected | Do not infer that DELETE has been granted. Option B needs a specific justification, a revised package and new expected results/hash |
| Available options | A: retain no DELETE; B: propose DELETE on sessions only; reject; defer |
| Technical recommendation | **APPROVE — option A for the test** |
| Reasoning | N-1 grants no session-cleanup exception. The restrictive interpretation avoids adding a permission without a demonstrated need |
| Security and operational risks | Retaining rows requires an eventual retention/cleanup policy; allowing deletion could remove useful history. Changing `revoked_at` is not proof that authentication code enforces revocation |
| Dependencies | R-4 matrix and the N-1 constraint. Session lifecycle/cleanup design remains a later Slice 2.3 decision, not a prerequisite to this restrictive test policy |
| Required evidence | Current no-delete grant policy and A-LP17/V08 expectations; later runtime refusal evidence. Any alternative needs a concrete session-cleanup requirement |
| Timing | Before database-test authorization; operational session cleanup later before implementing the affected behavior |
| Reversibility | **Easy to retain a restriction; potentially destructive to grant and use deletion.** An erased row cannot be restored by later revoking the permission |

### R-6 — Keep TEMP revoked

| Aspect | Owner guidance |
| --- | --- |
| Plain-English explanation | Keep the runtime role, including rights inherited through PUBLIC, from creating temporary database tables during this test |
| If approved | Accept the current restrictive test grant policy and its refusal check; no privilege changes occur now |
| If rejected | A justified need and a revised grant/test package are required; rejection is not an automatic grant |
| Available options | Keep TEMP revoked; propose granting it with a reason; defer |
| Technical recommendation | **APPROVE — keep revoked** |
| Reasoning | The current package does not need temporary tables. Avoiding an unused permission keeps the test's scope smaller |
| Security and operational risks | A future workload may need TEMP and would fail under this policy; granting it would add object creation and resource-use capabilities that current tests are not designed to require |
| Dependencies | Review with R-4. No additional earlier decision is needed to choose the restrictive policy; execution remains subject to Group B's authorization gates |
| Required evidence | `provision.sql`, inventory and A-LP8's expected refusal; a concrete workload requirement before considering a wider policy |
| Timing | Before database-test authorization |
| Reversibility | **Easy at design time.** A later change requires a newly reviewed package and evidence; it should not be toggled during a run to bypass a failure |

### R-7 — INFO observations do not count as enforced tests

| Aspect | Owner guidance |
| --- | --- |
| Plain-English explanation | Keep observations, setup checks, rewritten tests and omitted tests visibly separate so that useful output is not mistaken for a proven requirement |
| If approved | Accept honest result accounting: INFO is never an acceptance pass, REWRITTEN remains separate, DEFERRED remains unpassed |
| If rejected | Acceptance reporting needs review before a database run is authorized; rejection cannot turn observations or skipped checks into enforced evidence |
| Available options | Approve the classification; request a justified revised classification and corresponding test design; defer |
| Technical recommendation | **APPROVE — reporting policy** |
| Reasoning | It prevents inflated pass totals and makes missing coverage visible. “Informational” describes how a result is counted, not whether it matters to another decision |
| Security and operational risks | An INFO result may reveal a significant weakness; ignoring it would still be wrong. ENV/FIXTURE failures invalidate the context even though they add no acceptance passes |
| Dependencies | Read the test-class explanation below and coordinate V4-6. This reporting policy can be decided before the later V4-7 choice; it cannot waive A7/N-4 |
| Required evidence | Exact expected-result classes and matrix; later per-stage summaries, raw errors, deferred list and cleanup status, not only the process exit code |
| Timing | Before database-test authorization, then apply again during acceptance review |
| Reversibility | **Easy before reporting; difficult after reliance.** Corrections must preserve earlier reports and explicitly retract overstated conclusions |

### R-9 — Audit integrity wording and its limits

| Aspect | Owner guidance |
| --- | --- |
| Plain-English explanation | Describe the audit table accurately: ordinary application permissions restrict edits, but the table is not an immutable or tamper-evident record |
| If approved | Acknowledge the documented limit. This is wording/policy acceptance, not permission to add a trigger or function |
| If rejected | The technical limitation does not disappear. If stronger integrity is required, it needs a separate design and the relevant scope approval before implementation |
| Available options | Acknowledge the current limit; reject it as insufficient and request a stronger design; defer |
| Technical recommendation | **APPROVE — acknowledge the limits** |
| Reasoning | It matches the recorded Q-6 direction and avoids promising security the grant model cannot provide |
| Security and operational risks | Owners/superusers can alter or remove audit rows; the runtime role can insert arbitrary content. Privilege restrictions do not establish truthful events, tamper detection or retention guarantees |
| Dependencies | Existing Q-6 and proposed R-4 matrix. A stronger trigger/function approach needs a separate manifest/scope decision; it is not provided by another answer on this sheet |
| Required evidence | Grant definitions, owner/application suite observations and source threat model; later tests can corroborate role restrictions but cannot prove audit immutability |
| Timing | Before database-test authorization as an acknowledgement; stronger audit requirements belong to separate design work |
| Reversibility | **Easy to correct wording; difficult to retrofit guarantees.** Later protections cannot establish that earlier stored events were authentic |

### V4-6 — Treatment of the network-dependent tests

| Aspect | Owner guidance |
| --- | --- |
| Plain-English explanation | Accept that this limited package tests some password properties differently and cannot run eleven checks that depend on client libraries or an external database connection |
| If approved | Accept the seven rewritten checks as a separately counted, limited path and document eleven deferrals as an open coverage gap. This is not final equivalence or full acceptance |
| If rejected | The current test plan is insufficient for the owner's intended evidence; redesign or a separately authorized additional environment is needed |
| Available options | Accept the bounded rewrites/classification and temporary gap; reject that scope; defer. The later disposition of the gap belongs to V4-7, not an implicit blanket approval here |
| Technical recommendation | **APPROVE — only the bounded rewrite/classification and explicit temporary deferral**, with the qualifications written in the response's notes; do not accept full equivalence or waived requirements |
| Reasoning | Loopback `psql` can test useful database behavior without recreating a host path. It cannot substitute for Node pool behavior, Prisma-adapter behavior or drift comparisons |
| Security and operational risks | Wrong-password checks match message text rather than SQLSTATE; missing-password refusals are client-side. The empty-string case is absent. Neither the `pg` library nor host forwarding is exercised |
| Dependencies | V4-1 path; R-7 accounting and I-4 access semantics should be agreed with it. Actual equivalence acceptance requires future results. V4-7 is not a prerequisite for a limited run that keeps the gap open |
| Required evidence | Matrix mappings, expected classes, reviewed differences and later individual rewritten results. Any final acceptance needs the missing evidence or an explicit, separately reconciled acceptance-policy decision |
| Timing | Before database-test authorization for planned scope; after results for evidence interpretation |
| Reversibility | **Easy as a limited plan; difficult once used for sign-off.** New evidence can close a gap, but previous missing tests must never be relabeled as passed |

### V4-10 — Final execution authorization

| Aspect | Owner guidance |
| --- | --- |
| Plain-English explanation | Decide whether to issue a complete written permission for named database-test stages against one exact package/run/image, after the earlier safety and policy gates are satisfied |
| If approved | A mere response is insufficient. Only a separately completed, reviewed and signed authorization can permit its named stages, with cleanup and two-phase identity review; this guide supplies none |
| If rejected | No database stage runs. Approved design directions, if any are later recorded, would remain design decisions only |
| Available options | Later authorize a concrete stage subset under the source rules; refuse; defer |
| Technical recommendation | **DEFER — do not authorize now** |
| Reasoning | Boundary evidence, image identity, resource records and unresolved policies cannot be replaced by a valid-looking token. Current draft wording also needs clarification before signing |
| Security and operational risks | Execution creates/removes storage, credentials and synthetic database objects. The token is a checksum anyone with the inputs can compute; it is not a signature or proof of owner consent |
| Dependencies | Group A completion and actual evidence; V4-9; V4-3 through V4-6, I-4/I-5, R-3/R-4/R-5/R-6/R-7/R-9; database scope of I-6; remaining-finding review and draft reconciliation. V4-7 may remain open only while acceptance remains incomplete |
| Required evidence | Independently matched package hashes/file list, pinned external draft inputs, reviewed boundary report/hash, exact run/image/commands/environment, stage scope, cleanup/stop rules and completed owner authorization. Later-phase permission additionally binds the actual container ID and volume `CreatedAt` |
| Timing | After boundary evidence and database policy review, immediately before any named database-test stage |
| Reversibility | **Potentially destructive once exercised.** Withholding later stages is possible; already-created or removed state is not reversed by withdrawing permission |

The register proposes first authorizing `preflight` and `create` with the required cleanup/report arrangements, then reviewing actual identity records before authorizing later stages. Recovery requires separate written permission. No token or signed authorization is produced here. In particular, the register's blanket prohibition on “using any port” and port 5432 conflicts literally with the runner's in-container loopback readiness/password checks. Its “running a container” wording also needs distinction from the proposed start stage versus the forbidden `docker run` shortcut. These are unresolved drafting issues to reconcile before authorization, not permission to ignore the prohibitions.

## Group C — Can be deferred

### V4-7 — Do the deferred tests require a separate environment?

| Aspect | Owner guidance |
| --- | --- |
| Plain-English explanation | Decide how the eleven missing checks will eventually be handled: a separately designed environment, a later phase, or a specifically justified change to what evidence is accepted |
| If approved | The chosen option must be explicit. Selecting another environment authorizes no implementation or run. Accepting deferral would document a coverage gap, not make the omitted checks pass |
| If rejected | The gap cannot be accepted as proposed; required evidence must be obtained before the corresponding acceptance claim. The limited earlier run can remain a separate decision |
| Available options | A second separately designed/authorized environment; later phase with acceptance pending; explicit consideration of accepting deferral; defer the choice |
| Technical recommendation | **DEFER — choose after boundary evidence, while retaining every missing acceptance obligation** |
| Reasoning | The boundary result informs which later environment might be suitable. Choosing now could commit to another unverified design or silently lower requirements |
| Security and operational risks | Required library/adapter behavior may remain untested. Drift rows are INFO in the package but still matter to Q-4b's evaluation condition. An additional environment introduces its own resource and network risks |
| Dependencies | Boundary evidence first for an informed choice; V4-6/R-7 define the gap and accounting. Reconcile any proposed acceptance change with A7's no-waiver rule, N-4's required-CI-test rule and Q-4b; no such reconciliation is made here |
| Required evidence | Named missing IDs/properties, their requirement/milestone mapping, proposed environment or later-phase owner/timing, and explicit acceptance rationale. These details are not yet established |
| Timing | Later; before Slice 2.2 evidence or any affected requirement is claimed complete. It does not block the immediate boundary or limited database evidence milestones |
| Reversibility | **Easy while acceptance stays open; difficult after sign-off.** Future tests can add evidence, but policy acceptance cannot manufacture a historical pass |

## Understanding the test evidence

These counts were read from the 239-row expected-results file, with the matrix supplying the original classes of deferred IDs. They are **planned expectations, not run results**.

| Class | Plain-English meaning | Planned count | How to use it |
| --- | --- | ---: | --- |
| ENFORCE | An assertion about a database-enforced property, such as rejecting an invalid write or a forbidden privilege | 118: owner suite 42, app suite 76 | Count only actual accepted passes; unchanged SQL does not imply it has run |
| REWRITTEN | A replacement check using a different path with stated limits | 7 | Count separately; examine equivalence instead of treating it as an identical original test |
| Deferred enforced | A required-property check this package cannot run | 5 | `T-PW3`, `S1`, `S5`, `S6`, `S7`: never a pass; remains an evidence gap |
| Deferred informational | An omitted observation | 6 | `S2`, `S3`, `S4`, `D1`, `D2`, `D3`: not acceptance passes, but can still be needed by another decision |
| INFO | A recorded observation, including known limits of privileges, status or audit behavior | 14 not deferred | Report and interpret it; do not count it as enforced acceptance |
| ENV | Checks that the experiment reached the intended database/role/run and has the expected setting | 33 | Must succeed; a wrong environment invalidates the experiment but correct setup adds no acceptance pass |
| FIXTURE | Setup data/actions needed to make a test meaningful | 56 | Must succeed; creating a test row is not itself proof of a product requirement |

The eleven deferred rows have class `DEFERRED` in the expected file; their enforced/informational split comes from the matrix. Thus 118 + 7 + 11 + 14 + 33 + 56 = 239 expected rows. The historical accounting 118 unchanged + 7 rewritten + 5 deferred enforced = 130 original enforced IDs is bookkeeping, **never “130 passed.”**

| Rewritten IDs | What is preserved | What is not established |
| --- | --- | --- |
| PWC1, PWC7 | Runtime/migrator login with the intended password | Host forwarding and the Node `pg` client path |
| PWC2, PWC6 | Intended wrong-password refusal | SQLSTATE comparison; the implementation matches message text |
| PWC4, PWC5 | No-password attempt is refused by the client | A server-side missing-password rejection; empty-string T-PW3 remains deferred |
| PWC8 | Runtime loopback counts agree with owner socket counts | An independent host client path or complete application behavior |

The pool limit/no-hang properties and Prisma DELETE/INSERT paths are absent even where SQL covers the underlying permission. The drift observations are absent too. A future report must distinguish data integrity, permissions, client behavior and production applicability.

**A successful runner exit is insufficient.** In `stage_report`, deferred IDs are printed but do not set the failure accumulator. A zero exit can coexist with all eleven deferrals. Review raw errors, individual expected results, missing/duplicate/unexpected IDs, per-stage status, environment/fixture outcomes, the separate rewritten class and cleanup evidence. Cleanup success is not a test pass, and test success is not cleanup success.

**Acceptance-policy ambiguity remains open.** The sheet/package describe possible owner acceptance of deferral. The log's A7 says gather missing Milestone 0 evidence without waiving acceptance criteria; N-4 requires skipped required CI database tests to fail; Q-4b requires disposable PostgreSQL and drift evaluation. The exact mapping of all deferred IDs to those broader obligations is not established by the sheet. The owner must not infer that a V4-7 response overrides them. Scheduling a test later leaves the corresponding requirement open; any proposed change to an existing owner requirement needs explicit reconciliation. “Accepted deferral” and “test passed” are different statements in every case.

## Source limitations and ambiguities to retain

| Item | Consequence for owner review | Timing / treatment |
| --- | --- | --- |
| M3 — Recovery separation | `recover` is not mechanically excluded from ordinary stage lists; cleanup uses the same removal core | Written separation before boundary and database authorization; do not describe it as a code-enforced boundary |
| M4 — Identity wording | Creation/list/image operations cannot all verify a prior recorded identity; full container verification is not repeated between stop and removal | Use source-qualified I-5 before database authorization; any desired code improvement requires separate package work |
| L1 — Access scope | Fixed login SQL and direct `counts.sql` are part of the scope; file allow-listing is not a role/file matrix, and not all paths prepend the beacon guard | Include in I-4 and database authorization review |
| L2 — Stale register | Stage count and blanket statement that earlier I-4/I-5 are not re-asked conflict with the current sheet | Explicitly use sheet/plan boundary gates before boundary authorization; reconcile database register wording before database authorization |
| L4 — Exit status | Deferred checks can remain unpassed despite successful process exit | Inspect evidence before database acceptance |
| L5 — Operator environment | Executables are chosen through PATH; context is checked during preflight, not every later stage; inherited `DX_PGPASSFILE` is not scrubbed | Specify boundary tools/context per plan; acknowledge remaining database-runner limitations in authorization and acceptance |
| L6 — Verifier coverage | It compares selected reported fields, not every configuration field or runtime behavior; for example it does not check entrypoint/command/user, and environment checks are not a complete allow-list of all variables | Use the manual canary checklist before boundary authorization; review coverage before database authorization. Do not run this verifier on canaries |
| L7 — Operation count | There are 13 named lifecycle operations, 14 CLI invocation sites within them because list has two variants, plus the separate exec site | Retain the wording discrepancy; reconcile documentation before finalizing database documentation without modifying pinned files here |
| Concrete boundary procedure | Endpoint/port, listener/client/readiness implementation, tool availability, exact commands and image/storage facts remain incomplete | Must be concrete before boundary execution authorization; no invented defaults or broad discovery |
| Credential rationale | The sheet's “all owner-level checks” wording must not imply password authentication for socket suites; the administrator environment credential differs from tested-role pgpass files | Read R-3 with the source-qualified explanation in this guide; no source edits made |
| Database authorization draft | Blanket port/running prohibitions conflict literally with loopback checks/start behavior; post-failure cleanup/report wording must be made consistent | Owner-reviewed clarification before signing V4-10's separate authorization; do not silently reinterpret the draft |
| Accepted deferral versus existing requirements | A later policy choice cannot automatically waive A7, N-4 or Q-4b obligations | Map missing evidence to requirements before acceptance; keep required work pending |

No finding is marked fixed here. No protected file is edited to reconcile it. Where a desired correction needs code or a pinned-package change, that is a separate revision/review, not a reason to mutate the current package during decision preparation.

## Production schema and migrations remain a separate milestone

None of these 22 responses alone authorizes production implementation. The database-test `schema` stage uses a draft in a throwaway database. The decision log section 4B explicitly permits planning only, and A3 retains the condition that the conceptual model and business rules for enabled features are approved before schema implementation. The conceptual model has an approved direction; unapproved details must not be filled in by implication.

| Required decision or evidence area | What is established in the log | What must be resolved or demonstrated for the affected production scope |
| --- | --- | --- |
| Model and guard order | Minimal nine-table model and allow-list guard direction accepted; guard committed before models; Q-1 describes later legacy retirement | Verify the prerequisite guard/CI state and reconcile stale documents. Plan the valid retirement reference and CI-step removal in the first-model/migration change; historical intent is not current implementation evidence |
| Prisma/PostgreSQL compatibility | A3 is conditional; generator direction accepted; database-free spike evidence exists | Evidence appropriate to the actual generator/build, database constraints and client/adapter behavior. N-5 remains open on whether A3 needs a separately authorized `nook_dev` run; this guide permits no protected-database access |
| Unique indexes | Q-4 approved active-row uniqueness in principle; Q-4b approved preview evaluation only | Decide per-entity uniqueness scopes explicitly; evaluate PostgreSQL enforcement and required drift behavior before choosing preview versus another mechanism. Revision 4 omits drift and cannot supply that evidence |
| Schema rules | Status value sets, initial property fields and normalization direction accepted | Resolve Q-8's proposed CHECK/rowVersion/bed-reason/session choices or explicitly exclude them; approve business rules for enabled features. Do not silently turn later status/lifecycle behavior into database guarantees |
| Later lifecycle details | Q-2/N-2 defer status semantics to Slice 2.3; parts of parent/child archiving can wait until Slice 2.4 | Keep those deferrals explicit and do not implement the behavior early. Settle any rule that affects the schema actually being authorized; not every later application choice blocks a deliberately narrower schema scope |
| Roles and audit | Migrator owns tables; roles/grants provisioned separately from migrations; audit privileges-only; no runtime DELETE on business tables | Review final production grants/procedure under Q-7, credential handling and session cleanup exception if needed. Test R-4/R-5 choices are not production provisioning permission; no unapproved trigger/function |
| Generated artifacts and migration method | Generator family/output direction accepted | Resolve Q-3 commit-versus-build choice and choose the migration-generation method. The competing methods named in older plans are not approved |
| Fixtures versus seeding | Disposable test fixture rows are part of the draft experiment | Resolve Q-9 seed placement for any implementation involving seeds; permission for synthetic test fixtures is not permission for production seed data |
| Acceptance and CI | A7 retains missing acceptance evidence; N-4 requires migration-on-empty-database/database tests and fail-closed required-test handling | Review actual accepted evidence and deferred obligations; plan required first-migration CI work and verify its result when separately authorized. Hosted results cannot be asserted before an authorized push/run |
| Other scope | Q-10's lint/README/assets/public publishing remains unresolved; ADR-010 hosting/region/final deployed major remains open | Keep unrelated publishing/asset decisions outside schema authorization unless included explicitly. Hosting choices must be resolved before their deployment scope; they are not automatic additions to the seven boundary gates |
| Implementation authority | Earlier planning approvals explicitly exclude production schema/migration work | Obtain a new explicit implementation authorization defining files, approved rules, migration method, guard/CI work and validation. It does not automatically authorize migration execution, installation, commit, push or deployment |

A blanket “approve all Revision 4 decisions” therefore cannot start production work. The evidence must be assessed against the actual production requirements, including differences between the disposable draft and the proposed implementation. This guide neither claims those gates passed nor creates a new universal production checklist beyond the source conditions; where the scope-dependent choices above remain unclear, return them to the owner.

## Documentation validation record

The source count is **22 unique decisions**: 10 V4 identifiers, four I identifiers, two BV identifiers and six R identifiers. The guide assigns them as 7 + 14 + 1 and gives each one detailed entry with all requested analysis fields. Recommendations are explicitly advisory; there are no completed owner response fields in this guide.

Validation is limited to local text review, identifier/class counting, link/format checks and byte/hash comparison. The existing decision sheet, boundary plan, decision log, runner/verifier and all other baseline repository files are preserved. The three package manifests and every listed package file match their pre-task hashes; no package code or self-test is executed to verify this.

| Package | Manifest SHA-256 | Files checked against manifest |
| --- | --- | ---: |
| Revision 2 | `30df85941c508147452655b7f8582f82a176d16a024bdc764e253e97422f51b9` | 15 |
| Revision 3 | `8c1e0b8c1afc65ac979bbbc7ec790e9dff65c6c81fc715b6498c0a550409c619` | 19 |
| Revision 4 | `9d328f061493ef373eb954ca83f85f6941729c4132e6e4014eed480dbe6504ef` | 14 |

These hashes establish unchanged artifacts, not successful tests or permission to execute them. No prohibited operation was performed in preparing this guide.

## Proposed owner decision sequence — no responses supplied

1. Review V4-1 and explicitly select the I-12 path. If the owner does not choose the Revision 4 path, stop this proposal rather than falling back to an earlier package.
2. Review V4-2's pinning procedure and I-6's canary configuration. If local image facts are needed, consider only a separately scoped read-only prerequisite authorization; obtain no facts by creating resources. Keep storage/tool uncertainties open until evidence supports the proposed configuration.
3. Review BV-NET-1's exact three-resource identities and cleanup rules. Complete BV-CANARY-1's endpoint, listener/client/readiness mapping, timing and logs; no placeholder counts as a choice.
4. Review V4-8 with all seven Group A decisions and concrete details. Address the source caveats. Only then consider a separate written boundary authorization covering exact commands, identities, limits, cleanup and stop conditions. No response in the sheet substitutes for it.
5. Only after a separately authorized boundary run, review its raw evidence, cleanup and report hash. Decide V4-9 from the actual result. Failure, missing evidence or ambiguity keeps database execution blocked; do not resolve I-12's residual risk by assumption.
6. Review the Group B database policies, preferably identity/stages/cleanup and access exceptions first, then credentials/grants/audit/fixtures/accounting and the bounded rewritten-test scope. Revisit I-6's PostgreSQL-specific scope. Reconcile the stale register and contradictory draft language before signing anything.
7. Consider V4-10 only after those gates: a separate authorization for named stages, with cleanup/report arrangements, followed by review of actual create records before permission for later stages. Recovery has separate written scope even though the runner does not enforce that separation mechanically.
8. Review any later database results by class and evidence, not exit status. Decide V4-7 before affected acceptance is called complete, retaining A7/N-4/Q-4b constraints unless the owner explicitly and separately reconciles a change. Deferred tests are never reported as passed.
9. Address the outstanding production decisions and required evidence for the intended scope, then seek a distinct production implementation authorization. No boundary or database-test approval implies it.

**Stop here for the owner's decisions. All 22 responses remain blank in the actual sheet. No execution is authorized by this guide.**
