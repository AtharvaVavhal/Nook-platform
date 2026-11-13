import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Inject } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { CsrfGuard, OriginGuard, SessionGuard } from '../auth/auth.guards.js';
import type { AuthenticatedRequest } from '../auth/auth.types.js';
import { CheckInService } from './checkin.service.js';
import { RequirePermission } from '../auth/permissions.js';

@ApiTags('Check-ins')
@ApiBearerAuth()
@UseGuards(SessionGuard)
@Controller('check-ins')
export class CheckInController {
  constructor(@Inject(CheckInService) private readonly checkInService: CheckInService) {}

  @RequirePermission('checkin.write')
  @Post()
  @UseGuards(OriginGuard, CsrfGuard)
  @ApiOperation({ summary: 'Create a new check-in from an admitted admission' })
  async create(@Req() req: AuthenticatedRequest, @Body() dto: Record<string, unknown>) {
    const organizationId = req.auth!.organizationId;
    return this.checkInService.create(organizationId, { ...dto, organizationId }, req.auth!.userId);
  }

  @RequirePermission('checkin.read')
  @Get()
  @ApiOperation({ summary: 'List check-ins with pagination and filters' })
  async findAll(@Req() req: AuthenticatedRequest, @Query() query: Record<string, unknown>) {
    const organizationId = req.auth!.organizationId;
    return this.checkInService.findAll(organizationId, query);
  }

  @RequirePermission('checkin.read')
  @Get('occupancy')
  @ApiOperation({ summary: 'Occupancy derived from active check-ins' })
  async occupancy(@Req() req: AuthenticatedRequest) {
    return this.checkInService.occupancy(req.auth!.organizationId);
  }

  @RequirePermission('checkin.read')
  @Get(':id')
  @ApiOperation({ summary: 'Get a check-in by id' })
  async findOne(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string) {
    const organizationId = req.auth!.organizationId;
    return this.checkInService.findOne(organizationId, id);
  }

  @RequirePermission('checkin.write')
  @Put(':id')
  @UseGuards(OriginGuard, CsrfGuard)
  @ApiOperation({
    summary: 'Update the notes of a check-in (status changes only through check-out)',
  })
  async update(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: Record<string, unknown>,
  ) {
    const organizationId = req.auth!.organizationId;
    return this.checkInService.update(organizationId, id, dto);
  }

  @RequirePermission('checkin.write')
  @Post(':id/check-out')
  @UseGuards(OriginGuard, CsrfGuard)
  @ApiOperation({ summary: 'Check out a resident' })
  async checkOut(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: Record<string, unknown>,
  ) {
    const organizationId = req.auth!.organizationId;
    return this.checkInService.checkOut(organizationId, id, dto, req.auth!.userId);
  }
}
