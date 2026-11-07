# Task 4F.2 — Finance migration design proposal

> **Implementation note (Task 4F.2, 2026-11-02):** D1–D8 were approved at their recommendations and implemented as migrations
> `20261103090000_payment_receipt_snapshot`, `20261103100000_invoice_void_record` and `20261103110000_invoice_guard_hardening`, applied
> **only** to the isolated scratch database `nook_4f1_scratch`. The SQL in the migration files is the authoritative version; it matches
> this document except for a leading `-- phase-scope: slice-3.7` tag and explanatory comments. The text below is the original proposal.

Status (original proposal): **design only. No migration file exists, no SQL has been executed anywhere (not even in a rolled-back
transaction), `schema.prisma` is unchanged and nothing is staged or committed.** Date 2026-11-02, baseline HEAD `c85dcce`.
The SQL below is therefore **unexecuted**. It was written against the real schema and the existing migrations, and each
migration states the dry-run that must pass before it is applied anywhere.

Evidence used: the schema and migrations at `c85dcce`, and one **read-only** pre-flight query set against the disposable
scratch database `nook_4f1_scratch` (a `READ ONLY` transaction, rolled back). Nothing was read from `nook_dev` or `nook_test`
(not permitted), so **compatibility with `nook_dev`'s existing rows is not yet proven**; section E.3 gives the exact query to run
there once read access is approved.

## 0. Summary and decisions needed

Three additive pieces, each its own migration so each can be approved, applied and (if needed) stopped independently:

| #                                 | Migration                                | Adds                                                                | Touches existing rows?                      |
| --------------------------------- | ---------------------------------------- | ------------------------------------------------------------------- | ------------------------------------------- |
| 1                                 | `…_payment_receipt_snapshot`             | 2 nullable columns on `payments`, 3 CHECKs, 1 insert trigger        | No. Old payments keep `NULL`                |
| 2                                 | `…_invoice_void_record`                  | table `invoice_voids`, constraints, 2 triggers                      | No                                          |
| 3                                 | `…_invoice_guard_hardening`              | fail-closed pre-flight, replaced `finance_guard_invoice()`, 1 CHECK | No (pre-flight aborts instead of repairing) |
| 4 (optional, not recommended now) | `…_invoice_period_unique_excluding_void` | partial unique index                                                | Replaces an index; see D3                   |

Order is 1 → 2 → 3 (3 references the table from 2). **Decisions I need from you** (each has a recommendation):

| ID  | Decision                                                                                | Recommendation                                                                                                                                    |
| --- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | Freeze `notes` on an issued invoice?                                                    | **Yes.** No endpoint edits notes after issue, and a frozen record is simpler to defend                                                            |
| D2  | May an invoice that carries a credit be voided?                                         | **No.** Credits are append-only and cannot be reversed; voiding would orphan them. Correct it with another credit instead                         |
| D3  | After a void, may the same resident and month be invoiced again?                        | **No, for now** (void is terminal). Allowing it needs migration 4 and a Prisma-drift trade-off (E.6)                                              |
| D4  | DB-level refusal of payments on `DRAFT`/`CANCELLED` invoices?                           | **Yes**, inside the snapshot trigger (defence in depth; the API already refuses)                                                                  |
| D5  | Snapshot written by the database trigger or supplied by the application?                | **Trigger.** The database computes it under the invoice lock, so no client or code path can write a false one                                     |
| D6  | New `VOIDED` enum value or reuse `CANCELLED`?                                           | **Reuse `CANCELLED`.** `ALTER TYPE … ADD VALUE` cannot be used in the transaction that adds it, and all code already treats `CANCELLED` as closed |
| D7  | Approve the new route `POST /api/v1/finance/invoices/:id/void` in the scope guard (S8)? | Yes, at implementation time, with the slice entry in E.1                                                                                          |
| D8  | May a `DRAFT` be voided?                                                                | **Yes.** Drafts cannot be deleted, so this is the only way to abandon one; it uses the same record                                                |

## A. Receipt snapshots

### A.1 Problem

Today `receipt()` derives `balanceAfterPayment` from the invoice's current `adjustment_total` and from which payments are
currently reversed. A credit recorded after a payment therefore rewrites an already-printed receipt, and a later reversal changes
the running balance of later receipts. A receipt must keep showing the numbers it showed when it was issued.

### A.2 Columns (on `payments`, both nullable)

| Column                    | Type            | Meaning                                                                                                                                                                            |
| ------------------------- | --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `credit_total_at_payment` | `DECIMAL(12,2)` | The invoice's `adjustment_total` (a value ≤ 0) at the instant this payment was recorded                                                                                            |
| `balance_after_payment`   | `DECIMAL(12,2)` | `invoice.amount − invoice.paid_amount − payment.amount`, i.e. the balance remaining immediately after this payment, where `paid_amount` already includes credits applied before it |

Semantics: **point-in-time and never updated.** Later credits, reversals or other payments do not change them. A reversal still
marks the receipt reversed (via `payment_reversals`) but does not change its stored amounts. Corrections appear as separate
documents (the reversal and the replacement payment, which gets its own snapshot).

### A.3 How it is written (transactional strategy)

`recordPayment` already takes the invoice row `FOR UPDATE` and inserts the payment **before** updating the invoice. A
`BEFORE INSERT` trigger on `payments` re-reads that same row (`FOR UPDATE` again, which is free inside the same transaction) and
computes both values itself, overwriting anything the client supplied (D5). The values are therefore exact for the actual lock
order, including under concurrent payments, credits and reversals, and they commit atomically with the payment.

**Coupling to be tested:** the snapshot is correct only while the application inserts the payment before it updates
`invoices.paid_amount`. That is the current order and a test pins it (E.5).

### A.4 Existing payments without inventing history

The `payments_immutable` trigger forbids every `UPDATE`, so old rows cannot be back-filled, and I do not propose relaxing it.
Existing payments keep `NULL` in both columns. The API returns `balanceAfterPaymentSource: "recorded" | "derived"`; for `NULL`
rows it keeps today's derived value and labels it **derived**, so no historical figure is fabricated. Scratch evidence: 709 payments
exist, 180 of them reversed and 96 on credited invoices, which are exactly the rows whose derived figure can differ from reality.

### A.5 SQL (migration 1, unexecuted)

```sql
-- Migration 1: payment receipt snapshot. Additive: two nullable columns, three CHECKs, one insert trigger.
-- Existing rows keep NULL (payments are immutable, so they cannot and must not be back-filled).
ALTER TABLE "payments"
  ADD COLUMN "credit_total_at_payment" DECIMAL(12,2),
  ADD COLUMN "balance_after_payment"   DECIMAL(12,2);

ALTER TABLE "payments" ADD CONSTRAINT "payments_snapshot_complete"
  CHECK (num_nonnulls("credit_total_at_payment", "balance_after_payment") IN (0, 2));
ALTER TABLE "payments" ADD CONSTRAINT "payments_snapshot_credit_valid"
  CHECK ("credit_total_at_payment" IS NULL OR "credit_total_at_payment" <= 0);
ALTER TABLE "payments" ADD CONSTRAINT "payments_snapshot_balance_valid"
  CHECK ("balance_after_payment" IS NULL OR "balance_after_payment" >= 0);

CREATE FUNCTION "finance_snapshot_payment"() RETURNS trigger AS $$
DECLARE inv RECORD;
BEGIN
  SELECT "status", "amount", "paid_amount", "adjustment_total" INTO inv
    FROM "invoices"
   WHERE "id" = NEW."invoice_id" AND "organization_id" = NEW."organization_id"
     FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'payment references an unknown invoice' USING ERRCODE = '23503';
  END IF;
  IF inv."status" IN ('DRAFT', 'CANCELLED') THEN
    RAISE EXCEPTION 'payments cannot be recorded against a % invoice', lower(inv."status"::text)
      USING ERRCODE = '23514';
  END IF;
  NEW."credit_total_at_payment" := inv."adjustment_total";
  NEW."balance_after_payment"   := inv."amount" - inv."paid_amount" - NEW."amount";
  IF NEW."balance_after_payment" < 0 THEN
    RAISE EXCEPTION 'payment exceeds the invoice balance' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "payments_snapshot" BEFORE INSERT ON "payments"
  FOR EACH ROW EXECUTE FUNCTION "finance_snapshot_payment"();
```

`schema.prisma` change: add the two optional `Decimal? @db.Decimal(12, 2)` fields to `Payment`; regenerate the client (22 generated
files change). Trigger order with the existing `payments_check_correction` does not matter (they touch different fields).

## B. Issued-invoice trigger hardening

### B.1 Gaps today

`finance_guard_invoice()` protects amount, number, organization, resident, booking and period of a non-`DRAFT` invoice. It does
**not** protect `due_date`, `issued_at`, `notes`, `created_at` or the status graph. Today SQL can move `PAID` back to `DRAFT`,
rewrite `issued_at`, or change `due_date` after issue.

### B.2 Permitted status transitions (the only ones the database will accept)

```
DRAFT ──────────► ISSUED ◄──────────────────────────────┐
  │                 │  ▲                                  │ (a reversal can lower the settled amount)
  │                 ▼  │                                  │
  │          PARTIALLY_PAID ◄──────► PAID ────────────────┘
  │                 │                   │
  ▼                 ▼                   ▼
CANCELLED (void)  CANCELLED (void)     (PAID cannot be voided: settled money is non-zero)
CANCELLED is terminal. DRAFT can never be re-entered. OVERDUE is derived, never stored, never a target.
```

Rules enforced on `UPDATE`:

1. **`CANCELLED` is frozen.** Any further change is refused.
2. **Transitions** are limited to: `DRAFT → ISSUED | CANCELLED`; `ISSUED | PARTIALLY_PAID | PAID | OVERDUE(legacy) → ISSUED | PARTIALLY_PAID | PAID | CANCELLED`. Everything else, including any move back to `DRAFT` and any move into `OVERDUE`, is refused.
3. **`→ CANCELLED` is gated** (see B.3): a void record must exist and nothing may be settled.
4. **`DRAFT → ISSUED` must set `issued_at`.**
5. After issue (`OLD.status <> 'DRAFT'`) these are immutable: the existing set (amount, number, organization, resident, booking, period) **plus `due_date`, `issued_at`, `notes` (D1) and `created_at`.**
6. A `DRAFT` stays as editable as today; the issue step sets `due_date` and `issued_at` in the same `UPDATE`, which rule 5 allows because it checks `OLD.status`.

### B.3 Interaction with voiding

The only way into `CANCELLED` is: insert the `invoice_voids` row (migration 2), then update the status in the same transaction.
The guard checks that the void row exists **and** that `paid_amount = 0` and `adjustment_total = 0`. A plain
`UPDATE invoices SET status='CANCELLED'` is refused. Existing `CANCELLED` rows (12 in scratch, all tests) have no void record; they
stay `CANCELLED` and become frozen, and reports show them as "cancelled (no void record)".

### B.4 SQL (migration 3, unexecuted)

```sql
-- Migration 3: invoice guard hardening. Fails closed on inconsistent rows; repairs nothing.
DO $$
DECLARE bad text;
BEGIN
  SELECT concat_ws(', ',
    CASE WHEN a > 0 THEN 'issued/paid invoices without issued_at=' || a END,
    CASE WHEN b > 0 THEN 'DRAFT invoices with issued_at=' || b END,
    CASE WHEN c > 0 THEN 'CANCELLED invoices holding cash or credits=' || c END)
  INTO bad
  FROM (SELECT
    (SELECT count(*) FROM "invoices" WHERE "status" NOT IN ('DRAFT', 'CANCELLED') AND "issued_at" IS NULL) a,
    (SELECT count(*) FROM "invoices" WHERE "status" = 'DRAFT' AND "issued_at" IS NOT NULL) b,
    (SELECT count(*) FROM "invoices" WHERE "status" = 'CANCELLED' AND ("paid_amount" <> 0 OR "adjustment_total" <> 0)) c
  ) v;
  IF bad IS NOT NULL AND bad <> '' THEN
    RAISE EXCEPTION 'inconsistent invoices exist, migration aborted without changes: %', bad;
  END IF;
END $$;

ALTER TABLE "invoices" ADD CONSTRAINT "invoices_issued_at_consistent"
  CHECK ("status" = 'CANCELLED' OR ("status" = 'DRAFT') = ("issued_at" IS NULL));

CREATE OR REPLACE FUNCTION "finance_guard_invoice"() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'invoices cannot be deleted; void instead' USING ERRCODE = '23001';
  END IF;

  IF OLD."status" = 'CANCELLED' THEN
    RAISE EXCEPTION 'a voided invoice cannot be changed' USING ERRCODE = '23001';
  END IF;

  IF NEW."status" IS DISTINCT FROM OLD."status" AND NOT (
       (OLD."status" = 'DRAFT' AND NEW."status" IN ('ISSUED', 'CANCELLED'))
    OR (OLD."status" IN ('ISSUED', 'OVERDUE', 'PARTIALLY_PAID', 'PAID')
        AND NEW."status" IN ('ISSUED', 'PARTIALLY_PAID', 'PAID', 'CANCELLED'))
  ) THEN
    RAISE EXCEPTION 'invalid invoice status transition % -> %', OLD."status", NEW."status"
      USING ERRCODE = '23001';
  END IF;

  IF NEW."status" = 'CANCELLED' THEN
    IF NOT EXISTS (
      SELECT 1 FROM "invoice_voids" v
       WHERE v."invoice_id" = OLD."id" AND v."organization_id" = OLD."organization_id"
    ) THEN
      RAISE EXCEPTION 'an invoice can only be cancelled by recording a void' USING ERRCODE = '23001';
    END IF;
    IF NEW."paid_amount" <> 0 OR NEW."adjustment_total" <> 0 THEN
      RAISE EXCEPTION 'an invoice with settled money or credits cannot be voided' USING ERRCODE = '23001';
    END IF;
  END IF;

  IF OLD."status" = 'DRAFT' AND NEW."status" = 'ISSUED' AND NEW."issued_at" IS NULL THEN
    RAISE EXCEPTION 'issuing an invoice requires issued_at' USING ERRCODE = '23514';
  END IF;

  IF OLD."status" <> 'DRAFT' AND (
       NEW."amount" IS DISTINCT FROM OLD."amount"
    OR NEW."number" IS DISTINCT FROM OLD."number"
    OR NEW."organization_id" IS DISTINCT FROM OLD."organization_id"
    OR NEW."resident_id" IS DISTINCT FROM OLD."resident_id"
    OR NEW."booking_id" IS DISTINCT FROM OLD."booking_id"
    OR NEW."period_start" IS DISTINCT FROM OLD."period_start"
    OR NEW."period_end" IS DISTINCT FROM OLD."period_end"
    OR NEW."due_date" IS DISTINCT FROM OLD."due_date"
    OR NEW."issued_at" IS DISTINCT FROM OLD."issued_at"
    OR NEW."notes" IS DISTINCT FROM OLD."notes"
    OR NEW."created_at" IS DISTINCT FROM OLD."created_at"
  ) THEN
    RAISE EXCEPTION 'issued invoice identity, amount, dates and notes are immutable' USING ERRCODE = '23001';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
```

The trigger object `invoices_guard` is unchanged; only the function body is replaced, so no `DROP` is needed.
`CREATE OR REPLACE FUNCTION` is a body replacement, not an object drop; the scope guard's destructive-SQL rule (S4) must be told
this is approved (E.1).

## C. Invoice void / reversal

### C.1 Model (append-only, mirrors `payment_reversals` and `invoice_adjustments`)

The void is a separate immutable row, not columns on the mutable invoice. The invoice moves to the existing `CANCELLED` status
(D6). Nothing is deleted or rewritten: the invoice row, its payments, reversals and adjustments all remain.

### C.2 Rules (what "void" means)

- **Who / why:** `voided_by` (a user) and `reason` (3–500 characters, same rule as reversals and credits) are mandatory. OWNER and PROPERTY_MANAGER have equal access, as in the rest of finance.
- **Preconditions (checked by the database, so no code path can skip them):** invoice not already voided; `paid_amount = 0`; `adjustment_total = 0` (D2). In practice every payment must first be **reversed** through the existing audited reversal flow; void never touches payments.
- **No silent rewriting:** the void changes one column of one invoice row (`status`) and inserts one row. Payments stay immutable (`payments_immutable`), reversals stay append-only, and the previous status and amount are recorded in the void row.
- **One void per invoice:** `UNIQUE(invoice_id)`; a repeat or racing void fails with `23505`, which the API maps to 409.

### C.3 Balance and reporting after a void

| Surface                    | Behaviour                                                                                                                                        |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Invoice balance            | A voided invoice owes nothing; it is excluded from outstanding and overdue (those use `ISSUED / PARTIALLY_PAID / OVERDUE` only)                  |
| Monthly report `invoiced`  | Excluded, because it counts `ISSUED / PARTIALLY_PAID / OVERDUE / PAID` (`CANCELLED` is not in `BILLABLE_STATUSES`)                               |
| Monthly report `collected` | Unchanged: it counts non-reversed payments, and a voided invoice has none                                                                        |
| Invoice list / detail      | Shown with status `CANCELLED`, the void reason, actor and time; filter `status=CANCELLED` already exists                                         |
| Receipts                   | Still readable. Reversed payments are marked reversed with their own snapshot                                                                    |
| Numbering                  | A voided invoice keeps its number; numbers are never reused (the sequence may therefore have visible gaps)                                       |
| Re-billing the same month  | **Not possible** under D3 (the unique key stays). A wrong amount is corrected by a credit; a wrongly issued invoice is voided and not re-created |

### C.4 SQL (migration 2, unexecuted)

```sql
-- Migration 2: invoice void record. Additive: one new table, its constraints and two triggers.
CREATE TABLE "invoice_voids" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "invoice_id" UUID NOT NULL,
    "resident_id" UUID NOT NULL,
    "previous_status" "InvoiceStatus" NOT NULL,
    "amount_at_void" DECIMAL(12,2) NOT NULL,
    "reason" TEXT NOT NULL,
    "voided_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invoice_voids_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "invoice_voids_invoice_id_key" ON "invoice_voids"("invoice_id");
CREATE INDEX "invoice_voids_organization_id_created_at_idx" ON "invoice_voids"("organization_id", "created_at");

ALTER TABLE "invoice_voids" ADD CONSTRAINT "invoice_voids_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "invoice_voids" ADD CONSTRAINT "invoice_voids_invoice_id_organization_id_resident_id_fkey"
  FOREIGN KEY ("invoice_id", "organization_id", "resident_id")
  REFERENCES "invoices"("id", "organization_id", "resident_id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "invoice_voids" ADD CONSTRAINT "invoice_voids_voided_by_fkey"
  FOREIGN KEY ("voided_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "invoice_voids" ADD CONSTRAINT "invoice_voids_reason_present"
  CHECK (length(btrim("reason")) BETWEEN 3 AND 500);
ALTER TABLE "invoice_voids" ADD CONSTRAINT "invoice_voids_amount_positive" CHECK ("amount_at_void" > 0);
ALTER TABLE "invoice_voids" ADD CONSTRAINT "invoice_voids_previous_status_open"
  CHECK ("previous_status" <> 'CANCELLED');

-- Append-only, reusing the existing function from the corrections migration.
CREATE TRIGGER "invoice_voids_immutable" BEFORE UPDATE OR DELETE ON "invoice_voids"
  FOR EACH ROW EXECUTE FUNCTION "finance_forbid_correction_change"();

-- The database, not the caller, decides whether a void is allowed and records what was voided.
CREATE FUNCTION "finance_check_void"() RETURNS trigger AS $$
DECLARE inv RECORD;
BEGIN
  SELECT "status", "amount", "paid_amount", "adjustment_total" INTO inv
    FROM "invoices"
   WHERE "id" = NEW."invoice_id" AND "organization_id" = NEW."organization_id"
     FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'void references an unknown invoice' USING ERRCODE = '23503';
  END IF;
  IF inv."status" = 'CANCELLED' THEN
    RAISE EXCEPTION 'invoice is already voided' USING ERRCODE = '23505';
  END IF;
  IF inv."paid_amount" <> 0 OR inv."adjustment_total" <> 0 THEN
    RAISE EXCEPTION 'an invoice with settled money or credits cannot be voided; reverse its payments first'
      USING ERRCODE = '23514';
  END IF;
  NEW."previous_status" := inv."status";
  NEW."amount_at_void"  := inv."amount";
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "invoice_voids_check" BEFORE INSERT ON "invoice_voids"
  FOR EACH ROW EXECUTE FUNCTION "finance_check_void"();
```

`schema.prisma`: new model `InvoiceVoid` (`@@map("invoice_voids")`) with the composite relation to `Invoice`, plus the back-relation
on `Invoice`, `Organization` and `User`. Application flow (later task, new route, D7): lock the invoice `FOR UPDATE`, insert the
void row, update the status to `CANCELLED`, write a `finance.invoice.voided` audit event, all in one transaction.

## D. Constraints, indexes, scoping, concurrency

- **Organization scoping:** every new foreign key is composite and carries `organization_id`; `invoice_voids` references
  `invoices(id, organization_id, resident_id)`, so a void can never point at another organization's invoice or a different resident. Both
  triggers re-read the invoice with `organization_id = NEW.organization_id`.
- **Uniqueness / idempotency:** `invoice_voids(invoice_id)` is unique, so a void is exactly-once. Payment idempotency
  (`payment_idempotency_keys`, unique `(organization_id, key)` and `(payment_id)`) is unchanged and unaffected by the snapshot columns.
- **Indexes:** `invoice_voids(organization_id, created_at)` for history listing. No new index on `payments`; the snapshot columns are
  read by primary key through the existing `invoice_id` index.
- **Concurrency:** both new insert triggers take `FOR UPDATE` on the same invoice row the application already locks, so payment,
  reversal, credit and void all serialize on that row. A payment racing a void: if the payment commits first, `paid_amount > 0` and the
  void is refused; if the void commits first, the invoice is `CANCELLED` and the payment trigger refuses (D4). Lock order is unchanged
  (idempotency advisory lock, then the invoice row), so no new deadlock cycle is introduced.
- **Defence in depth:** a `CANCELLED` invoice is frozen, so even an orphan payment or credit could not update its totals.

## E. Migration safety

### E.1 Repository bookkeeping that the migrations require

- `scripts/phase_scope.json`: new slice `3.7` (approver, date, `ref` into `PHASE_3_SCOPE_REGISTER.md`) listing model `InvoiceVoid`, table `invoice_voids`, functions `finance_snapshot_payment` and `finance_check_void`, and route `POST /api/v1/finance/invoices/:id/void` (after D7); `migrationSlices` entries for the three new migration names.
- The register records that `finance_guard_invoice` is **replaced** (not dropped) and that `CREATE OR REPLACE FUNCTION` is approved for S4.
- Slice-tagged, additive SQL means S3 and S5 (committed migrations immutable) are unaffected; I will not edit any applied migration.

### E.2 Forward behaviour

Applied in order 1 → 2 → 3, each in the single transaction Prisma already wraps around a migration. Migration 1 and 2 add objects only.
Migration 3 first aborts without changes if any row would violate the new CHECK or the void rules; otherwise it adds the CHECK and replaces
the function body. Adding the CHECKs scans the table once (small at pilot scale; `NOT VALID` + `VALIDATE` is the fallback for large tables).

### E.3 Existing data compatibility

Read-only pre-flight run on **scratch** (rolled back), which holds representative test data:

| Check                                                           | Result on scratch                                                                                                                           |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Invoices by status                                              | DRAFT 549, ISSUED 431, PAID 132, PARTIALLY_PAID 289, CANCELLED 12                                                                           |
| Non-draft, non-cancelled without `issued_at`                    | 0                                                                                                                                           |
| DRAFT with `issued_at`                                          | 0                                                                                                                                           |
| CANCELLED with cash or credits                                  | 0 (all 12 have `issued_at` NULL)                                                                                                            |
| Stored `OVERDUE`                                                | 0                                                                                                                                           |
| Payments total / on DRAFT or CANCELLED invoices                 | 709 / 0                                                                                                                                     |
| Payments reversed / on credited invoices                        | 180 / 96 (these keep NULL snapshots and render "derived")                                                                                   |
| Issued invoices with `due_date` earlier than the IST issue date | 12 (test data created with explicit past due dates; **no constraint** is proposed on this, only that `due_date` stops changing after issue) |

For `nook_dev` the same query set must be run read-only before applying (requires your approval to read it). Production has no data per the
earlier plan; `nook_test` is out of scope.

### E.4 Rollback limitations

Prisma has no down migrations; rollback is a new forward migration, and it is **lossy once the features are used**:

- **Migration 3:** safe to reverse (`ALTER TABLE invoices DROP CONSTRAINT invoices_issued_at_consistent;` and `CREATE OR REPLACE FUNCTION finance_guard_invoice()` with the baseline body from `20261101130000`). No data is lost. Invoices already `CANCELLED` by void stay cancelled.
- **Migration 2:** `DROP TABLE invoice_voids` destroys the void reasons and actors; invoices voided in the meantime would remain `CANCELLED` with no record. Not recommended after first use; restore from backup instead.
- **Migration 1:** dropping the columns destroys every recorded snapshot (immutable history that cannot be re-derived exactly). Dropping only the trigger (`DROP TRIGGER payments_snapshot`) is the safe partial rollback.
- Before applying anywhere that matters: `pg_dump` of `payments`, `invoices` and `_prisma_migrations`, and a dry run on a throwaway copy.

### E.5 Required tests (database level, run on scratch as migrator and runtime roles)

Receipt snapshot: first payment records `credit=0, balance=amount−payment`; credit then payment records the credit and the reduced balance;
payment then credit leaves the first receipt unchanged; reversal marks the receipt reversed but leaves its stored values; replacement payment gets its own snapshot;
client-supplied snapshot values are overwritten; direct SQL `UPDATE` of a snapshot column is refused (immutable trigger); pre-existing rows still read `NULL` and render "derived";
overpayment and payments on DRAFT/CANCELLED invoices are refused at the database; 20 concurrent payments + credits produce receipts consistent with the actual lock order;
**pin the insert-before-update order** of `recordPayment`.
Guard: every forbidden transition is refused and every permitted one succeeds; `due_date`, `issued_at`, `notes`, `created_at` cannot change after issue; the issue step may set `due_date` and `issued_at` together; `CANCELLED` is frozen; a bare `status='CANCELLED'` update is refused; legacy cancelled rows stay readable; migration 3 aborts untouched when seeded with an inconsistent row.
Void: void of ISSUED/DRAFT succeeds with reason, actor, previous status and amount recorded; refused with cash, with credits, when already voided, with a short reason, across organizations (404) and for a resident mismatch; double and concurrent voids yield one row; payment racing void leaves a consistent result either way; payments, reversals and adjustments are byte-identical before and after a void; reports and outstanding exclude voided invoices; runtime role cannot `UPDATE`/`DELETE` `invoice_voids`; audit event written in the same transaction and rolled back with it.
**Existing tests that will need changes when this is implemented** (found by search): `finance.integration.test.ts` — the helper that sets `due_date` after issue (line ≈241, now frozen), the test that sets `status='CANCELLED'` by SQL (≈720, now needs a void), the direct `INSERT INTO payments` fixtures (≈1007, ≈1241, ≈1686; the trigger will compute snapshots and enforce balance), and the `UPDATE invoices SET paid_amount…adjustment_total` fixture (≈1492). All other suites should be unaffected.

### E.6 Optional migration 4 and its cost (D3)

To allow re-billing a voided month, replace the full unique index with `CREATE UNIQUE INDEX … ("organization_id","resident_id","period_start") WHERE "status" <> 'CANCELLED'`
after dropping `invoices_organization_id_resident_id_period_start_key`. Costs: it drops an index (destructive under S4, needs its own approved reference);
Prisma cannot express a partial unique index, so `schema.prisma` would lose `@@unique([organizationId, residentId, periodStart])` and later `migrate diff` runs would report drift;
`generateMonthly` must also ignore voided invoices when deciding what already exists. I recommend deferring it until the owner confirms they want void-and-rebill.

## F. Proposed approval path

1. You decide D1–D8 (or accept the recommendations).
2. I write the three migration files, the `schema.prisma` and scope changes, and tests, **without applying**, and show you the diff.
3. After your SQL review, I dry-run on a fresh disposable database, then on the existing scratch database, and report; nothing touches `nook_dev` or `nook_test` without separate approval.
