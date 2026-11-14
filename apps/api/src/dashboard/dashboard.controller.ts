import { Controller, Get, Inject, Param, Query, Req, UseGuards } from '@nestjs/common';
import { SessionGuard } from '../auth/auth.guards.js';
import type { AuthenticatedRequest } from '../auth/auth.types.js';
import { RequirePermission } from '../auth/permissions.js';
import { DashboardService } from './dashboard.service.js';

@Controller()
@UseGuards(SessionGuard)
export class DashboardController {
  // Explicit @Inject: the runtime (tsx) emits no decorator metadata, so constructor types alone are not enough.
  constructor(@Inject(DashboardService) private readonly dashboard: DashboardService) {}

  /**
   * Read-only, property-scoped owner dashboard. The route needs `inventory.read`; each section then follows the
   * existing permission of its own data and is `null` when the caller lacks it. The organization comes only from the
   * session; the query accepts `month` and `days` and refuses everything else.
   */
  @RequirePermission('inventory.read')
  @Get('properties/:propertyId/dashboard')
  get(
    @Req() request: AuthenticatedRequest,
    @Param('propertyId') propertyId: string,
    @Query() query: Record<string, unknown>,
  ) {
    return this.dashboard.getDashboard(request.auth!, propertyId, query);
  }
}
