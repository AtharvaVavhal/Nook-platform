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
import { AdmissionService } from './admission.service.js';

@ApiTags('Admissions')
@ApiBearerAuth()
@UseGuards(SessionGuard)
@Controller('admissions')
export class AdmissionController {
  constructor(@Inject(AdmissionService) private readonly admissionService: AdmissionService) {}

  @Post()
  @UseGuards(OriginGuard, CsrfGuard)
  @ApiOperation({ summary: 'Create a new admission from a confirmed booking' })
  async create(@Req() req: AuthenticatedRequest, @Body() dto: unknown) {
    const organizationId = req.auth!.organizationId;
    return this.admissionService.create(organizationId, dto);
  }

  @Get()
  @ApiOperation({ summary: 'List admissions with pagination and filters' })
  async findAll(@Req() req: AuthenticatedRequest, @Query() query: unknown) {
    const organizationId = req.auth!.organizationId;
    return this.admissionService.findAll(organizationId, query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get an admission by id' })
  async findOne(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string) {
    const organizationId = req.auth!.organizationId;
    return this.admissionService.findOne(organizationId, id);
  }

  @Put(':id')
  @UseGuards(OriginGuard, CsrfGuard)
  @ApiOperation({ summary: 'Update an admission' })
  async update(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: unknown,
  ) {
    const organizationId = req.auth!.organizationId;
    return this.admissionService.update(organizationId, id, dto);
  }

  @Delete(':id')
  @UseGuards(OriginGuard, CsrfGuard)
  @ApiOperation({ summary: 'Cancel an admission' })
  async cancel(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string) {
    const organizationId = req.auth!.organizationId;
    return this.admissionService.cancel(organizationId, id);
  }
}
