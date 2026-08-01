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
import { InviteWaitlistDto } from './admin.dto';
import { WaitlistService } from '@ptah-api/marketing';
import { AuditLogService } from '@ptah-api/audit';

/**
 * AdminWaitlistController — the founding early-adopter invite wave
 * (TASK_2026_170 R2).
 *
 * Mounted at `/api/v1/admin/waitlist/*` — path UNCHANGED by the R2 split; only
 * the owning class changed. Guard chain: `JwtAuthGuard` → `AdminGuard` at CLASS
 * level.
 *
 * ⚠️ VALIDATION DEBT: `@Body()` is still bare. Binding is TASK_2026_170 B7d
 * (`InviteWaitlistDto`'s `@Max(1000)` becomes enforced there); tracked by
 * `src/common/controller-validation.spec.ts`'s `UNVALIDATED_DEBT` ledger.
 */
@Controller('v1/admin/waitlist')
@UseGuards(JwtAuthGuard, AdminGuard)
export class AdminWaitlistController {
  private readonly logger = new Logger(AdminWaitlistController.name);

  constructor(
    @Inject(WaitlistService) private readonly waitlist: WaitlistService,
    @Inject(AuditLogService) private readonly auditLog: AuditLogService,
  ) {}

  /**
   * POST /waitlist/invite — send the founding early-adopter invite wave.
   *
   * Body: `{ ids?: string[]; batchSize?: number }` — `ids` wins, else the N
   * oldest un-notified rows. Sends the founding-discount email per row and
   * stamps `notifiedAt`; already-notified rows are skipped. Records one
   * `waitlist.invite` AdminAuditLog row per wave (best-effort — the invites
   * have already been sent, so an audit failure must not fail the request).
   *
   * Guard chain: `JwtAuthGuard` → `AdminGuard` (class-level) → `AdminThrottlerGuard`
   * (per-admin-email bucket). Throttle: 10/minute.
   */
  @Post('invite')
  @HttpCode(200)
  @UseGuards(AdminThrottlerGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async inviteWaitlist(
    @Req() req: Request,
    @Body() body: InviteWaitlistDto,
  ): Promise<{ invited: number; skipped: number }> {
    const actorEmail = req.user?.email ?? 'unknown';
    const userAgent = req.headers['user-agent'];

    const result = await this.waitlist.inviteBatch({
      ids: body.ids,
      batchSize: body.batchSize,
    });

    this.logger.log(
      `Admin waitlist invite wave: actor=${actorEmail} invited=${result.invited} skipped=${result.skipped}`,
    );

    try {
      await this.auditLog.write({
        actorEmail,
        action: 'waitlist.invite',
        targetType: 'Waitlist',
        metadata: {
          invited: result.invited,
          skipped: result.skipped,
          invitedIds: result.invitedIds,
          requestedIds: body.ids ?? null,
          batchSize: body.batchSize ?? null,
        },
        ipAddress: req.ip,
        userAgent: typeof userAgent === 'string' ? userAgent : undefined,
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(
        `Failed to write waitlist.invite audit log: ${message}`,
      );
    }

    return { invited: result.invited, skipped: result.skipped };
  }
}
