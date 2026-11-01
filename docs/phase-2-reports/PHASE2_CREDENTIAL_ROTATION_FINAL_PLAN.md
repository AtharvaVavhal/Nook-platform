# Nook – Phase 2 Credential Rotation: Final Corrected Safety Plan
*Inspection‑only – no real credentials are changed.*

---

## 1️⃣  Why plaintext temporary files are unacceptable

| Reason | Detail |
|--------|--------|
| **APFS copy‑on‑write & SSD wear‑leveling** | `shred` overwrites logical blocks, but the filesystem may redirect writes to new physical cells. The original ciphertext can remain on the medium and be recoverable with forensic tools. |
| **Snapshot / Time‑Machine / iCloud** | macOS may create invisible snapshots of the file before it is shredded. |
| **Process‑memory dumps** | A crash or `lldb` attach can spill the file contents into a core dump that lands on disk. |
| **Shell history / terminal scrollback** | Any `cat file` or redirection appears in the terminal buffer and in `~/.zsh_history`/`~/.bash_history`. |
| **No atomic “create‑write‑close‑unlink” guarantee** | Even with `umask 077`, the file exists for a non‑zero window and can be read by another process (e.g. backup agents). |

**Conclusion:** The only defensible design keeps secrets **exclusively in process memory** from generation to consumption.

---

## 2️⃣  In‑memory coordinator design (Node + native PTY)

### 2.1  High‑level architecture
```
┌─────────────────────┐
│  coordinator.js     │  (single Node process, never forks a shell)
│  - crypto.randomBytes(32) ×2   →  Buffer pwMig, pwFix
│  - imports PasswordHasher (TS → compiled JS) to hash pwFix → hashFix
│  - spawns **one** pty (node-pty) running:
│        psql -h 127.0.0.1 -p 5433 -U nook -d nook_test
│    *writes* pwMig twice to the pty when the "\password" prompts appear
│  - after successful "\password", writes pwMig to Keychain helper via stdin
│  - runs Prisma user.update({where:{id:FIXTURE_UID}, data:{passwordHash:hashFix}})
│  - writes pwFix to Keychain helper via stdin
│  - performs verification steps (interactive psql for migrator, Prisma verify for fixture)
│  - exits – all Buffers zero‑filled before GC
└─────────────────────┘
```

### 2.2  Critical implementation points (source‑level)

| Concern | Mitigation (code‑level) |
|---------|------------------------|
| **Secret in argv / env** | No `process.argv` or `process.env` secret use. All data stays in local `Buffer`s. |
| **Stdout / stderr leakage** | `console.log`/`console.error` never receives a secret. PTY `onData` handler only matches prompt strings (`Enter new password…`). |
| **PTY echo** | `ptyProcess.stdin.write(pwMig + '\n')` – the PTY is created with `{cols:80, rows:24, echo:false}` so the password is **not echoed** back to the master side. |
| **Terminal recording (script/ttyrec)** | The master side of the PTY is not a real terminal; most recording tools attach to the *slave* side. Because we never allocate a controlling TTY for the parent process, nothing is recorded. |
| **Error output** | Any `psql` error is captured via `ptyProcess.on('exit')` and logged **without** the password (the password never appears in the output stream). |
| **Keychain helper** | `child_process.spawn('./scripts/keychain_helper', ['update','nook_m3c_migrator','nook_phase3c_migrator'], {stdio:['pipe','ignore','ignore']})` → write `pwMig` to `stdin` and close. Same for fixture. No arguments contain secrets. |
| **Prisma** | `PrismaClient` instantiated with the normal `DATABASE_URL` (contains only superuser creds, not the new secret). The `user.update` call receives `hashFix` (a `string` derived in‑memory). Prisma sends a **parameterised** statement – the hash never appears in SQL text. |
| **Memory zeroing** | After each major step, `pwMig.fill(0); pwFix.fill(0); hashFix = null;` – reduces exposure window. |
| **Crash safety** | If the process dies before completion, the secrets evaporate with the process. No file ever existed, so nothing to recover. The operator simply re‑runs the coordinator (new secrets generated). |

### 2.3  Feasibility evidence (inspection)

| Component | Evidence |
|-----------|----------|
| `node-pty` | Widely used (e.g. VS Code terminal). Provides `spawn(command, args, {pty:{echo:false}})`. No secret ever placed in argv. |
| `PasswordHasher` | Already pure TS/JS; can be `require()`‑d after `ts-node`/`esbuild` compile step (or pre‑compile to `dist/`). |
| `keychain_helper` | Already accepts stdin only (see `scripts/keychain_helper.swift:82‑85`). `spawn(..., {stdio:['pipe','ignore','ignore']})` feeds the secret safely. |
| Prisma `user.update` | Verified in `apps/api/src/auth/auth.repository.ts:27‑31` – uses `$executeRaw` with tagged template, guaranteeing parameter binding. |
| No shell involvement | Entire flow stays inside one Node process; no `sh -c`, no heredoc, no `psql -c` with interpolated password. |

**Result:** A **single, auditable Node script** can perform the whole rotation without ever persisting a secret.

---

## 3️⃣  Corrected fixture‑owner verification (no old‑hash SQL)

| Check | Method (in‑memory) |
|-------|--------------------|
| **Exact user UUID** | `await prisma.user.findUnique({where:{id:FIXTURE_UID}, select:{id:true}})` – compare to `00000000-0000-4000-8000-000000000102`. |
| **Exactly one row updated** | `user.update` returns the updated record; Prisma throws `P2025` if none matched. |
| **Organization UUID unchanged** | `await prisma.membership.findUnique({where:{id:FIXTURE_MEM_UID}, select:{organizationId:true}})` – compare to `00000000-0000-4000-8000-000000000101`. |
| **Membership UUID unchanged** | Same query selects `id` → compare to `00000000-0000-4000-8000-000000000103`. |
| **Role & status unchanged** | Select `role, status` from the same membership record – expect `OWNER`, `ACTIVE`. |
| **Only `password_hash` targeted** | Prisma `update` data object contains **only** `passwordHash`; no other fields sent. |
| **New password verifies** | `await new PasswordHasher().verify(pwFix, storedHash)` – both values live only in Buffers/strings. |

*No SQL string containing the old hash is ever built.*

---

## 4️⃣  Failure‑recovery matrix (in‑memory only)

| Failure point | What succeeded | Recovery (no file) |
|---------------|----------------|--------------------|
| **`psql \password` OK, Keychain update fails** | PostgreSQL password changed | Re‑run the **Keychain `update`** call with the still‑alive `pwMig` buffer. |
| **Keychain `update` OK, `psql \password` fails** | Keychain holds new secret | Re‑run the **PTY `psql`** block – the same `pwMig` buffer is still in memory. |
| **Fixture hash update OK, Keychain `update` fails** | DB hash changed | Re‑run Keychain `update` with `pwFix` buffer. |
| **Keychain `update` OK, Fixture hash update fails** | Keychain holds new secret | Re‑run Prisma `user.update` (re‑hash `pwFix` – deterministic). |
| **Verification fails** | Both stores updated | Re‑run the failing verification step; secrets still in memory. |
| **Process crash before any step finishes** | Nothing persisted | No secret ever left memory → operator simply restarts coordinator (new independent secrets). |

*Because the secrets never touch durable storage, a crash does **not** leave a recoverable artifact. The only “recovery” is to start over with fresh secrets.*

---

## 5️⃣  Files that would need to exist / be modified

| File | Change |
|------|--------|
| `scripts/rotate_phase2_credentials.js` (new) | Coordinator implementation described above. |
| `scripts/keychain_helper.swift` | **No change** – already supports `update` via stdin. |
| `apps/api/src/auth/password-hasher.ts` | **No change** – used as library. |
| `apps/api/src/auth/auth.repository.ts` | **No change** – Prisma `user.update` already parameterised. |
| `package.json` (root) | Add dev‑dependency `node-pty` (and `@types/node-pty`). |
| `tsconfig.json` (or `package.json` scripts) | Ensure the coordinator can be compiled/run with `ts-node`/`esbuild`. |
| **No changes** to `.env`, `.env.test`, schema, migrations, Git history. |

---

## 6️⃣  Secret‑handling threat analysis (summary)

| Vector | Exposure? | Mitigation |
|--------|-----------|------------|
| Process argv / env | **No** | Secrets only in local variables. |
| Stdout / stderr | **No** | No `console.*` of secrets; PTY master side discards echoed input. |
| Temporary files | **No** | None created. |
| Shell history | **No** | No shell invoked for secret transport. |
| Core dumps | **Low** | Process zeroes buffers before exit; optional `process.setUncaughtExceptionCaptureCallback` to zero on crash. |
| PTY slave recording | **Low** | No controlling TTY allocated for parent; typical `script`/`ttyrec` attach to slave, not master. |
| Keychain helper error msgs | **No** | Helper prints only status code. |
| Prisma query logs | **No** | Prisma client instantiated without `log:['query']`. |

---

## 7️⃣  Execution estimate

| Phase | Approx. time |
|-------|--------------|
| Install `node-pty` & compile coordinator | 2 min |
| Run coordinator (interactive PTY + two Keychain updates + Prisma update + verification) | 5–8 min |
| Operator oversight (enter superuser password once) | 1 min |
| **Total** | **≈ 10 minutes** |

---

## 8️⃣  Remaining risks / open decisions

| Risk | Status |
|------|--------|
| **PTY library reliability** – `node-pty` must be vetted for the exact macOS version. | **Pending** – run a dry‑run against a throw‑away DB to confirm prompts are matched. |
| **Superuser password entry** – still requires a human to type the `nook` superuser password (or a protected `.pgpass` 600). | Acceptable; never scripted. |
| **Process crash after PostgreSQL change but before Keychain update** – secret lives only in memory, so operator must re‑run coordinator (new secrets). | Documented in recovery matrix. |
| **Audit‑trail requirement** – the rotation itself is not logged anywhere automatically. | Add a manual audit‑log entry after successful run. |

If the team cannot approve the `node-pty` dependency, the **only safe alternative** is a **human‑operated** `psql \password` step (operator pastes from a one‑time printed copy) followed by the two scripted Keychain `update` calls. That path re‑introduces clipboard / scrollback risk and must be explicitly accepted.

---

## 9️⃣  Corrected secret‑free approval request

```
CREDENTIAL ROTATION APPROVAL REQUEST — PHASE 2 (FINAL CORRECTED)

Targets
-------
• PostgreSQL role      : nook_phase3c_migrator
  Database             : nook_test @ 127.0.0.1:5433
• Fixture owner user   : m3c-owner@nook.test.invalid
  User UUID            : 00000000-0000-4000-8000-000000000102
  Org UUID             : 00000000-0000-4000-8000-000000000101
  Membership UUID      : 00000000-0000-4000-8000-000000000103

Keychain services / accounts
----------------------------
• Migrator   – service: nook_m3c_migrator      account: nook_phase3c_migrator
• Fixture    – service: nook_m3c_fixture_owner  account: m3c-owner@nook.test.invalid

Secret generation & transport
-----------------------------
1. Single Node coordinator (`scripts/rotate_phase2_credentials.js`) generates two independent
   32‑byte base64url secrets **in memory only**.
2. Coordinator spawns a **pseudo‑terminal** (`node-pty`) running
   `psql -h 127.0.0.1 -p 5433 -U nook -d nook_test`.
   When the `\password nook_phase3c_migrator` prompts appear, the coordinator writes the
   migrator secret twice (echo disabled).
3. Immediately after, the same migrator secret is piped via stdin to
   `./scripts/keychain_helper update nook_m3c_migrator nook_phase3c_migrator`.
4. Coordinator hashes the fixture secret with the existing `PasswordHasher`,
   runs `prisma.user.update({where:{id:FIXTURE_UID}, data:{passwordHash}})`,
   then pipes the fixture secret to
   `./scripts/keychain_helper update nook_m3c_fixture_owner m3c-owner@nook.test.invalid`.
5. All buffers are zero‑filled before exit; no temporary files, no env vars, no argv secrets.

Database operations
-------------------
• `psql \password` (client‑side SCRAM‑SHA‑256, no plaintext on wire).
• One Prisma `user.update` (parameterised, single row).

Keychain operations
-------------------
• Two `update` calls (atomic `SecItemUpdate`), each fed via stdin.

Superuser authentication
------------------------
• Interactive entry of `nook` superuser password **once** (or a protected `.pgpass` 600). Never scripted.

Verification
------------
• Helper `check` for both Keychain entries.
• Interactive `psql` test connection for migrator (operator enters new password from memory).
• Prisma `findUnique` + `PasswordHasher.verify` for fixture owner.
• SQL queries confirming UUIDs, role, status unchanged; no old hash compared.

Recovery
--------
• Any partial failure → re‑run the failing coordinator step; secrets still resident in memory.
• Process crash → no durable secret remains; operator restarts coordinator (new secrets).

Estimated duration
------------------
≈ 10 minutes (including superuser password entry).

Remaining risks
---------------
• `node-pty` dependency must be vetted; if not approved, fall back to human‑operated `\password` (clipboard risk).
• Superuser password still entered manually – acceptable.

CHECKPOINT A – **Credential rotation** – **requires explicit owner approval** before the coordinator is executed.

CHECKPOINT B – **GitHub release** – **separate**; rotation approval does **not** authorize commits, tags, or pushes.
```

---

## 🔟  Confirmation of *no real mutation*

- No `psql \password` executed.  
- No Prisma `user.update` executed.  
- No Keychain `update` run against real services.  
- No changes to `.env`, `.env.test`, schema, migrations, or Git history.  

---

**END OF REPORT** – *awaiting explicit owner approval for Checkpoint A before any real credential mutation.*