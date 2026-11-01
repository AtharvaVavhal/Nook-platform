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
import { BookingService } from './booking.service.js';
import { CreateBookingDto, UpdateBookingDto, BookingQueryDto } from './booking.dto.js';

@ApiTags('Bookings')
@ApiBearerAuth()
@UseGuards(SessionGuard)
@Controller('bookings')
export class BookingController {
  constructor(private readonly bookingService: BookingService) {}

  @Post()
  @UseGuards(OriginGuard, CsrfGuard)
  @ApiOperation({ summary: 'Create a new booking' })
  async create(@Req() req: any, @Body() dto: any) {
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
  async findOne(@Req() req: any, @Param('id') id: string) {
    const organizationId = req.auth!.organizationId;
    return this.bookingService.findOne(organizationId, id);
  }

  @Put(':id')
  @UseGuards(OriginGuard, CsrfGuard)
  @ApiOperation({ summary: 'Update a booking' })
  async update(@Req() req: any, @Param('id') id: string, @Body() dto: any) {
    const organizationId = req.auth!.organizationId;
    return this.bookingService.update(organizationId, id, dto);
  }

  @Delete(':id')
  @UseGuards(OriginGuard, CsrfGuard)
  @ApiOperation({ summary: 'Cancel a booking' })
  async cancel(@Req() req: any, @Param('id') id: string) {
    const organizationId = req.auth!.organizationId;
    return this.bookingService.cancel(organizationId, id);
  }

  @Get('beds/available')
  @ApiOperation({ summary: 'Get available beds for a date range' })
  async getAvailableBeds(@Req() req: any, @Query() query: any) {
    const organizationId = req.auth!.organizationId;
    const { startDate, endDate, propertyId } = query;
    if (!startDate || !endDate) throw new Error('startDate and endDate required');
    return this.bookingService.getAvailableBeds(organizationId, new Date(startDate), new Date(endDate), propertyId);
  }
}