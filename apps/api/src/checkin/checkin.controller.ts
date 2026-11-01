import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { CsrfGuard, OriginGuard, SessionGuard } from '../auth/auth.guards.js';
import type { AuthenticatedRequest } from '../auth/auth.types.js';
import { CheckInService } from './checkin.service.js';

@ApiTags('Check-ins')
@ApiBearerAuth()
@UseGuards(SessionGuard)
@Controller('check-ins')
export class CheckInController {
  constructor(private readonly checkInService: CheckInService) {}

  @Post()
  @UseGuards(OriginGuard, CsrfGuard)
  @ApiOperation({ summary: 'Create a new check-in from an admitted admission' })
  async create(@Req() req: any, @Body() dto: any) {
    const organizationId = req.auth!.organizationId;
    return this.checkInService.create(organizationId, { ...dto, organizationId });
  }

  @Get()
  @ApiOperation({ summary: 'List check-ins with pagination and filters' })
  async findAll(@Req() req: any, @Query() query: any) {
    const organizationId = req.auth!.organizationId;
    return this.checkInService.findAll(organizationId, query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a check-in by id' })
  async findOne(@Req() req: any, @Param('id') id: string) {
    const organizationId = req.auth!.organizationId;
    return this.checkInService.findOne(organizationId, id);
  }

  @Put(':id')
  @UseGuards(OriginGuard, CsrfGuard)
  @ApiOperation({ summary: 'Update a check-in' })
  async update(@Req() req: any, @Param('id') id: string, @Body() dto: any) {
    const organizationId = req.auth!.organizationId;
    return this.checkInService.update(organizationId, id, dto);
  }

  @Delete(':id')
  @UseGuards(OriginGuard, CsrfGuard)
  @ApiOperation({ summary: 'Cancel a check-in (mark as checked out)' })
  async cancel(@Req() req: any, @Param('id') id: string) {
    const organizationId = req.auth!.organizationId;
    return this.checkInService.cancel(organizationId, id);
  }

  @Post(':id/check-out')
  @UseGuards(OriginGuard, CsrfGuard)
  @ApiOperation({ summary: 'Check out a resident' })
  async checkOut(@Req() req: any, @Param('id') id: string, @Body() dto: any) {
    const organizationId = req.auth!.organizationId;
    return this.checkInService.checkOut(organizationId, id, dto);
  }
}