# Phase 2 — Slice 2.2: revision 4 boundary verification plan

**Status: proposed dedicated-network redesign, 2026-10-30; READY FOR OWNER REVIEW, NOT AUTHORIZED FOR EXECUTION.** No boundary observation has been performed. Design approval never permits execution. The [Revision 4 runner](disposable-test-v4/run_disposable_test.sh) does not implement, read or enforce this plan. This document is outside the pinned packages.

**Companions:** [owner decision sheet](OWNER_DECISION_SHEET_REVISION_4.md) · [Revision 4 register](OWNER_REVIEW_REVISION_4.md) · [README](disposable-test-v4/README.md) · [SAFETY.md](disposable-test-v4/SAFETY.md) · [I-12 analysis](PHASE_2_SLICE_2_2_I12_EGRESS_OPTIONS_ANALYSIS.md).

The purpose is to collect limited evidence about a no-network subject before considering database tests. A future evidence report may be hashed for `NOOK_BOUNDARY_EVIDENCE_SHA256`; the runner checks only the supplied value's form and token binding, not the report's authenticity, contents or acceptance. No database-test or production authorization follows from this plan.

## 1. Scope and authorization gates

The proposed run may create exactly three Docker resources: one dedicated verification network, one subject container and one positive-control container. No Docker volume (including an anonymous volume), image, additional container or database may be created. The owner-operated host canary process and local evidence files are separate from this Docker-resource inventory and must be explicitly covered by the future authorization. The canary must not be a fourth container.

Neither container may join an existing project network. The subject uses `--network none`; the control uses only the new network's recorded full ID. No shared-default-bridge positive-control procedure is permitted. No protected service, existing project resource or credential is a target. Ports `5432`, `5433` and `15433` are forbidden. Do not probe other endpoints, gateways, LAN addresses or protocols, or change host firewall/daemon settings to make a result pass.

Before boundary execution can be authorized:

1. Resolve the design decisions `V4-1`, `V4-2`, `I-6`, the option B path choice in `I-12`, `BV-NET-1`, `BV-CANARY-1`, and `V4-8` in the decision sheet. **All remain unresolved today.** Choosing the I-12 path does not accept its residual risk.
2. Specify the exact image ID, image-volume handling, run ID, names, labels, commands and arguments, operator environment, Docker context, evidence directory, duration, endpoint, readiness method and stop/cleanup conditions below. The endpoint and local image configuration are currently unknown. Any authorized read-only prerequisite inspection is a separate, explicitly scoped permission; it does not permit creation or probing.
3. Address the stale register caveat L2 explicitly in the written authorization: use this plan and the decision sheet's prerequisite split for boundary work, not the database-stage draft in the register. The register remains unchanged. Its later reconciliation must not silently alter a pinned package.
4. Issue a separate, explicit written boundary authorization after reviewing those concrete details. A design response in a decision sheet is not that authorization. No such authorization exists.

`V4-3`, `V4-4`, `V4-5`, `V4-6`, `I-4`, `I-5` and `R-3`, `R-4`, `R-5`, `R-6`, `R-7`, `R-9` remain separate unresolved database prerequisites. `V4-9` must remain unanswered until boundary evidence has been reviewed; `V4-10` is a later, separate database-stage authorization. `V4-7` remains an acceptance decision. Recovery is separately authorized, never implied.

## 2. Exact run and resource identities

`<runid>` is exactly `bvYYYYMMDDtHHMMSSz-hhhh`: a valid UTC calendar timestamp with literal lowercase `t` and `z`, followed by four randomly chosen lowercase hexadecimal digits. Exact syntax: `^bv[0-9]{8}t[0-9]{6}z-[0-9a-f]{4}$`, length **23** ASCII characters. Only lowercase ASCII letters, digits and a hyphen are allowed; no spaces, underscores or uppercase letters. The owner selects and binds the value in the future authorization; an example is not a selection. A short random suffix is not a uniqueness guarantee: collision checks are mandatory, and a stopped run ID is never reused.

All three resources have exactly these two run-identity labels:

- `com.nook.boundary-verification=true`
- `com.nook.boundary-run=<runid>`

Each also has its exact role label below; no runner `com.nook.disposable`, `com.nook.nn-run` or `com.nook.package-manifest` identity is substituted.

| Resource | Exact name | Exact third label | Proposed configuration |
| --- | --- | --- | --- |
| Network | `nook-bv-net-<runid>` (35 characters) | `com.nook.boundary-role=verification-network` | New local `bridge` network, not the built-in shared bridge; `Internal=false`, `Ingress=false`, `Attachable=false`, IPv6 disabled; no custom driver/IPAM options or manually chosen subnet |
| Subject | `nook-bv-subject-<runid>` (39 characters) | `com.nook.boundary-role=subject` | `--network none`; never attached to the verification network or an existing project network |
| Positive control | `nook-bv-control-<runid>` (39 characters) | `com.nook.boundary-role=positive-control` | Attached only to the recorded full ID of `nook-bv-net-<runid>` at creation; no later connect/disconnect operations |

The bridge network may provide an outbound route. Its dedication limits membership and cleanup scope; it is **not** an egress firewall or proof of host-service isolation. If the selected endpoint requires different network options, stop for a reviewed plan amendment and new authorization, not an improvised fallback.

### Recording and collisions

Use a new owner-authorized evidence directory, proposed `/private/tmp/nook_boundary_<runid>`, with `records/` and `out/`. Refuse an existing directory; never overwrite or delete evidence. Before creation, record the authorization reference, run ID, context, image ID, intended names, labels and configuration in `records/run.json`. Write a pending record before each create, retaining it as an audit trail.

Immediately after each successful create, before any other Docker action, capture its complete stdout and exit code, validate one full **64-character lowercase hexadecimal ID**, and persist that ID in `records/network.json`, `records/subject.json` or `records/control.json`. Include kind, exact name, run ID, all three labels, creation time, context and image ID (containers); the control record also binds the network ID. Read back the record before proceeding. Then inspect only that recorded ID and save the returned identity/configuration. A failed write, malformed output or interruption before recording leaves ownership ambiguous: stop; never infer an ID later from a name and adopt it.

Preflight and immediately-before-create collision checks may query only the three exact names and resources matching the exact label `com.nook.boundary-run=<runid>` (across containers and networks, so a missing marker/role does not hide a collision). Any name match or run-label match before creation is a collision, even if it appears to be an earlier attempt by this operator. After creation, only the already recorded identities are expected. Query output must be restricted to IDs, names and relevant labels. Use exact-name lookups or exact-match filters, not substring/prefix discovery. Compare returned names for exact equality; an unexpected result stops the task. Do not inspect an unrelated candidate or expand a search to resolve uncertainty. If the available query cannot keep that scope, stop.

No unfiltered listing, global disposable-label listing, prefix-wide enumeration, resource-list command substitution or broad enumeration fallback is permitted. If exact absence cannot be established, stop for owner review. Do not remove a collision, automatically choose another run ID, retry a failed create, or adopt an unrecorded resource. A later attempt needs a fresh run ID and authorization.

The owner verifies ownership by comparing **all** of recorded full ID, exact name, all three label values, kind and context with the authorization and create transcript. For containers, compare image ID and expected network membership; for the network, compare driver/scope/options and membership. Labels and names alone are insufficient, and these comparisons retain a time-of-check to time-of-use risk.

## 3. Canary containers and manual configuration checks

Both containers use the same owner-pinned local image ID (`sha256:<64 lowercase hex>`) with `--pull never`, entrypoint `sleep` and argument `600`; PostgreSQL must never start. Both request `--restart no`, `--memory 1g`, `--pids-limit 512`, and `--security-opt no-new-privileges`. They receive no database credentials, environment file, published ports, added capabilities, devices, host binds, Docker socket, links, volumes-from, extra hosts or custom DNS. The default image user and default capability set must be recorded; this proposal does not silently add `--cap-drop`, `--user` or `--read-only`.

**Storage precondition under I-6:** omitting an explicit volume flag is not a sufficient no-volume plan. Before any creation is authorized, review the pinned image's `Config.Volumes`. The proposed canary-only override is `--tmpfs /var/lib/postgresql/data:rw,noexec,nosuid,nodev,size=64m` in both containers, with image-declared volume destinations required to be exactly `/var/lib/postgresql/data`. This is a proposed in-container tmpfs, not a Docker volume resource. The owner must review the exact image metadata and the override's suitability for preventing anonymous volumes before authorizing creation. Different or additional declared destinations, an unestablished override, or unexpected mounts stop the proposal for amendment; do not create a volume to make it work. Its behavior on this local image/daemon has not been observed.

The canaries therefore differ from the runner in entrypoint, command, environment, identity labels and storage; the control also differs in network. The runner uses a named PostgreSQL volume and credentials and deliberately does not use tmpfs. This plan changes neither the runner nor its hardening policy. Evidence transfers to the database container only as far as the relevant configuration is comparable.

**Do not run `disposable-test-v4/node/inspect_check.mjs` on either canary.** It expects the runner's labels, PostgreSQL environment, a named data volume and `none` networking; it is not a boundary-canary verifier. Manually compare saved inspection fields with the authorization as follows, before starting and again while running. Missing or unfamiliar field shapes require review, never a default pass.

| Manual inspection fields | Static expectation to compare in a future run |
| --- | --- |
| `Id`, `Name`, `Image`, `Config.Labels`, `State.Status` | Exact recorded full ID, name (container inspect includes leading `/`), image ID and three labels; `created` before start, `running` for observations |
| `Config.Entrypoint`, `Config.Cmd`, `Config.User`, `Config.Env`, `Config.Volumes` | Sleep-only process, recorded image user/default environment, no injected credentials or development URLs; declared volume destination covered by the reviewed tmpfs |
| `HostConfig.NetworkMode`, `NetworkSettings.Networks` including each `NetworkID` | Subject: `none`, no real network attachment; only built-in `none` representation (empty before start may be reported). Control: exactly the recorded dedicated network, with matching full `NetworkID`; no second network |
| `HostConfig.PortBindings`, `HostConfig.PublishAllPorts`, `NetworkSettings.Ports` | No published bindings, publish-all false; an image-declared port with a null binding is not a published port and must not be probed |
| `Mounts`, `HostConfig.Binds`, `HostConfig.Mounts`, `HostConfig.Tmpfs`, `HostConfig.VolumesFrom` | Only the reviewed data-directory tmpfs; no named/anonymous volume, host bind, socket or inherited mount. Record the actual representation and stop if it cannot establish the expected storage |
| `HostConfig.Privileged`, `CapAdd`, `CapDrop`, `Devices`, `DeviceRequests`, `Links`, `ExtraHosts`, `Dns` | Not privileged; no added capabilities, devices, links, extra hosts or custom DNS; record default capability policy |
| `HostConfig.PidMode`, `IpcMode`, `UsernsMode`, `SecurityOpt` | No host/shared-container namespaces; reviewed default user namespace; `no-new-privileges` enabled; record security options and any default profile |
| `HostConfig.RestartPolicy`, `Memory`, `PidsLimit` | No restart, 1073741824 bytes, 512 PIDs |
| Network `Id`, `Name`, `Labels`, `Driver`, `Scope`, `Internal`, `Ingress`, `Attachable`, `EnableIPv6`, `Options`, `IPAM`, `Containers` | Match section 2 and recorded daemon-assigned addressing/default options; initially empty membership, then only the recorded control; no unknown member, and never the subject |

This table states review expectations, not implemented checks or observed results. Inspect reports configuration; it does not measure packets, namespace behavior or capability enforcement. The runner verifier's broader coverage limitations remain L6.

## 4. Endpoint decision and positive-control protocol

**BV-CANARY-1 is UNRESOLVED. No exact canary endpoint or port has been established.** The earlier plan mentioned a host loopback listener and an example port, but did not establish a container-reachable endpoint. Neither is a selected endpoint. In particular, the subject's `127.0.0.1` denotes its own namespace and is not a substitute for host loopback.

Before authorization the owner must complete and review all of the following; placeholders are not executable defaults:

| Required choice | Current status / constraint |
| --- | --- |
| Single destination and port | **UNRESOLVED:** one exact numeric IP literal, address family and TCP port, excluding `5432`, `5433`, `15433`; identical in control and subject; no DNS search, alternate address or port sweep |
| Listener implementation and bind | **UNRESOLVED:** owner-managed host process, exact implementation/arguments, bind address, process ownership and lifetime; no existing service or extra container |
| Reachability mapping | **UNRESOLVED:** explain how the dedicated network reaches that host listener, without touching a project service or changing firewall/daemon configuration; if a loopback-only bind cannot support it, stop for an explicit design decision |
| Readiness and health evidence | **UNRESOLVED implementation:** listener confirms successful bind/listen at the approved address/port, gives its PID/start time and timestamped ready event, opens its log before probing, and reports uninterrupted health through both attempt windows; no extra readiness connection |
| Client and bytes | **UNRESOLVED implementation:** exact pre-existing client executable and arguments in the pinned image; fixed request and expected banner/response, with run/role correlation markers; no installation, retry, redirect or fallback behavior |
| Timing and logs | Proposed maximum 5 seconds per attempt; start the subject attempt within 30 seconds after control success, within the containers' 600-second lifetime. Authorize exact timestamps, log paths and listener shutdown procedure |

Canary-side logs must record accepted connections, time, peer address/port, received marker/bytes, response and listener errors/start/stop events. Application logs cannot record packets that never reach or are never accepted by the listener: absence of a log entry is limited evidence, not a packet-level guarantee. Correlate role markers with non-overlapping time windows; Docker/NAT may obscure the original container address.

**Single positive-control test:** after manual inspection and readiness, the recorded control makes exactly one TCP connection attempt to the owner-selected endpoint, sends the approved fixed request once, and waits for the expected response within five seconds. Save client command, version, timestamps, full stdout/stderr, exit code, response bytes, control ID, image ID and network ID, plus the corresponding canary log. No retries or secondary probes are allowed.

- **Control success:** connection established, exact expected response received within the deadline, successful client exit, and exactly one attributable control exchange in the healthy canary log. All identity/configuration checks must also match.
- **Control failure:** no connection, timeout/refusal, wrong/absent response or nonzero exit. Stop; do not probe from the subject or troubleshoot by widening scope. This makes the boundary result **inconclusive**, not an isolation pass.
- **Inconclusive despite apparent success:** missing/truncated logs, ambiguous attribution, readiness not established, listener health gap, multiple attempts, unavailable/unsupported client, configuration/identity drift, missed timing or any unapproved change. Stop and retain the risk.

This control validates only the particular client-to-listener connectivity path at that time. It does not establish reachability of the development database, universal host-service isolation, or any untested address, port, protocol or channel. A dedicated network alone proves none of those claims.

## 5. Subject checks and future sequence (not executable authorization)

Static reading establishes intended flags and the differences from the runner. Every observation below requires separately authorized live execution; none has been collected.

1. Review the concrete authorization and image/storage prerequisites. Docker must already be running; do not start it. Record the exact approved context/daemon identity and CLI path, refuse routing overrides, and recheck the context before each lifecycle phase. Take two free-disk readings, both at least 5.5 GiB. Use only section 2's collision queries. Unavailable prerequisites mean stop, not installation or resource discovery.
2. Create only the dedicated network, record its full ID immediately, and inspect its identity/configuration and empty membership. Create the subject, record immediately, inspect before start. Then create the control attached by the recorded network ID, record immediately, inspect before start. Recheck membership: only the control may appear. Retain pending and completed records. No resources are adopted.
3. Start only the recorded containers after matching manual inspections. Recheck their configurations while running. For the subject, collect `/proc/net/dev`, `/proc/net/route` and `/proc/net/ipv6_route`, interface/address and route listings for both families (including policy-routing tables if supported), `/etc/resolv.conf`, and capability/security fields from `/proc/1/status` and the actual probe process. The owner must name available observation/decoding tools in advance; if a required observation cannot be made, stop without installing tools.
4. Expect only loopback interfaces and local/loopback routes, no non-loopback interface, default route or route to the canary. Decode `CapInh`, `CapPrm`, `CapEff`, `CapBnd`, `CapAmb`; require no `CAP_NET_ADMIN` or `CAP_SYS_ADMIN` in any set, record all remaining capabilities and `NoNewPrivs` (expected 1). Record rather than assume seccomp/profile state. These observations are snapshots of the kernel-provided state, not proof against every channel or later change.
5. Establish owner-canary readiness, then perform the single control test in section 4. Only after success, within the approved window and with continuous listener health, let the subject make exactly one attempt using the same client/options, numeric destination, port and request semantics (subject role marker). Save exit code, diagnostics, timestamps and any received bytes, and the entire canary-side log window. Attempt no other destination.
6. Expected subject result: the client actually attempts the authorized connection and fails to establish it (for example a documented no-route error or deadline expiry), with no attributable subject acceptance in the healthy canary log. Missing tools, bad arguments, a refusal/reset of unexplained origin, unavailable logging or a listener outage are **inconclusive**. Any established subject connection, even without the expected banner, or attributable canary acceptance is a **boundary failure**. Stop further probing.
7. Reinspect recorded identities, subject network configuration and dedicated-network membership. Apply only the explicitly authorized cleanup below, then assemble the evidence report. Do not invoke a Revision 4 stage, including its `recover` or `report`, for this task.

Even a matching `--network none` inspection plus a failed subject attempt does not alone prove host isolation. Evidence is limited to this configuration, observation window and endpoint, supported by control success and canary health/logs.

## 6. Cleanup, interruption and recovery

Cleanup authorization is limited to the three recorded full IDs and must be written before creation. No removal by name, prefix, wildcard, force, prune, Compose or guessed ID is allowed. Preserve local logs, pending records, completed records and reports.

Before the first cleanup mutation, verify every successfully recorded resource against its record and authorization, including context, exact name/ID/labels, container image/network identity and network membership. A pending create without a recorded ID, unexpected absence, unknown network member, mismatch or inaccessible daemon means **stop and remove nothing**. A resource never created is skipped only when the audit trail clearly establishes that no create was attempted. No broad enumeration is a fallback.

After a clean initial audit, stop the recorded control and subject if running, then remove those containers without force or volume-removal flags. Immediately before **each** stop or removal, recheck that container's identity and the network's permitted membership. An already stopped container may be removed only in its recorded, verified state. Then inspect the recorded network ID again: require the exact name/labels/driver/scope/configuration and **zero attached containers**, and only then remove it by full ID. Never detach an unexpected member to make network removal succeed.

On a later mismatch or operation failure, stop the remaining cleanup immediately and report any removals already completed; do not claim that earlier removals were undone. Verify completed removals only against the exact recorded IDs, distinguishing a specific not-found result from daemon/permission errors. Final collision checks use only the original exact-name/run-label scope. Report each resource as removed-and-confirmed, remaining, never-created or ambiguous; unexpected absence before a recorded removal is not a cleanup success. The owner shuts down their recorded canary process using the authorized procedure and preserves its logs.

Interruption, lost records or create-to-record crashes require owner review and a **separate recovery authorization**. No automatic adoption, retry or recovery is permitted. This is a written authorization rule, **not mechanically enforced by the Revision 4 runner**: its `recover` can share a stage list with ordinary stages and uses the same cleanup core (M3). That runner cannot manage these boundary-canary identities. No recovery is authorized now.

## 7. Evidence, outcomes and remaining findings

The future report must include the written authorization reference; run/context/image identities; immediate full-ID records and create transcripts; scoped collision results; manual configuration comparisons; namespace/routes/capability observations; the exact endpoint/bind/client/request/response and readiness/health evidence; both attempt windows and client outcomes; canary logs; cleanup actions and unresolved leftovers; and every deviation, omission or untested assumption. Preserve raw evidence without credentials. Hash the completed report with an ordinary file-hash tool.

| Outcome | Meaning |
| --- | --- |
| Limited boundary evidence collected | All identity/configuration/namespace checks match, control succeeds, subject cannot establish the single connection, canary remains healthy with no subject acceptance, and evidence is complete. This is evidence for that path, not universal isolation proof |
| Boundary failure | Subject establishes the connection or the canary records attributable subject acceptance; retain the risk and block database execution |
| Inconclusive / unverified | Missing or ambiguous observation, failed control, unresolved endpoint, timing/logging gap, collision, configuration drift, unavailable tools or other stop condition; no pass |
| Cleanup incomplete / ambiguous | Report independently of the connectivity outcome; no overall completion claim while resources remain unresolved |

The owner must review actual evidence before deciding `V4-9` or considering `V4-10`. Design approval, a report hash, a successful cleanup or a runner exit code does not authorize a database test or count deferred tests as passed.

The [decision sheet section A1](OWNER_DECISION_SHEET_REVISION_4.md#a1-remaining-findings-from-the-revision-4-safety-review) retains **M3, M4, L1, L2, L4, L5, L6 and L7** and their timing. Boundary authorization must acknowledge the written recovery rule, register caveat, operator-environment limitations and manual coverage limits; database authorization/acceptance must separately address the remaining runner/SQL/test findings. None was fixed in a pinned package. The older isolated-environment plan and Revision 2/3 authorization drafts remain historical designs for their own packages, not fallback procedures for this boundary run.
