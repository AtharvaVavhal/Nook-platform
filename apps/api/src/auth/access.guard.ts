import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { log } from '../observability/json-logger.js';
import { authenticateRequest } from './auth.guards.js';
import type { AuthenticatedRequest } from './auth.types.js';
import { ROUTE_ACCESS_KEY, roleHasPermission, type RouteAccess } from './permissions.js';
import { SessionService } from './session.service.js';

/**
 * Global default-deny guard (registered once, as APP_GUARD). Runs before any controller-level guard.
 *
 *  - no declaration              -> 403 ROUTE_NOT_DECLARED (a new route is closed until someone decides who may use it)
 *  - @Public()                   -> allowed without a session
 *  - @SelfService()              -> any role with a valid session
 *  - @RequirePermission(p)       -> valid session AND the role holds p, otherwise 403 INSUFFICIENT_ROLE
 *
 * Existing controller guards (SessionGuard, Origin/CSRF, RoleGuard) and in-service role rules still run after
 * this guard; nothing is removed.
 */
@Injectable()
export class AccessGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(SessionService) private readonly sessions: SessionService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') throw new ForbiddenException({ code: 'ROUTE_NOT_DECLARED' });
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const access = this.reflector.getAllAndOverride<RouteAccess | undefined>(ROUTE_ACCESS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!access) {
      log.warn('route has no access declaration', {
        context: 'access',
        route: `${context.getClass().name}.${context.getHandler().name}`,
      });
      throw new ForbiddenException({ code: 'ROUTE_NOT_DECLARED' });
    }
    if (access.kind === 'public') return true;
    const auth = await authenticateRequest(this.sessions, request);
    if (access.kind === 'self') return true;
    if (access.kind === 'permission' && roleHasPermission(auth.role, access.permission))
      return true;
    log.warn('permission denied', {
      context: 'access',
      permission: access.kind === 'permission' ? access.permission : 'unknown',
      role: String(auth.role),
      route: `${context.getClass().name}.${context.getHandler().name}`,
    });
    throw new ForbiddenException({ code: 'INSUFFICIENT_ROLE' });
  }
}
