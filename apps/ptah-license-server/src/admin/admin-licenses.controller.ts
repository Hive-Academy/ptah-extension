import {
  Body,
  Controller,
  Inject,
  Logger,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { JwtAuthGuard } from '../app/auth/guards/jwt-auth.guard';
import { AdminGuard } from './admin.guard';
import { AdminThrottlerGuard } from './admin-throttler.guard';
import { LicenseService } from '../license/services/license.service';
import type { ComplimentaryLicenseResult } from '../license/services/license.service';
import { IssueComplimentaryLicenseDto } from '../license/dto/issue-complimentary-license.dto';

/**
 * AdminLicensesController — admin-gifted complimentary licences
 * (TASK_2026_170 R2).
 *
 * Mounted at `/api/v1/admin/licenses/*` — path UNCHANGED by the R2 split; only
 * the owning class changed. Guard chain: `JwtAuthGuard` → `AdminGuard` at CLASS
 * level, i.e. a DASHBOARD route authenticated by an admin's session cookie.
 *
 * ⚠️ NOT TO BE CONFUSED WITH `POST /api/v1/admin/licenses` (no
 * `/complimentary`), which today still belongs to
 * `license/controllers/admin.controller.ts` and is authenticated by an
 * `x-api-key` header via `AdminApiKeyGuard` — a machine/ops integration, a
 * completely different trust model that merely looks like a neighbour.
 * TASK_2026_170 R3 moves that one to `v1/integrations/licenses`, after which
 * this prefix is owned by exactly one controller and one auth model.
 *
 * ⚠️ VALIDATION DEBT: `@Body()` is still bare. Binding is TASK_2026_170 B7c;
 * tracked by `src/common/controller-validation.spec.ts`'s `UNVALIDATED_DEBT`
 * ledger.
 */
@Controller('v1/admin/licenses')
@UseGuards(JwtAuthGuard, AdminGuard)
export class AdminLicensesController {
  private readonly logger = new Logger(AdminLicensesController.name);

  constructor(
    @Inject(LicenseService) private readonly licenseService: LicenseService,
  ) {}

  /**
   * POST /licenses/complimentary — issue an admin-gifted complimentary license
   * (TASK_2025_292 §5.1, §6.3).
   *
   * Guard chain: `JwtAuthGuard` → `AdminGuard` (class-level) → `AdminThrottlerGuard`
   * (per-admin-email bucket). Throttle: 20/minute — high enough for a migration
   * batch but still a hard upper bound.
   */
  @Post('complimentary')
  @UseGuards(AdminThrottlerGuard)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async issueComplimentaryLicense(
    @Req() req: Request,
    @Body() body: IssueComplimentaryLicenseDto,
  ): Promise<ComplimentaryLicenseResult> {
    const actorEmail = req.user?.email ?? 'unknown';
    const userAgent = req.headers['user-agent'];
    this.logger.log(
      `Admin POST complimentary-license: actor=${actorEmail} targetUserId=${body.userId} preset=${body.durationPreset} stack=${body.stackOnTopOfPaid === true}`,
    );
    return this.licenseService.createComplimentaryLicense(body, {
      email: actorEmail,
      ip: req.ip,
      userAgent: typeof userAgent === 'string' ? userAgent : undefined,
    });
  }
}
