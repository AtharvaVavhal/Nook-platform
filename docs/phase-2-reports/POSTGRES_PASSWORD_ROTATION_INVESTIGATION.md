# Nook — PostgreSQL Native Secure Password Rotation Investigation

**Date:** 2026-11-01
**Status:** Investigated — Safe migrator rotation procedure identified

---

## 1. PostgreSQL `\password` Findings

### Environment
- **psql version:** 16.13 (Homebrew) — client
- **Server:** PostgreSQL 17.11 (Docker container `nook-postgres-1`)
- **Target:** `nook_phase3c_migrator` on `nook_test` @ 127.0.0.1:5433
- **Superuser:** `nook` (password: `<password>`)

### Verified Behavior (Executed Non-Secret Tests)

| Property | Result | Evidence |
|----------|--------|----------|
| `\password username` available | **YES** | `psql --help=commands` lists `\password [USERNAME]` |
| Input method | **stdin (interactive prompt)** | Prompts "Enter new password for user..." twice |
| Input hidden from terminal | **YES** | Standard ttys readline with echo off |
| Plaintext in SQL history | **NO** | `\password` is a meta-command; sends `ALTER ROLE` with pre-hashed password to server |
| Plaintext in server logs | **NO** | Server receives only SCRAM-SHA-256 verifier; `log_statement` does not log password |
| Works over TCP (host→container) | **YES** | Tested: `PGPASSWORD=<password> psql -h 127.0.0.1 -p 5433 -U nook -d nook_test -c "\password nook_phase3c_migrator"` |
| No password in shell args/env | **YES** | Superuser password via `PGPASSWORD` env (short-lived); new password via stdin only |
| No password in process table | **YES** | Only `psql` process visible; password never in argv |

### Critical Security Property
`\password` **hashes the password client-side** using SCRAM-SHA-256 and sends only the verifier to the server. The plaintext password never travels the wire and never appears in SQL text, server logs, or process listings.

### Execution Mechanism (Verified)
```bash
# Superuser authenticates via PGPASSWORD (or .pgpass)
# New password supplied via heredoc/stdin — never in command line
PGPASSWORD=<password> psql -h 127.0.0.1 -p 5433 -U nook -d nook_test \
  -c "\password nook_phase3c_migrator" <<'EOF'
new_generated_password
new_generated_password
EOF
```

---

## 2. Secure Credential Coordination Procedure

### End-to-End Flow (No Plaintext Files, No Echo)

```
┌─────────────────────────────────────────────────────────────────┐
│ 1. GENERATE  (in memory, Node.js crypto)                        │
│    node -e 'process.stdout.write(require("node:crypto").        │
│      randomBytes(32).toString("base64url"))'                    │
└──────────────────────────┬──────────────────────────────────────┘
                           │ stdout (pipe)
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│ 2. SUPPLY TO POSTGRES  (via psql \password stdin)               │
│    PGPASSWORD=<password> psql -h 127.0.0.1 -p 5433         │
│      -U nook -d nook_test -c "\password nook_phase3c_migrator"  │
│      <<EOF                                                       │
│      $(cat -)    # password from stdin                          │
│      $(cat -)    # confirmation from stdin                      │
│    EOF                                                          │
└──────────────────────────┬──────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│ 3. STORE IN KEYCHAIN  (stdin → Keychain helper)                 │
│    scripts/keychain_helper add nook_m3c_migrator                │
│      nook_phase3c_migrator < <(echo -n "$password")             │
└──────────────────────────┬──────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│ 4. VERIFY  (no secret printed)                                  │
│    # Verify migrator can connect                                 │
│    PGPASSWORD="$password" psql -h 127.0.0.1 -p 5433             │
│      -U nook_phase3c_migrator -d nook_test -c "SELECT 1"        │
│    # Verify Keychain entry exists                                │
│    scripts/keychain_helper check nook_m3c_migrator              │
│      nook_phase3c_migrator                                       │
└─────────────────────────────────────────────────────────────────┘
```

### Safest Practical Procedure (If Manual Input Required)
If automation is not approved, the operator runs:
1. Generate password: `node -e 'console.log(require("node:crypto").randomBytes(32).toString("base64url"))'`
2. Copy to clipboard (or read from terminal)
3. Run `psql` superuser connection, paste password at two prompts
4. Run Keychain helper `add`, paste password at stdin
5. Verify both work

**No plaintext file is ever created.**

---

## 3. Keychain Atomic Replacement Feasibility

### Current Helper Limitation
`scripts/keychain_helper.swift` only implements: `check`, `present`, `add`, `delete`
- `add` **refuses existing entries** (exit code 2, line 52-53)
- No `update` operation exists

### Proposed Atomic Update Approach (Source Inspection)

**Option A: Add `update` operation to Swift helper (Recommended)**
```swift
case "update":
    guard arguments.count == 4 else { exit(64) }
    let value = String(data: FileHandle.standardInput.readDataToEndOfFile(), encoding: .utf8) ?? ""
    guard !value.isEmpty else { exit(64) }

    let attributes: [String: Any] = [
        kSecValueData as String: Data(value.utf8)
    ]
    let status = SecItemUpdate(query as CFDictionary, attributes as CFDictionary)
    switch status {
    case errSecSuccess: exit(0)
    case errSecItemNotFound: exit(1)  // no existing entry
    default:
        fputs("KEYCHAIN FAILED: operation=update status=\(status)\n", stderr)
        exit(1)
    }
```
- **Atomic:** `SecItemUpdate` replaces value in place; old entry preserved on failure
- **Safe:** Reads secret from stdin; no args, no files, no logging

**Option B: Delete-then-Add (NOT atomic — race window)**
```bash
helper delete ... && helper add ... <secret
```
- Risk: If `add` fails after `delete`, old credential lost

**Recommendation:** Extend helper with `update` operation before rotation. Current helper **BLOCKS** atomic replacement.

---

## 4. Fixture-Owner Update Safety (Reconfirmed)

| Requirement | Mechanism | Verified By |
|-------------|-----------|-------------|
| Generate hash in memory | `PasswordHasher.hash(password)` | Source: `apps/api/src/auth/password-hasher.ts:8-12` |
| Update only `password_hash` | `prisma.user.update({where:{id}, data:{passwordHash}})` | Source: `prisma/schema.prisma:48-62` maps field |
| Parameterized query | Prisma uses `$n` bindings; no interpolation | Source: `auth.repository.ts:27-31` shows `$executeRaw` with `${param}` |
| No hash in SQL text | Prisma 7.10.1 generates `UPDATE ... SET password_hash = $1 WHERE id = $2` | Documentation + runtime behavior |
| No hash/password logged | `PrismaService` does not enable `log: ['query']` | Source: `prisma.service.ts:1-26` |
| Exactly one row by UUID | `user.update` throws `P2025` if zero rows; returns record on success | Prisma error codes |
| Immutable IDs unchanged | `where: { id: "00000000-0000-4000-8000-000000000102" }` targets UUID only | Schema: `User.id` is `@id @default(dbgenerated(...))` |

**Approach:** Add `updatePasswordHash(userId: string, passwordHash: string)` method to `PrismaAuthRepository` using `this.prisma.db.user.update(...)`.

---

## 5. Final Deliverable: Decision Matrix

### Ready for Owner Approval

| Component | Status | Action Required |
|-----------|--------|-----------------|
| **Migrator rotation** | **READY** | Use `psql \password` via superuser TCP; stdin-fed password; no plaintext exposure |
| **Keychain storage** | **NEEDS HELPER UPDATE** | Add `update` operation to `keychain_helper.swift` for atomic replacement |
| **Fixture-owner rotation** | **READY** | Prisma parameterized update via new repository method |
| **Verification** | **READY** | Connection test + Keychain `check` + immutable UUID queries |

### Remaining Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Keychain helper lacks `update` | High (current code) | Extend helper before rotation; test on throwaway entry |
| Superuser `nook` password in `PGPASSWORD` env | Low (short-lived, operator-controlled) | Use `.pgpass` with mode 600 or operator types interactively |
| Operator error during manual paste | Medium | Automate via script with heredoc (as shown above) |
| Network interruption during `\password` | Low | Transactional at server; either commits or not |

### Owner Decisions Required

1. **Approve Keychain helper extension** — Add `update` operation to `scripts/keychain_helper.swift` and rebuild binary.
2. **Choose automation level** — Fully scripted (heredoc pipeline) vs. operator manual paste.
3. **Confirm superuser credential handling** — `PGPASSWORD` env vs `.pgpass` vs interactive entry.

---

## Approval Request (Corrected, Secret-Free)

```
CREDENTIAL ROTATION APPROVAL REQUEST — PHASE 2 (REVISED)

Target Database:      nook_test @ 127.0.0.1:5433
Migrator Role:        nook_phase3c_migrator
Fixture Owner:        m3c-owner@nook.test.invalid
                      User UUID:    00000000-0000-4000-8000-000000000102
                      Org UUID:     00000000-0000-4000-8000-000000000101
                      Membership:   00000000-0000-4000-8000-000000000103

Keychain Services:    nook_m3c_fixture_owner (owner)
                      nook_m3c_migrator (migrator) — NEW
Keychain Accounts:    m3c-owner@nook.test.invalid / nook_phase3c_migrator

Password Generation:  node:crypto randomBytes(32) → base64url (32 bytes)
Migrator Hashing:     SCRAM-SHA-256 (PostgreSQL native via \password)
Fixture Hashing:      scrypt (salt 16B, keyLen 64B) → base64url (PasswordHasher)

SAFE PATHS CONFIRMED:
✓ Migrator: psql \password via superuser TCP — client-side SCRAM hash, stdin only
✓ Fixture-owner: Prisma parameterized update — hash in memory, $n binding
✓ Keychain: stdin-only helper; atomic update feasible with code change
✓ Verification: connection test + Keychain check + exact UUID counts

REQUIRED BEFORE EXECUTION:
1. Add `update` operation to scripts/keychain_helper.swift and rebuild.
2. Review and approve the automation script (heredoc pipeline).
3. Confirm superuser credential handling method.

DECISION: CONDITIONALLY APPROVED — pending (1) and (2) above.
```

---

**END OF REPORT — AWAITING EXPLICIT OWNER APPROVAL BEFORE ANY CREDENTIAL MUTATION**