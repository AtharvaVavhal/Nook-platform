import { Body, Controller, Get, Param, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { Inject } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { CsrfGuard, OriginGuard, SessionGuard } from '../auth/auth.guards.js';
import type { AuthenticatedRequest } from '../auth/auth.types.js';
import { CheckInService } from './checkin.service.js';

@ApiTags('Check-ins')
@ApiBearerAuth()
@UseGuards(SessionGuard)
@Controller('check-ins')
export class CheckInController {
  constructor(@Inject(CheckInService) private readonly checkInService: CheckInService) {}

  @Post()
  @UseGuards(OriginGuard, CsrfGuard)
  @ApiOperation({ summary: 'Create a new check-in from an admitted admission' })
  async create(@Req() req: AuthenticatedRequest, @Body() dto: Record<string, unknown>) {
    const organizationId = req.auth!.organizationId;
    return this.checkInService.create(organizationId, { ...dto, organizationId });
  }

  @Get()
  @ApiOperation({ summary: 'List check-ins with pagination and filters' })
  async findAll(@Req() req: AuthenticatedRequest, @Query() query: Record<string, unknown>) {
    const organizationId = req.auth!.organizationId;
    return this.checkInService.findAll(organizationId, query);
  }

  @Get('occupancy')
  @ApiOperation({ summary: 'Occupancy derived from active check-ins' })
  async occupancy(@Req() req: AuthenticatedRequest) {
    return this.checkInService.occupancy(req.auth!.organizationId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a check-in by id' })
  async findOne(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    const organizationId = req.auth!.organizationId;
    return this.checkInService.findOne(organizationId, id);
  }

  @Put(':id')
  @UseGuards(OriginGuard, CsrfGuard)
  @ApiOperation({
    summary: 'Update the notes of a check-in (status changes only through check-out)',
  })
  async update(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() dto: Record<string, unknown>,
  ) {
    const organizationId = req.auth!.organizationId;
    return this.checkInService.update(organizationId, id, dto);
  }

  @Post(':id/check-out')
  @UseGuards(OriginGuard, CsrfGuard)
  @ApiOperation({ summary: 'Check out a resident' })
  async checkOut(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() dto: Record<string, unknown>,
  ) {
    const organizationId = req.auth!.organizationId;
    return this.checkInService.checkOut(organizationId, id, dto);
  }
}
