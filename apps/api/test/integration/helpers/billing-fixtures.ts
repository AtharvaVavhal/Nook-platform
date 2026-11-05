import { randomUUID } from 'node:crypto';
import { withMigratorClient } from './db.js';

/** Organizations, users and stays for billing tests that call services directly (no HTTP, no login). */
export interface BillingOrg {
  orgId: string;
  userId: string;
  propertyId: string;
  roomId: string;
}

export async function seedBillingOrg(
  status: 'ACTIVE' | 'DISABLED' = 'ACTIVE',
): Promise<BillingOrg> {
  const org: BillingOrg = {
    orgId: randomUUID(),
    userId: randomUUID(),
    propertyId: randomUUID(),
    roomId: randomUUID(),
  };
  const floorId = randomUUID();
  await withMigratorClient(async (c) => {
    await c.query('BEGIN');
    await c.query(
      `INSERT INTO organizations (id, name, status, updated_at) VALUES ($1, $2, $3::"OrganizationStatus", now())`,
      [org.orgId, `Billing Test Org ${org.orgId.slice(0, 8)}`, status],
    );
    await c.query(
      `INSERT INTO users (id, login_identifier, password_hash, display_name, updated_at) VALUES ($1,$2,'not-a-real-hash','Billing Tester',now())`,
      [org.userId, `bill-${org.userId}@nook.test.invalid`],
    );
    await c.query(
      `INSERT INTO memberships (id, organization_id, user_id, role, status) VALUES ($1,$2,$3,'OWNER','ACTIVE')`,
      [randomUUID(), org.orgId, org.userId],
    );
    await c.query(
      `INSERT INTO properties (id, organization_id, code, name, updated_at) VALUES ($1,$2,$3,'P',now())`,
      [org.propertyId, org.orgId, `P-${org.propertyId.slice(0, 8)}`],
    );
    await c.query(
      `INSERT INTO floors (id, organization_id, property_id, label, ordinal, updated_at) VALUES ($1,$2,$3,'F',0,now())`,
      [floorId, org.orgId, org.propertyId],
    );
    await c.query(
      `INSERT INTO rooms (id, organization_id, property_id, floor_id, label, updated_at) VALUES ($1,$2,$3,$4,'R',now())`,
      [org.roomId, org.orgId, org.propertyId, floorId],
    );
    await c.query('COMMIT');
  });
  return org;
}

export interface StayOptions {
  residentId?: string;
  name?: string;
  price: string;
  checkInAt: Date;
  /** Defaults to the check-in time. */
  bookingStart?: Date;
  /** Exclusive end. Defaults to a year after check-in. */
  bookingEnd?: Date;
  checkedOutAt?: Date;
}

/** A resident (new unless given) with a booking, an admitted admission and a check-in on a new bed. */
export async function seedStay(org: BillingOrg, opts: StayOptions) {
  const ids = {
    resident: opts.residentId ?? randomUUID(),
    bed: randomUUID(),
    booking: randomUUID(),
    admission: randomUUID(),
    checkIn: randomUUID(),
  };
  const start = opts.bookingStart ?? opts.checkInAt;
  const end = opts.bookingEnd ?? new Date(opts.checkInAt.getTime() + 365 * 86_400_000);
  await withMigratorClient(async (c) => {
    await c.query('BEGIN');
    if (!opts.residentId) {
      await c.query(
        `INSERT INTO residents (id, organization_id, first_name, last_name, status, updated_at) VALUES ($1,$2,$3,'Resident','ACTIVE',now())`,
        [ids.resident, org.orgId, opts.name ?? `Res${ids.resident.slice(0, 6)}`],
      );
    }
    await c.query(
      `INSERT INTO beds (id, organization_id, property_id, room_id, label, updated_at) VALUES ($1,$2,$3,$4,$5,now())`,
      [ids.bed, org.orgId, org.propertyId, org.roomId, `B-${ids.bed.slice(0, 8)}`],
    );
    await c.query(
      `INSERT INTO bookings (id, organization_id, resident_id, bed_id, start_date, end_date, monthly_price, status, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'CONFIRMED',now())`,
      [ids.booking, org.orgId, ids.resident, ids.bed, start, end, opts.price],
    );
    await c.query(
      `INSERT INTO admissions (id, organization_id, booking_id, resident_id, bed_id, admission_date, status, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,'ADMITTED',now())`,
      [ids.admission, org.orgId, ids.booking, ids.resident, ids.bed, opts.checkInAt],
    );
    await c.query(
      `INSERT INTO check_ins (id, organization_id, admission_id, resident_id, bed_id, booking_id, check_in_at, status, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,now())`,
      [
        ids.checkIn,
        org.orgId,
        ids.admission,
        ids.resident,
        ids.bed,
        ids.booking,
        opts.checkInAt,
        opts.checkedOutAt ? 'CHECKED_OUT' : 'ACTIVE',
      ],
    );
    if (opts.checkedOutAt) {
      await c.query(
        `INSERT INTO check_outs (id, organization_id, check_in_id, resident_id, bed_id, booking_id, check_out_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,now())`,
        [
          randomUUID(),
          org.orgId,
          ids.checkIn,
          ids.resident,
          ids.bed,
          ids.booking,
          opts.checkedOutAt,
        ],
      );
    }
    await c.query('COMMIT');
  });
  return ids;
}
