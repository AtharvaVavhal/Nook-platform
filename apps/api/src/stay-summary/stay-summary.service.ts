import { Injectable, NotFoundException, Inject, ConflictException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import { Prisma } from '../generated/client.js';
import { istDateOf, todayIst } from '../common/time.js';
import { FinanceService } from '../finance/finance.service.js';

interface CheckInWithRelations {
  id: string;
  checkInAt: Date;
  status: string;
  bedId: string;
  bookingId: string;
  admissionId: string;
  bed: {
    label: string;
    room: {
      label: string;
      floor: { property: { name: string } };
    };
  };
  booking: {
    id: string;
    startDate: Date;
    endDate: Date;
    monthlyPrice: Prisma.Decimal;
    status: string;
    paymentStatus: string;
    bed: {
      label: string;
      room: {
        label: string;
        floor: { property: { name: string } };
      };
    };
    admission: {
      id: string;
      admissionDate: Date;
      status: string;
      property: { name: string } | null;
      room: { label: string } | null;
    } | null;
    admissionId: string;
    effectiveAssignments?: {
      id: string;
      bedId: string;
      status: string;
      endAt: Date | null;
      startAt: Date;
      bed: CheckInWithRelations['bed'];
    }[];
  } | null;
  admission: {
    id: string;
    admissionDate: Date;
    status: string;
    property: { name: string } | null;
    room: { label: string } | null;
  } | null;
}

interface BookingWithRelations {
  id: string;
  startDate: Date;
  endDate: Date;
  monthlyPrice: Prisma.Decimal;
  status: string;
  paymentStatus: string;
  bedId: string;
  bed: {
    label: string;
    room: {
      label: string;
      floor: { property: { name: string } };
    };
  };
  admission: {
    id: string;
    admissionDate: Date;
    status: string;
    property: { name: string } | null;
    room: { label: string } | null;
  } | null;
}

/** One approved booking extension, read from the append-only `booking.extended` audit events. */
export interface StaySummaryExtension {
  id: string;
  approvedAt: string;
  approvedByUserId: string | null;
  approvedBy: string | null;
  previousEndDate: string | null;
  newEndDate: string | null;
  reason: string | null;
}

export interface StaySummaryCurrentStay {
  booking: {
    id: string;
    bedId: string;
    bedLabel: string;
    roomLabel: string;
    propertyName: string;
    startDate: string;
    endDate: string;
    monthlyPrice: string;
    status: string;
    paymentStatus: string;
    extensions: StaySummaryExtension[];
  };
  admission: {
    id: string;
    admissionDate: string;
    status: string;
    propertyName: string | null;
    roomLabel: string | null;
  } | null;
  activeCheckIn: {
    id: string;
    checkInAt: string;
    bedId: string;
    bedLabel: string;
    roomLabel: string;
    isOverstay: boolean;
    bookingEndDate: string;
  };
  status: 'ACTIVE';
}

@Injectable()
export class StaySummaryService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(FinanceService) private readonly financeService: FinanceService,
  ) {}

  /** Approved extensions of one booking, oldest first (the same source BookingService.extensionHistory reads). */
  private async extensionsOf(
    tx: Prisma.TransactionClient,
    organizationId: string,
    bookingId: string,
  ): Promise<StaySummaryExtension[]> {
    const events = await tx.auditEvent.findMany({
      where: {
        organizationId,
        targetType: 'booking',
        targetId: bookingId,
        action: 'booking.extended',
      },
      orderBy: { occurredAt: 'asc' },
      include: { actor: { select: { displayName: true } } },
    });
    return events.map((event) => {
      const meta = (event.metadata ?? {}) as Record<string, unknown>;
      const text = (value: unknown) => (typeof value === 'string' ? value : null);
      return {
        id: event.id,
        approvedAt: event.occurredAt.toISOString(),
        approvedByUserId: event.actorUserId,
        approvedBy: event.actor?.displayName ?? null,
        previousEndDate: text(meta.previousEndDate),
        newEndDate: text(meta.newEndDate),
        reason: text(meta.reason),
      };
    });
  }

  async getStaySummary(organizationId: string, residentId: string) {
    return this.prisma.db.$transaction(
      async (tx) => {
        // 1. Find the resident
        const resident = await tx.resident.findFirst({
          where: { id: residentId, organizationId },
          select: {
            id: true,
            firstName: true,
            lastName: true,
            phone: true,
            email: true,
            status: true,
          },
        });
        if (!resident) {
          throw new NotFoundException('Resident not found');
        }

        // 2. Find active check-ins for this resident
        const activeCheckIns = (await tx.checkIn.findMany({
          where: {
            residentId,
            organizationId,
            status: 'ACTIVE',
            checkOut: null,
          },
          include: {
            booking: {
              include: {
                effectiveAssignments: {
                  where: { organizationId },
                  include: {
                    bed: {
                      include: { room: { include: { floor: { include: { property: true } } } } },
                    },
                  },
                },
                bed: {
                  include: {
                    room: {
                      include: {
                        floor: { include: { property: { select: { name: true } } } },
                      },
                    },
                  },
                },
              },
            },
            bed: { include: { room: { select: { label: true } } } },
            admission: {
              include: {
                property: { select: { name: true } },
                room: { select: { label: true } },
              },
            },
          } satisfies Prisma.CheckInInclude,
        })) as unknown as CheckInWithRelations[];

        // 2a-2c. Determine current stay based on active check-ins
        let currentStay: StaySummaryCurrentStay | null = null;
        let currentStayStatus: 'ACTIVE' | 'NO_ACTIVE_STAY' | 'INCONSISTENT_ACTIVE_CHECK_INS' =
          'NO_ACTIVE_STAY';

        if (activeCheckIns.length === 1) {
          const checkIn = activeCheckIns[0]!;
          const booking = checkIn.booking!;
          const admission = checkIn.admission;
          const segments = booking.effectiveAssignments ?? [];
          const active = segments.filter(
            (segment) => segment.status === 'ACTIVE' && segment.endAt === null,
          );
          if (segments.length && active.length !== 1)
            throw new ConflictException('Active stay assignment requires review');
          const physical = active[0];
          const currentBed = physical?.bed ?? checkIn.bed;
          const currentBedId = physical?.bedId ?? checkIn.bedId;
          const now = new Date();
          const isOverstay = istDateOf(booking.endDate).getTime() <= istDateOf(now).getTime();

          currentStay = {
            booking: {
              id: booking.id,
              bedId: currentBedId,
              bedLabel: currentBed?.label ?? '',
              roomLabel: currentBed?.room?.label ?? '',
              propertyName:
                currentBed?.room?.floor?.property?.name ??
                booking.bed?.room?.floor?.property?.name ??
                '',
              startDate: booking.startDate.toISOString(),
              endDate: booking.endDate.toISOString(),
              monthlyPrice: booking.monthlyPrice.toString(),
              status: booking.status,
              paymentStatus: booking.paymentStatus,
              extensions: await this.extensionsOf(tx, organizationId, booking.id),
            },
            admission: admission
              ? {
                  id: admission.id,
                  admissionDate: admission.admissionDate.toISOString(),
                  status: admission.status,
                  propertyName: admission.property?.name ?? null,
                  roomLabel: admission.room?.label ?? null,
                }
              : null,
            activeCheckIn: {
              id: checkIn.id,
              checkInAt: checkIn.checkInAt.toISOString(),
              bedId: currentBedId,
              bedLabel: currentBed?.label ?? '',
              roomLabel: currentBed?.room?.label ?? '',
              isOverstay,
              bookingEndDate: booking.endDate.toISOString(),
            },
            status: 'ACTIVE',
          };
          currentStayStatus = 'ACTIVE';
        } else if (activeCheckIns.length > 1) {
          currentStay = null;
          currentStayStatus = 'INCONSISTENT_ACTIVE_CHECK_INS';
        }

        // 3. Find upcoming bookings (excluding the one linked to active check-in)
        const activeBookingId = activeCheckIns[0]?.booking?.id;
        const allBookings = (await tx.booking.findMany({
          where: {
            residentId,
            organizationId,
            status: 'CONFIRMED',
            ...(activeBookingId ? { id: { not: activeBookingId } } : {}),
          },
          include: {
            bed: {
              include: {
                room: {
                  include: {
                    floor: { include: { property: { select: { name: true } } } },
                  },
                },
              },
            },
            admission: {
              include: {
                property: { select: { name: true } },
                room: { select: { label: true } },
              },
            },
          } satisfies Prisma.BookingInclude,
          orderBy: { startDate: 'asc' },
        })) as unknown as BookingWithRelations[];

        // Classify upcoming bookings
        const today = todayIst();
        const upcomingBookings = await Promise.all(
          allBookings.map(async (booking) => {
            const admission = booking.admission;
            let classification:
              | 'FUTURE_NO_ADMISSION'
              | 'ADMISSION_PENDING'
              | 'ADMITTED_AWAITING_CHECKIN'
              | 'START_DATE_PASSED_NO_CHECKIN'
              | 'HISTORICAL' = 'HISTORICAL';

            const bookingEndIst = istDateOf(booking.endDate);
            const bookingStartIst = istDateOf(booking.startDate);
            const todayIstDate = istDateOf(today);

            // The end date is exclusive (the first day the bed is no longer booked), so on the end day the booking is already history.
            if (bookingEndIst.getTime() <= todayIstDate.getTime()) {
              classification = 'HISTORICAL';
            } else if (bookingStartIst.getTime() > todayIstDate.getTime()) {
              if (!admission) {
                classification = 'FUTURE_NO_ADMISSION';
              } else if (admission.status === 'PENDING') {
                classification = 'ADMISSION_PENDING';
              } else if (admission.status === 'ADMITTED') {
                classification = 'ADMITTED_AWAITING_CHECKIN';
              }
            } else {
              // Start date has passed
              if (!admission) {
                classification = 'START_DATE_PASSED_NO_CHECKIN';
              } else if (admission.status === 'PENDING') {
                classification = 'ADMISSION_PENDING';
              } else if (admission.status === 'ADMITTED') {
                classification = 'ADMITTED_AWAITING_CHECKIN';
              }
            }

            return {
              booking: {
                id: booking.id,
                bedId: booking.bedId,
                bedLabel: booking.bed?.label ?? '',
                roomLabel: booking.bed?.room?.label ?? '',
                propertyName: booking.bed?.room?.floor?.property?.name ?? '',
                startDate: booking.startDate.toISOString(),
                endDate: booking.endDate.toISOString(),
                monthlyPrice: booking.monthlyPrice.toString(),
                status: booking.status,
                paymentStatus: booking.paymentStatus,
                extensions: await this.extensionsOf(tx, organizationId, booking.id),
              },
              admission: admission
                ? {
                    id: admission.id,
                    admissionDate: admission.admissionDate.toISOString(),
                    status: admission.status,
                    propertyName: admission.property?.name ?? null,
                    roomLabel: admission.room?.label ?? null,
                  }
                : null,
              classification,
              note: null,
            };
          }),
        );

        // 4. Find last check-out (if no active stay)
        let lastCheckOut: {
          id: string;
          checkOutAt: string;
          reason: string | null;
          notes: string | null;
          bookingId: string;
          bedId: string;
        } | null = null;
        if (currentStayStatus !== 'ACTIVE') {
          const checkOut = await tx.checkOut.findFirst({
            where: {
              residentId,
              organizationId,
            },
            include: {
              booking: { select: { id: true } },
              bed: { select: { id: true } },
            },
            orderBy: { checkOutAt: 'desc' },
          });

          if (checkOut) {
            lastCheckOut = {
              id: checkOut.id,
              checkOutAt: checkOut.checkOutAt.toISOString(),
              reason: checkOut.reason ?? null,
              notes: checkOut.notes ?? null,
              bookingId: checkOut.bookingId,
              bedId: checkOut.bedId,
            };
          }
        }

        // 5. Get finance balance using FinanceService
        const financeBalance = await this.financeService.outstanding(
          organizationId,
          { residentId },
          tx,
        );

        return {
          resident: {
            id: resident.id,
            firstName: resident.firstName,
            lastName: resident.lastName,
            phone: resident.phone ?? null,
            email: resident.email ?? null,
            status: resident.status,
          },
          currentStay,
          currentStayStatus,
          allowedActions: currentStayStatus === 'ACTIVE' ? ['transferPreview'] : [],
          upcomingBookings,
          lastCheckOut,
          financeBalance,
        };
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
      },
    );
  }
}
