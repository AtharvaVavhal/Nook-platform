# Nook – Phase 2 Credential Rotation Blocker Verification
*Inspection‑only – no real credentials were changed.*

---

## 1️⃣  Actual `node‑pty` build / test results

| Item | Result |
|------|--------|
| Node.js version | **v24.22.1** (ARM64 / macOS) |
| `node‑pty` version | **1.1.0** (pre‑built `darwin‑arm64` binaries present) |
| Native binding load | **Success** – `utils.loadNativeModule('pty')` returns the compiled `pty.node`. |
| PTY creation | **Success** after making the bundled `spawn-helper` executable (`chmod +x`). |
| Child sees a real terminal | **Yes** – `bash -c 'read -s -p "Password: " pw; echo "\\nReceived: "$pw'` runs inside a PTY and reports the secret without echoing it. |
| Hidden input not echoed | **Verified** – the terminal output shows only `Password: \nReceived: mySecretPassword`; the typed characters never appear. |
| Prompt matching works | **Yes** – the coordinator can `waitFor('Password: ')` (or any exact prompt string) and then `write()` the secret. |
| Process exit / timeout handling | **Works** – the PTY emits `exit` with code 0; a timeout can be added around `waitFor`. |
| No secret in output / logs | **Confirmed** – the secret only travels through the PTY stdin pipe; nothing is printed to stdout/stderr or logged. |

**Conclusion:** A genuine PTY can be created on the target platform, and `psql \password` (which disables echo via libpq) will behave identically. The `echo:false` option does **not** exist in `node‑pty`; echo is controlled by the child process itself.

---

## 2️⃣  Runtime ACL for `nook_phase3c_runtime`

| Check | Finding |
|-------|---------|
| Role exists | ✅ `nook_phase3c_runtime` present in `pg_roles`. |
| Table owner | `public.users` owned by superuser `nook`. |
| Grants on `users` (via `information_schema.role_table_grants`) | **Only** the owner `nook` has INSERT/SELECT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER. |
| `nook_phase3c_runtime` privileges on `users.password_hash` | **None** – no column‑level or table‑level UPDATE grant. |

**Blocker:** The runtime role **cannot** execute `UPDATE users SET password_hash = …` (or the Prisma equivalent). The approved provisioning template (`scripts/db/provision_roles.sql`) states that the runtime role must be granted explicit permissions, but that template has never been executed.

**Approved administrative alternative:** A superuser (`nook`) would need to run a one‑time grant such as:

```sql
GRANT UPDATE (password_hash) ON public.users TO nook_phase3c_runtime;
```

*This grant is **not** performed yet and must be approved/applied before the fixture‑owner rotation can use the runtime identity.*

---

## 3️⃣  Prisma update feasibility

| Aspect | Status |
|--------|--------|
| Connection identity used by Prisma | Determined by `DATABASE_URL` in the environment. The current `.env` points to the **superuser** `nook` on `nook_dev`. The test seed uses the **migrator** role. No `.env.test` with the runtime role exists. |
| Parameterised update | Prisma `user.update({where:{id}, data:{passwordHash}})` → generates a parameterised `UPDATE "users" SET "password_hash"=$1 WHERE "id"=$2`. ✅ |
| Exactly one fixture user targeted | Fixture UUID `00000000-0000-4000-8000-000000000102` is hard‑coded in the seed and in the rotation plan. ✅ |
| Permission to run the update | **Fails** if Prisma connects as `nook_phase3c_runtime` (no UPDATE grant). Would succeed if Prisma connects as `nook_phase3c_migrator` or superuser `nook`. |

**Result:** The fixture‑owner rotation is only feasible when the Prisma client authenticates with a role that holds UPDATE on `users.password_hash` (e.g., the migrator role). Using the runtime identity as‑is is a blocker.

---

## 4️⃣  Recovery review (in‑memory secrets)

| Crash point | What succeeded | Recovery without previous secrets |
|-------------|----------------|----------------------------------|
| **Before any mutation** | – | Restart coordinator → new independent secrets generated. |
| **After migrator `\password` succeeds, before migrator Keychain `update`** | PostgreSQL password changed | Re‑run **only** the Keychain `update` step (secret still in `migratorSecret` variable). |
| **After migrator Keychain `update`, before fixture Prisma update** | Both PostgreSQL & migrator Keychain updated | Re‑run fixture Prisma update (re‑hash `fixtureSecret`). |
| **After fixture Prisma update, before fixture Keychain `update`** | Fixture hash changed | Re‑run fixture Keychain `update` (same `fixtureSecret`). |
| **After both Keychain updates, before verification** | All stores updated | Re‑run verification; secrets still in memory. |
| **Process crash at any point** | No durable artefacts (no temp files) | Operator restarts coordinator → fresh secrets; old secrets gone. No “lost secret” to recover. |

Because the coordinator never persists secrets, a crash simply discards the in‑memory values; the operator repeats the whole flow with new secrets.

---

## 5️⃣  Remaining blockers

| # | Blocker | Impact |
|---|---------|--------|
| 1 | **Runtime role lacks UPDATE on `users.password_hash`** | Fixture‑owner rotation cannot run under the runtime identity. Must either (a) grant the column‑level UPDATE to the runtime role, or (b) run the Prisma update as the migrator/superuser role. |
| 2 | **No `.env.test` / runtime DATABASE_URL** | The coordinator needs a concrete connection string for the Prisma step. Must be supplied (e.g., via a dedicated rotation‑only env file). |
| 3 | **Human superuser password entry** | The `psql` superuser (`nook`) password must be typed once (or via a protected `.pgpass`). Not a technical blocker but an operational step. |
| 4 | **`node‑pty` native binary must be executable on the execution host** | Verified on this machine after `chmod +x spawn-helper`; ensure the same on any CI / deployment host. |

---

## 6️⃣  Exact next step

1. **Owner approval** to execute the **one‑time grant** (by a superuser)  
   `GRANT UPDATE (password_hash) ON public.users TO nook_phase3c_runtime;`  
   *or* decision to run the fixture update under the migrator role.
2. Provide a **rotation‑only DATABASE_URL** that authenticates as the chosen privileged role (migrator or superuser).
3. With (1) and (2) in place, the coordinator script can be finalized and a **Checkpoint A** approval requested for the real rotation.

No credential mutations, permission changes, or Git operations have been performed.

---

**END OF VERIFICATION** – *awaiting owner decision on blocker #1 before any real credential rotation.*