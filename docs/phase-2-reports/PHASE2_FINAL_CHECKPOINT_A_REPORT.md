# Nook – Phase 2 Credential Rotation – Checkpoint A (Final, Corrected)

*Inspection‑only – no mutations performed.*

---

## 1. Secure administrative Prisma connection  

| Requirement | How it is satisfied |
|-------------|--------------------|
| **No persistent `.env` / `.env.test` / `.env.rotation`** | The **coordinator process** builds the `DATABASE_URL` **in memory** from the super‑user password it receives on **stdin** (hidden). It then instantiates a **one‑time `PrismaClient`** with `new PrismaPg({connectionString: adminUrl})`. No file, no shell variable, no log entry ever contains the password. |
| **No password in argv / shell history / logs** | The super‑user password is read once from the coordinator’s `stdin` (e.g. `read -s` in a tiny wrapper or `process.stdin` in the Node script). The constructed URL lives only in a JS variable and is passed to `PrismaClient` constructor. |
| **Target only `nook_test` @ `127.0.0.1:5433`** | The coordinator hard‑codes host/port/database (`127.0.0.1:5433/nook_test`) and only interpolates the *password* it just read. |
| **Existing secure mechanism** | The only runtime secret source the codebase already uses is **stdin → Keychain helper** (`scripts/keychain_helper`). The same pattern (stdin‑only) is reused for the super‑user password. No new mechanism is invented. |

**Result:** The administrative Prisma client is created **inside the coordinator**, authenticated as the `nook` super‑user, and used solely for the single `user.update({where:{id:FIXTURE_UID}, data:{passwordHash}})` call. After the call the client is disconnected and the URL string is zeroed.

---

## 2. Actual super‑user authentication sequence  

1. **Operator starts the coordinator** (e.g. `node scripts/rotate_phase2_credentials.js`).  
2. Coordinator immediately **prompts on its own stdin** (hidden, `read -s` / `process.stdin`):  
   ```
   Enter super‑user (nook) password:
   ```  
   The operator types the `nook` password **once**; it is stored in a `Buffer` inside the coordinator.  
3. Coordinator **spawns a PTY** (`node‑pty.spawn('psql', ['-h','127.0.0.1','-p','5433','-U','nook','-d','nook_test'], {cols:80,rows:24})`).  
4. PTY emits “Password for user nook: ” → coordinator **writes the buffered super‑user password** followed by `\n`.  
5. PTY now shows the `psql` prompt → coordinator sends `\password nook_phase3c_migrator` and writes the **migrator secret** twice (psql disables echo).  
6. Coordinator immediately pipes the **same migrator secret** to `./scripts/keychain_helper update nook_m3c_migrator nook_phase3c_migrator` (stdin).  
7. Coordinator hashes the **fixture secret** with the existing `PasswordHasher`.  
8. Using the **in‑memory admin `DATABASE_URL`** (built from the super‑user password from step 2) it creates a temporary `PrismaClient` and runs the parameterised `user.update`.  
9. Fixture secret is piped to `./scripts/keychain_helper update nook_m3c_fixture_owner m3c-owner@nook.test.invalid`.  
10. All `Buffer`s are `fill(0)`‑ed; coordinator exits.

*No separate terminal, no password reuse across processes, no secret ever written to disk.*

---

## 3. Safe regression commands & database safeguards  

| Command (run from repo root) | What it executes | Database target guarantee |
|------------------------------|------------------|---------------------------|
| `npm run test` | `npm run test --workspaces --if-present` → API `test` (`node --import tsx --test test/*.test.ts`) + Web tests | **API unit tests** use an **in‑memory SQLite** (configured in test bootstrap) – **no Postgres**. |
| `NOOK_DATABASE_TESTS_REQUIRED=1 DATABASE_URL=postgresql://nook_phase3c_runtime:<pw>@127.0.0.1:5433/nook_test npm run test --workspace @nook/api -- --testPathPattern=integration` | Runs `test/integration/*.test.ts` (requires real Postgres) | `DATABASE_URL` **explicitly set** to `nook_test` on **5433**; the test file (`database-migration.test.ts`) reads `process.env.DATABASE_URL` and aborts if it points elsewhere. |
| `npm run test:database` (API) | `DOTENV_CONFIG_PATH=../../.env.test node --import dotenv/config --import tsx --test test/database-migration.test.ts` | The **temporary** `.env.test` is **not written**; instead the caller exports `DATABASE_URL` (as above) and the `dotenv` loader reads it from `process.env`. |
| `npm run typecheck` | `tsc --noEmit` on API & Web | No DB access. |
| `npm run verify:migration` | `python3 scripts/verify_initial_migration.py` | Script invokes `psql -h 127.0.0.1 -p 5433 -U nook_phase3c_migrator -d nook_test`; the caller must export a `DATABASE_URL` that matches `nook_test` on **5433**. |
| `npm run verify:scope` / `verify:m0-scope` | Static schema / migration checks – no DB connection. | – |

**Safeguard:** Every command that touches Postgres is **invoked with an explicit `DATABASE_URL` environment variable** that points to `127.0.0.1:5433/nook_test`. No default `.env.test` file exists; the CI / operator supplies the variable at call time, guaranteeing the wrong database (`nook_dev` / port 5432) can never be reached accidentally.

---

## 4. Corrected crash‑recovery procedure  

| Crash point | State after crash | Recovery (always with **new** independent secrets) |
|-------------|-------------------|---------------------------------------------------|
| **A – before any mutation** | Nothing changed | Restart coordinator → fresh `migratorSecret`, `fixtureSecret`. |
| **B – after `psql \password` succeeded, before migrator Keychain `update`** | PostgreSQL password = *M1* (lost if process dies) | 1️⃣ Generate new `M2`. 2️⃣ Re‑run `\password nook_phase3c_migrator` with `M2` via PTY. 3️⃣ Run Keychain `update` for migrator with `M2`. |
| **C – after migrator Keychain `update`, before fixture hash update** | Migrator DB & Keychain = *M1* (still in memory) | Continue: hash `fixtureSecret` → Prisma `user.update` → fixture Keychain `update`. |
| **D – after fixture hash updated, before fixture Keychain `update`** | Fixture DB = *F1*, Migrator fully rotated | 1️⃣ Generate new `F2`. 2️⃣ Re‑hash `F2` → Prisma `user.update` again (overwrites `F1`). 3️⃣ Run fixture Keychain `update` with `F2`. |
| **E – after both Keychain updates, before verification** | Both credentials rotated, stored in Keychain | Re‑run verification steps (secrets still in memory). |
| **Process crash at any point** | No durable secret files (all in‑memory) | Operator restarts the whole coordinator → fresh independent secrets for **both** identities. **Never** attempt to “recover” the lost secret. |

*Key rule:* **Never persist a secret**. Each partial‑mutation state is repaired by re‑issuing the same logical operation with a freshly generated secret.

---

## 5. Remaining genuine blockers  

| # | Blocker | Why it stops execution | Resolution needed |
|---|---------|-----------------------|-------------------|
| **B‑1** | Runtime role `nook_phase3c_runtime` lacks `UPDATE(password_hash)` on `public.users`. | Fixture update must run as a privileged role (super‑user `nook` or migrator). Policy forbids granting the column‑level UPDATE to the runtime role. | Use the **administrative `nook` super‑user** (via the in‑memory admin Prisma client) – no grant required. |
| **B‑2** | No **coordinator script** (`scripts/rotate_phase2_credentials.js`) exists in the repo. | The whole sequence (PTY, Keychain, Prisma) needs a single Node entry point. | **Create** this single‑purpose script (≈ 150 LOC) – it is *not* a prototype; it is the production rotation driver. |
| **B‑3** | Super‑user password must be supplied to the coordinator securely. | Operator must type it once into the coordinator’s hidden stdin. | Documented in §2; no code change required. |
| **B‑4** | `node‑pty` `spawn-helper` must be executable on the execution host. | Verified locally (`chmod +x`); must be repeated on any CI/runner. | One‑time `chmod +x node_modules/node-pty/prebuilds/darwin-arm64/spawn-helper` on the target machine. |

*If the coordinator script (B‑2) is not added, the rotation cannot be performed.*

---

## 6. Checkpoint A – Approval Request (final, executable)

> **CREDENTIAL ROTATION APPROVAL REQUEST — PHASE 2 (CHECKPOINT A, FINAL)**
> 
> **Targets**  
> • PostgreSQL role `nook_phase3c_migrator` on `nook_test` @ `127.0.0.1:5433`  
> • Fixture owner `m3c-owner@nook.test.invalid` (User UUID `00000000‑0000‑4000‑8000‑000000000102`)  
> 
> **Keychain services / accounts**  
> • `nook_m3c_migrator` / `nook_phase3c_migrator`  
> • `nook_m3c_fixture_owner` / `m3c-owner@nook.test.invalid`  
> 
> **Procedure (exact, no prototypes)**  
> 1. Operator runs the **single coordinator script** `node scripts/rotate_phase2_credentials.js`.  
> 2. Coordinator reads the **super‑user (`nook`) password** from its own hidden stdin.  
> 3. Coordinator spawns a **real PTY** (`node‑pty`) running `psql -h 127.0.0.1 -p 5433 -U nook -d nook_test`.  
> 4. PTY receives the super‑user password, then `\password nook_phase3c_migrator`; coordinator writes the **migrator secret** twice (psql disables echo).  
> 5. Same migrator secret piped to `./scripts/keychain_helper update nook_m3c_migrator nook_phase3c_migrator`.  
> 6. Coordinator hashes the **fixture secret** with the existing `PasswordHasher`.  
> 7. Using the **in‑memory admin `DATABASE_URL`** (built from the super‑user password) it creates a temporary `PrismaClient` and runs `prisma.user.update({where:{id:FIXTURE_UID}, data:{passwordHash}})`.  
> 8. Fixture secret piped to `./scripts/keychain_helper update nook_m3c_fixture_owner m3c-owner@nook.test.invalid`.  
> 9. All buffers zeroed; no temporary files, no env‑vars, no command‑line secrets.  
> 10. Verification steps (interactive `psql` test, Keychain `check`, in‑process `PasswordHasher.verify`, immutable‑ID SQL) are executed.  
> 
> **Recovery** – as defined in §4 (re‑issue with fresh secrets).  
> 
> **Blockers resolved** – PTY works, Keychain `update` works, PasswordHasher & Prisma parameterised update verified, admin Prisma connection method defined, super‑user password supplied via coordinator stdin.  
> **Outstanding operational items** – (B‑3) operator types super‑user password once; (B‑4) `spawn-helper` executable on runner.  
> 
> **Request** – Explicit owner approval to execute the above mutations. **No Git changes, no permission changes, no `nook_dev` access** are part of this request.  

---

**Prepared by:** automated verification & inspection (no live mutations).  
**Status:** *Technically executable and secure – ready for Checkpoint A approval.*