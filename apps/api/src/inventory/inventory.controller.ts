import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { CsrfGuard, OriginGuard, SessionGuard } from '../auth/auth.guards.js';
import type { AuthenticatedRequest } from '../auth/auth.types.js';
import { InventoryService } from './inventory.service.js';
import {
  codeField,
  invalidInput,
  labelField,
  ordinalField,
  operationalStatusField,
  outOfServiceReasonField,
  parseBody,
  parseUuid,
  rejectOrganizationFields,
  stringField,
} from './inventory.validation.js';
import { RequirePermission } from '../auth/permissions.js';

@Controller()
@UseGuards(SessionGuard)
export class InventoryController {
  constructor(@Inject(InventoryService) private readonly inventory: InventoryService) {}

  @RequirePermission('inventory.read')
  @Get('properties')
  listProperties(@Req() request: AuthenticatedRequest) {
    return this.inventory.listProperties(request.auth!);
  }

  @RequirePermission('inventory.write')
  @Post('properties')
  @UseGuards(OriginGuard, CsrfGuard)
  createProperty(@Req() request: AuthenticatedRequest, @Body() body: unknown) {
    const input = parseBody(body);
    rejectOrganizationFields(input);
    return this.inventory.createProperty(request.auth!, {
      code: codeField(input, true)!,
      name: stringField(input, 'name', true)!,
    });
  }

  @RequirePermission('inventory.read')
  @Get('properties/:propertyId')
  getProperty(@Req() request: AuthenticatedRequest, @Param('propertyId') propertyId: string) {
    return this.inventory.getProperty(request.auth!, parseUuid(propertyId, 'propertyId'));
  }

  @RequirePermission('inventory.write')
  @Patch('properties/:propertyId')
  @UseGuards(OriginGuard, CsrfGuard)
  updateProperty(
    @Req() request: AuthenticatedRequest,
    @Param('propertyId') propertyId: string,
    @Body() body: unknown,
  ) {
    const input = parseBody(body);
    rejectOrganizationFields(input);
    const code = codeField(input, false);
    const name = stringField(input, 'name', false);
    return this.inventory.updateProperty(request.auth!, parseUuid(propertyId, 'propertyId'), {
      ...(code !== undefined ? { code } : {}),
      ...(name !== undefined ? { name } : {}),
    });
  }

  @RequirePermission('inventory.write')
  @Post('properties/:propertyId/archive')
  @UseGuards(OriginGuard, CsrfGuard)
  @HttpCode(HttpStatus.OK)
  archiveProperty(@Req() request: AuthenticatedRequest, @Param('propertyId') propertyId: string) {
    return this.inventory.archiveProperty(request.auth!, parseUuid(propertyId, 'propertyId'));
  }

  @RequirePermission('inventory.read')
  @Get('properties/:propertyId/floors')
  listFloors(@Req() request: AuthenticatedRequest, @Param('propertyId') propertyId: string) {
    return this.inventory.listFloors(request.auth!, parseUuid(propertyId, 'propertyId'));
  }

  @RequirePermission('inventory.write')
  @Post('properties/:propertyId/floors')
  @UseGuards(OriginGuard, CsrfGuard)
  createFloor(
    @Req() request: AuthenticatedRequest,
    @Param('propertyId') propertyId: string,
    @Body() body: unknown,
  ) {
    const input = parseBody(body);
    rejectOrganizationFields(input);
    return this.inventory.createFloor(request.auth!, parseUuid(propertyId, 'propertyId'), {
      label: labelField(input, true)!,
      ordinal: ordinalField(input, true)!,
    });
  }

  @RequirePermission('inventory.write')
  @Patch('floors/:floorId')
  @UseGuards(OriginGuard, CsrfGuard)
  updateFloor(
    @Req() request: AuthenticatedRequest,
    @Param('floorId') floorId: string,
    @Body() body: unknown,
  ) {
    const input = parseBody(body);
    rejectOrganizationFields(input);
    const label = labelField(input, false);
    const ordinal = ordinalField(input, false);
    return this.inventory.updateFloor(request.auth!, parseUuid(floorId, 'floorId'), {
      ...(label !== undefined ? { label } : {}),
      ...(ordinal !== undefined ? { ordinal } : {}),
    });
  }

  @RequirePermission('inventory.write')
  @Post('floors/:floorId/archive')
  @UseGuards(OriginGuard, CsrfGuard)
  @HttpCode(HttpStatus.OK)
  archiveFloor(@Req() request: AuthenticatedRequest, @Param('floorId') floorId: string) {
    return this.inventory.archiveFloor(request.auth!, parseUuid(floorId, 'floorId'));
  }

  @RequirePermission('inventory.read')
  @Get('properties/:propertyId/rooms')
  listRooms(
    @Req() request: AuthenticatedRequest,
    @Param('propertyId') propertyId: string,
    @Query('floorId') floorId?: string,
    @Query('q') query?: string,
  ) {
    return this.inventory.listRooms(
      request.auth!,
      parseUuid(propertyId, 'propertyId'),
      floorId ? parseUuid(floorId, 'floorId') : undefined,
      query?.trim() || undefined,
    );
  }

  @RequirePermission('inventory.write')
  @Post('properties/:propertyId/rooms')
  @UseGuards(OriginGuard, CsrfGuard)
  createRoom(
    @Req() request: AuthenticatedRequest,
    @Param('propertyId') propertyId: string,
    @Body() body: unknown,
  ) {
    const input = parseBody(body);
    rejectOrganizationFields(input);
    return this.inventory.createRoom(request.auth!, parseUuid(propertyId, 'propertyId'), {
      floorId: parseUuid(stringField(input, 'floorId', true)!, 'floorId'),
      label: labelField(input, true)!,
    });
  }

  @RequirePermission('inventory.write')
  @Patch('rooms/:roomId')
  @UseGuards(OriginGuard, CsrfGuard)
  updateRoom(
    @Req() request: AuthenticatedRequest,
    @Param('roomId') roomId: string,
    @Body() body: unknown,
  ) {
    const input = parseBody(body);
    rejectOrganizationFields(input);
    const label = labelField(input, false);
    return this.inventory.updateRoom(request.auth!, parseUuid(roomId, 'roomId'), {
      ...(label !== undefined ? { label } : {}),
    });
  }

  @RequirePermission('inventory.write')
  @Post('rooms/:roomId/archive')
  @UseGuards(OriginGuard, CsrfGuard)
  @HttpCode(HttpStatus.OK)
  archiveRoom(@Req() request: AuthenticatedRequest, @Param('roomId') roomId: string) {
    return this.inventory.archiveRoom(request.auth!, parseUuid(roomId, 'roomId'));
  }

  @RequirePermission('inventory.read')
  @Get('rooms/:roomId/beds')
  listBeds(@Req() request: AuthenticatedRequest, @Param('roomId') roomId: string) {
    return this.inventory.listBeds(request.auth!, parseUuid(roomId, 'roomId'));
  }

  @RequirePermission('inventory.write')
  @Post('rooms/:roomId/beds')
  @UseGuards(OriginGuard, CsrfGuard)
  createBed(
    @Req() request: AuthenticatedRequest,
    @Param('roomId') roomId: string,
    @Body() body: unknown,
  ) {
    const input = parseBody(body);
    rejectOrganizationFields(input);
    const operationalStatus = operationalStatusField(input);
    if (!operationalStatus) throw invalidInput('operationalStatus', 'REQUIRED');
    const reason = outOfServiceReasonField(input, operationalStatus);
    return this.inventory.createBed(request.auth!, parseUuid(roomId, 'roomId'), {
      label: labelField(input, true)!,
      operationalStatus,
      ...(reason ? { outOfServiceReason: reason } : {}),
    });
  }

  @RequirePermission('inventory.write')
  @Patch('beds/:bedId')
  @UseGuards(OriginGuard, CsrfGuard)
  updateBed(
    @Req() request: AuthenticatedRequest,
    @Param('bedId') bedId: string,
    @Body() body: unknown,
  ) {
    const input = parseBody(body);
    rejectOrganizationFields(input);
    const operationalStatus = operationalStatusField(input);
    const reason = outOfServiceReasonField(input, operationalStatus);
    const label = labelField(input, false);
    return this.inventory.updateBed(request.auth!, parseUuid(bedId, 'bedId'), {
      ...(label !== undefined ? { label } : {}),
      ...(operationalStatus !== undefined ? { operationalStatus } : {}),
      ...(reason !== undefined ? { outOfServiceReason: reason } : {}),
    });
  }

  @RequirePermission('inventory.write')
  @Post('beds/:bedId/archive')
  @UseGuards(OriginGuard, CsrfGuard)
  @HttpCode(HttpStatus.OK)
  archiveBed(@Req() request: AuthenticatedRequest, @Param('bedId') bedId: string) {
    return this.inventory.archiveBed(request.auth!, parseUuid(bedId, 'bedId'));
  }

  @RequirePermission('inventory.read')
  @Get('inventory/summary')
  getInventorySummary(@Req() request: AuthenticatedRequest) {
    return this.inventory.getInventorySummary(request.auth!);
  }
}
