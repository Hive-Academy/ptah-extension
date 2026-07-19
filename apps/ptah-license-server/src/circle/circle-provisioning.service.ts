import { Inject, Injectable, Logger } from '@nestjs/common';
import { AuditLogService } from '../audit/audit-log.service';
import { PrismaService } from '../prisma/prisma.service';
import { CircleProvider } from './circle.provider';

/**
 * CircleProvisioningService — orchestrates Circle community membership for paid
 * Builders subscribers, driven by the Paddle webhook fan-out.
 *
 * Every method is BEST-EFFORT and NEVER rethrows: the Paddle webhook path must
 * succeed (and stay idempotent) even when Circle is down, misconfigured, or
 * disabled. Failures are logged and recorded to the admin audit log; they never
 * propagate to the caller.
 *
 * Feature-off mode: when `CIRCLE_API_TOKEN`/`CIRCLE_COMMUNITY_ID` are unset the
 * provider reports `isEnabled() === false`; we log ONCE per process and no-op.
 */
@Injectable()
export class CircleProvisioningService {
  private readonly logger = new Logger(CircleProvisioningService.name);
  private loggedDisabled = false;

  constructor(
    @Inject(CircleProvider) private readonly circle: CircleProvider,
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AuditLogService) private readonly audit: AuditLogService,
  ) {}

  /**
   * Invite a paid Builders member into the Circle community and persist the
   * resulting `circleMemberId` on the user. No-ops in feature-off mode.
   */
  async provisionBuildersMember(userId: string, email: string): Promise<void> {
    if (!this.isEnabledOrLogOnce('provision')) {
      return;
    }

    try {
      const result = await this.circle.inviteMember(email);
      if (!result.ok) {
        this.logger.warn(
          `Circle invite did not succeed for user ${userId} (status: ${
            result.status ?? 'n/a'
          }): ${result.error ?? 'unknown error'}`,
        );
        await this.safeAudit('circle.member.invite', userId, {
          email,
          ok: false,
          status: result.status ?? null,
          error: result.error ?? null,
        });
        return;
      }

      if (result.memberId) {
        await this.prisma.user.update({
          where: { id: userId },
          data: { circleMemberId: result.memberId },
        });
      } else {
        this.logger.warn(
          `Circle invite succeeded for user ${userId} but returned no member id`,
        );
      }

      this.logger.log(
        `Circle member provisioned for user ${userId}${
          result.memberId ? ` (memberId: ${result.memberId})` : ''
        }`,
      );
      await this.safeAudit('circle.member.invite', userId, {
        email,
        ok: true,
        status: result.status ?? null,
        memberId: result.memberId ?? null,
      });
    } catch (error: unknown) {
      this.logError('provision Circle member', userId, error);
    }
  }

  /**
   * Remove/deactivate a member from the Circle community when their Builders
   * subscription is canceled, and clear the stored `circleMemberId`. No-ops in
   * feature-off mode and when the user has no Circle membership on record.
   */
  async deprovisionBuildersMember(userId: string): Promise<void> {
    if (!this.isEnabledOrLogOnce('deprovision')) {
      return;
    }

    try {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { circleMemberId: true, email: true },
      });

      const target = user?.circleMemberId ?? user?.email;
      if (!target) {
        this.logger.log(
          `No Circle membership on record for user ${userId} — nothing to deprovision`,
        );
        return;
      }

      const result = await this.circle.removeMember(target);
      if (!result.ok) {
        this.logger.warn(
          `Circle removal did not succeed for user ${userId} (status: ${
            result.status ?? 'n/a'
          }): ${result.error ?? 'unknown error'}`,
        );
        await this.safeAudit('circle.member.remove', userId, {
          ok: false,
          status: result.status ?? null,
          error: result.error ?? null,
        });
        return;
      }

      if (user?.circleMemberId) {
        await this.prisma.user.update({
          where: { id: userId },
          data: { circleMemberId: null },
        });
      }

      this.logger.log(`Circle member deprovisioned for user ${userId}`);
      await this.safeAudit('circle.member.remove', userId, {
        ok: true,
        status: result.status ?? null,
      });
    } catch (error: unknown) {
      this.logError('deprovision Circle member', userId, error);
    }
  }

  /**
   * Returns true when Circle is configured. When disabled, logs once per
   * process (keyed by nothing more than a boolean flag) and returns false so
   * callers can cleanly skip.
   */
  private isEnabledOrLogOnce(op: 'provision' | 'deprovision'): boolean {
    if (this.circle.isEnabled()) {
      return true;
    }
    if (!this.loggedDisabled) {
      this.logger.log(
        'Circle integration disabled (CIRCLE_API_TOKEN/CIRCLE_COMMUNITY_ID unset) — skipping all Circle provisioning',
      );
      this.loggedDisabled = true;
    } else {
      this.logger.debug(`Circle disabled — skipping ${op}`);
    }
    return false;
  }

  /**
   * Write an audit row without ever letting an audit failure escape into the
   * webhook path.
   */
  private async safeAudit(
    action: 'circle.member.invite' | 'circle.member.remove',
    userId: string,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    try {
      await this.audit.write({
        actorEmail: null,
        action,
        targetType: 'User',
        targetId: userId,
        metadata,
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.warn(
        `Failed to write Circle audit log (${action}) for user ${userId}: ${message}`,
      );
    }
  }

  private logError(op: string, userId: string, error: unknown): void {
    const message = error instanceof Error ? error.message : 'Unknown error';
    this.logger.error(`Failed to ${op} for user ${userId}: ${message}`);
  }
}
