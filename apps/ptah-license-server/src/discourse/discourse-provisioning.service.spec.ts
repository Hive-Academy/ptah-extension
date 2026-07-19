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

interface AdminMock {
  isEnabled: jest.Mock<boolean, []>;
  syncGroupMembership: jest.Mock;
}

interface AuditMock {
  write: jest.Mock;
}

function createAdminMock(enabled = true): AdminMock {
  return {
    isEnabled: jest.fn().mockReturnValue(enabled),
    syncGroupMembership: jest.fn(),
  };
}

function createAuditMock(): AuditMock {
  return { write: jest.fn().mockResolvedValue('audit-id') };
}

function build(
  admin: AdminMock,
  audit: AuditMock,
): DiscourseProvisioningService {
  return new DiscourseProvisioningService(
    admin as unknown as DiscourseAdminProvider,
    audit as unknown as AuditLogService,
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
});
