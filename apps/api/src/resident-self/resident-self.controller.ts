import {
  BadRequestException,
  Controller,
  Get,
  Inject,
  Param,
  ParseUUIDPipe,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { HttpResponse } from '../auth/auth.types.js';
import { RequireResidentPermission } from '../auth/permissions.js';
import { ResidentPortalEnabledGuard } from '../resident-auth/resident-auth.guards.js';
import type { ResidentAuthenticatedRequest } from '../resident-auth/resident-auth.types.js';
import { ResidentSelfService } from './resident-self.service.js';

const uuidPipe = new ParseUUIDPipe({
  exceptionFactory: () => new BadRequestException({ code: 'INVALID_ID' }),
});

/**
 * Resident self-service (read-only). Every route needs a valid RESIDENT session (its own cookie and table; a staff session is
 * refused) and the resident permission; the resident and organization come from `request.residentAuth`, never from the
 * request. There is no route that accepts a resident or organization id.
 */
@ApiTags('Resident self-service')
@UseGuards(ResidentPortalEnabledGuard)
@Controller('me')
export class ResidentSelfController {
  constructor(@Inject(ResidentSelfService) private readonly self: ResidentSelfService) {}

  private static fresh(response: HttpResponse): void {
    response.setHeader('Cache-Control', 'no-store');
  }

  @RequireResidentPermission('resident.self.read')
  @Get()
  @ApiOperation({ summary: 'My profile' })
  async profile(
    @Req() req: ResidentAuthenticatedRequest,
    @Res({ passthrough: true }) res: HttpResponse,
  ) {
    ResidentSelfController.fresh(res);
    return { data: await this.self.profile(req.residentAuth!) };
  }

  @RequireResidentPermission('resident.self.read')
  @Get('stay')
  @ApiOperation({ summary: 'My current stay, upcoming bookings and last stay' })
  async stay(
    @Req() req: ResidentAuthenticatedRequest,
    @Res({ passthrough: true }) res: HttpResponse,
  ) {
    ResidentSelfController.fresh(res);
    return { data: await this.self.stay(req.residentAuth!) };
  }

  @RequireResidentPermission('resident.self.read')
  @Get('rent-summary')
  @ApiOperation({ summary: 'My rent summary' })
  async rentSummary(
    @Req() req: ResidentAuthenticatedRequest,
    @Res({ passthrough: true }) res: HttpResponse,
  ) {
    ResidentSelfController.fresh(res);
    return { data: await this.self.rentSummary(req.residentAuth!) };
  }

  @RequireResidentPermission('resident.self.read')
  @Get('invoices')
  @ApiOperation({ summary: 'My invoices (paginated)' })
  async invoices(
    @Req() req: ResidentAuthenticatedRequest,
    @Query() query: unknown,
    @Res({ passthrough: true }) res: HttpResponse,
  ) {
    ResidentSelfController.fresh(res);
    return { data: await this.self.invoices(req.residentAuth!, query) };
  }

  @RequireResidentPermission('resident.self.read')
  @Get('invoices/:id')
  @ApiOperation({ summary: 'One of my invoices, with its payments' })
  async invoice(
    @Req() req: ResidentAuthenticatedRequest,
    @Param('id', uuidPipe) id: string,
    @Res({ passthrough: true }) res: HttpResponse,
  ) {
    ResidentSelfController.fresh(res);
    return { data: await this.self.invoice(req.residentAuth!, id) };
  }

  @RequireResidentPermission('resident.self.read')
  @Get('payments')
  @ApiOperation({ summary: 'My payment history (paginated)' })
  async payments(
    @Req() req: ResidentAuthenticatedRequest,
    @Query() query: unknown,
    @Res({ passthrough: true }) res: HttpResponse,
  ) {
    ResidentSelfController.fresh(res);
    return { data: await this.self.payments(req.residentAuth!, query) };
  }

  @RequireResidentPermission('resident.self.read')
  @Get('receipts/:id')
  @ApiOperation({ summary: 'The receipt for one of my payments (id is the payment id)' })
  async receipt(
    @Req() req: ResidentAuthenticatedRequest,
    @Param('id', uuidPipe) id: string,
    @Res({ passthrough: true }) res: HttpResponse,
  ) {
    ResidentSelfController.fresh(res);
    return { data: await this.self.receipt(req.residentAuth!, id) };
  }
}
