import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { parseCookies } from '../auth/auth.guards.js';
import type { HttpRequest, HttpResponse } from '../auth/auth.types.js';
import { CsrfService } from '../auth/csrf.service.js';
import { loadRuntimeConfig } from '../config.js';
import { requireObject } from '../common/input.js';
import { Public, RequireResidentPermission, ResidentSessionOnly } from '../auth/permissions.js';
import {
  RESIDENT_CSRF_COOKIE,
  RESIDENT_SESSION_ABSOLUTE_MS,
  RESIDENT_SESSION_COOKIE,
} from './policy.js';
import {
  ResidentCsrfGuard,
  ResidentOriginGuard,
  ResidentPortalEnabledGuard,
} from './resident-auth.guards.js';
import { ResidentAuthService } from './resident-auth.service.js';
import type { ResidentAuthenticatedRequest } from './resident-auth.types.js';

/** Same protections as the owner cookies (HttpOnly, SameSite=Strict, Secure in production, no Domain), different names. */
const cookieOptions = (secure: boolean) => ({
  httpOnly: true,
  secure,
  sameSite: 'strict' as const,
  path: '/',
});

@ApiTags('Resident sign-in')
@UseGuards(ResidentPortalEnabledGuard)
@Controller('resident-auth')
export class ResidentAuthController {
  constructor(
    @Inject(ResidentAuthService) private readonly auth: ResidentAuthService,
    @Inject(CsrfService) private readonly csrf: CsrfService,
  ) {}

  private secure(): boolean {
    return loadRuntimeConfig().secureCookies;
  }

  @Public()
  @Get('csrf')
  getCsrf(@Req() request: HttpRequest, @Res({ passthrough: true }) response: HttpResponse) {
    const token =
      parseCookies(request.headers.cookie).get(RESIDENT_CSRF_COOKIE) ?? this.csrf.createToken();
    response.cookie(RESIDENT_CSRF_COOKIE, token, {
      ...cookieOptions(this.secure()),
      maxAge: RESIDENT_SESSION_ABSOLUTE_MS,
    });
    response.setHeader('Cache-Control', 'no-store');
    return { data: { csrfToken: token } };
  }

  @Public()
  @Post('otp/request')
  @UseGuards(ResidentOriginGuard)
  @HttpCode(HttpStatus.OK)
  async requestOtp(
    @Req() request: HttpRequest,
    @Res({ passthrough: true }) response: HttpResponse,
  ) {
    const body = requireObject(request.body);
    response.setHeader('Cache-Control', 'no-store');
    return { data: await this.auth.requestOtp(body.phone, request.ip ?? 'unknown') };
  }

  @Public()
  @Post('otp/verify')
  @UseGuards(ResidentOriginGuard)
  @HttpCode(HttpStatus.OK)
  async verifyOtp(@Req() request: HttpRequest, @Res({ passthrough: true }) response: HttpResponse) {
    const body = requireObject(request.body);
    const result = await this.auth.verifyOtp(body.phone, body.code, request.ip ?? 'unknown');
    response.cookie(RESIDENT_SESSION_COOKIE, result.secret, {
      ...cookieOptions(this.secure()),
      maxAge: RESIDENT_SESSION_ABSOLUTE_MS,
    });
    // A fresh CSRF value with every sign-in, exactly as for the owner app.
    response.cookie(RESIDENT_CSRF_COOKIE, this.csrf.createToken(), {
      ...cookieOptions(this.secure()),
      maxAge: RESIDENT_SESSION_ABSOLUTE_MS,
    });
    response.setHeader('Cache-Control', 'no-store');
    return { data: { authenticated: true } };
  }

  @ResidentSessionOnly()
  @Post('logout')
  @UseGuards(ResidentOriginGuard, ResidentCsrfGuard)
  @HttpCode(HttpStatus.OK)
  async logout(
    @Req() request: ResidentAuthenticatedRequest,
    @Res({ passthrough: true }) response: HttpResponse,
  ) {
    await this.auth.logout(request.residentAuth!);
    response.clearCookie(RESIDENT_SESSION_COOKIE, cookieOptions(this.secure()));
    response.clearCookie(RESIDENT_CSRF_COOKIE, cookieOptions(this.secure()));
    return { data: { loggedOut: true } };
  }

  @RequireResidentPermission('resident.self.read')
  @Get('me')
  me(
    @Req() request: ResidentAuthenticatedRequest,
    @Res({ passthrough: true }) response: HttpResponse,
  ) {
    response.setHeader('Cache-Control', 'no-store');
    return { data: this.auth.me(request.residentAuth!) };
  }
}
