import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { loadRuntimeConfig } from '../config.js';
import { CsrfService } from './csrf.service.js';
import type { AuthenticatedRequest } from './auth.types.js';
import { SessionService } from './session.service.js';

export const SESSION_COOKIE = 'nook_session';
export const CSRF_COOKIE = 'nook_csrf';
export const CSRF_HEADER = 'x-csrf-token';

export function parseCookies(header: string | undefined): Map<string, string> {
  const cookies = new Map<string, string>();
  for (const part of header?.split(';') ?? []) {
    const separator = part.indexOf('=');
    if (separator <= 0) continue;
    const key = part.slice(0, separator).trim();
    try {
      const value = decodeURIComponent(part.slice(separator + 1).trim());
      if (key) cookies.set(key, value);
    } catch {
      continue;
    }
  }
  return cookies;
}

@Injectable()
export class SessionGuard implements CanActivate {
  constructor(@Inject(SessionService) private readonly sessions: SessionService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const secret = parseCookies(request.headers.cookie).get(SESSION_COOKIE);
    const auth = await this.sessions.authenticate(secret ?? '');
    if (!auth) throw new UnauthorizedException({ code: 'UNAUTHENTICATED' });
    request.auth = auth;
    return true;
  }
}

@Injectable()
export class OriginGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const origin = request.headers.origin;
    if (typeof origin !== 'string' || origin !== loadRuntimeConfig().webOrigin) {
      throw new ForbiddenException({ code: 'INVALID_ORIGIN' });
    }
    return true;
  }
}

@Injectable()
export class CsrfGuard implements CanActivate {
  constructor(@Inject(CsrfService) private readonly csrf: CsrfService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const cookies = parseCookies(request.headers.cookie);
    const header = request.headers[CSRF_HEADER];
    const headerToken = Array.isArray(header) ? header[0] : header;
    if (!this.csrf.matches(cookies.get(CSRF_COOKIE), headerToken)) {
      throw new ForbiddenException({ code: 'INVALID_CSRF_TOKEN' });
    }
    return true;
  }
}
