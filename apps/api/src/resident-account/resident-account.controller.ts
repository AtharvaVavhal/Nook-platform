import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CsrfGuard, OriginGuard, SessionGuard } from '../auth/auth.guards.js';
import type { AuthenticatedRequest } from '../auth/auth.types.js';
import { RequirePermission } from '../auth/permissions.js';
import { ResidentAccountService } from './resident-account.service.js';

/** Owner-side administration of resident portal access. Owner and manager sessions only; a resident session is refused (403). */
@ApiTags('Resident portal accounts')
@UseGuards(SessionGuard)
@Controller('resident-accounts')
export class ResidentAccountController {
  constructor(@Inject(ResidentAccountService) private readonly accounts: ResidentAccountService) {}

  @RequirePermission('resident.account.manage')
  @Post()
  @UseGuards(OriginGuard, CsrfGuard)
  @ApiOperation({ summary: 'Provision portal access for an existing resident (owner only)' })
  provision(@Req() req: AuthenticatedRequest, @Body() body: unknown) {
    return this.accounts.provision(req.auth!, body);
  }

  @RequirePermission('resident.account.read')
  @Get()
  @ApiOperation({ summary: 'List resident portal accounts in the organization' })
  list(@Req() req: AuthenticatedRequest, @Query() query: unknown) {
    return this.accounts.list(req.auth!, query);
  }

  @RequirePermission('resident.account.manage')
  @Post(':id/suspend')
  @UseGuards(OriginGuard, CsrfGuard)
  @HttpCode(HttpStatus.OK)
  suspend(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    return this.accounts.changeStatus(req.auth!, id, 'suspend', body);
  }

  @RequirePermission('resident.account.manage')
  @Post(':id/revoke')
  @UseGuards(OriginGuard, CsrfGuard)
  @HttpCode(HttpStatus.OK)
  revoke(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    return this.accounts.changeStatus(req.auth!, id, 'revoke', body);
  }

  @RequirePermission('resident.account.manage')
  @Post(':id/reactivate')
  @UseGuards(OriginGuard, CsrfGuard)
  @HttpCode(HttpStatus.OK)
  reactivate(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    return this.accounts.changeStatus(req.auth!, id, 'reactivate', body);
  }

  @RequirePermission('resident.account.manage')
  @Post(':id/phone')
  @UseGuards(OriginGuard, CsrfGuard)
  @HttpCode(HttpStatus.OK)
  changePhone(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: unknown,
  ) {
    return this.accounts.changePhone(req.auth!, id, body);
  }
}
