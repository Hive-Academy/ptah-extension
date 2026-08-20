import {
  Body,
  Controller,
  HttpCode,
  Inject,
  Logger,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { JwtAuthGuard } from '@ptah-api/identity';
import { AdminGuard } from '@ptah-api/identity';
import { AdminThrottlerGuard } from '@ptah-api/identity';
import { dtoPipe } from '@ptah-api/core';
import { ApproveWaitlistDto } from './admin.dto';
import { WaitlistApprovalService } from './waitlist-approval/waitlist-approval.service';
import type { WaitlistApprovalResponse } from './waitlist-approval/waitlist-approval.types';

/**
 * AdminWaitlistController — approve waitlist rows to the founding cohort
 * (TASK_2026_201 R1, R8).
 *
 * Mounted at `/api/v1/admin/waitlist/*`. Guard chain: `JwtAuthGuard` →
 * `AdminGuard` at CLASS level, i.e. a DASHBOARD route authenticated by an
 * admin's session cookie.
 *
 * ⚠️ THIS CLASS REPLACES A DELETED ONE OF THE SAME NAME, AND THE PATH IS THE
 * ONLY THING THEY SHARE. The previous `AdminWaitlistController` owned
 * `POST /waitlist/invite`, the PAID founding-discount invite wave. TASK_2026_201
 * deletes that flow outright rather than repointing it (context.md C2) — the
 * route, its DTO, its service method and its mail template are all gone — and
 * `POST /waitlist/approve` grants FREE access instead. Nothing here is a
 * rename of anything there.
 *
 * ⚠️ EVERY `@Body()` / `@Query()` PARAM MUST BIND `dtoPipe(TheDto)`.
 * A bare `@Body() dto: X` is SILENTLY UNVALIDATED in this server: esbuild does
 * not emit `emitDecoratorMetadata`, so Nest cannot infer the DTO type and the
 * global ValidationPipe short-circuits — every `class-validator` decorator
 * becomes inert. See `libs/api/core/src/lib/common/dto-validation.pipe.ts`.
 * `apps/ptah-license-server/src/common/controller-validation.spec.ts` fails the
 * build if a binding is dropped.
 *
 * The stakes here are GRANTS as well as outbound mail, and `@ArrayMaxSize(50)`
 * on `ApproveWaitlistDto.ids` is the only bound on both: each id in the array
 * becomes a free 1-year Builders licence, a founding-cohort placement and one
 * welcome email. Unbind the pipe and that cap stops existing.
 */
@Controller('v1/admin/waitlist')
@UseGuards(JwtAuthGuard, AdminGuard)
export class AdminWaitlistController {
  private readonly logger = new Logger(AdminWaitlistController.name);

  constructor(
    @Inject(WaitlistApprovalService)
    private readonly approval: WaitlistApprovalService,
  ) {}

  /**
   * POST /waitlist/approve — approve N waitlist rows to the founding cohort.
   *
   * Body: `{ ids: string[] }` (1..50 waitlist row ids). Per row, in one
   * transaction: claim the row, find-or-create the user, issue a free 1-year
   * `builders` complimentary licence, assign the `founding` cohort, stamp
   * `approvedAt`, write the `waitlist.approve` audit row. After commit: one
   * welcome email carrying the licence key.
   *
   * ⚠️ ALWAYS `200` ONCE THE BODY VALIDATES AND THE COHORT RESOLVES. Per-row
   * failures are reported as per-row outcomes (`approved`, `already_approved`,
   * `already_paid`, `not_found`, `failed`), never as an HTTP status: a 4xx/5xx
   * for one bad id in a batch of 50 would tell the admin nothing about the
   * other 49, all of which committed (R1.6, R2.4). The one exception is an
   * unprovisioned `founding` group, which throws a sanitized 500 BEFORE any row
   * is touched, so no licence is issued for any of them (R1.5).
   *
   * ⚠️ NO `AuditLogService` HERE. The `waitlist.approve` row is written INSIDE
   * the service's per-row transaction (PRE-6) so it commits and rolls back with
   * the grant. Writing it from the controller would put it outside every
   * transaction and produce audit rows for grants that rolled back.
   *
   * Guard chain: `JwtAuthGuard` → `AdminGuard` (class-level) →
   * `AdminThrottlerGuard` (per-admin-email bucket). Throttle: 10/minute,
   * matching the invite wave this replaces. The batch cap lives in the DTO, not
   * the throttle, precisely so a 25-row cohort cannot trip a per-request limit
   * halfway through and strand itself half-approved (R8).
   */
  @Post('approve')
  @HttpCode(200)
  @UseGuards(AdminThrottlerGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async approveWaitlist(
    @Req() req: Request,
    @Body(dtoPipe(ApproveWaitlistDto)) body: ApproveWaitlistDto,
  ): Promise<WaitlistApprovalResponse> {
    const actorEmail = req.user?.email ?? 'unknown';
    const userAgent = req.headers['user-agent'];

    this.logger.log(
      `Admin POST waitlist approve: actor=${actorEmail} rows=${body.ids.length}`,
    );

    return this.approval.approve(body.ids, {
      email: actorEmail,
      ip: req.ip,
      userAgent: typeof userAgent === 'string' ? userAgent : undefined,
    });
  }
}
