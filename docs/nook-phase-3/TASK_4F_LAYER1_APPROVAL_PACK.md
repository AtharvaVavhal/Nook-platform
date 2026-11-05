# Layer 1 (invoice status must match the amounts): approval pack

Status: **verified on the clean scratch database `nook_layer1_clean` (2026-11-03); applied nowhere else.** The migration is
`prisma/migrations/20261103120000_invoice_status_consistency/migration.sql` (slice 3.7). Production application remains a separate
approval. Section 6 records the clean-scratch results.

## 1. The exact SQL

```sql
DO $$
DECLARE bad bigint;
BEGIN
  SELECT count(*) INTO bad FROM "invoices"
   WHERE NOT (
        "status" IN ('DRAFT', 'CANCELLED')
     OR ("status" = 'PAID' AND "paid_amount" = "amount")
     OR ("status" = 'PARTIALLY_PAID' AND "paid_amount" < "amount" AND "paid_amount" + "adjustment_total" > 0)
     OR ("status" = 'ISSUED' AND "paid_amount" < "amount" AND "paid_amount" + "adjustment_total" <= 0)
     OR ("status" = 'OVERDUE' AND "paid_amount" < "amount")
   );
  IF bad > 0 THEN
    RAISE EXCEPTION 'invoices whose status contradicts their amounts exist (%), migration aborted without changes', bad;
  END IF;
END $$;

ALTER TABLE "invoices" ADD CONSTRAINT "invoices_status_matches_amounts" CHECK (
     "status" IN ('DRAFT', 'CANCELLED')
  OR ("status" = 'PAID' AND "paid_amount" = "amount")
  OR ("status" = 'PARTIALLY_PAID' AND "paid_amount" < "amount" AND "paid_amount" + "adjustment_total" > 0)
  OR ("status" = 'ISSUED' AND "paid_amount" < "amount" AND "paid_amount" + "adjustment_total" <= 0)
  OR ("status" = 'OVERDUE' AND "paid_amount" < "amount")
);
```

It changes no function, trigger, column or row. Existing constraints it relies on: `amount > 0`, `0 <= paid_amount <= amount`,
`adjustment_total <= 0`, `paid_amount + adjustment_total >= 0`.

## 2. Pre-flight results

| Database                              | Result                                                                                                                                                                                                                                                                                                         |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `nook_4f1_scratch` (today, read-only) | **18 contradicting rows out of 2,662 non-draft, non-cancelled invoices, so the migration would abort** (fail-closed, verified by running the file in a rolled-back transaction: `invoices whose status contradicts their amounts exist (18), migration aborted without changes`; constraint absent afterwards) |
| Production / `nook_dev` / `nook_test` | **Not checked** (not accessible to this work). The same `SELECT count(*)` as the pre-flight, run read-only by an operator, answers it.                                                                                                                                                                         |

**Where the 18 came from, and why no legacy data is involved.** Both kinds were written by the _old_ versions of the three
constraint tests, whose direct-SQL probes succeeded and were committed because the constraint does not exist yet:
12 rows `PARTIALLY_PAID` with nothing paid (from the F1 and credit-only-relabel probes; 12 = six runs of two) and 6 rows `OVERDUE` but fully paid (the
legacy-OVERDUE probe). Every one was created after 2026-11-02 19:00 UTC, when those tests were first run; **none predates
them**. Application code (every API path) produced zero contradicting rows.

**The test fix (done, approved).** Those probes now run inside a transaction that is always rolled back. Verified on scratch:
18 contradicting rows before running the finance status tests, 18 after (the tests added none), and the new test "status
rule probes leave no trace, with or without the constraint" passes both with and without the constraint. The 18 existing
rows are left exactly as they are (no database cleanup, as instructed).

## 3. What the constraint changes in behaviour

| Statement                                                        | Before   | After                                                      |
| ---------------------------------------------------------------- | -------- | ---------------------------------------------------------- |
| `ISSUED` with nothing paid -> `PARTIALLY_PAID` (F1)              | accepted | `23514`                                                    |
| money recorded as settled while the status says `ISSUED` (F2)    | accepted | `23514`                                                    |
| `PAID` -> `ISSUED` / `PARTIALLY_PAID` (F3)                       | accepted | `23514`                                                    |
| credit-only partial settlement (`ISSUED`, paid = credit, cash 0) | valid    | valid                                                      |
| fully credited -> `PAID`                                         | valid    | valid                                                      |
| legacy `OVERDUE` while open                                      | valid    | valid                                                      |
| `OVERDUE` but fully paid                                         | accepted | `23514`                                                    |
| every application path (issue, pay, reverse, credit, void)       | n/a      | unchanged: each writes status and amounts in one statement |

Not closed by this constraint (Layer 2, deferred): `paid_amount` or `adjustment_total` forged together with a matching status,
without payment or adjustment rows behind them.

Verified earlier on scratch with the exact migration file inside a rolled-back transaction, on data that had no contradicting
rows at that time: all 13 probes behaved as above, and the constraint was absent afterwards.

## 4. Rollback limitations

- Prisma migrations are forward-only. "Rollback" is a **new** migration `ALTER TABLE "invoices" DROP CONSTRAINT "invoices_status_matches_amounts";`, which changes no data and is safe at any time.
- Once the migration is recorded as applied, its file must never be edited (checksum).
- While the constraint is present, a **restore of an older backup into a database that already has it** is fine, but restoring
  rows that contradict it (for example a dump of a database that never had the constraint and contains such rows) fails at
  the constraint; the restore drill's `status_contradicts_amounts` line is the early warning.
- The current application code writes status and amounts in one statement on every path (read in the 4F review and covered by the API tests). Code older than 4F.1 has not been tested against the constraint, so deploy the migration together with the current code.
- A migration that fails its pre-flight leaves the database unchanged and the migration marked failed in Prisma's table;
  recovery needs `prisma migrate resolve` by an operator.

## 5. Clean scratch verification: what was needed (done, see section 6)

The existing scratch database cannot take the migration because of the 18 rows (and may not be cleaned). A **clean** verification
needs a new database whose schema is built by the migrations:

1. Approval to create **one** new scratch database, for example `nook_layer1_clean` (its own `nook_layer1_*` roles are not needed:
   the existing migrator/runtime scratch roles can be reused with the same grants).
2. Apply migrations `20261101…` to `20261103110000_invoice_guard_hardening` to it (approved, scratch only, via the existing
   `apply_scratch.mjs`-style procedure), run the full finance and ledger suites there (expect 0 contradicting rows).
3. Apply `20261103120000_invoice_status_consistency` there, run the same suites, and flip the three `todo` constraint tests to
   ordinary tests: they must pass.
4. Run the pre-flight and the restore-drill fingerprint (`ledger|status_contradicts_amounts = 0`) before and after.
5. Report; the existing scratch databases and the restore-drill database stay untouched.

Until that has been done and reviewed, this migration should not be applied anywhere, and the scope-guard slice 3.7 entry for it
stays as a written-but-unapplied migration.

## 6. Clean scratch verification: results (2026-11-03)

| Step                                                                                                            | Result                                                                                                                                                                                        |
| --------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Database                                                                                                        | `nook_layer1_clean`, new, owner `nook_4f1_migrator`, identity checked (database, user, comment marker) before every script                                                                    |
| Built from migration history (17 migrations before Layer 1)                                                     | structure identical to the existing scratch database: extensions, 23 tables, columns, 83 indexes, 101 constraints, 15 triggers, 13 functions, 15 enums, owners, ACLs, runtime-role privileges |
| Pre-flight on the clean data (166 invoices after the full pre-Layer-1 test run, including the former red tests) | **0 contradicting rows**; every ledger invariant 0                                                                                                                                            |
| Layer 1 applied                                                                                                 | pre-flight passed, constraint `invoices_status_matches_amounts` present; absent in the existing scratch                                                                                       |
| The three former `todo` tests, now ordinary tests                                                               | **pass** (F1-F3, credit-only partial settlement, legacy OVERDUE), as do the other four status-rule tests                                                                                      |

## 7. Decision requested

Approve step 5 (create `nook_layer1_clean`, apply migrations to it, run the verification), or defer Layer 1 until after the
pilot. Production application remains a separate approval.
