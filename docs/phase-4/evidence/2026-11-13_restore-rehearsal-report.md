# Restore drill report 20261113T061604Z

- Source: 127.0.0.1:52013/nook_closure_src (scratch-rehearsal); server/size: 17.11 10 MB
- Drill database: 127.0.0.1:52013/nook_restore_drill_closure (left in place)
- Tools: docker-exec:nook-closure-restore-0f621961-9d72-4212-8ff8-2488449330d4; permissions restored: no (NOT VERIFIED)
- Encrypted dump: 200240 bytes, sha256 9dc8f0e2a264005fcd4b771fd5e1b2f8521d3b29d5d46f4a24b42824ae96c346
- Durations (s): dump+encrypt 1, decrypt+restore 0, fingerprint 0, total 1
- Result: PASS

> This was a rehearsal on a scratch source. It proves the procedure and tooling work. It does NOT show that a
> production backup restores: repeat with --source-kind production-backup on a real backup.

## Comparison
```
PASS  ext                 2 facts identical
PASS  table              33 facts identical
PASS  column             33 facts identical
PASS  index             135 facts identical
PASS  constraint        199 facts identical
PASS  trigger            29 facts identical
PASS  function          211 facts identical
PASS  enum               25 facts identical
PASS  rows               33 facts identical
PASS  hash               32 facts identical
PASS  ledger             12 facts identical
PASS  total              10 facts identical
SKIP  owner/acl      dumped with --no-owner --no-acl: owners and privileges NOT VERIFIED
SKIP  runtime_priv   no --runtime-role given
```

## Ledger invariants (violation counts; a healthy production database shows 0 except legacy cancelled_without_void)
```
adjustment_total_drift = 0
cancelled_with_money = 0
cancelled_without_void = 0
draft_with_money = 0
duplicate_invoice_numbers = 0
negative_cash = 0
paid_amount_drift = 0
paid_exceeds_amount = 0
partially_paid_without_live_payment = 0
payments_on_draft_or_cancelled = 0
reversals_without_payment = 0
status_contradicts_amounts = 0
```

## Totals
```
audit_events = 0
invoices_adjustment_total = 0
invoices_non_draft_amount = 0
invoices_paid_amount = 0
latest_migration = 20261111130000_assignment_replacement_chain_guards
migrations_applied = 24
migrations_unfinished = 0
payments_amount = 0
per_organization_digest = d41d8cd98f00b204e9800998ecf8427e
reversed_payments_amount = 0
```
