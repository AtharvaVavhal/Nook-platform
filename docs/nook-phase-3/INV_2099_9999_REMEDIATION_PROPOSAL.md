# INV-2099-9999: the one legacy-versus-booking conflict in `nook_layer1_clean`

Status: **investigation and proposal. No row was deleted, modified, voided or cleaned, and the slot-conflict trigger migration was not
applied.** Facts marked (DB) come from a read-only query made before Docker Desktop stopped (the host disk filled); facts marked
(code) come from the repository. A complete read-only report script (`inv_conflict_report.sql`, in the scratchpad) is ready to run
once Docker is back, and the table in section 2 must be re-confirmed with it.

## 1. What it is

| Question         | Answer                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Invoice          | `INV-2099-9999` in organization `Finance Test Org dba1dea7` (DB). Created 2026-11-03 05:05:19 UTC (DB).                                                                                                                                                                                                                                                                                                                                                                                            |
| Kind             | A **DRAFT with no booking** (DB: `booking_id IS NULL`, status `DRAFT`). The statement that created it sets only `id, organization_id, resident_id, number, period_start, period_end, amount, due_date, updated_at`: amount 10, both period dates and the due date equal to the first day of the test's month, status left at its column default `DRAFT`, never issued (code).                                                                                                                      |
| Conflict         | The same resident-month also holds an active **booking** invoice, so the month has two active invoices, one with and one without a booking (DB: `active_same_month = 2`).                                                                                                                                                                                                                                                                                                                          |
| Money            | No payment can exist: the database refuses payments on a DRAFT, and a CHECK keeps a draft's `paid_amount` at 0. No credit can be applied through the application to a draft. The ledger check `draft_with_money` was 0 in the last read. To be re-confirmed by the report script.                                                                                                                                                                                                                  |
| Originating test | `invoice: duplicate prevention at API and database level` in `finance.integration.test.ts`. At the baseline commit it creates a booking draft through the API, expects the second API call to answer `409`, then inserts a booking-less invoice **directly in SQL** and expects `23505` from the old resident-level unique index (`git show HEAD:...` lines 373-391).                                                                                                                              |
| Why it persisted | That index was replaced by the per-booking partial indexes (migration `20261103130000`). The migration was applied to the clean scratch database **before** I adapted this test, so the next full finance run inserted the row successfully, the test failed (it expected an error), and nothing rolled the insert back. It happened in exactly one run (05:05:19 UTC). The test now inserts **with** the booking and expects the new index to refuse it, so it can no longer create the conflict. |

It is an artefact of a test written for the old model, not of any application path. The application cannot create it: `createDraft`
requires a booking and refuses a month already billed by an active legacy invoice, and monthly generation always sets a booking and
skips such months (both tested).

## 2. Related rows (to confirm with the report script)

Run `psql -f inv_conflict_report.sql` in a read-only session on `nook_layer1_clean`. It prints the invoice, every invoice of that
resident-month, payments / reversals / credits / void records on them, the booking and stay, the organization's audit events for those
invoices, and the count of other conflicts (expected 0). Expected: the sibling is the booking DRAFT created by the same test, an
`finance.invoice.created` audit event exists for the sibling and **none** for `INV-2099-9999` (it was inserted by SQL, not by the
application), and no payment, credit or void exists for either.

## 3. Consequence

- `Finance Test Org dba1dea7` double-bills nobody in reality: both rows are drafts in a test organization.
- The slot-conflict trigger's pre-flight reports exactly this one resident-month on this database, so that migration would abort here
  (fail-closed, by design). It cannot be rehearsed end to end on this database without remediating or replacing it.
- The restore-verify ledger line `legacy_vs_booking_conflicts` (not yet part of the script) would show 1 here and must be 0 in production.

## 4. Data-preserving options

| Option                                                                                                     | What changes                                                                                                                    | Preserves history?       | Needs approval?                               | Verdict                                   |
| ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ------------------------ | --------------------------------------------- | ----------------------------------------- |
| A. Leave the row; rehearse the trigger elsewhere                                                           | nothing                                                                                                                         | yes                      | none                                          | **Recommended for this database**         |
| B. Build a second clean scratch database from the migrations and rehearse the trigger migration there      | a new database (a few MB); nothing existing is touched                                                                          | yes                      | database creation                             | **Recommended for the trigger rehearsal** |
| C. Void `INV-2099-9999` through the application (`POST /finance/invoices/:id/void`, a DRAFT may be voided) | one row becomes `CANCELLED`, one `invoice_voids` row and one `finance.invoice.voided` audit event are added; nothing is deleted | yes (terminal, but kept) | **owner approval: it modifies a scratch row** | acceptable, not needed                    |
| D. Delete the row                                                                                          | not possible (the database refuses deleting invoices)                                                                           | n/a                      | n/a                                           | rejected                                  |
| E. Edit it (add a booking, change the month)                                                               | refused for issued invoices; for a DRAFT it is allowed by SQL                                                                   | no (rewrites history)    | n/a                                           | rejected                                  |
| F. Make the trigger pre-flight ignore it                                                                   | weakens the safeguard                                                                                                           | n/a                      | n/a                                           | rejected                                  |

## 5. The same situation in production (procedure, nothing to run now)

The pre-flight query (section 3 of the trigger proposal) must return **0** before the trigger migration. If it returns rows, for each
resident-month an operator decides, with the owner, which invoice is the real one, and voids the other **through the application**
(never by SQL), keeping every row:

| Redundant invoice is       | Procedure                                                                                       |
| -------------------------- | ----------------------------------------------------------------------------------------------- |
| DRAFT (cannot hold money)  | void it with a reason                                                                           |
| ISSUED, unpaid, no credits | void it with a reason                                                                           |
| has payments               | reverse each payment with a reason, then void; or keep it and void the other one instead        |
| has credits                | cannot be voided (credits are irreversible): keep it as the real invoice and void the other one |
| PAID                       | keep it; void the other one                                                                     |

Then rerun the pre-flight; only a clean result allows the migration.

## 6. Decisions requested

1. Option A + B (leave the row; build a second clean scratch database for the trigger rehearsal)? Or option C?
2. Add `legacy_vs_booking_conflicts` as an informational invariant to `restore-verify.sql` (recommended)?
