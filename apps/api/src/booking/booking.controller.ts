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
import { Inject, ParseUUIDPipe } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { CsrfGuard, OriginGuard, SessionGuard } from '../auth/auth.guards.js';
import type { AuthenticatedRequest } from '../auth/auth.types.js';
import { BookingService } from './booking.service.js';
import { parseAvailabilityQuery } from './booking.input.js';

@ApiTags('Bookings')
@ApiBearerAuth()
@UseGuards(SessionGuard)
@Controller('bookings')
export class BookingController {
  constructor(@Inject(BookingService) private readonly bookingService: BookingService) {}

  @Post()
  @UseGuards(OriginGuard, CsrfGuard)
  @ApiOperation({ summary: 'Create a new booking' })
  async create(@Req() req: any, @Body() dto: unknown) {
    const organizationId = req.auth!.organizationId;
    return this.bookingService.create(organizationId, dto);
  }

  @Get()
  @ApiOperation({ summary: 'List bookings with pagination and filters' })
  async findAll(@Req() req: any, @Query() query: any) {
    const organizationId = req.auth!.organizationId;
    return this.bookingService.findAll(organizationId, query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a booking by id' })
  async findOne(@Req() req: any, @Param('id', ParseUUIDPipe) id: string) {
    const organizationId = req.auth!.organizationId;
    return this.bookingService.findOne(organizationId, id);
  }

  @Put(':id')
  @UseGuards(OriginGuard, CsrfGuard)
  @ApiOperation({ summary: 'Update a booking' })
  async update(@Req() req: any, @Param('id', ParseUUIDPipe) id: string, @Body() dto: unknown) {
    const organizationId = req.auth!.organizationId;
    return this.bookingService.update(organizationId, id, dto, req.auth!.userId);
  }

  @Post(':id/extend')
  @UseGuards(OriginGuard, CsrfGuard)
  @ApiOperation({ summary: 'Extend a booking end date (reason required, audited)' })
  async extend(@Req() req: AuthenticatedRequest, @Param('id') id: string, @Body() body: unknown) {
    const { organizationId, userId, role } = req.auth!;
    return this.bookingService.extend({ organizationId, userId, role }, id, body);
  }

  @Delete(':id')
  @UseGuards(OriginGuard, CsrfGuard)
  @ApiOperation({ summary: 'Cancel a booking' })
  async cancel(@Req() req: any, @Param('id', ParseUUIDPipe) id: string) {
    const organizationId = req.auth!.organizationId;
    return this.bookingService.cancel(organizationId, id);
  }

  @Get('beds/available')
  @ApiOperation({ summary: 'Get available beds for a date range' })
  async getAvailableBeds(@Req() req: any, @Query() query: any) {
    const organizationId = req.auth!.organizationId;
    const { startDate, endDate, propertyId } = parseAvailabilityQuery(query);
    return this.bookingService.getAvailableBeds(organizationId, startDate, endDate, propertyId);
  }
}
