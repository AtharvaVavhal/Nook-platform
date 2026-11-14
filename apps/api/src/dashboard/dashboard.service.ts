import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { roleHasPermission } from '../auth/permissions.js';
import type { AuthenticatedContext } from '../auth/auth.types.js';
import { physicalBedId } from '../common/stay-occupancy.js';
import { PrismaService } from '../database/prisma.service.js';
import { Prisma } from '../generated/client.js';
import { formatMoney, monthRangeIst, parseBillingMonth } from '../finance/finance.util.js';
import {
  DASHBOARD_LIST_CAP,
  classifyStayEnd,
  computeGates,
  dateKey,
  daysPastEnd,
  fullName,
  istDateKey,
  mergeActivity,
  summarizeInventory,
  validateDashboardRequest,
  dashboardWindows,
  type DashboardGates,
  type DashboardParams,
} from './dashboard.rules.js';
import type {
  ActivityItem,
  AdmissionItem,
  BedPlaceView,
  BookingItem,
  Bookings,
  Dashboard,
  DashboardResponse,
  DepartureItem,
  Finance,
  Money,
  PastEndStay,
  PaymentItem,
  StayEnding,
  Tenants,
  Unattributed,
  UpcomingArrival,
} from './dashboard.types.js';

/** Invoice statuses, as in the existing monthly report and outstanding queries (finance.service). */
const BILLABLE_STATUSES = ['ISSUED', 'PARTIALLY_PAID', 'OVERDUE', 'PAID'] as const;
const OPEN_STATUSES = ['ISSUED', 'PARTIALLY_PAID', 'OVERDUE'] as const;

const Decimal = Prisma.Decimal;
type Decimal = Prisma.Decimal;
const ZERO = new Decimal(0);

const bedPlace = {
  select: {
    id: true,
    label: true,
    room: { select: { label: true, floor: { select: { label: true } } } },
  },
} as const;
const residentSelect = { select: { id: true, firstName: true, lastName: true } } as const;

interface BedPlaceRow {
  id: string;
  label: string;
  room: { label: string; floor: { label: string } };
}

const place = (bed: BedPlaceRow): BedPlaceView => ({
  bedId: bed.id,
  bedLabel: bed.label,
  roomLabel: bed.room.label,
  floorLabel: bed.room.floor.label,
});

const money = (value: Decimal | null | undefined): Money => formatMoney(value ?? ZERO);
const sumOf = (value: Decimal | null | undefined): Decimal => value ?? ZERO;

export interface BuildInput {
  organizationId: string;
  propertyId: string;
  params: DashboardParams;
  gates: DashboardGates;
  now: Date;
}

@Injectable()
export class DashboardService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /** Validates the request, derives the caller's gates from the existing permission table and builds the dashboard. */
  async getDashboard(
    context: AuthenticatedContext,
    rawPropertyId: string,
    rawQuery: Record<string, unknown>,
  ): Promise<DashboardResponse> {
    const now = new Date();
    const { propertyId, params } = validateDashboardRequest(rawPropertyId, rawQuery, now);
    const gates = computeGates((permission) => roleHasPermission(context.role, permission));
    const data = await this.build({
      organizationId: context.organizationId,
      propertyId,
      params,
      gates,
      now,
    });
    return { data };
  }

  /**
   * Builds the dashboard from one RepeatableRead read transaction, so every section reads the same snapshot and the
   * figures add up. The caller's organization is the only tenant filter source; every query carries it. Takes no write
   * and no lock. `now` and `gates` are parameters so the date windows and the gating are testable.
   */
  async build(input: BuildInput): Promise<Dashboard> {
    const { organizationId, propertyId, params, gates, now } = input;
    const { access, sources } = gates;
    const windows = dashboardWindows(now, params.days);
    const period = parseBillingMonth(params.month);
    const range = monthRangeIst(period);
    const recentRange = { gte: windows.recentStart, lt: windows.recentEnd };

    const built = await this.prisma.db.$transaction(
      async (tx): Promise<Omit<Dashboard, 'asOf'> | null> => {
        const property = await tx.property.findFirst({
          where: { id: propertyId, organizationId, archivedAt: null },
          select: { id: true, code: true, name: true },
        });
        if (!property) return null;

        // ------------------------------------------------------------------ inventory
        const floors = await tx.floor.findMany({
          where: { organizationId, propertyId, archivedAt: null },
          orderBy: [{ ordinal: 'asc' }, { id: 'asc' }],
          select: { id: true, label: true, ordinal: true },
        });
        const rooms = await tx.room.count({
          where: { organizationId, propertyId, archivedAt: null, floor: { archivedAt: null } },
        });
        const beds = await tx.bed.findMany({
          where: {
            organizationId,
            propertyId,
            archivedAt: null,
            room: { archivedAt: null, floor: { archivedAt: null } },
          },
          select: {
            id: true,
            label: true,
            operationalStatus: true,
            room: { select: { label: true, floor: { select: { id: true, label: true } } } },
          },
        });
        const bedById = new Map(beds.map((bed) => [bed.id, bed]));

        // Active stays whose physical bed may be in this property. The physical bed is resolved per row with the
        // existing rule; a stay whose segments are inconsistent is counted as an anomaly instead of failing the page.
        const stayRows = await tx.checkIn.findMany({
          where: {
            organizationId,
            status: 'ACTIVE',
            checkOut: null,
            OR: [
              { bed: { propertyId } },
              {
                booking: {
                  effectiveAssignments: {
                    some: {
                      organizationId,
                      status: 'ACTIVE',
                      endAt: null,
                      bed: { propertyId },
                    },
                  },
                },
              },
            ],
          },
          select: {
            id: true,
            bookingId: true,
            residentId: true,
            bedId: true,
            checkInAt: true,
            bed: { select: { propertyId: true } },
            resident: residentSelect,
            booking: {
              select: {
                endDate: true,
                effectiveAssignments: {
                  where: { organizationId },
                  select: { bedId: true, status: true, endAt: true },
                },
              },
            },
          },
        });
        let stayNeedsReview = 0;
        const stays: Array<{
          row: (typeof stayRows)[number];
          bedId: string;
        }> = [];
        for (const row of stayRows) {
          let physical: string | null;
          try {
            physical = physicalBedId({
              bedId: row.bedId,
              booking: { effectiveAssignments: row.booking.effectiveAssignments },
            });
          } catch {
            physical = null;
          }
          if (physical === null) {
            if (row.bed.propertyId === propertyId) stayNeedsReview += 1;
            continue;
          }
          if (bedById.has(physical)) stays.push({ row, bedId: physical });
        }
        const occupiedBedIds = new Set(stays.map((stay) => stay.bedId));
        const summary = summarizeInventory(
          floors,
          beds.map((bed) => ({
            id: bed.id,
            floorId: bed.room.floor.id,
            outOfService: bed.operationalStatus === 'OUT_OF_SERVICE',
          })),
          occupiedBedIds,
        );

        const stayEnding = (stay: (typeof stays)[number]): StayEnding => {
          const bed = bedById.get(stay.bedId)!;
          return {
            checkInId: stay.row.id,
            bookingId: stay.row.bookingId,
            residentId: stay.row.residentId,
            residentName: fullName(stay.row.resident),
            bedId: bed.id,
            bedLabel: bed.label,
            roomLabel: bed.room.label,
            floorLabel: bed.room.floor.label,
            checkInAt: stay.row.checkInAt.toISOString(),
            endDate: istDateKey(stay.row.booking.endDate),
          };
        };
        const byEnd = (a: StayEnding, b: StayEnding) =>
          a.endDate.localeCompare(b.endDate) || a.checkInId.localeCompare(b.checkInId);
        const upcomingStays = stays
          .filter((stay) => classifyStayEnd(stay.row.booking.endDate, windows) === 'UPCOMING')
          .map(stayEnding)
          .sort(byEnd);
        const pastEndStays: PastEndStay[] = stays
          .filter((stay) => classifyStayEnd(stay.row.booking.endDate, windows) === 'PAST_END')
          .map((stay) => ({
            ...stayEnding(stay),
            daysPast: daysPastEnd(stay.row.booking.endDate, windows.today),
          }))
          .sort(byEnd);

        // ------------------------------------------------------------------ bookings
        const needBookings = access.bookings || access.upcomingCheckIns;
        let upcoming: { count: number; items: UpcomingArrival[]; committedBeds: number } | null =
          null;
        if (needBookings) {
          const where = {
            organizationId,
            status: 'CONFIRMED' as const,
            checkIns: { none: {} },
            startDate: { gte: windows.upcomingStart, lt: windows.upcomingEnd },
            bed: {
              propertyId,
              archivedAt: null,
              room: { archivedAt: null, floor: { archivedAt: null } },
            },
          };
          const count = await tx.booking.count({ where });
          const committed = await tx.booking.groupBy({ by: ['bedId'], where });
          const rows = await tx.booking.findMany({
            where,
            orderBy: [{ startDate: 'asc' }, { id: 'asc' }],
            take: DASHBOARD_LIST_CAP,
            select: {
              id: true,
              startDate: true,
              endDate: true,
              resident: residentSelect,
              bed: bedPlace,
              ...(sources.admission ? { admission: { select: { status: true } } } : {}),
            },
          });
          upcoming = {
            count,
            committedBeds: committed.length,
            items: rows.map((row) => ({
              bookingId: row.id,
              residentId: row.resident.id,
              residentName: fullName(row.resident),
              ...place(row.bed),
              startDate: istDateKey(row.startDate),
              endDate: istDateKey(row.endDate),
              admissionStatus: sources.admission
                ? ((row as { admission?: { status: string } | null }).admission?.status ?? 'NONE')
                : null,
            })) as UpcomingArrival[],
          };
        }

        let recentBookings: BookingItem[] | null = null;
        if (access.bookings || sources.booking) {
          const rows = await tx.booking.findMany({
            where: { organizationId, bed: { propertyId }, createdAt: recentRange },
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            take: DASHBOARD_LIST_CAP,
            select: {
              id: true,
              startDate: true,
              endDate: true,
              status: true,
              createdAt: true,
              resident: residentSelect,
              bed: bedPlace,
            },
          });
          recentBookings = rows.map((row) => ({
            bookingId: row.id,
            residentId: row.resident.id,
            residentName: fullName(row.resident),
            ...place(row.bed),
            startDate: istDateKey(row.startDate),
            endDate: istDateKey(row.endDate),
            status: row.status,
            createdAt: row.createdAt.toISOString(),
          }));
        }

        // ------------------------------------------------------------------ admissions, departures, check-ins
        let recentAdmissions: AdmissionItem[] | null = null;
        if (access.recentAdmissions) {
          const rows = await tx.admission.findMany({
            where: {
              organizationId,
              status: 'ADMITTED',
              bed: { propertyId },
              admissionDate: recentRange,
            },
            orderBy: [{ admissionDate: 'desc' }, { id: 'desc' }],
            take: DASHBOARD_LIST_CAP,
            select: {
              id: true,
              bookingId: true,
              admissionDate: true,
              resident: residentSelect,
              bed: bedPlace,
            },
          });
          recentAdmissions = rows.map((row) => ({
            admissionId: row.id,
            bookingId: row.bookingId,
            residentId: row.resident.id,
            residentName: fullName(row.resident),
            ...place(row.bed),
            admissionDate: istDateKey(row.admissionDate),
          }));
        }

        let recentDepartures: DepartureItem[] | null = null;
        if (access.tenants || sources.checkin) {
          const rows = await tx.checkOut.findMany({
            where: { organizationId, bed: { propertyId }, checkOutAt: recentRange },
            orderBy: [{ checkOutAt: 'desc' }, { id: 'desc' }],
            take: DASHBOARD_LIST_CAP,
            select: {
              id: true,
              checkInId: true,
              bookingId: true,
              checkOutAt: true,
              reason: true,
              resident: residentSelect,
              bed: bedPlace,
            },
          });
          recentDepartures = rows.map((row) => ({
            checkOutId: row.id,
            checkInId: row.checkInId,
            bookingId: row.bookingId,
            residentId: row.resident.id,
            residentName: fullName(row.resident),
            ...place(row.bed),
            checkOutAt: row.checkOutAt.toISOString(),
            reason: row.reason,
          }));
        }

        // ------------------------------------------------------------------ finance
        let finance: Finance | null = null;
        let recentPaymentRows: Array<{
          item: PaymentItem;
          bed: BedPlaceRow | null;
        }> = [];
        if (access.finance) {
          const attributed = { booking: { bed: { propertyId } } };
          const billed = {
            organizationId,
            periodStart: period.periodStart,
            status: { in: [...BILLABLE_STATUSES] },
            ...attributed,
          };
          const open = { organizationId, status: { in: [...OPEN_STATUSES] }, ...attributed };
          const billedAgg = await tx.invoice.aggregate({
            where: billed,
            _sum: { amount: true, paidAmount: true },
          });
          const openAgg = await tx.invoice.aggregate({
            where: open,
            _sum: { amount: true, paidAmount: true },
          });
          const overdueAgg = await tx.invoice.aggregate({
            where: { ...open, dueDate: { lt: windows.today } },
            _sum: { amount: true, paidAmount: true },
            _count: true,
          });
          const pendingAgg = await tx.invoice.aggregate({
            where: { ...open, dueDate: { gte: windows.today } },
            _sum: { amount: true, paidAmount: true },
            _count: true,
          });
          const collectedAgg = await tx.payment.aggregate({
            where: {
              organizationId,
              receivedAt: { gte: range.from, lt: range.to },
              reversals: { none: {} },
              invoice: attributed,
            },
            _sum: { amount: true },
          });
          const payments = await tx.payment.findMany({
            where: { organizationId, receivedAt: recentRange, invoice: attributed },
            orderBy: [{ receivedAt: 'desc' }, { id: 'desc' }],
            take: DASHBOARD_LIST_CAP,
            select: {
              id: true,
              amount: true,
              method: true,
              receivedAt: true,
              resident: residentSelect,
              reversals: { select: { id: true }, take: 1 },
              invoice: {
                select: { id: true, number: true, booking: { select: { bed: bedPlace } } },
              },
            },
          });
          recentPaymentRows = payments.map((row) => ({
            item: {
              paymentId: row.id,
              invoiceId: row.invoice.id,
              invoiceNumber: row.invoice.number,
              residentId: row.resident.id,
              residentName: fullName(row.resident),
              amount: money(row.amount),
              method: row.method,
              receivedAt: row.receivedAt.toISOString(),
              reversed: row.reversals.length > 0,
            },
            bed: row.invoice.booking?.bed ?? null,
          }));

          // Organization-level: invoices with no booking (and their payments) cannot be attributed to a property.
          const noBooking = { bookingId: null };
          const uBilled = await tx.invoice.aggregate({
            where: {
              organizationId,
              periodStart: period.periodStart,
              status: { in: [...BILLABLE_STATUSES] },
              ...noBooking,
            },
            _sum: { amount: true },
          });
          const uOpen = await tx.invoice.aggregate({
            where: { organizationId, status: { in: [...OPEN_STATUSES] }, ...noBooking },
            _sum: { amount: true, paidAmount: true },
            _count: true,
          });
          const uOverdue = await tx.invoice.aggregate({
            where: {
              organizationId,
              status: { in: [...OPEN_STATUSES] },
              dueDate: { lt: windows.today },
              ...noBooking,
            },
            _sum: { amount: true, paidAmount: true },
          });
          const uCollected = await tx.payment.aggregate({
            where: {
              organizationId,
              receivedAt: { gte: range.from, lt: range.to },
              reversals: { none: {} },
              invoice: noBooking,
            },
            _sum: { amount: true },
          });
          const unattributedFigures = {
            count: uOpen._count,
            invoiced: sumOf(uBilled._sum.amount),
            collected: sumOf(uCollected._sum.amount),
            outstanding: sumOf(uOpen._sum.amount).minus(sumOf(uOpen._sum.paidAmount)),
            overdue: sumOf(uOverdue._sum.amount).minus(sumOf(uOverdue._sum.paidAmount)),
          };
          const unattributed: Unattributed | null =
            unattributedFigures.count > 0 ||
            !unattributedFigures.invoiced.isZero() ||
            !unattributedFigures.collected.isZero() ||
            !unattributedFigures.outstanding.isZero() ||
            !unattributedFigures.overdue.isZero()
              ? {
                  count: unattributedFigures.count,
                  invoiced: money(unattributedFigures.invoiced),
                  collected: money(unattributedFigures.collected),
                  outstanding: money(unattributedFigures.outstanding),
                  overdue: money(unattributedFigures.overdue),
                }
              : null;

          const balance = (sum: { amount: Decimal | null; paidAmount: Decimal | null }) =>
            sumOf(sum.amount).minus(sumOf(sum.paidAmount));
          finance = {
            invoiced: money(billedAgg._sum.amount),
            collected: money(collectedAgg._sum.amount),
            monthUnpaid: money(balance(billedAgg._sum)),
            outstanding: money(balance(openAgg._sum)),
            overdue: { count: overdueAgg._count, amount: money(balance(overdueAgg._sum)) },
            pendingPayments: { count: pendingAgg._count, amount: money(balance(pendingAgg._sum)) },
            recentPayments: recentPaymentRows.map((row) => row.item),
            unattributed,
          };
        }

        // ------------------------------------------------------------------ activity (recorded events only)
        let activity: ActivityItem[] | null = null;
        if (access.activity) {
          const events: ActivityItem[] = [];
          if (sources.booking && recentBookings) {
            for (const booking of recentBookings) {
              events.push({
                kind: 'booking_created',
                occurredAt: booking.createdAt,
                timeBasis: 'RECORD_CREATED',
                refId: booking.bookingId,
                residentId: booking.residentId,
                residentName: booking.residentName,
                bedId: booking.bedId,
                bedLabel: booking.bedLabel,
                roomLabel: booking.roomLabel,
                amount: null,
                reversed: null,
              });
            }
          }
          if (sources.admission) {
            const rows = await tx.admission.findMany({
              where: { organizationId, bed: { propertyId }, createdAt: recentRange },
              orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
              take: DASHBOARD_LIST_CAP,
              select: { id: true, createdAt: true, resident: residentSelect, bed: bedPlace },
            });
            for (const row of rows) {
              events.push({
                kind: 'admission_recorded',
                occurredAt: row.createdAt.toISOString(),
                timeBasis: 'RECORD_CREATED',
                refId: row.id,
                residentId: row.resident.id,
                residentName: fullName(row.resident),
                bedId: row.bed.id,
                bedLabel: row.bed.label,
                roomLabel: row.bed.room.label,
                amount: null,
                reversed: null,
              });
            }
          }
          if (sources.checkin) {
            const rows = await tx.checkIn.findMany({
              where: { organizationId, bed: { propertyId }, checkInAt: recentRange },
              orderBy: [{ checkInAt: 'desc' }, { id: 'desc' }],
              take: DASHBOARD_LIST_CAP,
              select: { id: true, checkInAt: true, resident: residentSelect, bed: bedPlace },
            });
            for (const row of rows) {
              events.push({
                kind: 'check_in',
                occurredAt: row.checkInAt.toISOString(),
                timeBasis: 'EVENT',
                refId: row.id,
                residentId: row.resident.id,
                residentName: fullName(row.resident),
                bedId: row.bed.id,
                bedLabel: row.bed.label,
                roomLabel: row.bed.room.label,
                amount: null,
                reversed: null,
              });
            }
            for (const departure of recentDepartures ?? []) {
              events.push({
                kind: 'check_out',
                occurredAt: departure.checkOutAt,
                timeBasis: 'EVENT',
                refId: departure.checkOutId,
                residentId: departure.residentId,
                residentName: departure.residentName,
                bedId: departure.bedId,
                bedLabel: departure.bedLabel,
                roomLabel: departure.roomLabel,
                amount: null,
                reversed: null,
              });
            }
          }
          if (sources.finance) {
            for (const { item, bed } of recentPaymentRows) {
              events.push({
                kind: 'payment_received',
                occurredAt: item.receivedAt,
                timeBasis: 'EVENT',
                refId: item.paymentId,
                residentId: item.residentId,
                residentName: item.residentName,
                bedId: bed?.id ?? null,
                bedLabel: bed?.label ?? null,
                roomLabel: bed?.room.label ?? null,
                amount: item.amount,
                reversed: item.reversed,
              });
            }
          }
          activity = mergeActivity(events);
        }

        // ------------------------------------------------------------------ assemble
        const tenants: Tenants | null = access.tenants
          ? {
              activeTenants: new Set(stays.map((stay) => stay.row.residentId)).size,
              upcomingCheckIns:
                access.upcomingCheckIns && upcoming
                  ? { count: upcoming.count, items: upcoming.items }
                  : null,
              upcomingCheckOuts: {
                count: upcomingStays.length,
                items: upcomingStays.slice(0, DASHBOARD_LIST_CAP),
              },
              pastEndDate: {
                count: pastEndStays.length,
                items: pastEndStays.slice(0, DASHBOARD_LIST_CAP),
              },
              recentAdmissions: access.recentAdmissions ? recentAdmissions : null,
              recentDepartures: recentDepartures ?? [],
            }
          : null;
        const bookings: Bookings | null =
          access.bookings && upcoming && recentBookings
            ? {
                confirmedUpcoming: { count: upcoming.count, items: upcoming.items },
                committedBeds: upcoming.committedBeds,
                recent: recentBookings,
              }
            : null;

        return {
          property,
          today: dateKey(windows.today),
          month: params.month,
          days: params.days,
          windows: {
            upcoming: {
              from: dateKey(windows.upcomingFrom),
              toExclusive: dateKey(windows.upcomingToExclusive),
            },
            recent: { from: dateKey(windows.recentFrom), to: dateKey(windows.recentTo) },
          },
          access,
          inventory: {
            rooms,
            beds: summary.beds,
            occupiedBeds: summary.occupiedBeds,
            availableBeds: summary.availableBeds,
            outOfServiceBeds: summary.outOfServiceBeds,
            occupancyPercent: summary.occupancyPercent,
            byFloor: summary.byFloor,
            anomalies: { occupiedOutOfService: summary.occupiedOutOfService, stayNeedsReview },
          },
          tenants,
          bookings,
          finance,
          activity,
        };
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
        maxWait: 5_000,
        timeout: 15_000,
      },
    );
    if (!built) throw new NotFoundException({ code: 'NOT_FOUND' });
    return { asOf: now.toISOString(), ...built };
  }
}
