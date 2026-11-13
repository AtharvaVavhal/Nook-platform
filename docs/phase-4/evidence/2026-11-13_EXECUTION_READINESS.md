# Phase 4 execution readiness — 2026-11-13

No tests rerun; no implementation, database, credential, feature gate or Git state changed. Prior verification remains accepted evidence. This inspection produced the resource inventory, acceptance execution matrix and consolidated owner-decision register.

## Capacity and cleanup

At 2026-11-13T05:04:48.391459+00:00, statvfs reported **9,461,760,000 bytes free (8.812 GiB)**. Repository minimum: **8,589,934,592 bytes (8 GiB)** under NOOK_LAUNCH_ROADMAP.md §0.5. Margin: **871,825,408 bytes**. The preceding df sample was 9,000,000 KiB; free space is changing, so neither sample is a permanent clearance. **The prior below-threshold disk blocker is resolved at this snapshot without deletion.** Recheck immediately before any heavy run.

Exact candidate allocations measured individually using `du -sk`:

| Candidate | Allocated bytes | Allocated KiB |
|---|---:|---:|
| `/Users/atharva/Library/Caches/com.microsoft.VSCode.ShipIt` | 1,684,369,408 | 1,644,892 |
| `/Users/atharva/Library/Caches/com.todesktop.230313mzl4w4u92.ShipIt` | 1,514,917,888 | 1,479,412 |
| `/Users/atharva/Library/Caches/ms-playwright` | 502,190,080 | 490,420 |
| `/Users/atharva/.npm/_cacache` | 60,608,512 | 59,188 |
| `/Users/atharva/.npm/_logs` | 139,264 | 136 |
| `/Users/atharva/Downloads/nook-phase4-1/apps/api/dist` | 2,338,816 | 2,284 |
| `/Users/atharva/Downloads/nook-phase4-1/apps/web/dist` | 2,170,880 | 2,120 |
| `/Users/atharva/Downloads/nook-phase4-1/node_modules/.cache` | 4,096 | 4 |

These are exact reported allocation measurements, **not a guaranteed post-deletion increase in free space**. APFS sharing/snapshots, open files and concurrent writes can change the actual result. A byte-exact reclaim guarantee cannot be established without deleting and remeasuring; no deletion is authorized or performed.

Candidate classification:
- The two `ShipIt` directories total **3,199,287,296 bytes (about 2.98 GiB)**. They are updater caches, conditional candidates only after confirming the associated apps are closed and no update is pending/in progress. The todesktop bundle's product identity was not inferred from its opaque name. Re-download/update work may be required after removal. Approve exact paths separately; do not delete their parent Caches directory.
- `ms-playwright`: 502,190,080 bytes. Reinstallable browser binaries; conditional on no other Playwright work needing them. Nook's inspected runner uses system Chrome and puppeteer-core, not this cache. Other projects may need a later browser download.
- npm `_cacache`: 60,608,512 bytes. Re-downloadable package cache; removal reduces offline installation capability. npm `_logs`: 139,264 bytes, optional only after deciding old diagnostic logs are expendable; contents were not read.
- API/web dist and node_modules/.cache: 4,513,792 bytes together. Rebuildable, but retain for the coming verification; no meaningful capacity benefit from deleting and rebuilding them now. They are not source or generated Prisma models.

Excluded: all projects/source, node_modules installation, credential/configuration files, Application Support, database files, Docker volumes, stopped containers, test evidence and shared images. Broad Library/Caches enumeration encountered protected paths; only complete individual measurements above are claimed.

Docker read-only summary: 4 images, 2.168 GB total and 1.739 GB reported reclaimable; 4 containers (1 active), 57.34 kB reported reclaimable; 9 volumes (3 active), 273.2 MB reported reclaimable; build cache 0 B. These rounded Docker numbers are **not approved safe cleanup candidates**. A stopped container or unattached volume may contain existing database data. No prune command is proposed.

Machine-readable measurements: [resource inspection](2026-11-13-resource-inspection.json).

## Integration resource contract

Inspected `scripts/qa/phase4-disposable.mjs`, `scripts/ci/test-files.json`, integration guard/isolation helpers, `scripts/e2e/corrections.e2e.mjs`, runtime Prisma service and CI workflow.

| Resource | Minimum or required condition supported by inspection |
|---|---|
| Host disk | At least 8 GiB free before heavy work; retain headroom during execution. Current sample clears this, narrowly. No extra image download is needed for the cached local image. |
| Database isolation | One newly created tmpfs PostgreSQL cluster per harness invocation, fresh cluster identity verification, generated database/role credentials, dedicated dynamic loopback port excluding 5432/5433, disposable database marker and suite lock. |
| CPU/concurrency | Full regression runs 13 integration files with test-file concurrency 1. Do not run browser or another cluster concurrently. Individual tests still exercise concurrent transactions. No CPU minimum is specified in the repo. |
| Memory | Host: 17,179,869,184 bytes (16 GiB), 10 CPUs. Docker VM: 8,319,504,384 bytes (~7.75 GiB), 10 CPUs. Keep these existing allocations; do not reduce them for this run. |
| Memory limitation | The harness sets no explicit container memory, tmpfs-size, CPU or process cap. No recorded full-suite peak establishes a lower RAM minimum. The 20/20 focused result does not prove full-suite memory sufficiency. A numeric smaller safe minimum would be speculation. |
| Cached image | postgres:17.11-alpine, image ID sha256:266d3c257594e195b309ae9d1805e54c788f1d7b375f56bf6c367aac6c917e7b, inspected size 414,811,982 bytes. No pull performed. |
| Hosted CI distinction | CI pins PostgreSQL 17.10 bookworm by digest; the local harness uses 17.11 alpine. Local results do not establish identical hosted-platform behavior. No workflow dispatched. |
| Browser | Existing system Chrome executable verified by filesystem metadata. Real-browser runner needs loopback API 3199 and web 5199, or explicitly supplied alternate ports. Port availability must be checked immediately before use; processes must not be killed to claim ports. |
| Time/output | Migration bootstrap timeout 120 s; full regression child timeout 1,200 s and 50 MiB captured-output cap; browser child timeout 300 s. Timeouts bound execution; they are not expected durations. |
| Long campaigns | Separate A6 mode uses 1,000 iterations, parallelism 4, timeout 7,200 s. It is not the nine transfer race pairs and must not be counted as that campaign. No stress campaign is started here. |

**Safe minimum operating configuration:** preserve the existing host/VM allocation, run one isolated cluster and one suite at a time, verify disk >=8 GiB and Docker health before starting, and use only generated runtime/migrator URLs from the harness. RAM/tmpfs minimum remains unproven until a full run records its peak; this is a measurement gap, not a policy decision. The harness itself does not enforce disk capacity, so the executor must perform the documented check.

Prepared full integration command (not executed in this task):

```sh
df -k .
NOOK_ALLOW_DISPOSABLE_INTEGRATION_DB=1 node --import tsx scripts/qa/phase4-disposable.mjs full regression
```

The local harness deliberately avoids reading .env and does not accept a user-supplied database URL. Its database safety preflight does not clear the separate S1 scope failure. Never change S1, hide/rename .env temporarily, or claim this command makes full CI green. Existing isolated-test authorization is distinct from release acceptance.

Do not use the historical diagnostic profile: it expects an obsolete missing-migration situation. `full-migration-browser` runs P4-2 correction E1–E10 and performs Prisma generation; it is **not a T1–T10 transfer runner** and should not be invoked merely to claim transfer acceptance.

## Scope failure root cause, without secrets

Evidence:
- `scripts/verify_phase_scope.py:130`: `not (root / ".env").exists()` is the entire failing predicate; it checks existence, not credential contents.
- Metadata inspection: root .env exists, is a regular file, not a symlink. Contents were never opened/read/hashed.
- `git check-ignore -v -- .env`: `.gitignore:14:**/.env` applies.
- `git ls-files --error-unmatch .env`: exits 1, confirming it is not tracked.
- `scripts/test_phase_scope.py` explicitly tolerates an ignored local .env in its real-repository self-test and separately tests that S1 rejects one. This explains why self-tests pass while actual scope remains 17/18.

**Resolved diagnostic ambiguity:** S1 is an intentional environment-dependent failure, not evidence of a model/route/migration allowlist error. It does not prove whether any value in .env is safe or unsafe; that was not inspected. The full scope guard was not rerun because its accepted failure and current existence predicate already establish the cause.

**Unresolved disposition:** owner must decide whether to retain this development configuration (and retain S1 FAIL) or arrange a permanent approved removal/relocation outside the repository after assessing dependent development workflows. No file is moved, deleted, read or copied by this task. A clean checkout normally has no ignored file, but HEAD omits dirty/untracked Phase 4 work; a HEAD-only checkout cannot certify the current implementation. Any future reviewed source snapshot must include all intended implementation, and its result cannot erase this workspace's failure. No temporary file hiding or guard exception is proposed.

## Acceptance and approvals

[Official acceptance execution matrix](2026-11-13_T1_T10_EXECUTION_MATRIX.md) separates independently testable read scenarios, runtime-blocked cases, missing specifications and missing runner work. [Owner decisions](../OWNER_DECISIONS_REQUIRED.md) consolidates D1–D8/A1/F1/R1 with choices, consequences and feature/production impact.

Resolved now: measured capacity recovery, resource topology and cached-image availability, exact S1 diagnosis, explicit T1–T10 preparation and one decision register. Still requires approval: any exact cleanup path; permanent .env disposition; all unresolved policy choices; separate target assessment/adoption and activation. No target database was contacted, no feature was enabled and no passing verification was repeated.
