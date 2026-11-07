import {
  Body,
  Controller,
  Delete,
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
import { EnquiryService } from './enquiry.service.js';
import { parseUpcomingDays } from './enquiry.input.js';

@ApiTags('Enquiries')
@ApiBearerAuth()
@UseGuards(SessionGuard)
@Controller('enquiries')
export class EnquiryController {
  constructor(@Inject(EnquiryService) private readonly enquiryService: EnquiryService) {}

  @Post()
  @UseGuards(OriginGuard, CsrfGuard)
  @ApiOperation({ summary: 'Create a new enquiry' })
  async create(@Req() req: AuthenticatedRequest, @Body() dto: unknown) {
    const organizationId = req.auth!.organizationId;
    return this.enquiryService.create(organizationId, dto);
  }

  @Get()
  @ApiOperation({ summary: 'List enquiries with pagination and filters' })
  async findAll(@Req() req: AuthenticatedRequest, @Query() query: unknown) {
    const organizationId = req.auth!.organizationId;
    return this.enquiryService.findAll(organizationId, query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get an enquiry by id' })
  async findOne(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string) {
    const organizationId = req.auth!.organizationId;
    return this.enquiryService.findOne(organizationId, id);
  }

  @Put(':id')
  @UseGuards(OriginGuard, CsrfGuard)
  @ApiOperation({ summary: 'Update an enquiry' })
  async update(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: unknown,
  ) {
    const organizationId = req.auth!.organizationId;
    return this.enquiryService.update(organizationId, id, dto);
  }

  @Delete(':id')
  @UseGuards(OriginGuard, CsrfGuard)
  @ApiOperation({ summary: 'Archive an enquiry' })
  async archive(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string) {
    const organizationId = req.auth!.organizationId;
    return this.enquiryService.archive(organizationId, id);
  }

  // Follow-ups
  @Post(':id/follow-ups')
  @UseGuards(OriginGuard, CsrfGuard)
  @ApiOperation({ summary: 'Add a follow-up to an enquiry' })
  async addFollowUp(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: unknown,
  ) {
    const organizationId = req.auth!.organizationId;
    const userId = req.auth!.userId;
    return this.enquiryService.addFollowUp(organizationId, id, userId, dto);
  }

  @Get(':id/follow-ups')
  @ApiOperation({ summary: 'Get follow-ups for an enquiry' })
  async getFollowUps(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string) {
    const organizationId = req.auth!.organizationId;
    return this.enquiryService.getFollowUps(organizationId, id);
  }

  // Conversion
  @Post(':id/convert')
  @UseGuards(OriginGuard, CsrfGuard)
  @ApiOperation({ summary: 'Convert enquiry to resident' })
  async convert(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() residentData: unknown,
  ) {
    const organizationId = req.auth!.organizationId;
    return this.enquiryService.convert(organizationId, id, residentData);
  }

  // Follow-up dashboards
  @Get('follow-ups/overdue')
  @ApiOperation({ summary: 'Get overdue follow-ups' })
  async getOverdueFollowUps(@Req() req: AuthenticatedRequest) {
    const organizationId = req.auth!.organizationId;
    return this.enquiryService.getOverdueFollowUps(organizationId);
  }

  @Get('follow-ups/upcoming')
  @ApiOperation({ summary: 'Get upcoming follow-ups' })
  async getUpcomingFollowUps(@Req() req: AuthenticatedRequest, @Query('days') days?: unknown) {
    const organizationId = req.auth!.organizationId;
    return this.enquiryService.getUpcomingFollowUps(organizationId, parseUpcomingDays(days));
  }
}
