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
import { ResidentService } from './resident.service.js';
import { CreateResidentDto, UpdateResidentDto, ResidentQueryDto } from './resident.dto.js';

@ApiTags('Residents')
@ApiBearerAuth()
@UseGuards(SessionGuard)
@Controller('residents')
export class ResidentController {
  constructor(@Inject(ResidentService) private readonly residentService: ResidentService) {}

  @Post()
  @UseGuards(OriginGuard, CsrfGuard)
  @ApiOperation({ summary: 'Create a new resident' })
  async create(@Req() req: AuthenticatedRequest, @Body() dto: CreateResidentDto) {
    const organizationId = req.auth!.organizationId;
    return this.residentService.create(organizationId, dto);
  }

  @Get()
  @ApiOperation({ summary: 'List residents with pagination and filters' })
  async findAll(@Req() req: AuthenticatedRequest, @Query() query: ResidentQueryDto) {
    const organizationId = req.auth!.organizationId;
    return this.residentService.findAll(organizationId, query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a resident by id' })
  async findOne(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    const organizationId = req.auth!.organizationId;
    return this.residentService.findOne(organizationId, id);
  }

  @Put(':id')
  @UseGuards(OriginGuard, CsrfGuard)
  @ApiOperation({ summary: 'Update a resident' })
  async update(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() dto: UpdateResidentDto,
  ) {
    const organizationId = req.auth!.organizationId;
    return this.residentService.update(organizationId, id, dto);
  }

  @Delete(':id')
  @UseGuards(OriginGuard, CsrfGuard)
  @ApiOperation({ summary: 'Archive a resident' })
  async delete(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    const organizationId = req.auth!.organizationId;
    return this.residentService.delete(organizationId, id);
  }
}
