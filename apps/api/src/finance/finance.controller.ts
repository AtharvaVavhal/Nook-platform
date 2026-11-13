import {
  Body,
  Controller,
  Get,
  Headers,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CsrfGuard, OriginGuard, SessionGuard } from '../auth/auth.guards.js';
import type { AuthenticatedRequest } from '../auth/auth.types.js';
import { FinanceService } from './finance.service.js';
import { RequirePermission } from '../auth/permissions.js';

// Organization and actor come only from the authenticated session; any organizationId in a
// request body or query string is ignored. OWNER and PROPERTY_MANAGER are both permitted,
// consistent with the other Phase 3 modules.
@ApiTags('Finance')
@ApiBearerAuth()
@UseGuards(SessionGuard)
@Controller('finance')
export class FinanceController {
  constructor(@Inject(FinanceService) private readonly finance: FinanceService) {}

  @RequirePermission('finance.invoice.write')
  @Post('invoices/generate-monthly')
  @UseGuards(OriginGuard, CsrfGuard)
  @ApiOperation({ summary: 'Generate monthly invoices for eligible residents (idempotent)' })
  generateMonthly(@Req() req: AuthenticatedRequest, @Body() body: unknown) {
    return this.finance.generateMonthly(req.auth!.organizationId, req.auth!.userId, body);
  }

  @RequirePermission('finance.invoice.write')
  @Post('invoices')
  @UseGuards(OriginGuard, CsrfGuard)
  @ApiOperation({ summary: 'Create a draft invoice' })
  createDraft(@Req() req: AuthenticatedRequest, @Body() body: unknown) {
    return this.finance.createDraft(req.auth!.organizationId, req.auth!.userId, body);
  }

  @RequirePermission('finance.invoice.write')
  @Post('invoices/:id/issue')
  @UseGuards(OriginGuard, CsrfGuard)
  @ApiOperation({ summary: 'Issue a draft invoice' })
  issue(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.finance.issue(req.auth!.organizationId, req.auth!.userId, id);
  }

  @RequirePermission('finance.read')
  @Get('invoices')
  @ApiOperation({ summary: 'List invoices with pagination and filters' })
  findAll(@Req() req: AuthenticatedRequest, @Query() query: Record<string, unknown>) {
    return this.finance.findAll(req.auth!.organizationId, query);
  }

  @RequirePermission('finance.read')
  @Get('invoices/:id')
  @ApiOperation({ summary: 'Get an invoice with its payment history' })
  findOne(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.finance.findOne(req.auth!.organizationId, id);
  }

  @RequirePermission('finance.read')
  @Get('invoices/:id/receipt')
  @ApiOperation({ summary: 'Receipt data for an invoice (optionally one payment)' })
  receipt(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Query('paymentId') paymentId?: string,
  ) {
    return this.finance.receipt(req.auth!.organizationId, id, paymentId);
  }

  @RequirePermission('finance.payment.record')
  @Post('payments')
  @UseGuards(OriginGuard, CsrfGuard)
  @ApiOperation({ summary: 'Record a payment against an invoice' })
  recordPayment(
    @Req() req: AuthenticatedRequest,
    @Body() body: unknown,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
  ) {
    return this.finance.recordPayment(
      req.auth!.organizationId,
      req.auth!.userId,
      body,
      idempotencyKey,
    );
  }

  @RequirePermission('finance.adjust')
  @Post('payments/:id/reverse')
  @UseGuards(OriginGuard, CsrfGuard)
  @ApiOperation({ summary: 'Reverse a payment (append-only; a reason is required)' })
  reversePayment(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    return this.finance.reversePayment(req.auth!.organizationId, req.auth!.userId, id, body);
  }

  @RequirePermission('finance.adjust')
  @Post('invoices/:id/adjustments')
  @UseGuards(OriginGuard, CsrfGuard)
  @ApiOperation({ summary: 'Credit an issued invoice (append-only; a reason is required)' })
  adjustInvoice(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    return this.finance.adjustInvoice(req.auth!.organizationId, req.auth!.userId, id, body);
  }

  @RequirePermission('finance.adjust')
  @Post('invoices/:id/void')
  @UseGuards(OriginGuard, CsrfGuard)
  @ApiOperation({
    summary:
      'Void an invoice (terminal; reason required; refused while payments are unreversed or credits applied)',
  })
  voidInvoice(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    return this.finance.voidInvoice(req.auth!.organizationId, req.auth!.userId, id, body);
  }

  @RequirePermission('finance.read')
  @Get('corrections')
  @ApiOperation({ summary: 'Correction history: payment reversals and invoice credits' })
  corrections(@Req() req: AuthenticatedRequest, @Query() query: Record<string, unknown>) {
    return this.finance.corrections(req.auth!.organizationId, query);
  }

  @RequirePermission('finance.read')
  @Get('outstanding')
  @ApiOperation({ summary: 'Outstanding and overdue balances' })
  outstanding(@Req() req: AuthenticatedRequest, @Query() query: Record<string, unknown>) {
    return this.finance.outstanding(req.auth!.organizationId, query);
  }

  @RequirePermission('finance.read')
  @Get('reports/monthly')
  @ApiOperation({ summary: 'Monthly financial report' })
  monthlyReport(@Req() req: AuthenticatedRequest, @Query() query: Record<string, unknown>) {
    return this.finance.monthlyReport(req.auth!.organizationId, query);
  }
}
