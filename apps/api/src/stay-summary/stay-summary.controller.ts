import { Controller, Get, Param, ParseUUIDPipe, Req, UseGuards } from '@nestjs/common';
import { Inject } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { SessionGuard } from '../auth/auth.guards.js';
import type { AuthenticatedRequest } from '../auth/auth.types.js';
import { StaySummaryService } from './stay-summary.service.js';
import { RequirePermission } from '../auth/permissions.js';

@ApiTags('Residents')
@ApiBearerAuth()
@UseGuards(SessionGuard)
@Controller('residents')
export class StaySummaryController {
  constructor(
    @Inject(StaySummaryService) private readonly staySummaryService: StaySummaryService,
  ) {}

  @RequirePermission('stay.summary.read')
  @Get(':residentId/stay-summary')
  @ApiOperation({ summary: 'Get a resident stay summary' })
  async getStaySummary(
    @Req() req: AuthenticatedRequest,
    @Param('residentId', ParseUUIDPipe) residentId: string,
  ) {
    const organizationId = req.auth!.organizationId;
    return this.staySummaryService.getStaySummary(organizationId, residentId);
  }
}
