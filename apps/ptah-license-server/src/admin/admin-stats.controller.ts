import { Controller, Get, Inject, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../app/auth/guards/jwt-auth.guard';
import { AdminGuard } from './admin.guard';
import { AdminService, AdminStatsResponse } from './admin.service';

/**
 * AdminStatsController — founding-launch dashboard aggregates
 * (TASK_2026_170 R2).
 *
 * Mounted at `/api/v1/admin/stats` — path UNCHANGED by the R2 split; only the
 * owning class changed (`@Get('stats')` on `v1/admin` became `@Get()` on
 * `v1/admin/stats`). Guard chain: `JwtAuthGuard` → `AdminGuard` at CLASS level.
 *
 * Returns the waitlist funnel plus active member counts by plan.
 *
 * The old "route ordering: MUST precede the `GET /:model` wildcard, otherwise
 * Nest matches `stats` against `:model` and `assertModel` 400s on the unknown
 * slug" warning is GONE, not forgotten: the wildcard moved to
 * `v1/admin/records/:model`, so `stats` and `:model` are no longer siblings and
 * cannot contest. `src/common/route-map.spec.ts` asserts that mechanically.
 *
 * ⚠️ NOT A DASHBOARD LIVENESS PROBE. This handler runs heavy aggregation;
 * `apps/ptah-landing-page/src/app/guards/admin-auth.guard.ts` deliberately
 * probes `GET /api/v1/admin/records/users?pageSize=1` instead, because the
 * guard fires on every admin route activation.
 *
 * NOTE: zero payload params — no `@Body()`, no `@Query()` — so this controller
 * is correctly ABSENT from `controller-validation.spec.ts`'s
 * `UNVALIDATED_DEBT`. It is under full enforcement and passes vacuously; adding
 * a ledger line for it would fail that spec's staleness assertion.
 */
@Controller('v1/admin/stats')
@UseGuards(JwtAuthGuard, AdminGuard)
export class AdminStatsController {
  constructor(@Inject(AdminService) private readonly admin: AdminService) {}

  @Get()
  async stats(): Promise<AdminStatsResponse> {
    return this.admin.getStats();
  }
}
