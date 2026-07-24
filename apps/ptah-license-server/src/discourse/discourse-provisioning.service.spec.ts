/**
 * Unit tests for `DiscourseProvisioningService`.
 *
 * Focus (mirrors CircleProvisioningService's guarantees):
 *   1. Happy path: successful add/remove writes an audit row.
 *   2. Tolerated no-op: user not yet in Discourse (skipped) audits ok+skipped.
 *   3. Non-fatal failure: an API failure NEVER throws; audits the failure.
 *   4. Feature-off: Discourse disabled → nothing called.
 */

import { DiscourseProvisioningService } from './discourse-provisioning.service';
import type { DiscourseAdminProvider } from './discourse-admin.provider';
import type { AuditLogService } from '../audit/audit-log.service';
import type { MemberGroupsService } from '../member-groups/member-groups.service';

interface AdminMock {
  isEnabled: jest.Mock<boolean, []>;
  syncGroupMembership: jest.Mock;
  syncNamedGroupMembership: jest.Mock;
}

interface AuditMock {
  write: jest.Mock;
}

interface MemberGroupsMock {
  getDiscourseGroupsForUser: jest.Mock;
}

function createAdminMock(enabled = true): AdminMock {
  return {
    isEnabled: jest.fn().mockReturnValue(enabled),
    syncGroupMembership: jest.fn().mockResolvedValue({ ok: true, status: 200 }),
    syncNamedGroupMembership: jest
      .fn()
      .mockResolvedValue({ ok: true, status: 200 }),
  };
}

function createAuditMock(): AuditMock {
  return { write: jest.fn().mockResolvedValue('audit-id') };
}

function createMemberGroupsMock(groups: string[] = []): MemberGroupsMock {
  return {
    getDiscourseGroupsForUser: jest.fn().mockResolvedValue(groups),
  };
}

function build(
  admin: AdminMock,
  audit: AuditMock,
  memberGroups?: MemberGroupsMock,
): DiscourseProvisioningService {
  return new DiscourseProvisioningService(
    admin as unknown as DiscourseAdminProvider,
    audit as unknown as AuditLogService,
    memberGroups as unknown as MemberGroupsService | undefined,
  );
}

describe('DiscourseProvisioningService', () => {
  it('adds the user to the builders group and audits success', async () => {
    const admin = createAdminMock(true);
    admin.syncGroupMembership.mockResolvedValue({ ok: true, status: 200 });
    const audit = createAuditMock();

    await build(admin, audit).syncBuildersGroup(
      'usr_1',
      'Buyer@Example.com',
      true,
    );

    // Email is lowercased; external id is the user id; isMember=true.
    expect(admin.syncGroupMembership).toHaveBeenCalledWith(
      'buyer@example.com',
      'usr_1',
      true,
    );
    expect(audit.write).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'discourse.group.sync',
        targetType: 'User',
        targetId: 'usr_1',
        metadata: expect.objectContaining({ ok: true, isMember: true }),
      }),
    );
  });

  it('removes the user from the builders group (isMember=false)', async () => {
    const admin = createAdminMock(true);
    admin.syncGroupMembership.mockResolvedValue({ ok: true, status: 200 });
    const audit = createAuditMock();

    await build(admin, audit).syncBuildersGroup('usr_2', 'x@e.com', false);

    expect(admin.syncGroupMembership).toHaveBeenCalledWith(
      'x@e.com',
      'usr_2',
      false,
    );
    expect(audit.write).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({ isMember: false, ok: true }),
      }),
    );
  });

  it('treats a not-in-Discourse user as a tolerated skipped no-op', async () => {
    const admin = createAdminMock(true);
    admin.syncGroupMembership.mockResolvedValue({ ok: true, skipped: true });
    const audit = createAuditMock();

    await expect(
      build(admin, audit).syncBuildersGroup('usr_3', 'y@e.com', true),
    ).resolves.toBeUndefined();

    expect(audit.write).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({ ok: true, skipped: true }),
      }),
    );
  });

  it('is non-fatal when the sync fails: audits the failure, never throws', async () => {
    const admin = createAdminMock(true);
    admin.syncGroupMembership.mockResolvedValue({
      ok: false,
      status: 500,
      error: 'Discourse admin API returned status 500',
    });
    const audit = createAuditMock();

    await expect(
      build(admin, audit).syncBuildersGroup('usr_4', 'z@e.com', true),
    ).resolves.toBeUndefined();

    expect(audit.write).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'discourse.group.sync',
        metadata: expect.objectContaining({ ok: false, status: 500 }),
      }),
    );
  });

  it('swallows a thrown provider error (never rethrows into the webhook path)', async () => {
    const admin = createAdminMock(true);
    admin.syncGroupMembership.mockRejectedValue(new Error('boom'));
    const audit = createAuditMock();

    await expect(
      build(admin, audit).syncBuildersGroup('usr_5', 'a@e.com', true),
    ).resolves.toBeUndefined();
  });

  it('skips cleanly (no API, no audit) when Discourse is disabled', async () => {
    const admin = createAdminMock(false);
    const audit = createAuditMock();

    await build(admin, audit).syncBuildersGroup('usr_6', 'off@e.com', true);

    expect(admin.syncGroupMembership).not.toHaveBeenCalled();
    expect(audit.write).not.toHaveBeenCalled();
  });

  describe('cohort (per-group) sync', () => {
    it('adds each cohort discourseGroup on provision, after the base builders sync', async () => {
      const admin = createAdminMock(true);
      const audit = createAuditMock();
      const memberGroups = createMemberGroupsMock([
        'builders-founding',
        'builders-charter',
      ]);

      await build(admin, audit, memberGroups).syncBuildersGroup(
        'usr_c1',
        'Cohort@Example.com',
        true,
      );

      // Base builders group sync still happened.
      expect(admin.syncGroupMembership).toHaveBeenCalledWith(
        'cohort@example.com',
        'usr_c1',
        true,
      );
      // Each cohort's Discourse group is added (email lowercased, isMember=true).
      expect(memberGroups.getDiscourseGroupsForUser).toHaveBeenCalledWith(
        'usr_c1',
      );
      expect(admin.syncNamedGroupMembership).toHaveBeenCalledWith(
        'cohort@example.com',
        'usr_c1',
        true,
        'builders-founding',
      );
      expect(admin.syncNamedGroupMembership).toHaveBeenCalledWith(
        'cohort@example.com',
        'usr_c1',
        true,
        'builders-charter',
      );
    });

    it('does NOT touch cohort groups on deprovision (cohort identity survives churn)', async () => {
      const admin = createAdminMock(true);
      const audit = createAuditMock();
      const memberGroups = createMemberGroupsMock(['builders-founding']);

      await build(admin, audit, memberGroups).syncBuildersGroup(
        'usr_c2',
        'x@e.com',
        false,
      );

      // Only the base builders group is removed; cohort groups are left intact.
      expect(admin.syncGroupMembership).toHaveBeenCalledWith(
        'x@e.com',
        'usr_c2',
        false,
      );
      expect(memberGroups.getDiscourseGroupsForUser).not.toHaveBeenCalled();
      expect(admin.syncNamedGroupMembership).not.toHaveBeenCalled();
    });

    it('is non-fatal when the cohort lookup throws (base sync still succeeds)', async () => {
      const admin = createAdminMock(true);
      const audit = createAuditMock();
      const memberGroups = createMemberGroupsMock();
      memberGroups.getDiscourseGroupsForUser.mockRejectedValue(
        new Error('db down'),
      );

      await expect(
        build(admin, audit, memberGroups).syncBuildersGroup(
          'usr_c3',
          'y@e.com',
          true,
        ),
      ).resolves.toBeUndefined();

      expect(admin.syncGroupMembership).toHaveBeenCalledTimes(1);
    });

    it('syncMemberGroup adds a user to a single named Discourse group and audits', async () => {
      const admin = createAdminMock(true);
      const audit = createAuditMock();

      await build(admin, audit).syncMemberGroup(
        'usr_c4',
        'Named@Example.com',
        'builders-founding',
        true,
      );

      expect(admin.syncNamedGroupMembership).toHaveBeenCalledWith(
        'named@example.com',
        'usr_c4',
        true,
        'builders-founding',
      );
      expect(audit.write).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'discourse.group.sync',
          targetId: 'usr_c4',
          metadata: expect.objectContaining({
            group: 'builders-founding',
            isMember: true,
            ok: true,
          }),
        }),
      );
    });

    it('syncMemberGroup no-ops when Discourse is disabled', async () => {
      const admin = createAdminMock(false);
      const audit = createAuditMock();

      await build(admin, audit).syncMemberGroup(
        'usr_c5',
        'z@e.com',
        'builders-founding',
        true,
      );

      expect(admin.syncNamedGroupMembership).not.toHaveBeenCalled();
      expect(audit.write).not.toHaveBeenCalled();
    });
  });
});
