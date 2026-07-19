import { Inject, Injectable, Logger } from '@nestjs/common';
import { AuditLogService } from '../audit/audit-log.service';
import { DiscourseAdminProvider } from './discourse-admin.provider';

/**
 * DiscourseProvisioningService — keeps the Discourse `builders` group in sync
 * with paid membership, driven by the Paddle webhook fan-out.
 *
 * Every call is BEST-EFFORT and NEVER rethrows: the Paddle webhook path must
 * succeed even when Discourse is down, misconfigured, or disabled. Failures are
 * logged and recorded to the admin audit log (`discourse.group.sync`).
 *
 * Feature-off: when the Discourse admin env vars are unset the provider reports
 * `isEnabled() === false`; we log ONCE per process and no-op.
 */
@Injectable()
export class DiscourseProvisioningService {
  private readonly logger = new Logger(DiscourseProvisioningService.name);
  private loggedDisabled = false;

  constructor(
    @Inject(DiscourseAdminProvider)
    private readonly discourse: DiscourseAdminProvider,
    @Inject(AuditLogService) private readonly audit: AuditLogService,
  ) {}

  /**
   * Add (`isMember=true`) or remove (`isMember=false`) the user from the
   * Discourse `builders` group. No-ops (audited as skipped) when Discourse is
   * disabled or the user is not yet present in Discourse.
   */
  async syncBuildersGroup(
    userId: string,
    email: string,
    isMember: boolean,
  ): Promise<void> {
    if (!this.isEnabledOrLogOnce(isMember)) {
      return;
    }

    const normalized = email.toLowerCase();
    try {
      const result = await this.discourse.syncGroupMembership(
        normalized,
        userId,
        isMember,
      );

      if (result.skipped) {
        this.logger.log(
          `Discourse group sync skipped for user ${userId} (user not in Discourse yet) — SSO will assert the group on first login`,
        );
        await this.safeAudit(userId, {
          email: normalized,
          isMember,
          ok: true,
          skipped: true,
        });
        return;
      }

      if (!result.ok) {
        this.logger.warn(
          `Discourse group sync did not succeed for user ${userId} (status: ${
            result.status ?? 'n/a'
          }): ${result.error ?? 'unknown error'}`,
        );
        await this.safeAudit(userId, {
          email: normalized,
          isMember,
          ok: false,
          status: result.status ?? null,
          error: result.error ?? null,
        });
        return;
      }

      this.logger.log(
        `Discourse builders group ${
          isMember ? 'add' : 'remove'
        } succeeded for user ${userId}`,
      );
      await this.safeAudit(userId, {
        email: normalized,
        isMember,
        ok: true,
        status: result.status ?? null,
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(
        `Failed to sync Discourse group for user ${userId}: ${message}`,
      );
    }
  }

  private isEnabledOrLogOnce(isMember: boolean): boolean {
    if (this.discourse.isEnabled()) {
      return true;
    }
    if (!this.loggedDisabled) {
      this.logger.log(
        'Discourse integration disabled (DISCOURSE_URL/DISCOURSE_API_KEY/DISCOURSE_API_USERNAME unset) — skipping all Discourse group sync',
      );
      this.loggedDisabled = true;
    } else {
      this.logger.debug(
        `Discourse disabled — skipping group ${isMember ? 'add' : 'remove'}`,
      );
    }
    return false;
  }

  private async safeAudit(
    userId: string,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    try {
      await this.audit.write({
        actorEmail: null,
        action: 'discourse.group.sync',
        targetType: 'User',
        targetId: userId,
        metadata,
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.warn(
        `Failed to write Discourse audit log for user ${userId}: ${message}`,
      );
    }
  }
}
