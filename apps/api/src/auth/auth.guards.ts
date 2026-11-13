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
import type { AuthenticatedContext, AuthenticatedRequest } from './auth.types.js';
import { SessionService } from './session.service.js';

export const SESSION_COOKIE = 'nook_session';
export const CSRF_COOKIE = 'nook_csrf';
export const CSRF_HEADER = 'x-csrf-token';

/** While a temporary password is still in use, only these endpoints work. */
const PASSWORD_CHANGE_ALLOWED_PATHS = ['/auth/me', '/auth/logout', '/auth/password', '/auth/csrf'];

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

/**
 * Authenticates the request from its session cookie and enforces the temporary-password restriction. Sets
 * `request.auth`. Shared by SessionGuard and the global AccessGuard so there is exactly one implementation.
 */
export async function authenticateRequest(
  sessions: SessionService,
  request: AuthenticatedRequest,
): Promise<AuthenticatedContext> {
  const secret = parseCookies(request.headers.cookie).get(SESSION_COOKIE);
  const auth = await sessions.authenticate(secret ?? '');
  if (!auth) throw new UnauthorizedException({ code: 'UNAUTHENTICATED' });
  request.auth = auth;
  if (auth.passwordChangeRequired) {
    const path = (request.originalUrl ?? '').split('?')[0] ?? '';
    if (!PASSWORD_CHANGE_ALLOWED_PATHS.some((allowed) => path.endsWith(allowed))) {
      throw new ForbiddenException({ code: 'PASSWORD_CHANGE_REQUIRED' });
    }
  }
  return auth;
}

@Injectable()
export class SessionGuard implements CanActivate {
  constructor(@Inject(SessionService) private readonly sessions: SessionService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    // The global AccessGuard runs first and has already authenticated every non-public request (including the
    // temporary-password restriction); authenticating twice would only touch the session twice.
    if (request.auth) return true;
    await authenticateRequest(this.sessions, request);
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

const ALLOWED_HISTORY_ROLES = new Set<AuthenticatedContext['role']>(['OWNER', 'PROPERTY_MANAGER']);

@Injectable()
export class RoleGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const role = request.auth?.role;
    if (!role || !ALLOWED_HISTORY_ROLES.has(role)) {
      throw new ForbiddenException({ code: 'INSUFFICIENT_ROLE' });
    }
    return true;
  }
}
