import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import { isAdminAllowlistConfigured, isAdminEmail } from '../admin-emails';

/**
 * AdminGuard
 *
 * Runs AFTER JwtAuthGuard in the guard chain. JwtAuthGuard populates
 * `request.user` from the `ptah_auth` cookie. This guard then checks the
 * user's email against the ADMIN_EMAILS environment variable (comma-separated,
 * case-insensitive).
 *
 * Expected env var:
 *   ADMIN_EMAILS="admin@example.com,other@example.com"
 *
 * Security posture:
 *   - Denies (403) if user is missing, email is missing, or email not in allowlist.
 *   - Denies (403) if ADMIN_EMAILS is completely unset — fail-closed, never open.
 *   - Logs every denial with the user email and request path for audit.
 *
 * ⚠️ THE FAIL-CLOSED DECISION STAYS HERE, NOT IN THE HELPER. The allowlist is
 * PARSED by `@ptah-api/identity`'s `isAdminEmail` — the single definition every
 * surface now shares — but `isAdminEmail` answers `false` for an unconfigured
 * allowlist because its other four callers are informational flags that must
 * never throw. This guard is the one AUTHORIZING caller, so it asks
 * `isAdminAllowlistConfigured` FIRST and denies outright. Reading that as
 * "nobody is an admin" and continuing is how a deploy that drops the env var
 * quietly opens the admin surface.
 *
 * Usage:
 *   @UseGuards(JwtAuthGuard, AdminGuard) // order matters — JwtAuthGuard first
 */
@Injectable()
export class AdminGuard implements CanActivate {
  private readonly logger = new Logger(AdminGuard.name);

  constructor(@Inject(ConfigService) private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    const user = req.user; // populated by JwtAuthGuard

    if (!isAdminAllowlistConfigured(this.config)) {
      this.logger.error(
        'ADMIN_EMAILS env var is not configured — denying all admin access',
      );
      throw new ForbiddenException(
        'Admin access not configured on this server',
      );
    }

    if (!user?.email) {
      this.logger.warn(
        `Admin denied: no authenticated user on ${req.method} ${req.path}`,
      );
      throw new ForbiddenException('Admin access requires authentication');
    }

    if (!isAdminEmail(this.config, user.email)) {
      this.logger.warn(
        `Admin denied for ${user.email.toLowerCase()} on ${req.method} ${
          req.path
        }`,
      );
      throw new ForbiddenException('This account is not an admin');
    }

    return true;
  }
}
