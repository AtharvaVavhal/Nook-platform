# Nook – Phase 2 Credential Rotation – Final Preparation & Closure Report
*(pre‑execution only – no mutations performed)*

---

### 1. Re‑usable implementation components

| Component | File / location | Status |
|-----------|----------------|--------|
| **Keychain helper (CLI)** | `scripts/keychain_helper.swift` → compiled binary `scripts/keychain_helper` | ✔️  `check / present / add / update / delete` all present. `update` reads secret **only from stdin**, uses `SecItemUpdate` (atomic), distinct exit codes (0 = ok, 2 = not‑found, 64 = bad args/empty, 1 = other). |
| **Password hashing** | `apps/api/src/auth/password-hasher.ts` (`PasswordHasher.hash / verify`) | ✔️  Pure in‑memory scrypt (16 B salt, 64 B key) → `scrypt$<salt‑b64url>$<hash‑b64url>`. |
| **Prisma service** | `apps/api/src/database/prisma.service.ts` | ✔️  Instantiates `PrismaClient` with `PrismaPg` adapter from `DATABASE_URL`. No query logging enabled. |
| **Fixture UUIDs (immutable)** | Seed script `scripts/seed_milestone_3c_fixtures.sh` | ✔️  User `00000000‑0000‑4000‑8000‑000000000102`, Org `…0101`, Membership `…0103`. |
| **Existing test suites** | *Auth integration* (9/9), *Inventory integration* (16/16), *Cross‑org isolation* (2/2), *Unit* (19/19) | ✔️  All previously reported green. |
| **Disk‑space guard** | `scripts/verify_initial_migration.py` (checks ≥ 5 GiB) | ✔️  Re‑usable as pre‑flight. |
| **Node‑pty PTY** | `node-pty@1.1.0` (pre‑built `darwin‑arm64` binary) | ✔️  Verified on this host: PTY creation works, child sees a terminal, `read -s` hides input, prompt matching works. `spawn‑helper` must be executable (`chmod +x`). |

---

### 2. Remaining genuine blockers

| # | Blocker | Why it stops the rotation |
|---|---------|---------------------------|
| **B‑1** | **Runtime role `nook_phase3c_runtime` lacks `UPDATE(password_hash)` on `public.users`.** | The fixture‑owner hash update must run as a role that *does* have that privilege (superuser `nook` or migrator). The policy decision is **not to grant** the column‑level UPDATE to the runtime role. |
| **B‑2** | **No rotation‑only `DATABASE_URL` that authenticates as the privileged role.** | The coordinator needs a concrete connection string for the Prisma step (superuser `nook` on `nook_test`). This must be supplied at execution time (e.g. a temporary `.env.rotation` file that is deleted afterwards). |
| **B‑3** | **Superuser (`nook`) password must be entered interactively (or via a protected `.pgpass` 600).** | Not a technical blocker, but an operational step that must be documented. |
| **B‑4** | **`node‑pty` `spawn-helper` must be executable on the execution host.** | Verified locally (`chmod +x`), must be repeated on any CI/runner. |

---

### 3. Administrative connection procedure (no secrets exposed)

1. **Open a dedicated terminal** (no recording, no `script`).
2. **Connect as superuser** to the *target* database only:

   ```bash
   psql -h 127.0.0.1 -p 5433 -U nook -d nook_test
   # password for `nook` typed once (or read from a mode‑600 .pgpass)
   ```

3. **Run the migrator password change** inside that session:

   ```sql
   \password nook_phase3c_migrator
   -- paste the generated migrator secret twice (psql disables echo)
   ```

4. **Leave the psql session open** (or re‑connect) for the fixture‑owner hash update:

   ```sql
   UPDATE public.users
     SET password_hash = $1
   WHERE id = '00000000-0000-4000-8000-000000000102';
   -- $1 is the scrypt hash produced in‑memory by PasswordHasher
   ```

   *The UPDATE is executed via the coordinator's Prisma call, which uses a parameterised statement; the hash never appears in SQL text.*

5. **Exit psql** (`\q`).

All secrets stay in the coordinator process memory; only the superuser password is typed by the operator.

---

### 4. Corrected crash‑recovery procedure

| Crash point | State after crash | Recovery actions (using **new** independent secrets) |
|-------------|-------------------|------------------------------------------------------|
| **A** – before any mutation | Nothing changed | Restart coordinator → fresh secrets. |
| **B** – after `psql \password` succeeded, before migrator Keychain `update` | PostgreSQL password = *secret‑M1* (lost if process dies) | 1. Generate new secret *M2*.<br>2. Re‑run `\password nook_phase3c_migrator` with *M2*.<br>3. Run Keychain `update` for migrator with *M2*. |
| **C** – after migrator Keychain updated, before fixture hash update | Migrator DB & Keychain = *M1* (still in memory) | Continue: hash fixture secret *F1*, run Prisma `user.update`, then Keychain `update` for fixture. |
| **D** – after fixture hash updated, before fixture Keychain `update` | Fixture DB = *F1*, Migrator fully rotated | 1. Generate new fixture secret *F2*.<br>2. Re‑hash *F2* → run Prisma `user.update` again (overwrites *F1*).<br>3. Run fixture Keychain `update` with *F2*. |
| **E** – after both Keychain updates, before verification | Both credentials rotated, stored | Re‑run verification steps (still have *M1*/*F1* in memory). |
| **Process crash at any point** | No durable secret files exist (all in‑memory) | Operator restarts the whole coordinator → new independent secrets for both identities. No attempt to "recover" the lost secret. |

*Key principle:* **Never persist a secret to make recovery easier.** Each partial‑mutation state is repaired by re‑issuing the same logical operation with a freshly generated secret.

---

### 5. Exact verification commands (run *after* the coordinator finishes)

```bash
# 0️⃣  Pre‑flight
df -Pk /Users/atharva/Downloads/nook | awk 'NR==2{exit ($4*1024 < 5368709120)}' && echo "DISK OK"

# 1️⃣  Docker health
docker ps --filter name=nook-postgres --format '{{.Status}}' | grep -q 'healthy' && echo "PG healthy"

# 2️⃣  Target verification (run as superuser, no secret printed)
psql -h 127.0.0.1 -p 5433 -U nook -d nook_test -Atc \
  "SELECT current_database(), current_user, inet_server_port();"
# expect: nook_test | nook | 5432

# 3️⃣  Migrator credential check (interactive – operator types new password)
psql -h 127.0.0.1 -p 5433 -U nook_phase3c_migrator -d nook_test -c "SELECT 1;"

# 4️⃣  Migrator Keychain entry
./scripts/keychain_helper check nook_m3c_migrator nook_phase3c_migrator && echo "Migrator KC OK"

# 5️⃣  Fixture owner Keychain entry
./scripts/keychain_helper check nook_m3c_fixture_owner m3c-owner@nook.test.invalid && echo "Fixture KC OK"

# 6️⃣  Fixture authentication (Node one‑liner, no secret printed)
node -e "
  const {PasswordHasher}=require('./apps/api/dist/auth/password-hasher.js');
  const {PrismaClient}=require('@prisma/client');
  const p=new PrismaClient();
  (async()=>{ const u=await p.user.findUnique({where:{id:'00000000-0000-4000-8000-000000000102'},select:{password_hash:true}});
    const ok=await new PasswordHasher().verify(process.argv[1], u.password_hash);
    console.log('Fixture auth:', ok?'PASS':'FAIL'); process.exit(ok?0:1);
  })();
" "$(cat fixture_pw)"   # fixture_pw only exists in the coordinator run; replace with the in‑memory value during real run

# 7️⃣  Immutable IDs & role/status unchanged
psql -h 127.0.0.1 -p 5433 -U nook -d nook_test -Atc "
  SELECT u.id, u.login_identifier,
         m.id AS membership_id, m.organization_id, m.role, m.status
  FROM users u JOIN memberships m ON u.id=m.user_id
  WHERE u.id='00000000-0000-4000-8000-000000000102';
"
# compare to documented UUIDs, role=OWNER, status=ACTIVE

# 8️⃣  Full test suite (only if disk ≥5 GiB and DB is nook_test)
npm run test   # runs auth, inventory, cross‑org, unit – all previously green
npm run typecheck
```

*All commands avoid printing any secret or hash.*

---

### 6. What remains **unexecuted**

| Item | Reason |
|------|--------|
| Real `psql \password` execution | Requires explicit **Checkpoint A** approval. |
| Real Prisma `user.update` for fixture hash | Same – needs privileged `DATABASE_URL` and approval. |
| Real Keychain `update` calls | Same. |
| Full regression test suite run against `nook_test` | Not run yet (disk‑space check & approval pending). |
| One‑time grant decision (blocker B‑1) | Owner must decide: run fixture update as superuser/migrator *or* grant column‑level UPDATE to runtime role (policy says **do not grant**). |

---

### 7. Checkpoint A – Approval Required

> **CREDENTIAL ROTATION APPROVAL REQUEST — PHASE 2 (FINAL)**
>
> **Targets**
> • PostgreSQL role `nook_phase3c_migrator` on `nook_test` @ `127.0.0.1:5433`
> • Fixture owner `m3c-owner@nook.test.invalid` (User UUID `00000000‑0000‑4000‑8000‑000000000102`)
>
> **Keychain services / accounts**
> • `nook_m3c_migrator` / `nook_phase3c_migrator`
> • `nook_m3c_fixture_owner` / `m3c-owner@nook.test.invalid`
>
> **Procedure** (summary)
> 1. Operator opens a clean terminal, connects as superuser `nook` to `nook_test` (port 5433).
> 2. Coordinator (Node script) generates two independent 32‑byte base64url secrets **in memory only**.
> 3. Using a real PTY (`node‑pty`), the coordinator sends `\password nook_phase3c_migrator` and writes the migrator secret twice (psql disables echo).
> 4. Same migrator secret piped to `./scripts/keychain_helper update …`.
> 5. Coordinator hashes the fixture secret with the existing `PasswordHasher`, runs a parameterised Prisma `user.update` (authenticated as the superuser connection from step 1).
> 6. Fixture secret piped to `./scripts/keychain_helper update …`.
> 7. All buffers zeroed; no temporary files, no env‑vars, no command‑line secrets.
> 8. Verification steps listed in §5 are executed.
>
> **Recovery** – described in §4 (re‑issue with fresh secrets).
>
> **Blockers already resolved** – PTY works, Keychain `update` works, PasswordHasher & Prisma parameterised update verified.
> **Outstanding decisions** – (B‑1) fixture update will run as superuser (no grant to runtime role); (B‑2) a one‑time rotation‑only `DATABASE_URL` will be supplied at run time.
>
> **Request** – Explicit owner approval to execute the above mutations. **No Git changes, no permission changes, no `nook_dev` access** are part of this request.

---

**Prepared by:** automated verification & inspection (no live mutations).
**Status:** *Ready for Checkpoint A approval.*