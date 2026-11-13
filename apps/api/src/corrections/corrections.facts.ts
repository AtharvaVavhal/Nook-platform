import { Prisma } from '../generated/client.js';
import {
  CorrectionError,
  FIELD_SPECS,
  istDayKeyOf,
  type FieldKey,
  type SnapshotFacts,
  type TargetType,
  type ValueEnvelope,
} from './corrections.rules.js';

/**
 * Database reads and row locks for correction snapshots (specification 9 and 10). Timestamps are read as canonical
 * microsecond text, never through a JavaScript Date, so no precision is lost in the stored snapshot.
 *
 * Locks (specification 10.2): Bed -> Booking -> Admission -> CheckIn -> CheckOut. A correction takes NO Resident row
 * lock on a lifecycle chain, so it can never hold a Resident row and then wait for an Invoice. Name corrections take the
 * Resident row alone (FOR NO KEY UPDATE, which does not conflict with the key-share locks that payment inserts take).
 */

export type Tx = Prisma.TransactionClient;

const TS = (column: string) =>
  Prisma.raw(`to_char(${column} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`);

export interface ResidentRow {
  id: string;
  firstName: string;
  lastName: string;
  status: string;
  createdAt: string;
}

export interface Chain {
  assignmentSnapshot?: string;
  bookingId: string;
  residentId: string;
  bedId: string;
  bookingStatus: string;
  startDate: string;
  endDate: string;
  monthlyPrice: string;
  bookingCreatedAt: string;
  admissionId: string | null;
  admissionStatus: string | null;
  admissionDate: string | null;
  checkInId: string | null;
  checkInStatus: string | null;
  checkInAt: string | null;
  checkOutId: string | null;
  checkOutAt: string | null;
  checkOutReason: string | null;
}

export async function loadResident(
  tx: Tx,
  organizationId: string,
  id: string,
): Promise<ResidentRow | null> {
  const rows = await tx.$queryRaw<
    { id: string; first_name: string; last_name: string; status: string; created_at: string }[]
  >(Prisma.sql`
    SELECT id, first_name, last_name, status::text AS status, ${TS('created_at')} AS created_at
    FROM residents WHERE id = ${id}::uuid AND organization_id = ${organizationId}::uuid`);
  const r = rows[0];
  return r
    ? {
        id: r.id,
        firstName: r.first_name,
        lastName: r.last_name,
        status: r.status,
        createdAt: r.created_at,
      }
    : null;
}

/** Locks only the Resident row, in a mode that does not conflict with the key-share locks of payment inserts. */
export async function lockResidentForUpdate(
  tx: Tx,
  organizationId: string,
  id: string,
): Promise<boolean> {
  const rows = await tx.$queryRaw<{ id: string }[]>(
    Prisma.sql`SELECT id FROM residents WHERE id = ${id}::uuid AND organization_id = ${organizationId}::uuid FOR NO KEY UPDATE`,
  );
  return rows.length > 0;
}

/** Resolves any lifecycle target to its booking id (null when the target does not exist in this organization). */
export async function resolveBookingId(
  tx: Tx,
  organizationId: string,
  targetType: TargetType,
  targetId: string,
): Promise<string | null> {
  let rows: { booking_id: string }[] = [];
  const org = organizationId;
  if (targetType === 'BOOKING') {
    rows = await tx.$queryRaw(
      Prisma.sql`SELECT id AS booking_id FROM bookings WHERE id = ${targetId}::uuid AND organization_id = ${org}::uuid`,
    );
  } else if (targetType === 'ADMISSION') {
    rows = await tx.$queryRaw(
      Prisma.sql`SELECT booking_id FROM admissions WHERE id = ${targetId}::uuid AND organization_id = ${org}::uuid`,
    );
  } else if (targetType === 'CHECK_IN') {
    rows = await tx.$queryRaw(
      Prisma.sql`SELECT booking_id FROM check_ins WHERE id = ${targetId}::uuid AND organization_id = ${org}::uuid`,
    );
  } else if (targetType === 'CHECK_OUT') {
    rows = await tx.$queryRaw(
      Prisma.sql`SELECT booking_id FROM check_outs WHERE id = ${targetId}::uuid AND organization_id = ${org}::uuid`,
    );
  }
  return rows[0]?.booking_id ?? null;
}

export async function loadChain(
  tx: Tx,
  organizationId: string,
  bookingId: string,
): Promise<Chain | null> {
  const rows = await tx.$queryRaw<Record<string, string | null>[]>(Prisma.sql`
    SELECT b.id AS booking_id, b.resident_id, b.bed_id, b.status::text AS booking_status,
           ${TS('b.start_date')} AS start_date, ${TS('b.end_date')} AS end_date,
           b.monthly_price::text AS monthly_price, ${TS('b.created_at')} AS booking_created_at,
           a.id AS admission_id, a.status::text AS admission_status, ${TS('a.admission_date')} AS admission_date,
           c.id AS check_in_id, c.status::text AS check_in_status, ${TS('c.check_in_at')} AS check_in_at,
           o.id AS check_out_id, ${TS('o.check_out_at')} AS check_out_at, o.reason AS check_out_reason,
           (SELECT string_agg(e.id::text || ':' || to_char(e.start_at AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS.US') || ':' ||
             coalesce(to_char(e.end_at AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS.US'),'ACTIVE'), '|' ORDER BY e.start_at,e.id)
             FROM effective_stay_assignments e WHERE e.booking_id=b.id AND e.organization_id=b.organization_id) AS assignment_snapshot
    FROM bookings b
    LEFT JOIN admissions a ON a.booking_id = b.id AND a.organization_id = b.organization_id
    LEFT JOIN check_ins c ON c.admission_id = a.id AND c.organization_id = b.organization_id
    LEFT JOIN check_outs o ON o.check_in_id = c.id AND o.organization_id = b.organization_id
    WHERE b.id = ${bookingId}::uuid AND b.organization_id = ${organizationId}::uuid`);
  const r = rows[0];
  if (!r) return null;
  return {
    assignmentSnapshot: r.assignment_snapshot ?? '',
    bookingId: r.booking_id!,
    residentId: r.resident_id!,
    bedId: r.bed_id!,
    bookingStatus: r.booking_status!,
    startDate: r.start_date!,
    endDate: r.end_date!,
    monthlyPrice: r.monthly_price!,
    bookingCreatedAt: r.booking_created_at!,
    admissionId: r.admission_id ?? null,
    admissionStatus: r.admission_status ?? null,
    admissionDate: r.admission_date ?? null,
    checkInId: r.check_in_id ?? null,
    checkInStatus: r.check_in_status ?? null,
    checkInAt: r.check_in_at ?? null,
    checkOutId: r.check_out_id ?? null,
    checkOutAt: r.check_out_at ?? null,
    checkOutReason: r.check_out_reason ?? null,
  };
}

type LockTable = 'beds' | 'bookings' | 'admissions' | 'check_ins' | 'check_outs';

async function lockRow(
  tx: Tx,
  organizationId: string,
  table: LockTable,
  id: string,
): Promise<boolean> {
  // The table name comes from the closed union above, never from input.
  const rows = await tx.$queryRaw<{ id: string }[]>(
    Prisma.sql`SELECT id FROM ${Prisma.raw(table)} WHERE id = ${id}::uuid AND organization_id = ${organizationId}::uuid FOR UPDATE`,
  );
  return rows.length > 0;
}

export type ChainDepth = 'booking' | 'admission' | 'checkIn' | 'checkOut';

/**
 * Locks Bed -> Booking -> Admission -> CheckIn -> CheckOut (the rows that exist, down to `depth`) and returns the chain
 * re-read after the locks. An unlocked probe only decides which rows to lock; if the re-read differs from it (a row
 * appeared or changed identity) the attempt is refused as retryable instead of proceeding on an unlocked fact.
 */
export async function lockChain(
  tx: Tx,
  organizationId: string,
  bookingId: string,
  depth: ChainDepth,
): Promise<Chain> {
  const probe = await loadChain(tx, organizationId, bookingId);
  if (!probe) throw new CorrectionError(404, 'NOT_FOUND', 'Not found');
  const reach = { booking: 1, admission: 2, checkIn: 3, checkOut: 4 }[depth];
  if (!(await lockRow(tx, organizationId, 'beds', probe.bedId)))
    throw new CorrectionError(404, 'NOT_FOUND', 'Not found');
  if (!(await lockRow(tx, organizationId, 'bookings', bookingId)))
    throw new CorrectionError(404, 'NOT_FOUND', 'Not found');
  if (reach >= 2 && probe.admissionId)
    await lockRow(tx, organizationId, 'admissions', probe.admissionId);
  if (reach >= 3 && probe.checkInId)
    await lockRow(tx, organizationId, 'check_ins', probe.checkInId);
  if (reach >= 4 && probe.checkOutId)
    await lockRow(tx, organizationId, 'check_outs', probe.checkOutId);
  const chain = await loadChain(tx, organizationId, bookingId);
  if (
    !chain ||
    chain.bedId !== probe.bedId ||
    chain.admissionId !== probe.admissionId ||
    chain.checkInId !== probe.checkInId ||
    chain.checkOutId !== probe.checkOutId
  ) {
    throw new CorrectionError(
      409,
      'RETRY_REQUIRED',
      'The records changed while they were being locked. Retry with the same Idempotency-Key.',
    );
  }
  return chain;
}

/** CheckIn -> CheckOut only (checkout `reason` corrections; no organization gate, no Bed/Booking lock). */
export async function lockCheckOutOnly(
  tx: Tx,
  organizationId: string,
  checkOutId: string,
): Promise<{
  checkInId: string;
  checkInStatus: string;
  checkOutAt: string;
  reason: string | null;
} | null> {
  const probe = await tx.$queryRaw<{ check_in_id: string }[]>(
    Prisma.sql`SELECT check_in_id FROM check_outs WHERE id = ${checkOutId}::uuid AND organization_id = ${organizationId}::uuid`,
  );
  const checkInId = probe[0]?.check_in_id;
  if (!checkInId) return null;
  await lockRow(tx, organizationId, 'check_ins', checkInId);
  await lockRow(tx, organizationId, 'check_outs', checkOutId);
  const rows = await tx.$queryRaw<
    { check_in_id: string; check_in_status: string; check_out_at: string; reason: string | null }[]
  >(
    Prisma.sql`
      SELECT o.check_in_id, c.status::text AS check_in_status, ${TS('o.check_out_at')} AS check_out_at, o.reason
      FROM check_outs o JOIN check_ins c ON c.id = o.check_in_id AND c.organization_id = o.organization_id
      WHERE o.id = ${checkOutId}::uuid AND o.organization_id = ${organizationId}::uuid`,
  );
  const r = rows[0];
  if (!r || r.check_in_id !== checkInId) {
    throw new CorrectionError(
      409,
      'RETRY_REQUIRED',
      'The records changed while they were being locked. Retry with the same Idempotency-Key.',
    );
  }
  return {
    checkInId: r.check_in_id ?? null,
    checkInStatus: r.check_in_status ?? null,
    checkOutAt: r.check_out_at ?? null,
    reason: r.reason,
  };
}

export async function invoiceSlotsFact(
  tx: Tx,
  organizationId: string,
  bookingId: string,
): Promise<string> {
  const rows = await tx.$queryRaw<{ s: string }[]>(Prisma.sql`
    -- Only facts a reviewer relied on: which slots exist, whether each is a draft, issued or voided, and its amount.
    -- A payment moving an issued invoice to PARTIALLY_PAID or PAID is settlement, not a change of the slot, so it must not
    -- stale a correction.
    SELECT id::text || ':' || CASE WHEN status = 'DRAFT' THEN 'DRAFT' WHEN status = 'CANCELLED' THEN 'CANCELLED' ELSE 'ISSUED' END
           || ':' || to_char(period_start, 'YYYY-MM-DD') || ':' || amount::text AS s
    FROM invoices WHERE booking_id = ${bookingId}::uuid AND organization_id = ${organizationId}::uuid
    ORDER BY period_start, id`);
  return rows.map((r) => r.s).join('|');
}

// ------------------------------------------------------------------------------------- envelopes and snapshots

/** Millisecond-resolution Date from canonical microsecond text; comparisons only, never written back. */
export function textToDate(text: string): Date {
  return new Date(text.replace(/\.(\d{3})\d{3}Z$/, '.$1Z'));
}

export function dayOfInstantText(text: string): string {
  return istDayKeyOf(textToDate(text));
}

/** The authoritative current value of the corrected field as a closed envelope (used as `originalValue`). */
export function currentEnvelope(
  fieldKey: FieldKey,
  resident: ResidentRow | null,
  chain: Chain | null,
): ValueEnvelope {
  switch (fieldKey) {
    case 'firstName':
      return { kind: 'text', value: resident!.firstName };
    case 'lastName':
      return { kind: 'text', value: resident!.lastName };
    case 'startDate':
      return { kind: 'date', value: dayOfInstantText(chain!.startDate) };
    case 'endDate':
      return { kind: 'date', value: dayOfInstantText(chain!.endDate) };
    case 'monthlyPrice':
      return { kind: 'money', value: chain!.monthlyPrice };
    case 'admissionDate':
      return { kind: 'date', value: dayOfInstantText(chain!.admissionDate!) };
    case 'checkInAt':
      return { kind: 'instant', value: chain!.checkInAt! };
    case 'checkOutAt':
      return { kind: 'instant', value: chain!.checkOutAt! };
    case 'reason':
      return chain!.checkOutReason === null
        ? { kind: 'null', value: null }
        : { kind: 'text', value: chain!.checkOutReason };
  }
}

/**
 * Named dependency facts for the field's group (specification 9.2). Only these are compared at approval; an unrelated
 * edit never appears here. Keys are `GROUP:fact`; the group becomes the closed `staleCause`.
 */
export function snapshotFacts(
  fieldKey: FieldKey,
  resident: ResidentRow | null,
  chain: Chain | null,
  invoiceSlots: string | null,
): SnapshotFacts {
  const f: SnapshotFacts = {};
  const spec = FIELD_SPECS[fieldKey];
  if (spec.target === 'RESIDENT') {
    f[`RESIDENT_FIELD:${fieldKey}`] =
      fieldKey === 'firstName' ? resident!.firstName : resident!.lastName;
    return f;
  }
  const c = chain!;
  if (c.assignmentSnapshot && fieldKey !== 'reason')
    f['CHECK_IN:assignmentChain'] = c.assignmentSnapshot;
  if (spec.target === 'BOOKING') {
    f['BOOKING_TERMS:startDate'] = c.startDate;
    f['BOOKING_TERMS:endDate'] = c.endDate;
    f['BOOKING_TERMS:monthlyPrice'] = c.monthlyPrice;
    f['BOOKING_TERMS:status'] = c.bookingStatus;
    f['BOOKING_TERMS:bedId'] = c.bedId;
    f['ADMISSION:id'] = c.admissionId;
    f['ADMISSION:status'] = c.admissionStatus;
    f['ADMISSION:admissionDate'] = c.admissionDate;
    f['CHECK_IN:id'] = c.checkInId;
    f['CHECK_IN:status'] = c.checkInStatus;
    f['CHECK_IN:checkInAt'] = c.checkInAt;
    f['CHECK_OUT:id'] = c.checkOutId;
    f['CHECK_OUT:checkOutAt'] = c.checkOutAt;
    f['INVOICE_SLOTS:slots'] = invoiceSlots ?? '';
  } else if (spec.target === 'ADMISSION') {
    f['ADMISSION:id'] = c.admissionId;
    f['ADMISSION:status'] = c.admissionStatus;
    f['ADMISSION:admissionDate'] = c.admissionDate;
    f['BOOKING_TERMS:startDate'] = c.startDate;
    f['BOOKING_TERMS:endDate'] = c.endDate;
    f['BOOKING_TERMS:status'] = c.bookingStatus;
    f['CHECK_IN:id'] = c.checkInId;
    f['CHECK_IN:checkInAt'] = c.checkInAt;
  } else if (fieldKey === 'checkInAt') {
    f['CHECK_IN:id'] = c.checkInId;
    f['CHECK_IN:status'] = c.checkInStatus;
    f['CHECK_IN:checkInAt'] = c.checkInAt;
    f['ADMISSION:id'] = c.admissionId;
    f['ADMISSION:status'] = c.admissionStatus;
    f['ADMISSION:admissionDate'] = c.admissionDate;
    f['CHECK_OUT:id'] = c.checkOutId;
    f['CHECK_OUT:checkOutAt'] = c.checkOutAt;
  } else if (fieldKey === 'checkOutAt') {
    f['CHECK_OUT:id'] = c.checkOutId;
    f['CHECK_OUT:checkOutAt'] = c.checkOutAt;
    f['CHECK_OUT:reason'] = c.checkOutReason;
    f['CHECK_IN:id'] = c.checkInId;
    f['CHECK_IN:status'] = c.checkInStatus;
    f['CHECK_IN:checkInAt'] = c.checkInAt;
  } else {
    // checkout reason
    f['CHECK_OUT:id'] = c.checkOutId;
    f['CHECK_OUT:reason'] = c.checkOutReason;
    f['CHECK_OUT:checkOutAt'] = c.checkOutAt;
    f['CHECK_IN:id'] = c.checkInId;
    f['CHECK_IN:status'] = c.checkInStatus;
  }
  return f;
}

/**
 * Immutable age basis stored with the proposal (specification 6): effective day, original and proposed days of a date
 * field, and the category anchor. Recomputed against the decision-time day, so a recent effectiveAt can never hide an
 * old fact. A missing required anchor fails closed.
 */
export function candidateDays(
  fieldKey: FieldKey,
  original: ValueEnvelope,
  proposed: ValueEnvelope,
  effectiveAtDay: string,
  resident: ResidentRow | null,
  chain: Chain | null,
): string[] {
  const days = [effectiveAtDay];
  const need = (text: string | null | undefined, what: string): string => {
    if (!text)
      throw new CorrectionError(
        409,
        'LIFECYCLE_CONFLICT',
        `Required history is missing (${what}); the correction cannot be aged safely`,
      );
    return dayOfInstantText(text);
  };
  switch (fieldKey) {
    case 'firstName':
    case 'lastName':
      days.push(need(resident!.createdAt, 'resident creation'));
      break;
    case 'startDate':
    case 'endDate':
      days.push(original.value!, proposed.value!, need(chain!.startDate, 'booking start'));
      break;
    case 'monthlyPrice':
      days.push(need(chain!.startDate, 'booking start'));
      break;
    case 'admissionDate':
      days.push(original.value!, proposed.value!);
      break;
    case 'checkInAt':
    case 'checkOutAt':
      days.push(dayOfInstantText(original.value!), dayOfInstantText(proposed.value!));
      break;
    case 'reason':
      days.push(need(chain!.checkOutAt, 'checkout'));
      break;
  }
  return days;
}
