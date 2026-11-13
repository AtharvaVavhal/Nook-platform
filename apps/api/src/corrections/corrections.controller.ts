import {
  Body,
  Controller,
  Get,
  Headers,
  Inject,
  Param,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CsrfGuard, OriginGuard, SessionGuard } from '../auth/auth.guards.js';
import type { AuthenticatedRequest } from '../auth/auth.types.js';
import { CorrectionsService, type CommandContext } from './corrections.service.js';
import { RequirePermission } from '../auth/permissions.js';

interface ResponseLike {
  status(code: number): unknown;
  setHeader(name: string, value: string): unknown;
}

function context(req: AuthenticatedRequest): CommandContext {
  // Organization, actor and role come only from the authenticated session, never from the body or query.
  return {
    organizationId: req.auth!.organizationId,
    userId: req.auth!.userId,
    role: req.auth!.role,
  };
}

/**
 * Correction API (specification v1.3 section 12). Every route needs a session; every POST also needs Origin and CSRF.
 * Role and membership are re-read from the database inside each command; this controller cannot grant authority.
 */
@ApiTags('Corrections')
@ApiBearerAuth()
@UseGuards(SessionGuard)
@Controller('corrections')
export class CorrectionsController {
  constructor(@Inject(CorrectionsService) private readonly corrections: CorrectionsService) {}

  @RequirePermission('correction.submit')
  @Post()
  @UseGuards(OriginGuard, CsrfGuard)
  @ApiOperation({ summary: 'Submit a correction proposal (Idempotency-Key header required)' })
  async submit(
    @Req() req: AuthenticatedRequest,
    @Headers('idempotency-key') key: string | undefined,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: ResponseLike,
  ) {
    const result = await this.corrections.submit(context(req), key, body);
    res.status(result.status);
    return result.body;
  }

  @RequirePermission('correction.read')
  @Get()
  @ApiOperation({ summary: 'Correction queue (safe summaries, no values)' })
  list(
    @Req() req: AuthenticatedRequest,
    @Query() query: unknown,
    @Res({ passthrough: true }) res: ResponseLike,
  ) {
    res.setHeader('Cache-Control', 'no-store');
    return this.corrections.list(context(req), query);
  }

  // Registered before ':id' so "history" is never read as an id.
  @RequirePermission('correction.read')
  @Get('history')
  @ApiOperation({ summary: 'Corrections for one target' })
  history(
    @Req() req: AuthenticatedRequest,
    @Query() query: unknown,
    @Res({ passthrough: true }) res: ResponseLike,
  ) {
    res.setHeader('Cache-Control', 'no-store');
    return this.corrections.history(context(req), query);
  }

  @RequirePermission('correction.finance')
  @Get('finance-reviews')
  @ApiOperation({ summary: 'Correction billing gaps and issued-invoice reviews' })
  financeReviews(
    @Req() req: AuthenticatedRequest,
    @Query() query: unknown,
    @Res({ passthrough: true }) res: ResponseLike,
  ) {
    res.setHeader('Cache-Control', 'no-store');
    return this.corrections.listFinanceReviews(context(req), query);
  }

  @RequirePermission('correction.finance')
  @Post('finance-reviews/:linkId/resolve')
  @UseGuards(OriginGuard, CsrfGuard)
  @ApiOperation({ summary: 'Resolve a finance review (independent OWNER)' })
  async resolve(
    @Req() req: AuthenticatedRequest,
    @Headers('idempotency-key') key: string | undefined,
    @Param('linkId') linkId: string,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: ResponseLike,
  ) {
    const result = await this.corrections.resolveFinanceReview(context(req), key, linkId, body);
    res.status(result.status);
    return result.body;
  }

  @RequirePermission('correction.read')
  @Get(':id')
  @ApiOperation({ summary: 'Protected correction detail' })
  detail(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Res({ passthrough: true }) res: ResponseLike,
  ) {
    res.setHeader('Cache-Control', 'no-store');
    return this.corrections.detail(context(req), id);
  }

  @RequirePermission('correction.review')
  @Post(':id/approve')
  @UseGuards(OriginGuard, CsrfGuard)
  @ApiOperation({ summary: 'Approve and apply a correction' })
  async approve(
    @Req() req: AuthenticatedRequest,
    @Headers('idempotency-key') key: string | undefined,
    @Param('id') id: string,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: ResponseLike,
  ) {
    const result = await this.corrections.approve(context(req), key, id, body);
    res.status(result.status);
    return result.body;
  }

  @RequirePermission('correction.review')
  @Post(':id/reject')
  @UseGuards(OriginGuard, CsrfGuard)
  @ApiOperation({ summary: 'Reject a correction' })
  async reject(
    @Req() req: AuthenticatedRequest,
    @Headers('idempotency-key') key: string | undefined,
    @Param('id') id: string,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: ResponseLike,
  ) {
    const result = await this.corrections.reject(context(req), key, id, body);
    res.status(result.status);
    return result.body;
  }

  @RequirePermission('correction.submit')
  @Post(':id/withdraw')
  @UseGuards(OriginGuard, CsrfGuard)
  @ApiOperation({ summary: 'Withdraw your own pending correction' })
  async withdraw(
    @Req() req: AuthenticatedRequest,
    @Headers('idempotency-key') key: string | undefined,
    @Param('id') id: string,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: ResponseLike,
  ) {
    const result = await this.corrections.withdraw(context(req), key, id, body);
    res.status(result.status);
    return result.body;
  }
}
