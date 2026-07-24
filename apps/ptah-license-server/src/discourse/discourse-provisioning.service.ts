import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { AuditLogService } from '../audit/audit-log.service';
import { MemberGroupsService } from '../member-groups/member-groups.service';
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
    // Optional: member-cohort lookup for per-group Discourse sync. Bound by the
    // @Global() MemberGroupsModule; @Optional keeps the base builders sync
    // working if the module is ever unregistered (e.g. in a narrow test).
    @Optional()
    @Inject(MemberGroupsService)
    private readonly memberGroups?: MemberGroupsService,
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

    await this.syncBaseBuildersGroup(userId, email, isMember);

    // On provision, ALSO add the user's cohort groups' Discourse groups. On
    // deprovision we intentionally touch ONLY the base builders access group
    // above — cohort membership (e.g. "founding") is durable identity that
    // survives churn.
    if (isMember) {
      await this.syncCohortGroups(userId, email);
    }
  }

  /**
   * Add/remove a user to/from a SPECIFIC named Discourse group (a cohort
   * group). Best-effort + audited, mirroring `syncBuildersGroup`. Used by the
   * admin assign flow. No-ops when Discourse is disabled.
   */
  async syncMemberGroup(
    userId: string,
    email: string,
    discourseGroupName: string,
    isMember: boolean,
  ): Promise<void> {
    if (!this.isEnabledOrLogOnce(isMember)) {
      return;
    }
    await this.syncOneNamedGroup(
      userId,
      email.toLowerCase(),
      discourseGroupName,
      isMember,
    );
  }

  /**
   * Add the user to every cohort group's Discourse group. Best-effort: a
   * lookup or per-group failure is logged and never rethrown.
   */
  private async syncCohortGroups(userId: string, email: string): Promise<void> {
    if (!this.memberGroups) {
      return;
    }
    try {
      const groupNames =
        await this.memberGroups.getDiscourseGroupsForUser(userId);
      const normalized = email.toLowerCase();
      for (const groupName of groupNames) {
        await this.syncOneNamedGroup(userId, normalized, groupName, true);
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.warn(
        `Failed to sync cohort Discourse groups for user ${userId}: ${message}`,
      );
    }
  }

  /** Single named-group add/remove with audit + non-fatal error handling. */
  private async syncOneNamedGroup(
    userId: string,
    normalizedEmail: string,
    groupName: string,
    isMember: boolean,
  ): Promise<void> {
    try {
      const result = await this.discourse.syncNamedGroupMembership(
        normalizedEmail,
        userId,
        isMember,
        groupName,
      );
      await this.safeAudit(userId, {
        email: normalizedEmail,
        group: groupName,
        isMember,
        ok: result.ok,
        skipped: result.skipped ?? false,
        status: result.status ?? null,
        error: result.error ?? null,
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(
        `Failed to sync Discourse group '${groupName}' for user ${userId}: ${message}`,
      );
    }
  }

  /**
   * The original base `builders` group add/remove. Extracted so
   * `syncBuildersGroup` can layer cohort-group sync on top.
   */
  private async syncBaseBuildersGroup(
    userId: string,
    email: string,
    isMember: boolean,
  ): Promise<void> {
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
