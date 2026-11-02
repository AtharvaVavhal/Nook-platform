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
  async create(@Req() req: any, @Body() dto: any) {
    const organizationId = req.auth!.organizationId;
    const data = { ...dto, organizationId };
    return this.admissionService.create(organizationId, data);
  }

  @Get()
  @ApiOperation({ summary: 'List admissions with pagination and filters' })
  async findAll(@Req() req: any, @Query() query: any) {
    const organizationId = req.auth!.organizationId;
    return this.admissionService.findAll(organizationId, query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get an admission by id' })
  async findOne(@Req() req: any, @Param('id') id: string) {
    const organizationId = req.auth!.organizationId;
    return this.admissionService.findOne(organizationId, id);
  }

  @Put(':id')
  @UseGuards(OriginGuard, CsrfGuard)
  @ApiOperation({ summary: 'Update an admission' })
  async update(@Req() req: any, @Param('id') id: string, @Body() dto: any) {
    const organizationId = req.auth!.organizationId;
    return this.admissionService.update(organizationId, id, dto);
  }

  @Delete(':id')
  @UseGuards(OriginGuard, CsrfGuard)
  @ApiOperation({ summary: 'Cancel an admission' })
  async cancel(@Req() req: any, @Param('id') id: string) {
    const organizationId = req.auth!.organizationId;
    return this.admissionService.cancel(organizationId, id);
  }
}