import { Controller, Get, Param, ParseUUIDPipe, Query, Req, UseGuards } from '@nestjs/common';
import { Inject } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { SessionGuard, RoleGuard } from '../auth/auth.guards.js';
import type { AuthenticatedRequest } from '../auth/auth.types.js';
import { ResidentHistoryService } from './resident-history.service.js';
import { RequirePermission } from '../auth/permissions.js';

@ApiTags('Residents')
@ApiBearerAuth()
@UseGuards(SessionGuard, RoleGuard)
@Controller('residents')
export class ResidentHistoryController {
  constructor(
    @Inject(ResidentHistoryService) private readonly residentHistoryService: ResidentHistoryService,
  ) {}

  @RequirePermission('resident.history.read')
  @Get(':residentId/history')
  @ApiOperation({ summary: 'Get resident lifecycle history' })
  async getHistory(
    @Req() req: AuthenticatedRequest,
    @Param('residentId', ParseUUIDPipe) residentId: string,
    @Query() query: Record<string, unknown>,
  ) {
    const organizationId = req.auth!.organizationId;
    return this.residentHistoryService.getHistory(organizationId, residentId, query);
  }
}
