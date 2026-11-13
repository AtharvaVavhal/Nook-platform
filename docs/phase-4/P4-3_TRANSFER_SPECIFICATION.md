# NOOK — P4-3 Transfer Specification

**Status:** NOT IMPLEMENTED; NOT OWNER-APPROVED. P4-2 critical acceptance (including A1–A10) is a prerequisite. Financial correction application remains OFF.

---

## 1. Scope

This specification defines the **explicit room/bed transfer** milestone (P4-3). It covers:

- Moving an **active resident** from one bed to another within the same organization.
- Preserving **full assignment history** (source → destination) without losing auditability.
- **Atomic availability verification** — destination bed must be free for the transfer interval.
- **No financial changes** — booking, rent, issued invoices, deposits remain untouched.
- **Authorization** — OWNER / PROPERTY_MANAGER per existing matrix; self-approval prohibited.

**Out of scope for initial release (owner decisions pending):**
- Backdated or future-dated transfers.
- Cross-property transfers.
- Transfers involving overstay/overdue residents.
- Transfers where destination bed has different pricing (requires rent review).
- Resident confirmation workflow.

---

## 2. Existing Architecture (Verified Baseline)

### 2.1 Current Models

| Model | Key Fields | Purpose |
|---|---|---|
| `Booking` | `bedId`, `startDate`, `endDate`, `monthlyPrice` | Commercial terms; one bed per booking |
| `Admission` | `bedId`, `propertyId`, `roomId`, `admissionDate` | Links booking to physical bed; property/room metadata only |
| `CheckIn` | `bedId`, `checkInAt`, `status` | Active stay begins; one per admission |
| `CheckOut` | `bedId`, `checkOutAt`, `reason` | Active stay ends; one per check-in |
| `Bed` | `roomId`, `propertyId`, `operationalStatus` | Physical inventory; `IN_SERVICE` / `OUT_OF_SERVICE` |
| `Room` | `propertyId`, `floorId` | Container for beds |
| `AuditEvent` | `action`, `targetType`, `targetId`, `metadata` | Append-only event log |

### 2.2 Critical Design Facts

- **Booking.bedId** is the *commercial* bed assignment (one per booking).
- **CheckIn.bedId** is the *physical* occupancy at check-in time.
- **Admission** has `propertyId`/`roomId` as metadata — **not a transfer mechanism**.
- Changing `Booking.bedId` directly would break history, billing, and availability.
- Finance uses `Booking.monthlyPrice` snapshot at booking creation — bed price is unused.

### 2.3 Existing Concurrency Control

- **Organization gate** (`acquireOrgGate`) — exclusive advisory lock per organization.
- **Lock order** (P4-2 §10.2): command-key → proposal row → org gate → invoice-number → Bed → Booking → Admission → CheckIn → CheckOut → Invoice.
- **Transaction options:** ordinary writers `maxWait: 5s, timeout: 15s, lock_timeout: 3s`; corrections `maxWait: 10s, timeout: 30s, lock_timeout: 5s`.
- **Idempotency:** HMAC receipt stored in same transaction as effect.

---

## 3. Business Rules

### 3.1 Room Transfer
- Moves an **active resident** from current bed to a destination bed in a **different room**.
- Destination bed must be in a **different room** (`roomId` differs).
- Source and destination must be in the **same organization**.
- Destination bed must be available for the **entire remaining booking interval** (or until next transfer/checkout).

### 3.2 Bed Transfer
- Moves an **active resident** from current bed to another bed in the **same room**.
- Destination bed must be in the **same room** (`roomId` same).
- Never allows simultaneous active allocation of the same bed.

### 3.3 Common Rules
| Rule | Detail |
|---|---|
| **Active stay required** | Resident must have a `CheckIn` with `status = 'ACTIVE'` and no `CheckOut`. |
| **Destination availability** | No overlapping `CheckIn` (status `ACTIVE`) on destination bed for the transfer interval. |
| **Same organization** | Source and destination beds must belong to the same `organizationId`. |
| **Booking unchanged** | `Booking.bedId`, `monthlyPrice`, `startDate`, `endDate` **never change**. |
| **No proration** | Full-month rent continues per existing booking terms. |
| **No issued invoice changes** | Invoices remain immutable; financial implications go through review. |
| **Reason required** | 1–2000 characters, trimmed. |
| **Effective instant** | Zoned RFC 3339, `≤ now` (no future-dated transfers in initial release). |

---

## 4. Database Model Decisions

### 4.1 New Model: `StayAssignment`

Represents a **physical assignment segment** of a booking. One booking can have multiple sequential assignments (original + transfers).

```prisma
enum StayAssignmentKind {
  ORIGINAL      // The booking's initial bed assignment
  TRANSFER      // A room/bed transfer
}

enum StayAssignmentStatus {
  ACTIVE        // Currently occupying this bed
  COMPLETED     // Ended by transfer or checkout
}

model StayAssignment {
  id                 String                  @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  organizationId     String                  @map("organization_id") @db.Uuid
  bookingId          String                  @map("booking_id") @db.Uuid
  residentId         String                  @map("resident_id") @db.Uuid
  bedId              String                  @map("bed_id") @db.Uuid
  kind               StayAssignmentKind      @default(ORIGINAL)
  status             StayAssignmentStatus    @default(ACTIVE)
  startAt            DateTime                @map("start_at") @db.Timestamptz(6)   // Inclusive
  endAt              DateTime?               @map("end_at") @db.Timestamptz(6)     // Exclusive; null = active
  transferId         String?                 @map("transfer_id") @db.Uuid          // Link to Transfer record
  createdAt          DateTime                @default(now()) @map("created_at") @db.Timestamptz(6)

  organization Organization @relation(fields: [organizationId], references: [id], onDelete: Restrict, onUpdate: Restrict)
  booking      Booking      @relation(fields: [bookingId, organizationId], references: [id, organizationId], onDelete: Restrict, onUpdate: Restrict)
  resident     Resident     @relation(fields: [residentId, organizationId], references: [id, organizationId], onDelete: Restrict, onUpdate: Restrict)
  bed          Bed          @relation(fields: [bedId, organizationId], references: [id, organizationId], onDelete: Restrict, onUpdate: Restrict)
  transfer     Transfer?    @relation(fields: [transferId, organizationId], references: [id, organizationId], onDelete: SetNull, onUpdate: Restrict)

  @@unique([id, organizationId])
  @@index([organizationId, bookingId, startAt])
  @@index([organizationId, bedId, startAt, endAt])
  @@map("stay_assignments")
}
```

### 4.2 New Model: `Transfer`

Immutable record of each transfer event.

```prisma
enum TransferType {
  ROOM_TRANSFER   // Destination bed in different room
  BED_TRANSFER    // Destination bed in same room
}

model Transfer {
  id                  String          @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  organizationId      String          @map("organization_id") @db.Uuid
  residentId          String          @map("resident_id") @db.Uuid
  bookingId           String          @map("booking_id") @db.Uuid
  type                TransferType
  sourceBedId         String          @map("source_bed_id") @db.Uuid
  sourceRoomId        String          @map("source_room_id") @db.Uuid
  sourcePropertyId    String          @map("source_property_id") @db.Uuid
  destinationBedId    String          @map("destination_bed_id") @db.Uuid
  destinationRoomId   String          @map("destination_room_id") @db.Uuid
  destinationPropertyId String        @map("destination_property_id") @db.Uuid
  reason              String
  effectiveAt         DateTime        @map("effective_at") @db.Timestamptz(6)
  actorUserId         String          @map("actor_user_id") @db.Uuid
  actorRole           MembershipRole  @map("actor_role")
  idempotencyKey      String          @map("idempotency_key") @db.Uuid
  recordedAt          DateTime        @default(now()) @map("recorded_at") @db.Timestamptz(6)

  organization Organization @relation(fields: [organizationId], references: [id], onDelete: Restrict, onUpdate: Restrict)
  resident     Resident     @relation(fields: [residentId, organizationId], references: [id, organizationId], onDelete: Restrict, onUpdate: Restrict)
  booking      Booking      @relation(fields: [bookingId, organizationId], references: [id, organizationId], onDelete: Restrict, onUpdate: Restrict)
  sourceBed    Bed          @relation("TransferSourceBed", fields: [sourceBedId, organizationId], references: [id, organizationId], onDelete: Restrict, onUpdate: Restrict)
  destBed      Bed          @relation("TransferDestBed", fields: [destinationBedId, organizationId], references: [id, organizationId], onDelete: Restrict, onUpdate: Restrict)
  actor        User         @relation(fields: [actorUserId], references: [id], onDelete: Restrict, onUpdate: Restrict)
  assignments  StayAssignment[]

  @@unique([id, organizationId])
  @@unique([organizationId, actorUserId, idempotencyKey])
  @@index([organizationId, residentId, recordedAt])
  @@index([organizationId, bookingId, recordedAt])
  @@map("transfers")
}
```

### 4.3 Constraints & Indexes

| Constraint | Purpose |
|---|---|
| `UNIQUE(organizationId, bedId, startAt, endAt)` with `EXCLUDE USING GIST` | Prevent overlapping assignments on same bed (PostgreSQL exclusion constraint) |
| `CHECK (endAt IS NULL OR endAt > startAt)` | Valid interval |
| `CHECK (kind = 'ORIGINAL' OR transferId IS NOT NULL)` | Transfer assignments must link to transfer |
| `CHECK (status = 'ACTIVE' AND endAt IS NULL OR status = 'COMPLETED' AND endAt IS NOT NULL)` | State consistency |
| `UNIQUE(organizationId, bookingId, kind)` where `kind = 'ORIGINAL'` | Exactly one original assignment per booking |

### 4.4 Backfill Strategy

1. For every existing `Booking` with an `ACTIVE` `CheckIn`, create one `StayAssignment`:
   - `kind = 'ORIGINAL'`
   - `bedId = Booking.bedId`
   - `startAt = CheckIn.checkInAt`
   - `endAt = NULL` (active)
2. For `Booking` with `CHECKED_OUT` `CheckIn` + `CheckOut`:
   - `kind = 'ORIGINAL'`, `endAt = CheckOut.checkOutAt`, `status = 'COMPLETED'`
3. **Quarantine** ambiguous cases (multiple active check-ins, missing check-out, legacy `CHECKED_OUT` without `CheckOut`).
4. Require **explicit owner review** of backfill counts before enabling transfers.

---

## 5. API Contracts

### 5.1 Preview Availability (Read-Only, Advisory)

```
GET /api/v1/transfers/preview
Query: {
  destinationBedId: UUID,
  residentId: UUID,
  effectiveAt: RFC3339 (optional, defaults to now)
}
Response: {
  available: boolean,
  conflicts: Array<{ bedId, checkInId, checkInAt, checkOutAt? }>,
  currentAssignment: { bedId, roomId, propertyId, roomLabel, bedLabel },
  destination: { bedId, roomId, propertyId, roomLabel, bedLabel, operationalStatus },
  transferType: 'ROOM_TRANSFER' | 'BED_TRANSFER',
  booking: { id, monthlyPrice, startDate, endDate }
}
```

### 5.2 Execute Transfer

```
POST /api/v1/transfers
Headers: Idempotency-Key (UUID), X-CSRF-Token, Origin
Body: {
  residentId: UUID,
  destinationBedId: UUID,
  reason: string (1-2000 chars),
  effectiveAt: RFC3339 (≤ now)
}
Response (201): {
  id: UUID,
  type: 'ROOM_TRANSFER' | 'BED_TRANSFER',
  sourceBedId: UUID,
  destinationBedId: UUID,
  effectiveAt: RFC3339,
  recordedAt: RFC3339,
  stayAssignment: { id, bedId, startAt, endAt }
}
Error Codes:
  400: INVALID_VALUE, INVALID_EVIDENCE, UNKNOWN_FIELD
  403: INSUFFICIENT_ROLE, SELF_REVIEW
  404: NOT_FOUND
  409: CONFLICT (destination not available, no active stay, same bed)
  409: RETRY_REQUIRED (lock timeout, uncertain commit)
  503: CORRECTIONS_NOT_CONFIGURED (missing HMAC secret)
```

### 5.3 Transfer History

```
GET /api/v1/transfers/history?residentId={UUID}&page=1&limit=20
Response: {
  items: [{
    id, type, sourceBedId, destinationBedId, reason,
    effectiveAt, recordedAt, actor: { id, displayName },
    source: { bedLabel, roomLabel, propertyName },
    destination: { bedLabel, roomLabel, propertyName }
  }],
  total, page, limit, totalPages
}
```

---

## 6. Transaction & Locking Strategy

### 6.1 Lock Order (Extends P4-2 §10.2)

```
1. Command-key advisory lock (actor + idempotencyKey)
2. StayAssignment row (source) FOR UPDATE
3. Organization gate (exclusive)
4. Bed row locks: sourceBedId, destinationBedId (deterministic UUID order)
5. Booking row FOR UPDATE
6. Admission row FOR UPDATE
7. CheckIn row FOR UPDATE
8. (No Invoice lock — transfers never touch finance)
```

### 6.2 Protocol

| Step | Action |
|---|---|
| 1 | Acquire command-key lock → source `StayAssignment` FOR UPDATE |
| 2 | Re-read source assignment: must be `ACTIVE`, `endAt IS NULL`, match resident |
| 3 | Acquire org gate |
| 4 | Lock source & destination beds (UUID order) |
| 5 | Re-validate destination: no `ACTIVE` `CheckIn` overlapping `[effectiveAt, booking.endDate)` |
| 6 | Lock `Booking`, `Admission`, source `CheckIn` |
| 7 | Close source `StayAssignment`: `endAt = effectiveAt`, `status = 'COMPLETED'` |
| 8 | Create destination `StayAssignment`: `kind = 'TRANSFER'`, `startAt = effectiveAt`, `endAt = NULL`, `status = 'ACTIVE'` |
| 9 | Create `Transfer` record (immutable) |
| 10 | Create `AuditEvent` for `transfer.executed` |
| 11 | Create `CorrectionCommandReceipt` (idempotency receipt) |
| 12 | Release (transaction commits) |

### 6.3 Timeouts

| Operation | `lock_timeout` | Transaction `timeout` |
|---|---|---|
| Transfer execute | 5s (bounded by remaining budget) | 30s |
| Preview (advisory only) | N/A (no gate) | N/A |

### 6.4 Retry & Idempotency

- **Auto-retry:** Only SQLSTATE `40P01` (deadlock) / `40001` (serialization), max 2 attempts.
- **Lock timeout (55P03), P2028, connection loss:** `RETRY_REQUIRED` (409), client re-sends same `Idempotency-Key`.
- **Receipt:** Stored in same transaction → exists ⇔ command committed.
- **Replay:** Returns original result, rechecks authorization.

---

## 7. Authorization Matrix

| Action | OWNER | PROPERTY_MANAGER |
|---|---|---|
| Preview availability | ✅ | ✅ |
| Execute transfer (immediate, same property, unchanged rent) | ✅ | ✅ |
| Execute transfer (future-dated) | ❌ **Owner decision** | ❌ |
| Execute transfer (backdated) | ❌ **Owner decision** | ❌ |
| Execute transfer (cross-property) | ❌ **Owner decision** | ❌ |
| Execute transfer (destination price differs) | ❌ **Owner decision** | ❌ |
| Execute transfer (resident in overstay/overdue) | ❌ **Owner decision** | ❌ |
| Self-approval | ❌ | ❌ |

**All decisions re-read from DB:** membership, user status, organization status must be `ACTIVE` at execution time.

---

## 8. Audit Requirements

| Event | `action` | `targetType` | `targetId` | `metadata` |
|---|---|---|---|---|
| Transfer executed | `transfer.executed` | `booking` | `bookingId` | `{ transferId, type, sourceBedId, destinationBedId, effectiveAt, reason, actorUserId }` |
| Source assignment closed | `stay_assignment.closed` | `stay_assignment` | `assignmentId` | `{ transferId, endAt }` |
| Destination assignment opened | `stay_assignment.opened` | `stay_assignment` | `assignmentId` | `{ transferId, startAt }` |

- All events include `requestId`, `actorUserId`, `organizationId`, `occurredAt`.
- `Transfer` record is **append-only** (immutable trigger).
- `StayAssignment` updates only `endAt`/`status` on close; `startAt` immutable.

---

## 9. Finance Implications

### 9.1 Invariants (Never Changed)

- `Booking.monthlyPrice` — contractual rent, unchanged.
- `Booking.bedId` — commercial attribution, unchanged.
- `Invoice` amounts, status, due dates — immutable.
- Payment, reversal, credit, void records — untouched.

### 9.2 Financial Review Path

| Scenario | Handling |
|---|---|
| Destination bed has different `Bed.price` (reference only) | **No automatic change**. Show price difference in preview. If contractual rent should change → requires separate rent-review workflow (out of scope). |
| Transfer creates billing-gap-like situation (mid-month move) | **No proration**. Full-month invoicing continues per booking terms. If mid-month move creates two full invoices → flag for `FINANCE_REVIEW` (billing gap review). |
| Transfer during overdue invoice | No change to invoice. Overdue follow-up remains manual. |
| Deposit handling | Unchanged. Deposit stays with original booking. |

### 9.3 Billing-Gap Suppression (Extends P4-2)

If a transfer makes a month newly billable on the **destination bed** (e.g., resident wasn't billable there before):
- Create `CorrectionFinanceLink` with `kind = 'BILLING_GAP'`, `outcome = 'REVIEW_REQUIRED'`.
- `FinanceService.generateMonthly` and `createDraft` skip that `bookingId + periodStart`.
- OWNER resolves via `POST /corrections/finance-reviews/{linkId}/resolve` (`RELEASED` or `NO_SUPPORTED_REMEDY`).

---

## 10. Frontend Workflows

### 10.1 Active Stay Card → "Transfer" Action

- Only visible for `currentStayStatus === 'ACTIVE'`.
- Requires `OWNER` or `PROPERTY_MANAGER` role (from `allowedActions`).

### 10.2 Destination Selection

- List available beds: `IN_SERVICE`, not `archived`, in same organization.
- Filter by room/property for room transfers.
- Show `operationalStatus`, `outOfServiceReason`.
- Exclude current bed.
- **Preview button** calls `GET /transfers/preview` → shows conflicts, type, financial implication.

### 10.3 Confirmation Modal

| Field | Display |
|---|---|
| Resident | Name, current bed/room/property |
| Destination | Bed label, room, property |
| Transfer type | "Room transfer" / "Bed transfer" |
| Effective time | Zoned instant (Asia/Kolkata) |
| Reason | Required textarea |
| Financial note | "Monthly rent unchanged. No proration. Issued invoices unaffected." + price diff if any |

### 10.4 Idempotency Key Handling

- Generate UUID on modal open.
- Persist across retries (`RETRY_REQUIRED`).
- Clear on definitive success/error.

### 10.5 History View

- **Resident Profile → Corrections/Transfers tab** (extend existing `CorrectionHistory`).
- Show: type, source → destination, effective time, actor, reason.
- **Pending** transfers never shown as completed.

---

## 11. Test Strategy

### 11.1 Unit Tests (In-Memory Fake)

- Transfer service logic: validation, state transitions, audit shape.
- Idempotency receipt behavior.
- Authorization checks.
- Preview logic (no DB).

### 11.2 Integration Tests (Disposable PostgreSQL)

| Category | Scenarios |
|---|---|
| **Happy path** | Room transfer, bed transfer, immediate effectiveAt |
| **Authorization** | OWNER, PM, VIEWER (403), self-approval (403), inactive membership (403) |
| **Validation** | No active stay (404), same bed (409), destination occupied (409), cross-org (404), future effectiveAt (400) |
| **Concurrency** | Concurrent transfers (source/dest), transfer vs checkout, transfer vs extension, transfer vs booking create |
| **Idempotency** | Same key replay, changed payload conflict, uncertain commit replay |
| **Finance** | Issued invoices unchanged, billing gap created, billing gap review |
| **Audit** | Three events recorded, metadata complete |
| **History** | List transfers, pagination, cross-org isolation |

### 11.3 Race Pairs (≥ 1,000 interleavings each)

| Pair | Description |
|---|---|
| 1 | Two transfers moving same resident concurrently |
| 2 | Transfer vs checkout (same resident) |
| 3 | Transfer vs extension (same booking) |
| 4 | Transfer vs new booking on destination bed |
| 5 | Transfer vs admission create on destination bed |
| 6 | Transfer vs check-in on destination bed |
| 7 | Transfer vs another transfer on destination bed |
| 8 | Transfer vs correction (checkInAt) on same stay |
| 9 | Transfer vs financial generation on affected month |

Each pair must record: repetitions, deadlocks (40P01), final state, audit counts, receipt counts.

### 11.4 Browser E2E (Real Chrome, Real API, Disposable PG)

Scenarios mirror P4-2 E1–E10:
- T1: Submit transfer → preview → confirm → applied.
- T2: Queue with filters.
- T3: Protected detail (reviewer sees, anonymous blocked).
- T4: Concurrent transfer conflict (destination occupied).
- T5: Self-approval refused.
- T6: Resident profile shows transfer in history.
- T7: Billing gap review for mid-month transfer.
- T8: Same-key retry after network failure.
- T9: Tenant isolation.
- T10: Retryable conflict (lock timeout).

---

## 12. Open Owner Decisions

| # | Decision | Options | Impact |
|---|---|---|---|
| **D1** | **Effective time** — allow backdated transfers? | A) Immediate only (≤ now) / B) Backdated with evidence & OWNER approval | B adds complexity: age calculation, evidence, revalidation of historical availability |
| **D2** | **Future-dated transfers** — schedule a move? | A) Not allowed / B) Allowed with OWNER approval | B requires reservation logic, conflict with intervening bookings |
| **D3** | **Cross-property transfers** | A) Not allowed / B) Allowed with OWNER approval | B requires cross-property availability, different property gates |
| **D4** | **Overstay/overdue residents** — can they transfer? | A) Blocked / B) Allowed with OWNER approval | B requires finance review path for overdue implications |
| **D5** | **Destination price differs** — require rent review first? | A) Blocked / B) Allowed, rent unchanged / C) Allowed with rent review | C introduces rent renegotiation workflow (out of scope) |
| **D6** | **Resident confirmation required?** | A) No (staff-initiated only) / B) Yes (resident must approve) | B adds notification + consent flow, new API surface |
| **D7** | **Transfer history vs booking history** — does transfer appear in booking audit? | A) Only in transfer history / B) Also as `booking.transfer` audit event | B increases booking audit noise |
| **D8** | **Partial transfer** — move for part of remaining stay, then return? | A) Not allowed / B) Allowed (creates multiple segments) | B requires endAt on destination assignment, return transfer |

**All above are `OWNER DECISION REQUIRED` — not approved.**

---

## 13. Implementation Plan (Phased)

| Phase | Deliverable | Depends On |
|---|---|---|
| **P4-3.1** | Database migration: `StayAssignment`, `Transfer`, indexes, constraints, backfill script | P4-2 acceptance (A1–A10) |
| **P4-3.2** | Backend: `TransferService`, `TransferController`, preview endpoint, org-gate integration | P4-3.1 |
| **P4-3.3** | Finance integration: billing-gap creation, review path reuse | P4-3.2 |
| **P4-3.4** | Frontend: transfer action, destination picker, preview modal, confirmation, history tab | P4-3.2 |
| **P4-3.5** | Integration tests: all race pairs, concurrency, idempotency, finance | P4-3.4 |
| **P4-3.6** | Browser E2E: T1–T10 on disposable PG | P4-3.5 |
| **P4-3.7** | Owner decision review: D1–D8 resolved, policy documented | P4-3.6 |
| **P4-3.8** | Extended transfers (backdated, future, cross-property) per approved decisions | P4-3.7 |

---

## 14. Acceptance Gates

| Gate | Criteria |
|---|---|
| **P4-3.1 complete** | Migration applies cleanly; backfill reviewed; Prisma generates; typecheck passes |
| **P4-3.2 complete** | Unit tests pass; preview + execute endpoints return correct shapes; auth matrix enforced |
| **P4-3.3 complete** | Billing-gap created for mid-month moves; review path works; issued invoices unchanged |
| **P4-3.4 complete** | Frontend flows render; idempotency key persisted; error states handled |
| **P4-3.5 complete** | All 9 race pairs ≥ 1,000 runs; zero deadlocks; audit/receipt counts correct |
| **P4-3.6 complete** | 10/10 E2E scenarios pass on disposable PG; API 5xx = 0 |
| **P4-3.7 complete** | Owner decisions D1–D8 recorded in worksheet; policy matches implementation |
| **P4-3.8 complete** | Extended features implemented per decisions; regression suite passes |

---

## 15. Risks & Mitigations

| Risk | Mitigation |
|---|---|
| **Assignment model breaks existing readers** | All availability consumers (booking, check-in, extension, corrections, occupancy, stay-summary, scheduler) must migrate to `StayAssignment` in P4-3.1. No partial rollout. |
| **Exclusion constraint performance** | Test on 100-bed fixture; if contention high, consider per-booking batching for monthly generation (as in P4-2 A4). |
| **Backfill ambiguity** | Quarantine script + owner review gate; no transfers enabled until backfill signed off. |
| **Financial review overload** | Billing-gap review is OWNER-only; transfers during overdue/overstay blocked pending D4. |
| **Deadlock under load** | Lock order strictly enforced; lock_timeout bounded; A6 verification required before acceptance. |

---

## 16. Appendix: Migration Checklist

- [ ] Create `StayAssignment` table with indexes, constraints, exclusion constraint.
- [ ] Create `Transfer` table with indexes, constraints, immutability triggers.
- [ ] Add `StayAssignment` relations to `Booking`, `Resident`, `Bed`, `Transfer`.
- [ ] Add `Transfer` relations to `Booking`, `Resident`, `Bed` (source/dest), `User`, `StayAssignment`.
- [ ] Backfill script: one `StayAssignment` per booking with check-in history.
- [ ] Quarantine report: ambiguous cases listed for owner review.
- [ ] Update `CheckIn`/`CheckOut` services to read/write `StayAssignment` (not `Booking.bedId` for physical occupancy).
- [ ] Update `FinanceService` to use `StayAssignment` for eligibility (booking still provides `monthlyPrice`).
- [ ] Update `CorrectionsService` validators to use `StayAssignment` chain.
- [ ] Update `StaySummaryService` to use `StayAssignment` for current stay.
- [ ] Update occupancy/scheduler queries to use `StayAssignment`.
- [ ] Prisma generate, typecheck, lint pass.
- [ ] Migration dry-run on disposable DB; verify no data loss.

---

**End of Specification**

*This document is a proposal for owner review. No implementation is authorized until P4-2 acceptance is complete and owner decisions D1–D8 are resolved.*