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
import { JwtAuthGuard } from '@ptah-api/identity';
import { AdminGuard } from '@ptah-api/identity';
import { AdminThrottlerGuard } from '@ptah-api/identity';
import { dtoPipe } from '@ptah-api/core';
import { LicenseService } from '@ptah-api/licensing';
import type { ComplimentaryLicenseResult } from '@ptah-api/licensing';
import { IssueComplimentaryLicenseDto } from '@ptah-api/licensing';

/**
 * AdminLicensesController — admin-gifted complimentary licences
 * (TASK_2026_170 R2).
 *
 * Mounted at `/api/v1/admin/licenses/*` — path UNCHANGED by the R2 split; only
 * the owning class changed. Guard chain: `JwtAuthGuard` → `AdminGuard` at CLASS
 * level, i.e. a DASHBOARD route authenticated by an admin's session cookie.
 *
 * The other license-creation route — `x-api-key`-authenticated, a machine/ops
 * integration on a completely different trust model — used to sit next door at
 * `POST /api/v1/admin/licenses` (no `/complimentary`). TASK_2026_170 R3 moved it
 * to `POST /api/v1/integrations/licenses` as
 * `licensing/IntegrationLicensesController`, so this prefix is now owned by
 * exactly one controller and one auth model.
 *
 * ⚠️ EVERY `@Body()` / `@Query()` PARAM MUST BIND `dtoPipe(TheDto)`.
 * A bare `@Body() dto: X` is SILENTLY UNVALIDATED in this server: esbuild does
 * not emit `emitDecoratorMetadata`, so Nest cannot infer the DTO type and the
 * global ValidationPipe short-circuits — every `class-validator` decorator
 * becomes inert. See `libs/api/core/src/lib/common/dto-validation.pipe.ts`.
 * `apps/ptah-license-server/src/common/controller-validation.spec.ts` fails the
 * build if a binding is dropped.
 *
 * `IssueComplimentaryLicenseDto` is the DTO in this server with the most
 * behaviour riding on that binding: a custom EXACTLY-ONE-OF `userId` XOR
 * `email` cross-field rule, `@ValidateIf` gating `customExpiresAt` on
 * `durationPreset === 'custom'`, and a `@Transform` that trims and lowercases
 * `email` BEFORE `LicenseService.createComplimentaryLicense` find-or-creates a
 * user from it. None of that had ever executed before this binding.
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
    @Body(dtoPipe(IssueComplimentaryLicenseDto))
    body: IssueComplimentaryLicenseDto,
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
