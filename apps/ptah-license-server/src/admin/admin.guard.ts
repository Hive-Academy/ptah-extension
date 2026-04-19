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

/**
 * AdminGuard
 *
 * Runs AFTER JwtAuthGuard in the guard chain. JwtAuthGuard populates
 * `request.user` from the `ptah_auth` cookie. This guard then checks the
 * user's email against the ADMIN_EMAILS environment variable (comma-separated,
 * case-insensitive).
 *
 * Expected env var:
 *   ADMIN_EMAILS="abdallah@miramarstaffing.com,other@example.com"
 *
 * Security posture:
 *   - Denies (403) if user is missing, email is missing, or email not in allowlist.
 *   - Denies (403) if ADMIN_EMAILS is completely unset — fail-closed, never open.
 *   - Logs every denial with the user email and request path for audit.
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

    const raw = this.config.get<string>('ADMIN_EMAILS');
    if (!raw || raw.trim().length === 0) {
      this.logger.error(
        'ADMIN_EMAILS env var is not configured — denying all admin access',
      );
      throw new ForbiddenException(
        'Admin access not configured on this server',
      );
    }

    const allowlist = raw
      .split(',')
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean);

    if (!user?.email) {
      this.logger.warn(
        `Admin denied: no authenticated user on ${req.method} ${req.path}`,
      );
      throw new ForbiddenException('Admin access requires authentication');
    }

    const email = user.email.toLowerCase();
    if (!allowlist.includes(email)) {
      this.logger.warn(
        `Admin denied for ${email} on ${req.method} ${req.path}`,
      );
      throw new ForbiddenException('This account is not an admin');
    }

    return true;
  }
}
