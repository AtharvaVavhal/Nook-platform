import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { parseLoginDto } from './auth.dto.js';
import type {
  AuthenticatedContext,
  AuthenticatedRequest,
  HttpRequest,
  HttpResponse,
} from './auth.types.js';
import {
  CSRF_COOKIE,
  CsrfGuard,
  OriginGuard,
  parseCookies,
  SESSION_COOKIE,
  SessionGuard,
} from './auth.guards.js';
import { AuthService } from './auth.service.js';
import { CsrfService } from './csrf.service.js';
import { SessionService } from './session.service.js';
import { loadRuntimeConfig } from '../config.js';
import { Public, SelfService } from '../auth/permissions.js';

const cookieOptions = (secure: boolean) => ({
  httpOnly: true,
  secure,
  sameSite: 'strict' as const,
  path: '/',
});

@Controller('auth')
export class AuthController {
  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(CsrfService) private readonly csrf: CsrfService,
    @Inject(SessionService) private readonly sessions: SessionService,
  ) {}

  private secureCookies(): boolean {
    return loadRuntimeConfig().secureCookies;
  }

  @Public()
  @Post('login')
  @UseGuards(OriginGuard)
  @HttpCode(HttpStatus.OK)
  async login(@Req() request: HttpRequest, @Res({ passthrough: true }) response: HttpResponse) {
    let input: { email: string; password: string };
    try {
      input = parseLoginDto(request.body);
    } catch {
      throw new UnauthorizedException({ code: 'INVALID_CREDENTIALS' });
    }
    const result = await this.auth.login(input.email, input.password, request.ip ?? 'unknown');
    response.cookie(SESSION_COOKIE, result.secret, {
      ...cookieOptions(this.secureCookies()),
      maxAge: 8 * 60 * 60 * 1000,
    });
    // A fresh CSRF token with every sign-in. The cookie is HttpOnly: the web app never reads it, it gets the same
    // value from GET /auth/csrf and sends it back in a header (double submit).
    response.cookie(CSRF_COOKIE, this.csrf.createToken(), {
      ...cookieOptions(this.secureCookies()),
      maxAge: 8 * 60 * 60 * 1000,
    });
    response.setHeader('Cache-Control', 'no-store');
    return { data: { user: publicContext(result.context) } };
  }

  @SelfService()
  @Post('logout')
  @UseGuards(OriginGuard, SessionGuard, CsrfGuard)
  @HttpCode(HttpStatus.OK)
  async logout(
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: HttpResponse,
  ) {
    await this.auth.logout(request.auth!);
    response.clearCookie(SESSION_COOKIE, cookieOptions(this.secureCookies()));
    response.clearCookie(CSRF_COOKIE, cookieOptions(this.secureCookies()));
    return { data: { loggedOut: true } };
  }

  @SelfService()
  @Post('password')
  @UseGuards(OriginGuard, SessionGuard, CsrfGuard)
  @HttpCode(HttpStatus.OK)
  async changePassword(@Req() request: AuthenticatedRequest) {
    const body = (request.body ?? {}) as Record<string, unknown>;
    const result = await this.auth.changePassword(
      request.auth!,
      body.currentPassword,
      body.newPassword,
    );
    return { data: { changed: true, otherSessionsRevoked: result.revokedSessions } };
  }

  @SelfService()
  @Get('me')
  @UseGuards(SessionGuard)
  getMe(@Req() request: AuthenticatedRequest) {
    return { data: { user: publicContext(request.auth!) } };
  }

  @Public()
  @Get('csrf')
  getCsrf(@Req() request: HttpRequest, @Res({ passthrough: true }) response: HttpResponse) {
    const cookies = parseCookies(request.headers.cookie);
    const token = cookies.get(CSRF_COOKIE) ?? this.csrf.createToken();
    response.cookie(CSRF_COOKIE, token, {
      ...cookieOptions(this.secureCookies()),
      maxAge: 8 * 60 * 60 * 1000,
    });
    // A token must never be cached by the browser or an intermediary.
    response.setHeader('Cache-Control', 'no-store');
    return { data: { csrfToken: token } };
  }
}

function publicContext(context: AuthenticatedContext) {
  return {
    id: context.userId,
    displayName: context.displayName,
    organization: {
      id: context.organizationId,
      name: context.organizationName,
    },
    role: context.role,
    passwordChangeRequired: context.passwordChangeRequired,
  };
}
