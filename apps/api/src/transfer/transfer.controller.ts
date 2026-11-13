import { TransferFinanceService } from './transfer-finance.service.js';
import {
  Controller,
  Get,
  Post,
  Body,
  Headers,
  Query,
  Param,
  BadRequestException,
  Req,
  UseGuards,
  Inject,
  Optional,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiQuery, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { TransferService, TransferPreviewResult } from './transfer.service.js';
import { SessionGuard, RoleGuard, CsrfGuard, OriginGuard } from '../auth/auth.guards.js';
import type { AuthenticatedRequest } from '../auth/auth.types.js';
import { requireObject, requiredText } from '../common/input.js';
import { requireUuid } from '../common/ids.js';
import { resolveInstant } from '../common/time.js';
import { RequirePermission } from '../auth/permissions.js';

interface PreviewQueryDto {
  destinationBedId: string;
  residentId: string;
  effectiveAt?: string;
}

@ApiTags('Transfers')
@ApiBearerAuth()
@Controller('transfers')
@UseGuards(SessionGuard, RoleGuard)
export class TransferController {
  constructor(
    @Inject(TransferService) private readonly transferService: TransferService,
    @Optional() @Inject(TransferFinanceService) private readonly finance?: TransferFinanceService,
  ) {}

  @RequirePermission('transfer.finance')
  @Get('finance-reviews')
  financeReviews(@Req() req: AuthenticatedRequest, @Query() query: Record<string, unknown>) {
    return this.finance!.list(req.auth!.organizationId, req.auth!.userId, query);
  }

  @RequirePermission('transfer.finance')
  @Post('finance-reviews/:reviewId/resolve')
  @UseGuards(OriginGuard, CsrfGuard)
  resolveFinanceReview(
    @Req() req: AuthenticatedRequest,
    @Param('reviewId') reviewId: string,
    @Headers('idempotency-key') key: unknown,
    @Body() raw: unknown,
  ) {
    return this.finance!.resolve(
      req.auth!.organizationId,
      req.auth!.userId,
      requireUuid(reviewId, 'reviewId'),
      requireUuid(key, 'Idempotency-Key'),
      requireObject(raw),
    );
  }

  @RequirePermission('transfer.read')
  @Get('preview')
  @ApiOperation({
    summary: 'Preview a room/bed transfer',
    description:
      'Advisory read-only check for transfer availability. Returns current assignment, destination details, conflicts, and any unresolved policy restrictions. Does not create any records.',
  })
  @ApiQuery({ name: 'residentId', required: true, description: 'Resident UUID' })
  @ApiQuery({ name: 'destinationBedId', required: true, description: 'Destination bed UUID' })
  @ApiQuery({
    name: 'effectiveAt',
    required: false,
    description: 'Effective time (RFC3339), defaults to now',
  })
  @ApiResponse({ status: 200, description: 'Transfer preview result' })
  @ApiResponse({ status: 400, description: 'Invalid input or future-dated transfer' })
  @ApiResponse({ status: 403, description: 'Insufficient role' })
  @ApiResponse({ status: 404, description: 'Resident or destination bed not found' })
  @ApiResponse({ status: 409, description: 'No active stay, stale state, or destination occupied' })
  async preview(
    @Req() req: AuthenticatedRequest,
    @Query() query: PreviewQueryDto,
  ): Promise<TransferPreviewResult> {
    const organizationId = req.auth!.organizationId;
    for (const key of Object.keys(query)) {
      if (!['residentId', 'destinationBedId', 'effectiveAt'].includes(key))
        throw new BadRequestException({ code: 'UNKNOWN_FIELD' });
    }
    // Validate required parameters
    if (!query.residentId || !query.destinationBedId) {
      throw new BadRequestException('residentId and destinationBedId are required');
    }

    requireUuid(query.residentId, 'residentId');
    requireUuid(query.destinationBedId, 'destinationBedId');

    let effectiveAt: Date | undefined;
    if (query.effectiveAt !== undefined) {
      if (
        typeof query.effectiveAt !== 'string' ||
        !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(
          query.effectiveAt,
        )
      ) {
        throw new BadRequestException('effectiveAt must be a zoned RFC3339 timestamp');
      }
      const [year, month, day] = query.effectiveAt.slice(0, 10).split('-').map(Number);
      if (!month || !day || month > 12 || day > new Date(Date.UTC(year!, month, 0)).getUTCDate()) {
        throw new BadRequestException('effectiveAt must contain a valid calendar date');
      }
      try {
        effectiveAt = resolveInstant(query.effectiveAt, 'effectiveAt');
      } catch {
        throw new BadRequestException('effectiveAt must be a valid RFC3339 timestamp');
      }
    }

    return this.transferService.preview({
      organizationId,
      residentId: query.residentId,
      destinationBedId: query.destinationBedId,
      ...(effectiveAt ? { effectiveAt } : {}),
    });
  }

  @RequirePermission('transfer.read')
  @Get('history')
  @ApiOperation({ summary: 'List transfer history for a resident' })
  history(@Req() req: AuthenticatedRequest, @Query() query: Record<string, unknown>) {
    return this.transferService.history(req.auth!.organizationId, query);
  }

  @RequirePermission('transfer.execute')
  @Post()
  @UseGuards(OriginGuard, CsrfGuard)
  @ApiOperation({
    summary:
      'Request transfer execution (blocked pending receipt, review and rollout prerequisites)',
  })
  execute(
    @Req() req: AuthenticatedRequest,
    @Headers('idempotency-key') key: unknown,
    @Body() raw: unknown,
  ) {
    const body = requireObject(raw);
    for (const field of Object.keys(body)) {
      if (!['residentId', 'destinationBedId', 'reason', 'effectiveAt'].includes(field)) {
        throw new BadRequestException({ code: 'UNKNOWN_FIELD' });
      }
    }
    const residentId = requireUuid(body.residentId, 'residentId');
    const destinationBedId = requireUuid(body.destinationBedId, 'destinationBedId');
    const idempotencyKey = requireUuid(key, 'Idempotency-Key');
    const reason = requiredText(body, 'reason', 2000);
    if (
      typeof body.effectiveAt !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(body.effectiveAt)
    ) {
      throw new BadRequestException({
        code: 'INVALID_VALUE',
        message: 'effectiveAt must be a zoned RFC3339 instant',
      });
    }
    const effectiveAt = resolveInstant(body.effectiveAt, 'effectiveAt');
    const [year, month, day] = body.effectiveAt.slice(0, 10).split('-').map(Number);
    if (!month || !day || month > 12 || day > new Date(Date.UTC(year!, month, 0)).getUTCDate()) {
      throw new BadRequestException({
        code: 'INVALID_VALUE',
        message: 'effectiveAt must contain a valid calendar date',
      });
    }
    return this.transferService.execute({
      organizationId: req.auth!.organizationId,
      actorUserId: req.auth!.userId,
      actorRole: req.auth!.role,
      residentId,
      destinationBedId,
      reason,
      effectiveAt,
      idempotencyKey,
    });
  }
}
