import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import type { Request } from 'express';

/**
 * AdminThrottlerGuard — per-admin-email rate limiting (TASK_2025_292 Q10).
 *
 * The default `ThrottlerGuard` tracks clients by IP. That's wrong for admin
 * routes: an admin moves between networks (laptop ↔ phone hotspot) and would
 * repeatedly reset the budget. Tracking by `req.user.email` (populated by
 * `JwtAuthGuard`, validated by `AdminGuard`) gives a stable per-admin bucket.
 *
 * Guard chain ordering (caller responsibility):
 *   `@UseGuards(JwtAuthGuard, AdminGuard, AdminThrottlerGuard)`
 *
 * By the time this guard runs, `req.user.email` is guaranteed non-empty —
 * `AdminGuard` rejected the request otherwise. The `?? req.ip` fallback is
 * defensive only: any code path that ever bypasses `AdminGuard` still gets
 * *some* tracker (never the default anonymous-everyone bucket).
 */
@Injectable()
export class AdminThrottlerGuard extends ThrottlerGuard {
  protected override async getTracker(req: Request): Promise<string> {
    const email = req.user?.email;
    if (typeof email === 'string' && email.length > 0) {
      return email.toLowerCase();
    }
    return req.ip ?? 'unknown';
  }
}
