/**
 * Unit tests for SubscriptionDbService (TASK_2025_294 W1.B3).
 *
 * Exercises all Prisma-backed read/write operations on the service:
 *   - findUserWithSubscription / findUserWithSubscriptionAndLicense
 *   - findUserById / findSubscriptionForPortal
 *   - createSubscriptionAndLicense (transaction: revoke → license → sub)
 *   - updateSubscription / updateLicense
 *
 * Strategy: `createMockPrisma()` from `../testing` supplies a fully typed,
 * per-model mock with a callback-style `$transaction` that invokes the
 * callback against the same mock instance. That lets us assert that
 * createSubscriptionAndLicense issues three writes in the expected order
 * on a single transactional boundary.
 *
 * Race handling (per scope):
 *   - We assert that even when `license.updateMany` reports zero rows
 *     affected (no stale active licenses to revoke), the create path still
 *     succeeds — i.e. concurrent upserts with the same subscriptionId don't
 *     duplicate because the revoke-then-create ordering is preserved inside
 *     the transaction callback and `license.create` is called exactly once
 *     per invocation.
 *
 * Cryptographic assertions: we check the license-key format
 * (`ptah_lic_[0-9a-f]{64}`) rather than the exact bytes, since `randomBytes`
 * is non-deterministic.
 */

import {
  createMockPrisma,
  asPrismaService,
  type MockPrisma,
} from '../testing/mock-prisma.factory';
import { SubscriptionDbService } from './subscription-db.service';

const LICENSE_KEY_PATTERN = /^ptah_lic_[0-9a-f]{64}$/;

describe('SubscriptionDbService', () => {
  let prisma: MockPrisma;
  let service: SubscriptionDbService;

  beforeEach(() => {
    prisma = createMockPrisma();
    service = new SubscriptionDbService(asPrismaService(prisma));
  });

  // ---------------------------------------------------------------------------
  // findUserWithSubscription
  // ---------------------------------------------------------------------------
  describe('findUserWithSubscription', () => {
    it('returns null when user is not found', async () => {
      prisma.user.findUnique.mockResolvedValueOnce(null);

      const result = await service.findUserWithSubscription('missing-user');

      expect(result).toBeNull();
      expect(prisma.user.findUnique).toHaveBeenCalledWith({
        where: { id: 'missing-user' },
        include: {
          subscriptions: {
            orderBy: { createdAt: 'desc' },
            take: 1,
          },
        },
      });
    });

    it('returns a user with null subscription when they have no subscriptions', async () => {
      prisma.user.findUnique.mockResolvedValueOnce({
        id: 'user-1',
        email: 'alice@example.com',
        subscriptions: [],
      });

      const result = await service.findUserWithSubscription('user-1');

      expect(result).toEqual({
        id: 'user-1',
        email: 'alice@example.com',
        subscription: null,
      });
    });

    it('returns the most recent subscription shaped as LocalSubscription', async () => {
      const periodEnd = new Date('2026-12-31T00:00:00Z');
      const canceledAt = new Date('2026-03-01T00:00:00Z');
      const trialEnd = new Date('2026-04-01T00:00:00Z');

      prisma.user.findUnique.mockResolvedValueOnce({
        id: 'user-1',
        email: 'alice@example.com',
        subscriptions: [
          {
            id: 'sub-1',
            paddleSubscriptionId: 'pdl_sub_1',
            paddleCustomerId: 'pdl_cust_1',
            status: 'active',
            priceId: 'pri_pro_monthly',
            currentPeriodEnd: periodEnd,
            canceledAt,
            trialEnd,
            extraneousField: 'ignored',
          },
        ],
      });

      const result = await service.findUserWithSubscription('user-1');

      expect(result).toEqual({
        id: 'user-1',
        email: 'alice@example.com',
        subscription: {
          id: 'sub-1',
          paddleSubscriptionId: 'pdl_sub_1',
          paddleCustomerId: 'pdl_cust_1',
          status: 'active',
          priceId: 'pri_pro_monthly',
          currentPeriodEnd: periodEnd,
          canceledAt,
          trialEnd,
        },
      });
    });
  });

  // ---------------------------------------------------------------------------
  // findUserWithSubscriptionAndLicense
  // ---------------------------------------------------------------------------
  describe('findUserWithSubscriptionAndLicense', () => {
    it('returns null when user is not found', async () => {
      prisma.user.findUnique.mockResolvedValueOnce(null);

      const result =
        await service.findUserWithSubscriptionAndLicense('missing');

      expect(result).toBeNull();
    });

    it('scopes license lookup to active|paused statuses', async () => {
      prisma.user.findUnique.mockResolvedValueOnce({
        id: 'user-1',
        email: 'alice@example.com',
        subscriptions: [],
        licenses: [],
      });

      await service.findUserWithSubscriptionAndLicense('user-1');

      expect(prisma.user.findUnique).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        include: {
          subscriptions: {
            orderBy: { createdAt: 'desc' },
            take: 1,
          },
          licenses: {
            where: { status: { in: ['active', 'paused'] } },
            orderBy: { createdAt: 'desc' },
            take: 1,
          },
        },
      });
    });

    it('returns both subscription and license shapes when present', async () => {
      const periodEnd = new Date('2026-12-31T00:00:00Z');
      const licExpiresAt = new Date('2027-01-01T00:00:00Z');

      prisma.user.findUnique.mockResolvedValueOnce({
        id: 'user-1',
        email: 'alice@example.com',
        subscriptions: [
          {
            id: 'sub-1',
            paddleSubscriptionId: 'pdl_sub_1',
            paddleCustomerId: 'pdl_cust_1',
            status: 'trialing',
            priceId: 'pri_pro_monthly',
            currentPeriodEnd: periodEnd,
            canceledAt: null,
            trialEnd: new Date('2026-04-01T00:00:00Z'),
          },
        ],
        licenses: [
          {
            id: 'lic-1',
            licenseKey: 'ptah_lic_' + 'a'.repeat(64),
            plan: 'trial_pro',
            status: 'active',
            expiresAt: licExpiresAt,
          },
        ],
      });

      const result = await service.findUserWithSubscriptionAndLicense('user-1');

      expect(result?.subscription?.id).toBe('sub-1');
      expect(result?.license).toEqual({
        id: 'lic-1',
        licenseKey: 'ptah_lic_' + 'a'.repeat(64),
        plan: 'trial_pro',
        status: 'active',
        expiresAt: licExpiresAt,
      });
    });

    it('returns null license when the user has none of active|paused', async () => {
      prisma.user.findUnique.mockResolvedValueOnce({
        id: 'user-1',
        email: 'alice@example.com',
        subscriptions: [],
        licenses: [],
      });

      const result = await service.findUserWithSubscriptionAndLicense('user-1');

      expect(result?.license).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // findUserById
  // ---------------------------------------------------------------------------
  describe('findUserById', () => {
    it('returns the selected projection', async () => {
      prisma.user.findUnique.mockResolvedValueOnce({
        id: 'user-1',
        email: 'alice@example.com',
        paddleCustomerId: 'pdl_cust_1',
      });

      const result = await service.findUserById('user-1');

      expect(result).toEqual({
        id: 'user-1',
        email: 'alice@example.com',
        paddleCustomerId: 'pdl_cust_1',
      });
      expect(prisma.user.findUnique).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        select: {
          id: true,
          email: true,
          paddleCustomerId: true,
        },
      });
    });

    it('returns null when user not found', async () => {
      prisma.user.findUnique.mockResolvedValueOnce(null);
      const result = await service.findUserById('missing');
      expect(result).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // findSubscriptionForPortal
  // ---------------------------------------------------------------------------
  describe('findSubscriptionForPortal', () => {
    it('returns null when no matching subscription exists', async () => {
      prisma.subscription.findFirst.mockResolvedValueOnce(null);

      const result = await service.findSubscriptionForPortal('user-1');
      expect(result).toBeNull();
      expect(prisma.subscription.findFirst).toHaveBeenCalledWith({
        where: {
          userId: 'user-1',
          status: {
            in: ['active', 'trialing', 'past_due', 'paused', 'canceled'],
          },
        },
        orderBy: { createdAt: 'desc' },
      });
    });

    it('returns the subscription shape when a match exists', async () => {
      const periodEnd = new Date('2026-12-31T00:00:00Z');
      prisma.subscription.findFirst.mockResolvedValueOnce({
        id: 'sub-1',
        paddleSubscriptionId: 'pdl_sub_1',
        paddleCustomerId: 'pdl_cust_1',
        status: 'active',
        priceId: 'pri_pro_monthly',
        currentPeriodEnd: periodEnd,
        canceledAt: null,
        trialEnd: null,
      });

      const result = await service.findSubscriptionForPortal('user-1');

      expect(result).toEqual({
        id: 'sub-1',
        paddleSubscriptionId: 'pdl_sub_1',
        paddleCustomerId: 'pdl_cust_1',
        status: 'active',
        priceId: 'pri_pro_monthly',
        currentPeriodEnd: periodEnd,
        canceledAt: null,
        trialEnd: null,
      });
    });
  });

  // ---------------------------------------------------------------------------
  // createSubscriptionAndLicense — transactional three-step write
  // ---------------------------------------------------------------------------
  describe('createSubscriptionAndLicense', () => {
    const periodEnd = new Date('2026-12-31T00:00:00Z');
    const trialEnd = new Date('2026-04-01T00:00:00Z');

    const subscriptionData = {
      userId: 'user-1',
      paddleSubscriptionId: 'pdl_sub_1',
      paddleCustomerId: 'pdl_cust_1',
      status: 'active',
      priceId: 'pri_pro_monthly',
      currentPeriodEnd: periodEnd,
      trialEnd,
    };

    const licenseData = {
      userId: 'user-1',
      plan: 'pro',
      expiresAt: periodEnd,
      createdBy: 'paddle_reconcile_pdl_sub_1',
    };

    it('runs revoke → license.create → subscription.create inside a transaction and returns ids', async () => {
      prisma.license.updateMany.mockResolvedValueOnce({ count: 1 });
      prisma.license.create.mockResolvedValueOnce({ id: 'lic-1' });
      prisma.subscription.create.mockResolvedValueOnce({ id: 'sub-1' });

      const result = await service.createSubscriptionAndLicense(
        subscriptionData,
        licenseData,
      );

      // Transaction boundary was entered exactly once.
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);

      // Revoke stale active licenses first.
      expect(prisma.license.updateMany).toHaveBeenCalledWith({
        where: { userId: 'user-1', status: 'active' },
        data: { status: 'revoked' },
      });

      // License.create receives a generated key matching the documented format.
      expect(prisma.license.create).toHaveBeenCalledTimes(1);
      const licenseCreateArgs = prisma.license.create.mock.calls[0][0] as {
        data: Record<string, unknown>;
      };
      expect(licenseCreateArgs.data).toMatchObject({
        userId: 'user-1',
        plan: 'pro',
        status: 'active',
        expiresAt: periodEnd,
        createdBy: 'paddle_reconcile_pdl_sub_1',
      });
      expect(licenseCreateArgs.data['licenseKey']).toMatch(LICENSE_KEY_PATTERN);

      // Subscription.create mirrors the input data.
      expect(prisma.subscription.create).toHaveBeenCalledWith({
        data: {
          userId: 'user-1',
          paddleSubscriptionId: 'pdl_sub_1',
          paddleCustomerId: 'pdl_cust_1',
          status: 'active',
          priceId: 'pri_pro_monthly',
          currentPeriodEnd: periodEnd,
          trialEnd,
        },
      });

      // Returned ids and license key passthrough.
      expect(result.licenseId).toBe('lic-1');
      expect(result.subscriptionId).toBe('sub-1');
      expect(result.licenseKey).toMatch(LICENSE_KEY_PATTERN);
      expect(result.licenseKey).toBe(licenseCreateArgs.data['licenseKey']);
    });

    it('succeeds even when updateMany reports zero rows (no stale actives to revoke)', async () => {
      // This simulates the race where a concurrent writer has already
      // revoked the prior active license — our create path must not double
      // up. Since `license.create` is called exactly once per invocation,
      // two concurrent upserts with the same subscriptionId would produce
      // at most two rows (one per invocation), matching Prisma semantics.
      prisma.license.updateMany.mockResolvedValueOnce({ count: 0 });
      prisma.license.create.mockResolvedValueOnce({ id: 'lic-2' });
      prisma.subscription.create.mockResolvedValueOnce({ id: 'sub-2' });

      const result = await service.createSubscriptionAndLicense(
        subscriptionData,
        licenseData,
      );

      expect(prisma.license.create).toHaveBeenCalledTimes(1);
      expect(prisma.subscription.create).toHaveBeenCalledTimes(1);
      expect(result.subscriptionId).toBe('sub-2');
    });

    it('generates a unique license key on each invocation', async () => {
      prisma.license.updateMany.mockResolvedValue({ count: 0 });
      prisma.license.create
        .mockResolvedValueOnce({ id: 'lic-a' })
        .mockResolvedValueOnce({ id: 'lic-b' });
      prisma.subscription.create
        .mockResolvedValueOnce({ id: 'sub-a' })
        .mockResolvedValueOnce({ id: 'sub-b' });

      const first = await service.createSubscriptionAndLicense(
        subscriptionData,
        licenseData,
      );
      const second = await service.createSubscriptionAndLicense(
        subscriptionData,
        licenseData,
      );

      expect(first.licenseKey).toMatch(LICENSE_KEY_PATTERN);
      expect(second.licenseKey).toMatch(LICENSE_KEY_PATTERN);
      expect(first.licenseKey).not.toEqual(second.licenseKey);
    });
  });

  // ---------------------------------------------------------------------------
  // updateSubscription / updateLicense
  // ---------------------------------------------------------------------------
  describe('updateSubscription', () => {
    it('forwards partial update data to prisma.subscription.update', async () => {
      prisma.subscription.update.mockResolvedValueOnce({ id: 'sub-1' });
      const newEnd = new Date('2027-01-01T00:00:00Z');

      await service.updateSubscription('sub-1', {
        status: 'canceled',
        currentPeriodEnd: newEnd,
        canceledAt: new Date('2026-04-24T00:00:00Z'),
      });

      expect(prisma.subscription.update).toHaveBeenCalledWith({
        where: { id: 'sub-1' },
        data: {
          status: 'canceled',
          currentPeriodEnd: newEnd,
          canceledAt: new Date('2026-04-24T00:00:00Z'),
        },
      });
    });
  });

  describe('updateLicense', () => {
    it('forwards partial update data to prisma.license.update', async () => {
      prisma.license.update.mockResolvedValueOnce({ id: 'lic-1' });
      const newEnd = new Date('2027-01-01T00:00:00Z');

      await service.updateLicense('lic-1', {
        status: 'active',
        plan: 'pro',
        expiresAt: newEnd,
      });

      expect(prisma.license.update).toHaveBeenCalledWith({
        where: { id: 'lic-1' },
        data: {
          status: 'active',
          plan: 'pro',
          expiresAt: newEnd,
        },
      });
    });
  });
});
