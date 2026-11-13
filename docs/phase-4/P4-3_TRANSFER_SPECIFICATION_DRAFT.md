# P4-3 transfer specification — implementation draft

Status: NOT IMPLEMENTED; not owner-approved policy. Prepared from the current repository and the Phase 4 mission. P4-2 critical acceptance is a prerequisite specified by the mission. That prerequisite is currently blocked by a missing migration and unexecuted acceptance tests. Financial correction application remains OFF.

## Scope and existing architecture

The repository uses NestJS/Prisma, PostgreSQL, session-cookie authentication, two membership roles (OWNER and PROPERTY_MANAGER), and a React application with native hash navigation and fetch. Do not replace these with the technologies named in a historical overview.

The existing Booking stores a single bedId. Admission and CheckIn preserve that association; CheckOut must match its CheckIn. Existing overlap queries use Booking dates and bedId. Merely changing one bedId would either lose history or leave availability, billing and checkout reading contradictory assignments. Admission propertyId/roomId metadata is not a physical transfer.

## Required command contract

An explicit transfer command must identify the active stay, destination bed, reason and Idempotency-Key. Resolve tenant and actor from the authenticated server context. Reread active organization, membership and role inside every attempt and replay. Admit only OWNER and PROPERTY_MANAGER. Never accept client actor, organization, rent, financial classification or source-assignment facts as authoritative.

The command must return either a durable transfer with its original/destination property, room, bed and effective instant, or a precise conflict with no partial writes. A request lost after commit is resolved by the same idempotency key. An incompatible payload with that key is a conflict. Uncertain commit errors are never automatically retried.

A read-only availability preview must carry the proposed destination, current assignment and reservation interval. It is advisory: revalidate all facts atomically when confirming.

## Assignment model and migration design

Introduce explicit assignment segments for a booking, each with organization, resident, booking, bed, start and exclusive end. Capture transfer identity and immutable original/destination snapshots separately. Keep source booking identity and commercial terms unchanged. A completed segment and transfer record are historical facts, not editable rows.

All relations need composite same-tenant keys. Prevent overlapping effective assignments on the same bed at database level, with a reviewed exclusion-constraint/locking design. Prevent more than one current assignment per active stay. The database schema must distinguish original booking attribution from current physical occupancy; it must not silently overload historical CheckIn or CheckOut fields.

Backfill only relationships that are provably consistent. Quarantine ambiguous legacy active stays for review. Preserve original migration history and use forward migrations. Require an explicit review of backfill counts and conflicts before adoption. No SQL migration is supplied or approved by this draft.

Every availability consumer must move together to the reviewed assignment model: new booking, admission, check-in/out, extension, transfer, corrections, occupancy, stay summary and scheduler eligibility. A partial rollout that changes transfer writes while old readers continue to reserve Booking.bedId is prohibited.

## Transaction protocol

Use the existing exclusive organization gate, not a new shared/exclusive hybrid. Lock the source and destination beds in deterministic id order, then the booking and assignment/stay rows according to one reviewed global order. Recheck source assignment and destination overlap after locking. Include relevant inventory state in the concurrency boundary before relying on its availability or archived/out-of-service flags. Review implicit FK locks as well as explicit locks.

Close the old interval and open the destination interval in the same transaction as the immutable transfer event and idempotency receipt. The booking is not cancelled or recreated. A rollback preserves the complete source assignment and produces no transfer event or receipt. Bound every acquisition by remaining transaction time. Never hold a Resident UPDATE lock before acquiring Invoice locks.

Extend the same booking and its final assignment segment under that same availability authority. Checkout closes physical occupancy without rewriting booking terms or invoices. These integrations are required before enabling transfer creation.

## Finance boundary

FinanceService remains authoritative. Transfer must preserve booking.monthlyPrice, deposit records, issued invoices and all existing payment/credit/reversal records. No proration, tax, automatic credit, refund or deposit deduction is introduced.

A different advertised destination-bed price is not permission to change contractual rent. Show the financial implication and require the approved review workflow; do not invent a new rent-renegotiation operation. A transfer cannot silently create a new booking or a second full-month invoice.

## Reversible initial limits pending decisions

Before policy approval, keep transfer execution unavailable. The implementation candidate is an immediate transfer of an active resident within the same property, with unchanged contractual rent. Future, backdated, cross-property, overdue/overstay and rent-changing transfers remain unavailable until explicitly decided. These are proposed conservative limits, not a claim of owner approval. The ordinary checkout and extension paths remain available under their existing rules.

Required owner decisions: effective-time/backdating rights; future transfer reservations; cross-property permissions; treatment of unapproved overstay during a move; whether different destination pricing permits unchanged-rent transfer or requires review first; who may approve exceptional transfers. Deposit/refund policy remains separately gated.

## Frontend and history

Add a permission-aware action on the active stay, destination selection and preview, mandatory reason, and an explicit confirmation showing both assignments and unchanged commercial terms. Retain a command key across uncertain outcomes. Disable duplicate controls while pending. Handle loading, no available beds, stale source, unavailable destination, authorization failure and retryable conflicts. Refetch affected data without reloading the page.

Show completed transfers in the resident timeline and a dedicated immutable transfer history. Display both effective and recorded time, original/destination facts, actor and reason. Pending requests must not appear as completed moves.

## Required verification

Run same-tenant and cross-tenant cases, both roles and unauthorized users, vacant/occupied/out-of-service destinations, invalid or stale source, same-bed rejection, duplicate request and uncertain-commit replay, concurrent transfer/booking/extension/checkout, injected rollback, historical assignment preservation, immutable transfer records, and unchanged issued invoices/rent/deposits.

Each defined race pair must have at least 1,000 randomized interleavings, with durable-state, audit and receipt assertions and observed PostgreSQL deadlocks recorded independently of retries. Verify the complete browser lifecycle against the real API and disposable PostgreSQL, including mobile layouts. Passing typecheck or fixture-based browser navigation is insufficient acceptance.
