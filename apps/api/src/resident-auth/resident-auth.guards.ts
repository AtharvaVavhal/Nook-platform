import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { loadRuntimeConfig } from '../config.js';
import { CSRF_HEADER, parseCookies } from '../auth/auth.guards.js';
import type { HttpRequest } from '../auth/auth.types.js';
import { CsrfService } from '../auth/csrf.service.js';
import { RESIDENT_CSRF_COOKIE } from './policy.js';

/** The resident portal is off until RESIDENT_WEB_ORIGIN is configured: its routes then do not exist as far as callers can tell. */
@Injectable()
export class ResidentPortalEnabledGuard implements CanActivate {
  canActivate(): boolean {
    if (!loadRuntimeConfig().residentWebOrigin) throw new NotFoundException();
    return true;
  }
}

/** Exact match with the resident portal origin. The owner app's origin is NOT accepted here, and the reverse holds for staff routes. */
@Injectable()
export class ResidentOriginGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<HttpRequest>();
    const origin = request.headers.origin;
    const allowed = loadRuntimeConfig().residentWebOrigin;
    if (typeof origin !== 'string' || !allowed || origin !== allowed) {
      throw new ForbiddenException({ code: 'INVALID_ORIGIN' });
    }
    return true;
  }
}

/** Double-submit CSRF check against the resident CSRF cookie (a different cookie from the owner app's). */
@Injectable()
export class ResidentCsrfGuard implements CanActivate {
  private readonly csrf = new CsrfService();
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<HttpRequest>();
    const cookies = parseCookies(request.headers.cookie);
    const header = request.headers[CSRF_HEADER];
    const headerToken = Array.isArray(header) ? header[0] : header;
    if (!this.csrf.matches(cookies.get(RESIDENT_CSRF_COOKIE), headerToken)) {
      throw new ForbiddenException({ code: 'INVALID_CSRF_TOKEN' });
    }
    return true;
  }
}
