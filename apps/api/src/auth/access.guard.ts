import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  Optional,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { log } from '../observability/json-logger.js';
import { authenticateRequest, parseCookies } from './auth.guards.js';
import { RESIDENT_SESSION_COOKIE } from '../resident-auth/policy.js';
import type { ResidentAuthenticatedRequest } from '../resident-auth/resident-auth.types.js';
import { ResidentSessionService } from '../resident-auth/resident-session.service.js';
import type { AuthenticatedRequest } from './auth.types.js';
import {
  ROUTE_ACCESS_KEY,
  residentHasPermission,
  roleHasPermission,
  type RouteAccess,
} from './permissions.js';
import { SessionService } from './session.service.js';

/**
 * Global default-deny guard (registered once, as APP_GUARD). Runs before any controller-level guard.
 *
 *  - no declaration              -> 403 ROUTE_NOT_DECLARED (a new route is closed until someone decides who may use it)
 *  - @Public()                   -> allowed without a session
 *  - @SelfService()              -> any role with a valid session
 *  - @RequirePermission(p)       -> valid session AND the role holds p, otherwise 403 INSUFFICIENT_ROLE
 *  - @ResidentSessionOnly() / @RequireResidentPermission(p)
 *                                -> a valid RESIDENT session (its own cookie and table); a staff session is not accepted here
 *  - a resident session on any staff route -> 403 INSUFFICIENT_ROLE (the principal is known and holds no staff permission)
 *
 * Existing controller guards (SessionGuard, Origin/CSRF, RoleGuard) and in-service role rules still run after
 * this guard; nothing is removed.
 */
@Injectable()
export class AccessGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(SessionService) private readonly sessions: SessionService,
    // Optional so a bare AccessGuard (tests, probes) still works without the resident module.
    @Optional()
    @Inject(ResidentSessionService)
    private readonly residentSessions?: ResidentSessionService,
  ) {}

  private residentSecret(request: ResidentAuthenticatedRequest): string {
    return parseCookies(request.headers.cookie).get(RESIDENT_SESSION_COOKIE) ?? '';
  }

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
    if (access.kind === 'resident') {
      const resident = await this.residentSessions?.authenticate(this.residentSecret(request));
      if (!resident) throw new UnauthorizedException({ code: 'UNAUTHENTICATED' });
      (request as ResidentAuthenticatedRequest).residentAuth = resident;
      if (access.permission && !residentHasPermission(access.permission)) {
        throw new ForbiddenException({ code: 'INSUFFICIENT_ROLE' });
      }
      return true;
    }
    let auth;
    try {
      auth = await authenticateRequest(this.sessions, request);
    } catch (error) {
      // No staff session. If the caller holds a valid RESIDENT session they are a known principal without staff rights: 403, not 401.
      if (error instanceof UnauthorizedException && this.residentSessions) {
        const resident = await this.residentSessions.identify(this.residentSecret(request));
        if (resident) {
          log.warn('resident principal refused on a staff route', {
            context: 'access',
            route: `${context.getClass().name}.${context.getHandler().name}`,
          });
          throw new ForbiddenException({ code: 'INSUFFICIENT_ROLE' });
        }
      }
      throw error;
    }
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
