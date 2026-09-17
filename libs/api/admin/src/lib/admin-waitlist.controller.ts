import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Logger,
  Param,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { JwtAuthGuard } from '@ptah-api/identity';
import { AdminGuard } from '@ptah-api/identity';
import { AdminThrottlerGuard } from '@ptah-api/identity';
import { dtoPipe } from '@ptah-api/core';
import { ApproveWaitlistDto } from './admin.dto';
import {
  WaitlistFilterQueryDto,
  WaitlistIdParamsDto,
  WaitlistListQueryDto,
} from './admin-waitlist.dto';
import { AdminWaitlistService } from './admin-waitlist.service';
import type {
  WaitlistDetailsResponse,
  WaitlistEligibleIdsResponse,
  WaitlistListResponse,
} from './admin-waitlist.types';
import { WaitlistApprovalService } from './waitlist-approval/waitlist-approval.service';
import type { WaitlistApprovalResponse } from './waitlist-approval/waitlist-approval.types';

/**
 * AdminWaitlistController — admin waitlist pipeline read surface and founding cohort approval
 * (TASK_2026_201 R1, R8; TASK_2026_462 Batch A).
 *
 * Mounted at `/api/v1/admin/waitlist/*`. Guard chain: `JwtAuthGuard` →
 * `AdminGuard` at CLASS level, i.e. a DASHBOARD route authenticated by an
 * admin's session cookie.
 *
 * ⚠️ EVERY `@Body()` / `@Query()` / `@Param()` MUST BIND `dtoPipe(TheDto)`.
 * A bare `@Query() query: X` is SILENTLY UNVALIDATED in this server: esbuild does
 * not emit `emitDecoratorMetadata`, so Nest cannot infer the DTO type and the
 * global ValidationPipe short-circuits. See `libs/api/core/src/lib/common/dto-validation.pipe.ts`.
 * `apps/ptah-license-server/src/common/controller-validation.spec.ts` fails the
 * build if a binding is dropped.
 *
 * ⚠️ STATIC ROUTES PRECEDE DYNAMIC `:id/details`. `eligible-ids` and `export.csv`
 * are declared before `:id/details` so their path segments are never matched as `:id`.
 */
@Controller('v1/admin/waitlist')
@UseGuards(JwtAuthGuard, AdminGuard)
export class AdminWaitlistController {
  private readonly logger = new Logger(AdminWaitlistController.name);

  constructor(
    @Inject(WaitlistApprovalService)
    private readonly approval: WaitlistApprovalService,
    @Inject(AdminWaitlistService)
    private readonly waitlist: AdminWaitlistService,
  ) {}

  /**
   * GET /v1/admin/waitlist — paginated list plus filtered stage counts.
   */
  @Get()
  async listWaitlist(
    @Query(dtoPipe(WaitlistListQueryDto)) query: WaitlistListQueryDto,
  ): Promise<WaitlistListResponse> {
    return this.waitlist.list(query);
  }

  /**
   * GET /v1/admin/waitlist/eligible-ids — resolve select-matching to explicit ids,
   * capped at 50. Declared BEFORE `:id/details`.
   */
  @Get('eligible-ids')
  async getEligibleIds(
    @Query(dtoPipe(WaitlistFilterQueryDto)) query: WaitlistFilterQueryDto,
  ): Promise<WaitlistEligibleIdsResponse> {
    return this.waitlist.resolveEligibleIds(query);
  }

  /**
   * GET /v1/admin/waitlist/export.csv — server-generated formula-safe CSV export,
   * audited before download. Declared BEFORE `:id/details`.
   */
  @Get('export.csv')
  async exportCsv(
    @Req() req: Request,
    @Query(dtoPipe(WaitlistFilterQueryDto)) query: WaitlistFilterQueryDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<string> {
    const actorEmail = req.user?.email ?? 'unknown';
    const userAgent = req.headers['user-agent'];
    const actor = {
      email: actorEmail,
      ip: req.ip,
      userAgent: typeof userAgent === 'string' ? userAgent : undefined,
    };

    const result = await this.waitlist.exportCsv(query, actor);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${result.filename}"`,
    );
    return result.csv;
  }

  /**
   * GET /v1/admin/waitlist/:id/details — single waitlist entry plus linked user and audit.
   */
  @Get(':id/details')
  async getDetails(
    @Param(dtoPipe(WaitlistIdParamsDto)) params: WaitlistIdParamsDto,
  ): Promise<WaitlistDetailsResponse> {
    return this.waitlist.getDetails(params.id);
  }

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
