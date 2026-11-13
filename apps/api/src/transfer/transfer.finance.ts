import { istDateOf, istStartOfDay } from '../common/time.js';
import { Prisma } from '../generated/client.js';

/** Advisory only: transfers preserve the booking's commercial terms and never prorate rent. */
export function transferFinancePreview(input: {
  effectiveAt: Date;
  monthlyPrice: Prisma.Decimal;
  sourcePrice: Prisma.Decimal;
  destinationPrice: Prisma.Decimal;
}) {
  const day = istDateOf(input.effectiveAt);
  const periodStart = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), 1));
  const midMonth = input.effectiveAt.getTime() > istStartOfDay(periodStart).getTime();
  return {
    monthlyPrice: input.monthlyPrice.toFixed(2),
    sourceReferencePrice: input.sourcePrice.toFixed(2),
    destinationReferencePrice: input.destinationPrice.toFixed(2),
    referencePriceDifference: input.destinationPrice.minus(input.sourcePrice).toFixed(2),
    rentUnchanged: true as const,
    proration: false as const,
    issuedInvoicesUnchanged: true as const,
    reviewRequired: midMonth,
    reviewPeriod: midMonth ? periodStart.toISOString().slice(0, 10) : null,
    reviewSupported: false as const,
    reviewBlocker: 'TRANSFER_FINANCE_LINK_CONTRACT' as const,
  };
}
