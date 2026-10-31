# Phase 2 — Slice 2.2: I-12 host-service egress, options analysis

**Status:** written 2026-10-29, analysis only. **Nothing in it is approved, and I-12 stays unresolved.** No Docker command, Docker inspection, network probe, database connection, SQL, Prisma command, installation, configuration change, test stage or Git operation was performed. The revision 3 package ([`disposable-test-v3/`](disposable-test-v3/README.md), manifest `8c1e0b8c1afc65ac979bbbc7ec790e9dff65c6c81fc715b6498c0a550409c619`) and revision 2 are unchanged.
**Companions:** [SAFETY.md §6](disposable-test-v3/SAFETY.md) · [decision register, I-12](OWNER_REVIEW_ISOLATED_ENVIRONMENT.md) · [design plan](PHASE_2_SLICE_2_2_ISOLATED_TEST_ENVIRONMENT_PLAN.md).

**Evidence basis, stated plainly.** Only two things here are read from this repository: `docker-compose.yml` (the development database is published as `127.0.0.1:5433`, image `postgres:17.11-alpine`, password a documented placeholder) and the revision 3 package files. Everything about how Docker Desktop, Linux network namespaces, macOS `pf` or a hypervisor behaves is **background knowledge, not observed on this machine and not checked against current documentation in this task**. It is labelled _unverified_ wherever it carries weight. Nothing below is a measured result.

## 1. Separation is not enforcement

A new network, port, volume, credential or container name **separates** resources. It does not stop a process in the container from opening an outbound connection. Enforcement exists only where either (a) the process has **no network path** to the target (no interface or route), or (b) a **policy outside the process's control** drops the traffic. Every alternative below is judged only on that.

The protected targets are the existing development database (`127.0.0.1:5433` on the host, whose password is a public placeholder in the repository) and any other host service. How a Docker Desktop container reaches the host (a host-gateway name handled by Docker Desktop's own proxy) is _unverified_ here; the risk in revision 3 rests on it.

## 2. Alternatives

### Option 1 — Container with **no network** (`--network none`), tests run inside it ("revision 4 design")

- **Boundary.** The container's network namespace holds only a loopback interface: no bridge, no gateway, no host route. A process cannot reach the host because there is nothing to route through; no policy is needed. This is the only alternative that gives a boundary **by construction without anything privileged**. _Unverified on this Docker Desktop version._
- **What it prevents.** All outbound traffic from the PostgreSQL process and anything else in that namespace, including host services. It does not prevent other channels the container already has (for example the mounted volume and its own filesystem), but it has no host mount and no Docker socket.
- **Privileges and changes.** None beyond what revision 3 already needs: the same Docker CLI, the same local image, no installation, no firewall or daemon change.
- **Effect on existing Nook resources.** None by design; it removes the only network connection that revision 3 shared with the host.
- **Cost of the change (this is the real cost).** There is no published port, so the host can no longer reach the database over TCP, and the Node-based clients cannot connect. Tests would run **inside the container** with `psql` over the container's own loopback (via `docker exec`, using the closed-operation pattern already in the runner). The image is a PostgreSQL alpine image; it has no Node.
  - **Unaffected (118 of 130 `ENFORCE` ids):** `test_owner` (42) and `test_app` (76) are SQL suites that need only `psql` and the existing result protocol; so do schema, provisioning, inventory and counts.
  - **Cannot run as written (12 of 130):** `T-PW1`–`T-PW8` (password authentication over TCP, Node) and `S1`, `S5`, `S6`, `S7` (shared `pg.Pool` and the Prisma adapter, Node). Password-authentication checks could be re-expressed in `psql` over the in-container loopback, but that is a different test and its handling of the password (no `docker exec -e`, no process-list exposure) needs its own design. The Prisma adapter and the three drift comparisons (`INFO`) need Node and the pinned spike tree and cannot run here.
  - The Class 1 beacon check moves to `psql`; the Class 2 admin path is unchanged.
- **Operational complexity and likely cost.** Moderate: a new package (revision 4), a rewritten test path and expected-result lists, a new hash, a new owner review. No new software, no new disk beyond revision 3, no money.
- **Remaining limitations.** `none` is only as good as Docker's implementation and the Docker VM; a container with extra capabilities, or one later reconnected to a network, would lose the boundary, so the identity verifier would need to assert `NetworkMode` `none` and an empty network list. Twelve acceptance ids would be deferred or rewritten. Everything else in SAFETY.md §10–11 still applies (Docker socket power, shared VM).
- **Evidence needed to verify it (separately authorized).** `docker inspect` of the created, not-yet-started container showing network mode `none`, no published ports, no extra networks; after start, an in-container read of the routing table and interface list (loopback only) and a refused connection to a **canary** listener started by the owner on a throwaway host port (never `5433`); the same verifier checks added to `inspect_check.mjs` with offline self-tests.

### Option 1b — **Shared network namespace** with a Node client container

A second container joins the database container's namespace (`--network container:<id>`), so both have loopback only and no egress, and the Node tests could run there. _Unverified._ It needs a Node image that is not known to be present, the package files and the pinned spike tree inside the client container (which means read-only host bind mounts, a new category of exposure the revision 3 verifier forbids, or a way to copy files that the design forbids), and a second set of identity checks. **More complex; not recommended before Option 1 has been observed to work.**

### Option 2 — Docker **internal** network (`--internal`) plus a client container

- **Boundary.** Docker (not the host firewall) installs the rules that stop containers on an internal network from leaving it; the network has no gateway. Enforcement is by Docker's own rules, which need no privilege from us. _Unverified: whether the host-gateway name and Docker Desktop's host proxy are reachable from an internal network is exactly the open question._
- **Prevents.** Routing out of the bridge, if the above holds.
- **Cost and limits.** Published ports are not expected to work from an internal network, so the host-side TCP path disappears for the same reason as Option 1, **without** Option 1's by-construction guarantee, and it still needs a client container as in Option 1b. Strictly weaker than Option 1 for the same redesign.
- **Evidence needed.** Network inspect showing `Internal: true`; an attempt from inside to reach a canary listener on the host gateway, expected to fail; behaviour of the host-gateway name.

### Option 3 — A separate **disposable virtual machine** with an outbound policy

- **Boundary.** A guest with its own kernel; an outbound deny rule set inside the guest (for example `nftables` with default-deny egress except guest loopback) owned by the guest's root; and a hypervisor network mode chosen so the guest has no route to the host's services (for example no network device at all, or host-only isolation). The strongest boundary, and independent of Docker.
- **Prevents.** Everything the policy and the network mode drop. The boundary holds only if the hypervisor mode really gives no path to the host (a NAT mode normally gives the guest the host's gateway address; whether host loopback services are then reachable depends on how they are bound and on the hypervisor; _unverified_).
- **Privileges and changes.** A hypervisor or VM manager must be **installed** (forbidden now; needs its own authorization, disk gate and dependency review), an OS image downloaded, and in practice PostgreSQL, Node and the pinned inputs installed or copied into the guest. Networking mode choice may need administrator rights on macOS.
- **Effect on existing Nook resources.** Independent of them, but it shares host CPU, memory and disk (earlier in this project free disk fell sharply when Docker started), and any shared folder or host-only network would create a new path that must be checked.
- **Complexity and cost.** Highest: a new environment to build, secure, verify and tear down, new software supply chain, much larger disk and time, and a rewritten package. No money cost for local virtualization; cloud variants cost money and put data outside the machine (not recommended for this).
- **Remaining limitations.** Guest and hypervisor vulnerabilities; the rules and hypervisor mode must be verified rather than assumed; every install is a new unverified surface.
- **Evidence needed.** The guest's active rule set and routing table; an attempt from the guest to a canary listener on the host (and its failure); the hypervisor's network configuration; a hash of the guest image.

### Option 4 — **Host firewall** rules (`pf`) or Docker Desktop / VM configuration

- **Boundary.** Policy outside the container's control, genuinely enforceable.
- **Why it is not a candidate here.** It needs administrator rights and **changes protected host, Docker or VM configuration**, which this work forbids; rules scoped to "the Docker VM" would also affect the existing development container's VM, and per-container scoping is not available at that layer. Docker Desktop settings that might restrict host access are _unverified_ and may depend on a plan or administrator-managed configuration. It would need its own authorization and a rollback plan before it could be considered.

### Option 5 — **Not** enforcement (rejected)

Dropping capabilities, `no-new-privileges`, removing the host-gateway name or DNS settings, a seccomp profile on `connect` (it cannot inspect destination addresses and PostgreSQL's own local connections need the call), a dedicated bridge network and port (revision 3's design), random credentials, "the package never sends such traffic", and detection by probing the protected port. These reduce likelihood or remove a convenience; none stops an outbound connection.

## 3. Comparison

| Option                                  | Enforced by construction or by outside policy | Needs privilege or install          | Keeps revision 3's host TCP test path | Tests lost of 130 `ENFORCE`   | Complexity           |
| --------------------------------------- | --------------------------------------------- | ----------------------------------- | ------------------------------------- | ----------------------------- | -------------------- |
| Revision 3 as is                        | **No** (separation only)                      | no                                  | yes                                   | 0                             | low                  |
| 1. `--network none`, tests in-container | **Yes, by construction** (unverified)         | no                                  | no (replaced by in-container `psql`)  | up to 12 (deferred/rewritten) | moderate             |
| 1b. Shared namespace, Node client       | Yes (unverified)                              | no, but host mounts needed          | no                                    | 0, if it works                | high                 |
| 2. Internal network + client            | By Docker's rules (unverified)                | no                                  | no                                    | 0, if it works                | high                 |
| 3. Separate VM + outbound policy        | Yes, if configured and verified               | **install, possibly admin**         | depends                               | 0, if rebuilt                 | highest              |
| 4. Host firewall / Docker config        | Yes (policy)                                  | **admin; changes protected config** | yes                                   | 0                             | high, forbidden here |
| 5. Hardening, naming, credentials       | **No**                                        | no                                  | yes                                   | 0                             | low                  |

## 4. Conclusion

**No safe enforceable solution can be established from the available evidence.** Option 1 is the only one that offers a boundary without a privileged change or an installation, and it is promising for that reason, but nothing about it has been observed here, and it requires a redesign (revision 4) that defers or rewrites up to 12 of the 130 acceptance tests. Therefore:

- **I-12 stays unresolved.** Neither this analysis nor the register approves anything.
- **Recommended option: B** (keep execution blocked), with the next step being a **separately authorized design task for a revision 4 built on Option 1**, followed by a separately authorized, bounded verification of the boundary using the evidence listed under Option 1 and a canary listener, before any test package is run. Option A (accept the residual risk in revision 3) remains available to the owner but is not recommended as a substitute for enforcement.
- **I-12 cannot be resolved without a separate authorization.** Choosing an option is the owner's decision, designing revision 4 is a new task, and verifying any boundary needs Docker commands that this task is forbidden to run.

**Remaining uncertainties:** whether `--network none` behaves as assumed on this Docker Desktop and whether `docker exec` into such a container works for the admin path; whether in-container `psql` over loopback can reproduce the password-authentication tests acceptably; how the host-gateway path actually behaves today (never observed, which is why revision 3's risk is stated as unresolved rather than as proven); whether the 12 deferred tests may be deferred without weakening the Slice 2.2 evidence; and whether a node image or a VM is acceptable at all.

**Status: NOT READY FOR OWNER REVIEW as a decision to authorize execution** (execution remains blocked). The analysis and the updated register are ready for the owner to read and to choose among A, B and C.
