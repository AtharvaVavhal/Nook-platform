#!/usr/bin/env node
/** Retry-safe backfill preparation. Running it does not authorize assignment rollout. */
import console from 'node:console';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { backfillHistoryIssue, backfillAssignmentIssue } from './stay-assignment-backfill-rules.mjs';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../apps/api/src/generated/client.js';
import { loadRuntimeConfig } from '../apps/api/src/config.js';
import { acquireOrgGate, ORDINARY_TX_OPTIONS } from '../apps/api/src/common/org-gate.ts';
import { sqlStates } from '../apps/api/src/common/tx-errors.ts';

/** An injected client is used only by focused tests; ordinary CLI calls resolve the configured database lazily. */
export async function backfillStayAssignments(dryRun = false, client) {
  let owned;
  if (!client) {
    const databaseUrl = loadRuntimeConfig().databaseUrl;
    if (!databaseUrl) throw new Error('DATABASE_URL is required for backfill script.');
    owned = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
    client = owned;
  }
  let totalCreated = 0, totalSkipped = 0;
  const quarantined = [];
  try {
    console.log(`Starting StayAssignment backfill (${dryRun ? 'DRY RUN' : 'LIVE'}; rollout remains disabled)`);
    const organizations = await client.organization.findMany({ select: { id: true }, orderBy: { id: 'asc' } });
    for (const org of organizations) {
      // Enumerate identities only. State is loaded again inside the transaction, never trusted from this probe.
      const bookings = await client.booking.findMany({ where: { organizationId: org.id }, select: { id: true }, orderBy: { id: 'asc' } });
      for (const { id } of bookings) {
        let outcome;
        try {
          outcome = await client.$transaction(async tx => {
            if (dryRun) await tx.$executeRaw`SET TRANSACTION READ ONLY`;
            else {
              await acquireOrgGate(tx, org.id);
              await tx.$queryRaw`SELECT id FROM bookings WHERE id = ${id}::uuid AND organization_id = ${org.id}::uuid FOR UPDATE`;
              await tx.$queryRaw`SELECT id FROM check_ins WHERE booking_id = ${id}::uuid AND organization_id = ${org.id}::uuid ORDER BY id FOR UPDATE`;
              await tx.$queryRaw`SELECT id FROM check_outs WHERE booking_id = ${id}::uuid AND organization_id = ${org.id}::uuid ORDER BY id FOR UPDATE`;
            }
            const booking = await tx.booking.findFirst({ where: { id, organizationId: org.id }, include: {
              checkIns: { include: { checkOut: true }, orderBy: { checkInAt: 'asc' } },
              effectiveAssignments: true,
              stayAssignments: { orderBy: [{ startAt: 'asc' }, { id: 'asc' }], include: { transfer: { select: { organizationId: true, bookingId: true, residentId: true, sourceBedId: true, destinationBedId: true, effectiveAt: true } } } },
            } });
            if (!booking) return { kind: 'skip' };
            const issue = backfillHistoryIssue(booking) || backfillAssignmentIssue(booking, booking.effectiveAssignments.map(segment => ({ ...booking.stayAssignments.find(base => base.id === segment.id), ...segment })));
            if (issue) return { kind: 'quarantine', issue };
            if (!booking.checkIns.length || booking.stayAssignments.length) return { kind: 'skip' };
            const stay = booking.checkIns[0];
            // Compare original DB instants, preserving PostgreSQL microsecond precision. Quarantine all
            // ambiguous overlapping legacy histories rather than picking a winner by iteration order.
            const collisions = await tx.$queryRaw`
              SELECT s.id FROM effective_stay_assignments s
              JOIN check_ins candidate ON candidate.id = ${stay.id}::uuid AND candidate.organization_id = ${org.id}::uuid
              LEFT JOIN check_outs co ON co.check_in_id = candidate.id AND co.organization_id = candidate.organization_id
              WHERE s.organization_id = ${org.id}::uuid AND s.bed_id = candidate.bed_id
                AND s.start_at < COALESCE(co.check_out_at, 'infinity'::timestamptz)
                AND COALESCE(s.end_at, 'infinity'::timestamptz) > candidate.check_in_at
              UNION ALL
              SELECT other.id FROM check_ins other
              JOIN check_ins candidate ON candidate.id = ${stay.id}::uuid AND candidate.organization_id = ${org.id}::uuid
              LEFT JOIN check_outs co ON co.check_in_id = candidate.id AND co.organization_id = candidate.organization_id
              LEFT JOIN check_outs oo ON oo.check_in_id = other.id AND oo.organization_id = other.organization_id
              WHERE other.organization_id = ${org.id}::uuid AND other.bed_id = candidate.bed_id
                AND other.booking_id <> candidate.booking_id
                AND NOT EXISTS (SELECT 1 FROM stay_assignments a WHERE a.organization_id = other.organization_id AND a.booking_id = other.booking_id)
                AND other.check_in_at < COALESCE(co.check_out_at, 'infinity'::timestamptz)
                AND COALESCE(oo.check_out_at, 'infinity'::timestamptz) > candidate.check_in_at
              LIMIT 1`;
            if (collisions.length) return { kind: 'quarantine', issue: 'OVERLAPPING_STAY_HISTORY' };
            if (!dryRun) {
              // INSERT SELECT avoids truncating legacy timestamp precision through JavaScript Date.
              const inserted = await tx.$executeRaw`
                INSERT INTO stay_assignments (organization_id, booking_id, resident_id, bed_id, kind, status, start_at, end_at)
                SELECT c.organization_id, c.booking_id, c.resident_id, c.bed_id, 'ORIGINAL'::"StayAssignmentKind",
                  CASE WHEN c.status = 'ACTIVE' THEN 'ACTIVE'::"StayAssignmentStatus" ELSE 'COMPLETED'::"StayAssignmentStatus" END,
                  c.check_in_at, o.check_out_at
                FROM check_ins c LEFT JOIN check_outs o ON o.check_in_id = c.id AND o.organization_id = c.organization_id
                WHERE c.id = ${stay.id}::uuid AND c.organization_id = ${org.id}::uuid`;
              if (inserted !== 1) throw new Error('Backfill source changed before insertion');
            }
            return { kind: 'create' };
          }, { ...ORDINARY_TX_OPTIONS, ...(dryRun ? { isolationLevel: 'RepeatableRead' } : {}) });
        } catch (error) {
          // A direct writer outside the gate is still stopped by the existing unique/exclusion constraints.
          if (error?.code === 'P2002' || sqlStates(error).some(code => ['23505', '23P01'].includes(code))) {
            outcome = { kind: 'quarantine', issue: 'ASSIGNMENT_CONSTRAINT_CONFLICT' };
          } else throw error;
        }
        if (outcome.kind === 'create') totalCreated++;
        else if (outcome.kind === 'skip') totalSkipped++;
        else quarantined.push({ type: outcome.issue, organizationId: org.id, bookingId: id,
          message: 'Legacy stay history requires owner review' });
      }
    }
    console.log(`Total created: ${totalCreated}\nTotal skipped: ${totalSkipped}\nQuarantined: ${quarantined.length}`);
    for (const item of quarantined) console.log(`[QUARANTINE] org=${item.organizationId} booking=${item.bookingId} ${item.type}`);
    console.log(dryRun ? 'DRY RUN COMPLETE - No changes made' : 'BACKFILL COMPLETE - Rollout remains disabled');
    return { totalCreated, totalSkipped, quarantined };
  } finally { await owned?.$disconnect(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { await backfillStayAssignments(process.argv.includes('--dry-run')); }
  catch { console.error('Backfill failed; no rollout enabled. Database error details withheld.'); process.exitCode = 1; }
}
