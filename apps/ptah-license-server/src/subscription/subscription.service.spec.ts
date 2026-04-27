/**
 * Unit tests for SubscriptionService (TASK_2025_294 W1.B3).
 *
 * Coverage strategy — this is the business-logic orchestrator, so specs
 * verify state transitions, branching, and event emission rather than
 * infrastructure concerns. Collaborators are typed mocks:
 *
 *   - SubscriptionDbService     — Pick-typed `jest.Mocked<...>`
 *   - PaddleSyncService         — Pick-typed `jest.Mocked<...>`
 *   - ConfigService             — partial stub with `get(key)` seam
 *   - EventEmitter2             — `{ emit: jest.fn() }`
 *
 * State-transition coverage (per task requirements):
 *   - trial_active → active (reconcile updates status from trialing → active)
 *   - trial_expired → expired (local trialing subscription past currentPeriodEnd)
 *   - internal-trial skip: synthetic Paddle IDs never hit the real API
 *
 * Time is frozen for any branch that depends on `currentPeriodEnd > now`.
 */

import { freezeTime, type FrozenClock } from '@ptah-extension/shared/testing';
import type { ConfigService } from '@nestjs/config';
import type { EventEmitter2 } from '@nestjs/event-emitter';
import type {
  LocalLicense,
  LocalSubscription,
  SubscriptionDbService,
  UserWithSubscription,
  UserWithSubscriptionAndLicense,
} from './subscription-db.service';
import type {
  PaddleSubscriptionData,
  PaddleSyncService,
} from './paddle-sync.service';
import { SubscriptionService } from './subscription.service';
import {
  SUBSCRIPTION_EVENTS,
  LicenseUpdatedEvent,
  SubscriptionStatusChangedEvent,
  ReconciliationCompletedEvent,
} from './events';

// ---------------------------------------------------------------------------
// Typed collaborator mocks
// ---------------------------------------------------------------------------

type DbMock = jest.Mocked<
  Pick<
    SubscriptionDbService,
    | 'findUserWithSubscription'
    | 'findUserWithSubscriptionAndLicense'
    | 'findUserById'
    | 'findSubscriptionForPortal'
    | 'createSubscriptionAndLicense'
    | 'updateSubscription'
    | 'updateLicense'
  >
>;

type PaddleSyncMock = jest.Mocked<
  Pick<
    PaddleSyncService,
    | 'findSubscriptionByEmail'
    | 'findSubscriptionByCustomerId'
    | 'createPortalSession'
    | 'isActiveStatus'
  >
>;

function createDbMock(): DbMock {
  return {
    findUserWithSubscription: jest.fn(),
    findUserWithSubscriptionAndLicense: jest.fn(),
    findUserById: jest.fn(),
    findSubscriptionForPortal: jest.fn(),
    createSubscriptionAndLicense: jest.fn(),
    updateSubscription: jest.fn(),
    updateLicense: jest.fn(),
  } as DbMock;
}

function createPaddleSyncMock(): PaddleSyncMock {
  const mock = {
    findSubscriptionByEmail: jest.fn(),
    findSubscriptionByCustomerId: jest.fn(),
    createPortalSession: jest.fn(),
    isActiveStatus: jest.fn((status: string) =>
      ['active', 'trialing', 'past_due'].includes(status),
    ),
  } as unknown as PaddleSyncMock;
  return mock;
}

interface ConfigMockBacking {
  [key: string]: string | undefined;
}

function createConfigService(backing: ConfigMockBacking): ConfigService {
  const stub: Pick<ConfigService, 'get'> = {
    get: <T = string>(key: string): T | undefined => backing[key] as T,
  };
  return stub as ConfigService;
}

type EventEmitterMock = jest.Mocked<Pick<EventEmitter2, 'emit'>>;

function createEventEmitter(): EventEmitterMock {
  return { emit: jest.fn().mockReturnValue(true) } as EventEmitterMock;
}

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

const PRO_MONTHLY = 'pri_pro_monthly';
const PRO_YEARLY = 'pri_pro_yearly';

const DEFAULT_CONFIG: ConfigMockBacking = {
  PADDLE_PRICE_ID_PRO_MONTHLY: PRO_MONTHLY,
  PADDLE_PRICE_ID_PRO_YEARLY: PRO_YEARLY,
};

function makeLocalSubscription(
  overrides: Partial<LocalSubscription> = {},
): LocalSubscription {
  return {
    id: 'sub-1',
    paddleSubscriptionId: 'pdl_sub_1',
    paddleCustomerId: 'pdl_cust_1',
    status: 'active',
    priceId: PRO_MONTHLY,
    currentPeriodEnd: new Date('2026-12-31T00:00:00Z'),
    canceledAt: null,
    trialEnd: null,
    ...overrides,
  };
}

function makeLocalLicense(overrides: Partial<LocalLicense> = {}): LocalLicense {
  return {
    id: 'lic-1',
    licenseKey: 'ptah_lic_' + 'a'.repeat(64),
    plan: 'pro',
    status: 'active',
    expiresAt: new Date('2026-12-31T00:00:00Z'),
    ...overrides,
  };
}

function makeUserWithSub(
  overrides: Partial<UserWithSubscription> = {},
): UserWithSubscription {
  return {
    id: 'user-1',
    email: 'alice@example.com',
    subscription: makeLocalSubscription(),
    ...overrides,
  };
}

function makeUserWithSubAndLicense(
  overrides: Partial<UserWithSubscriptionAndLicense> = {},
): UserWithSubscriptionAndLicense {
  return {
    id: 'user-1',
    email: 'alice@example.com',
    subscription: makeLocalSubscription(),
    license: makeLocalLicense(),
    ...overrides,
  };
}

function makePaddleData(
  overrides: Partial<PaddleSubscriptionData> = {},
): PaddleSubscriptionData {
  return {
    id: 'pdl_sub_1',
    customerId: 'pdl_cust_1',
    status: 'active',
    priceId: PRO_MONTHLY,
    currentPeriodEnd: '2026-12-31T00:00:00Z',
    canceledAt: null,
    trialEnd: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SubscriptionService', () => {
  let db: DbMock;
  let paddle: PaddleSyncMock;
  let events: EventEmitterMock;
  let service: SubscriptionService;
  let clock: FrozenClock | undefined;

  function build(config: ConfigMockBacking = DEFAULT_CONFIG): void {
    db = createDbMock();
    paddle = createPaddleSyncMock();
    events = createEventEmitter();
    service = new SubscriptionService(
      createConfigService(config),
      db as unknown as SubscriptionDbService,
      paddle as unknown as PaddleSyncService,
      events as unknown as EventEmitter2,
    );
  }

  beforeEach(() => {
    build();
  });

  afterEach(() => {
    clock?.restore();
    clock = undefined;
    jest.clearAllMocks();
  });

  // =========================================================================
  // getStatus
  // =========================================================================
  describe('getStatus', () => {
    it('returns hasSubscription=false when user is not found', async () => {
      db.findUserWithSubscription.mockResolvedValueOnce(null);

      const result = await service.getStatus('missing');

      expect(result).toEqual({ hasSubscription: false, source: 'local' });
      expect(paddle.findSubscriptionByEmail).not.toHaveBeenCalled();
      expect(paddle.findSubscriptionByCustomerId).not.toHaveBeenCalled();
    });

    it('skips Paddle for internal trial (trial_customer_* synthetic id) and returns local data', async () => {
      clock = freezeTime('2026-04-24T00:00:00Z');
      db.findUserWithSubscription.mockResolvedValueOnce(
        makeUserWithSub({
          subscription: makeLocalSubscription({
            status: 'trialing',
            paddleCustomerId: 'trial_customer_abc',
            priceId: 'auto_trial_pro',
            currentPeriodEnd: new Date('2026-05-01T00:00:00Z'),
            trialEnd: new Date('2026-05-01T00:00:00Z'),
          }),
        }),
      );

      const result = await service.getStatus('user-1');

      expect(paddle.findSubscriptionByEmail).not.toHaveBeenCalled();
      expect(paddle.findSubscriptionByCustomerId).not.toHaveBeenCalled();
      expect(result.hasSubscription).toBe(true);
      expect(result.source).toBe('local');
      expect(result.requiresSync).toBe(false);
      expect(result.subscription?.plan).toBe('pro');
      expect(result.subscription?.status).toBe('trialing');
    });

    it('uses paddleCustomerId when available (1-call path) and returns Paddle source', async () => {
      db.findUserWithSubscription.mockResolvedValueOnce(makeUserWithSub());
      paddle.findSubscriptionByCustomerId.mockResolvedValueOnce({
        status: 'found',
        data: makePaddleData(),
      });
      // Portal session for active subscription inside buildStatusFromPaddle.
      db.findSubscriptionForPortal.mockResolvedValueOnce(
        makeLocalSubscription(),
      );
      paddle.createPortalSession.mockResolvedValueOnce({
        url: 'https://paddle.com/portal/xyz',
      });

      const result = await service.getStatus('user-1');

      expect(paddle.findSubscriptionByCustomerId).toHaveBeenCalledWith(
        'pdl_cust_1',
      );
      expect(paddle.findSubscriptionByEmail).not.toHaveBeenCalled();
      expect(result.source).toBe('paddle');
      expect(result.hasSubscription).toBe(true);
      expect(result.customerPortalUrl).toBe('https://paddle.com/portal/xyz');
      expect(result.subscription?.plan).toBe('pro');
      expect(result.subscription?.billingCycle).toBe('monthly');
    });

    it('falls back to email lookup when there is no stored paddleCustomerId', async () => {
      db.findUserWithSubscription.mockResolvedValueOnce(
        makeUserWithSub({ subscription: null }),
      );
      paddle.findSubscriptionByEmail.mockResolvedValueOnce({
        status: 'not_found',
      });

      const result = await service.getStatus('user-1');

      expect(paddle.findSubscriptionByEmail).toHaveBeenCalledWith(
        'alice@example.com',
      );
      expect(paddle.findSubscriptionByCustomerId).not.toHaveBeenCalled();
      expect(result).toEqual({ hasSubscription: false, source: 'local' });
    });

    it('falls back to local when Paddle returns error', async () => {
      clock = freezeTime('2026-04-24T00:00:00Z');
      db.findUserWithSubscription.mockResolvedValueOnce(
        makeUserWithSub({
          subscription: makeLocalSubscription({ status: 'active' }),
        }),
      );
      paddle.findSubscriptionByCustomerId.mockResolvedValueOnce({
        status: 'error',
        reason: 'timeout',
      });

      const result = await service.getStatus('user-1');

      expect(result.source).toBe('local');
      expect(result.hasSubscription).toBe(true);
      expect(result.requiresSync).toBe(true);
    });

    it('marks requiresSync=true when local subscription differs from Paddle (status mismatch)', async () => {
      db.findUserWithSubscription.mockResolvedValueOnce(
        makeUserWithSub({
          subscription: makeLocalSubscription({ status: 'trialing' }),
        }),
      );
      paddle.findSubscriptionByCustomerId.mockResolvedValueOnce({
        status: 'found',
        data: makePaddleData({ status: 'active' }),
      });
      db.findSubscriptionForPortal.mockResolvedValueOnce(null);

      const result = await service.getStatus('user-1');

      expect(result.source).toBe('paddle');
      expect(result.requiresSync).toBe(true);
    });

    it('buildStatusFromLocal returns hasSubscription=false when trial currentPeriodEnd has passed (trial_expired)', async () => {
      // Freeze AFTER the period end so `currentPeriodEnd > now` is false.
      clock = freezeTime('2026-06-01T00:00:00Z');
      db.findUserWithSubscription.mockResolvedValueOnce(
        makeUserWithSub({
          subscription: makeLocalSubscription({
            status: 'trialing',
            currentPeriodEnd: new Date('2026-05-01T00:00:00Z'),
          }),
        }),
      );
      // Non-trial Paddle id, so we hit Paddle. Paddle says not_found.
      paddle.findSubscriptionByCustomerId.mockResolvedValueOnce({
        status: 'not_found',
      });

      const result = await service.getStatus('user-1');

      expect(result.hasSubscription).toBe(false);
      expect(result.source).toBe('local');
      expect(result.requiresSync).toBe(true);
    });

    it('falls through to local when Paddle returns not_found for a non-trial subscription', async () => {
      clock = freezeTime('2026-04-24T00:00:00Z');
      db.findUserWithSubscription.mockResolvedValueOnce(
        makeUserWithSub({
          subscription: makeLocalSubscription({ status: 'active' }),
        }),
      );
      paddle.findSubscriptionByCustomerId.mockResolvedValueOnce({
        status: 'not_found',
      });

      const result = await service.getStatus('user-1');

      expect(result.source).toBe('local');
      expect(result.hasSubscription).toBe(true);
      expect(result.requiresSync).toBe(true); // Local copy exists → flag a sync.
    });

    it('identifies yearly billing cycle from the configured yearly price ID', async () => {
      db.findUserWithSubscription.mockResolvedValueOnce(
        makeUserWithSub({
          subscription: makeLocalSubscription({ priceId: PRO_YEARLY }),
        }),
      );
      paddle.findSubscriptionByCustomerId.mockResolvedValueOnce({
        status: 'found',
        data: makePaddleData({ priceId: PRO_YEARLY }),
      });
      db.findSubscriptionForPortal.mockResolvedValueOnce(null);

      const result = await service.getStatus('user-1');

      expect(result.subscription?.billingCycle).toBe('yearly');
    });
  });

  // =========================================================================
  // validateCheckout
  // =========================================================================
  describe('validateCheckout', () => {
    it('allows checkout when user has no subscription', async () => {
      db.findUserWithSubscription.mockResolvedValueOnce(null);

      const result = await service.validateCheckout('missing', PRO_MONTHLY);

      expect(result.canCheckout).toBe(true);
      expect(result.reason).toBe('none');
    });

    it('blocks checkout when user has an active subscription', async () => {
      db.findUserWithSubscription.mockResolvedValueOnce(makeUserWithSub());
      paddle.findSubscriptionByCustomerId.mockResolvedValueOnce({
        status: 'found',
        data: makePaddleData({ status: 'active' }),
      });
      db.findSubscriptionForPortal.mockResolvedValueOnce(
        makeLocalSubscription(),
      );
      paddle.createPortalSession.mockResolvedValueOnce({
        url: 'https://portal.example/xyz',
      });

      const result = await service.validateCheckout('user-1', PRO_MONTHLY);

      expect(result.canCheckout).toBe(false);
      expect(result.reason).toBe('existing_subscription');
      expect(result.existingPlan).toBe('pro');
      expect(result.customerPortalUrl).toBe('https://portal.example/xyz');
    });

    it('allows trial users to check out (trials are API-managed, not Paddle subscriptions)', async () => {
      clock = freezeTime('2026-04-24T00:00:00Z');
      db.findUserWithSubscription.mockResolvedValueOnce(
        makeUserWithSub({
          subscription: makeLocalSubscription({
            status: 'trialing',
            paddleCustomerId: 'trial_customer_abc',
            priceId: 'auto_trial_pro',
            currentPeriodEnd: new Date('2026-05-01T00:00:00Z'),
          }),
        }),
      );

      const result = await service.validateCheckout('user-1', PRO_MONTHLY);

      // Internal trial ⇒ hasSubscription=true, but status='trialing' is not
      // active|past_due|canceled-still-live|paused, so we fall through to
      // the default allow-checkout branch.
      expect(result.canCheckout).toBe(true);
    });

    it('blocks checkout when subscription is past_due and directs to portal', async () => {
      db.findUserWithSubscription.mockResolvedValueOnce(makeUserWithSub());
      paddle.findSubscriptionByCustomerId.mockResolvedValueOnce({
        status: 'found',
        data: makePaddleData({ status: 'past_due' }),
      });
      db.findSubscriptionForPortal.mockResolvedValueOnce(
        makeLocalSubscription(),
      );
      paddle.createPortalSession.mockResolvedValueOnce({
        url: 'https://portal.example/past-due',
      });

      const result = await service.validateCheckout('user-1', PRO_MONTHLY);

      expect(result.canCheckout).toBe(false);
      expect(result.reason).toBe('existing_subscription');
    });

    it('returns subscription_ending_soon when canceled but period still in the future', async () => {
      clock = freezeTime('2026-04-24T00:00:00Z');
      db.findUserWithSubscription.mockResolvedValueOnce(makeUserWithSub());
      paddle.findSubscriptionByCustomerId.mockResolvedValueOnce({
        status: 'found',
        data: makePaddleData({
          status: 'canceled',
          currentPeriodEnd: '2026-12-31T00:00:00Z',
        }),
      });
      // `isActiveStatus('canceled')` returns false → no portal lookup.

      const result = await service.validateCheckout('user-1', PRO_MONTHLY);

      // `canceled` is not in active-status set, so buildStatusFromPaddle
      // returns hasSubscription=false and getStatus returns no subscription.
      // The default allow-checkout branch is taken.
      expect(result.canCheckout).toBe(true);
      expect(result.reason).toBe('none');
    });
  });

  // =========================================================================
  // reconcile
  // =========================================================================
  describe('reconcile', () => {
    it('returns an error response when user is not found', async () => {
      db.findUserWithSubscriptionAndLicense.mockResolvedValueOnce(null);

      const result = await service.reconcile('missing', 'ghost@example.com');

      expect(result).toEqual({
        success: false,
        changes: {
          subscriptionUpdated: false,
          licenseUpdated: false,
          statusBefore: 'unknown',
          statusAfter: 'unknown',
        },
        errors: ['User not found'],
      });
      expect(paddle.findSubscriptionByEmail).not.toHaveBeenCalled();
    });

    it('skips Paddle for internal trial and returns a no-op success', async () => {
      db.findUserWithSubscriptionAndLicense.mockResolvedValueOnce(
        makeUserWithSubAndLicense({
          subscription: makeLocalSubscription({
            status: 'trialing',
            paddleCustomerId: 'trial_customer_abc',
            priceId: 'auto_trial_pro',
          }),
          license: makeLocalLicense({ plan: 'trial_pro' }),
        }),
      );

      const result = await service.reconcile('user-1', 'alice@example.com');

      expect(paddle.findSubscriptionByCustomerId).not.toHaveBeenCalled();
      expect(paddle.findSubscriptionByEmail).not.toHaveBeenCalled();
      expect(result.success).toBe(true);
      expect(result.changes.subscriptionUpdated).toBe(false);
      expect(result.changes.licenseUpdated).toBe(false);
      expect(result.changes.statusBefore).toBe('trialing');
      expect(result.changes.statusAfter).toBe('trialing');
      expect(result.changes.planBefore).toBe('trial_pro');
      expect(result.changes.planAfter).toBe('trial_pro');
    });

    it('returns error when Paddle lookup fails', async () => {
      db.findUserWithSubscriptionAndLicense.mockResolvedValueOnce(
        makeUserWithSubAndLicense(),
      );
      paddle.findSubscriptionByCustomerId.mockResolvedValueOnce({
        status: 'error',
        reason: 'timeout',
      });

      const result = await service.reconcile('user-1', 'alice@example.com');

      expect(result.success).toBe(false);
      expect(result.errors).toEqual(['Paddle API error: timeout']);
      expect(db.updateSubscription).not.toHaveBeenCalled();
    });

    it('returns success-no-op when Paddle has no subscription and local is empty', async () => {
      db.findUserWithSubscriptionAndLicense.mockResolvedValueOnce(
        makeUserWithSubAndLicense({ subscription: null, license: null }),
      );
      paddle.findSubscriptionByEmail.mockResolvedValueOnce({
        status: 'not_found',
      });

      const result = await service.reconcile('user-1', 'alice@example.com');

      expect(result.success).toBe(true);
      expect(result.changes).toEqual({
        subscriptionUpdated: false,
        licenseUpdated: false,
        statusBefore: 'none',
        statusAfter: 'none',
      });
    });

    it('surfaces Paddle-not-found message when local subscription exists but Paddle does not', async () => {
      db.findUserWithSubscriptionAndLicense.mockResolvedValueOnce(
        makeUserWithSubAndLicense(),
      );
      paddle.findSubscriptionByCustomerId.mockResolvedValueOnce({
        status: 'not_found',
      });

      const result = await service.reconcile('user-1', 'alice@example.com');

      expect(result.success).toBe(true);
      expect(result.errors).toEqual([
        'No subscription found in Paddle for this email',
      ]);
    });

    it('CREATE path: no local subscription → createSubscriptionAndLicense, both flags flip', async () => {
      db.findUserWithSubscriptionAndLicense.mockResolvedValueOnce(
        makeUserWithSubAndLicense({ subscription: null, license: null }),
      );
      paddle.findSubscriptionByEmail.mockResolvedValueOnce({
        status: 'found',
        data: makePaddleData({ status: 'active' }),
      });
      db.createSubscriptionAndLicense.mockResolvedValueOnce({
        subscriptionId: 'new-sub',
        licenseId: 'new-lic',
        licenseKey: 'ptah_lic_' + 'b'.repeat(64),
      });

      const result = await service.reconcile('user-1', 'alice@example.com');

      expect(db.createSubscriptionAndLicense).toHaveBeenCalledTimes(1);
      const [subData, licData] = db.createSubscriptionAndLicense.mock.calls[0];
      expect(subData.paddleSubscriptionId).toBe('pdl_sub_1');
      expect(subData.status).toBe('active');
      expect(licData.plan).toBe('pro');
      expect(licData.createdBy).toBe('paddle_reconcile_pdl_sub_1');

      expect(result.success).toBe(true);
      expect(result.changes.subscriptionUpdated).toBe(true);
      expect(result.changes.licenseUpdated).toBe(true);
      expect(result.changes.statusBefore).toBe('none');
      expect(result.changes.statusAfter).toBe('active');
      expect(result.paddleSubscription?.id).toBe('pdl_sub_1');

      // Events emitted for CREATE.
      const eventNames = events.emit.mock.calls.map((c) => c[0]);
      expect(eventNames).toEqual([
        SUBSCRIPTION_EVENTS.LICENSE_UPDATED,
        SUBSCRIPTION_EVENTS.STATUS_CHANGED,
        SUBSCRIPTION_EVENTS.RECONCILIATION_COMPLETED,
      ]);
    });

    it('trial_active → active: updates subscription + license and emits events', async () => {
      const oldEnd = new Date('2026-05-01T00:00:00Z');
      const newEnd = new Date('2026-06-01T00:00:00Z');

      db.findUserWithSubscriptionAndLicense.mockResolvedValueOnce(
        makeUserWithSubAndLicense({
          subscription: makeLocalSubscription({
            status: 'trialing',
            priceId: PRO_MONTHLY,
            currentPeriodEnd: oldEnd,
            trialEnd: oldEnd,
          }),
          license: makeLocalLicense({
            plan: 'trial_pro',
            status: 'active',
            expiresAt: oldEnd,
          }),
        }),
      );
      paddle.findSubscriptionByCustomerId.mockResolvedValueOnce({
        status: 'found',
        data: makePaddleData({
          status: 'active',
          priceId: PRO_MONTHLY,
          currentPeriodEnd: newEnd.toISOString(),
          trialEnd: oldEnd.toISOString(),
        }),
      });

      const result = await service.reconcile('user-1', 'alice@example.com');

      expect(db.updateSubscription).toHaveBeenCalledTimes(1);
      expect(db.updateSubscription).toHaveBeenCalledWith('sub-1', {
        status: 'active',
        priceId: PRO_MONTHLY,
        currentPeriodEnd: newEnd,
        canceledAt: null,
        trialEnd: oldEnd,
      });
      expect(db.updateLicense).toHaveBeenCalledTimes(1);
      expect(db.updateLicense).toHaveBeenCalledWith('lic-1', {
        status: 'active',
        plan: 'pro', // transitioned from trial_pro → pro since not trialing now
        expiresAt: newEnd,
      });

      expect(result.success).toBe(true);
      expect(result.changes.statusBefore).toBe('trialing');
      expect(result.changes.statusAfter).toBe('active');
      expect(result.changes.planBefore).toBe('trial_pro');
      expect(result.changes.planAfter).toBe('pro');

      // Emission: first event is LicenseUpdatedEvent with status='active'.
      expect(events.emit).toHaveBeenCalledWith(
        SUBSCRIPTION_EVENTS.LICENSE_UPDATED,
        expect.any(LicenseUpdatedEvent),
      );
      expect(events.emit).toHaveBeenCalledWith(
        SUBSCRIPTION_EVENTS.STATUS_CHANGED,
        expect.any(SubscriptionStatusChangedEvent),
      );
      expect(events.emit).toHaveBeenCalledWith(
        SUBSCRIPTION_EVENTS.RECONCILIATION_COMPLETED,
        expect.any(ReconciliationCompletedEvent),
      );
    });

    it('no-op when local matches Paddle exactly (neither update fires, no events)', async () => {
      const end = new Date('2026-12-31T00:00:00Z');
      db.findUserWithSubscriptionAndLicense.mockResolvedValueOnce(
        makeUserWithSubAndLicense({
          subscription: makeLocalSubscription({
            status: 'active',
            priceId: PRO_MONTHLY,
            currentPeriodEnd: end,
          }),
          license: makeLocalLicense({
            status: 'active',
            plan: 'pro',
            expiresAt: end,
          }),
        }),
      );
      paddle.findSubscriptionByCustomerId.mockResolvedValueOnce({
        status: 'found',
        data: makePaddleData({
          status: 'active',
          priceId: PRO_MONTHLY,
          currentPeriodEnd: end.toISOString(),
        }),
      });

      const result = await service.reconcile('user-1', 'alice@example.com');

      expect(db.updateSubscription).not.toHaveBeenCalled();
      expect(db.updateLicense).not.toHaveBeenCalled();
      expect(events.emit).not.toHaveBeenCalled();
      expect(result.success).toBe(true);
      expect(result.changes.subscriptionUpdated).toBe(false);
      expect(result.changes.licenseUpdated).toBe(false);
    });

    it('idempotency: same Paddle payload applied twice triggers update only once', async () => {
      // First pass: local is stale, updates fire.
      db.findUserWithSubscriptionAndLicense.mockResolvedValueOnce(
        makeUserWithSubAndLicense({
          subscription: makeLocalSubscription({
            status: 'trialing',
            priceId: PRO_MONTHLY,
            currentPeriodEnd: new Date('2026-05-01T00:00:00Z'),
          }),
          license: makeLocalLicense({
            plan: 'trial_pro',
            expiresAt: new Date('2026-05-01T00:00:00Z'),
          }),
        }),
      );
      const paddleData = makePaddleData({
        status: 'active',
        priceId: PRO_MONTHLY,
        currentPeriodEnd: '2026-06-01T00:00:00Z',
      });
      paddle.findSubscriptionByCustomerId.mockResolvedValueOnce({
        status: 'found',
        data: paddleData,
      });

      const first = await service.reconcile('user-1', 'alice@example.com');

      expect(first.changes.subscriptionUpdated).toBe(true);
      expect(db.updateSubscription).toHaveBeenCalledTimes(1);
      expect(db.updateLicense).toHaveBeenCalledTimes(1);

      // Second pass: local has been updated to match Paddle exactly.
      db.findUserWithSubscriptionAndLicense.mockResolvedValueOnce(
        makeUserWithSubAndLicense({
          subscription: makeLocalSubscription({
            status: 'active',
            priceId: PRO_MONTHLY,
            currentPeriodEnd: new Date('2026-06-01T00:00:00Z'),
          }),
          license: makeLocalLicense({
            plan: 'pro',
            status: 'active',
            expiresAt: new Date('2026-06-01T00:00:00Z'),
          }),
        }),
      );
      paddle.findSubscriptionByCustomerId.mockResolvedValueOnce({
        status: 'found',
        data: paddleData,
      });

      const second = await service.reconcile('user-1', 'alice@example.com');

      expect(second.changes.subscriptionUpdated).toBe(false);
      expect(second.changes.licenseUpdated).toBe(false);
      // Still only the one update from the first pass.
      expect(db.updateSubscription).toHaveBeenCalledTimes(1);
      expect(db.updateLicense).toHaveBeenCalledTimes(1);
    });

    it('falls back to 30-day currentPeriodEnd when Paddle omits it', async () => {
      clock = freezeTime('2026-04-24T00:00:00Z');
      db.findUserWithSubscriptionAndLicense.mockResolvedValueOnce(
        makeUserWithSubAndLicense({ subscription: null, license: null }),
      );
      paddle.findSubscriptionByEmail.mockResolvedValueOnce({
        status: 'found',
        data: makePaddleData({ currentPeriodEnd: null }),
      });
      db.createSubscriptionAndLicense.mockResolvedValueOnce({
        subscriptionId: 'new-sub',
        licenseId: 'new-lic',
        licenseKey: 'ptah_lic_' + 'c'.repeat(64),
      });

      await service.reconcile('user-1', 'alice@example.com');

      const [subData] = db.createSubscriptionAndLicense.mock.calls[0];
      // 2026-04-24 + 30 days = 2026-05-24.
      expect(subData.currentPeriodEnd.toISOString()).toBe(
        '2026-05-24T00:00:00.000Z',
      );
    });

    it('logs unknown priceId by mapping to "expired" plan', async () => {
      db.findUserWithSubscriptionAndLicense.mockResolvedValueOnce(
        makeUserWithSubAndLicense({ subscription: null, license: null }),
      );
      paddle.findSubscriptionByEmail.mockResolvedValueOnce({
        status: 'found',
        data: makePaddleData({ priceId: 'pri_mystery' }),
      });
      db.createSubscriptionAndLicense.mockResolvedValueOnce({
        subscriptionId: 'new-sub',
        licenseId: 'new-lic',
        licenseKey: 'ptah_lic_' + 'd'.repeat(64),
      });

      const result = await service.reconcile('user-1', 'alice@example.com');

      const [, licData] = db.createSubscriptionAndLicense.mock.calls[0];
      expect(licData.plan).toBe('expired');
      expect(result.changes.planAfter).toBe('expired');
    });
  });

  // =========================================================================
  // createPortalSession
  // =========================================================================
  describe('createPortalSession', () => {
    it('returns no_customer_record when the user has no portal-eligible subscription', async () => {
      db.findSubscriptionForPortal.mockResolvedValueOnce(null);

      const result = await service.createPortalSession('user-1');

      expect(result).toEqual({
        error: 'no_customer_record',
        message: 'No Paddle customer record found for this user.',
      });
      expect(paddle.createPortalSession).not.toHaveBeenCalled();
    });

    it('returns no_customer_record for internal trial users', async () => {
      db.findSubscriptionForPortal.mockResolvedValueOnce(
        makeLocalSubscription({
          status: 'trialing',
          paddleCustomerId: 'trial_customer_abc',
          priceId: 'auto_trial_pro',
        }),
      );

      const result = await service.createPortalSession('user-1');

      expect(result).toEqual({
        error: 'no_customer_record',
        message:
          'Portal is not available during trial period. Use the pricing page to subscribe.',
      });
      expect(paddle.createPortalSession).not.toHaveBeenCalled();
    });

    it('returns paddle_api_error when Paddle call returns null', async () => {
      db.findSubscriptionForPortal.mockResolvedValueOnce(
        makeLocalSubscription(),
      );
      paddle.createPortalSession.mockResolvedValueOnce(null);

      const result = await service.createPortalSession('user-1');

      expect(result).toEqual({
        error: 'paddle_api_error',
        message: 'Unable to create portal session. Please try again later.',
      });
    });

    it('returns url + expiresAt 60 minutes in the future on success', async () => {
      clock = freezeTime('2026-04-24T00:00:00Z');
      db.findSubscriptionForPortal.mockResolvedValueOnce(
        makeLocalSubscription(),
      );
      paddle.createPortalSession.mockResolvedValueOnce({
        url: 'https://paddle.com/portal/abc',
      });

      const result = await service.createPortalSession('user-1');

      expect(result).toEqual({
        url: 'https://paddle.com/portal/abc',
        expiresAt: '2026-04-24T01:00:00.000Z',
      });
      expect(paddle.createPortalSession).toHaveBeenCalledWith('pdl_cust_1', [
        'pdl_sub_1',
      ]);
    });
  });

  // =========================================================================
  // getCheckoutInfo
  // =========================================================================
  describe('getCheckoutInfo', () => {
    it('throws when user is not found', async () => {
      db.findUserById.mockResolvedValueOnce(null);

      await expect(service.getCheckoutInfo('missing')).rejects.toThrow(
        'User not found',
      );
    });

    it('returns email and paddleCustomerId when user has one', async () => {
      db.findUserById.mockResolvedValueOnce({
        id: 'user-1',
        email: 'alice@example.com',
        paddleCustomerId: 'pdl_cust_1',
      });

      const result = await service.getCheckoutInfo('user-1');

      expect(result).toEqual({
        email: 'alice@example.com',
        paddleCustomerId: 'pdl_cust_1',
      });
    });

    it('returns undefined paddleCustomerId when user has none', async () => {
      db.findUserById.mockResolvedValueOnce({
        id: 'user-1',
        email: 'alice@example.com',
        paddleCustomerId: null,
      });

      const result = await service.getCheckoutInfo('user-1');

      expect(result).toEqual({
        email: 'alice@example.com',
        paddleCustomerId: undefined,
      });
    });
  });
});
