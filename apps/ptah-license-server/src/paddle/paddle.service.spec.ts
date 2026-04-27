/**
 * Unit tests for `PaddleService` — money-path batch W1.B1.1.
 *
 * Scope: the business-logic handlers invoked by `PaddleWebhookService`
 * after signature verification succeeds. Each handler is tested against
 * the MockPrisma factory + stubbed Email/Events/PaddleClient seams.
 *
 * What we assert about money paths:
 *   - Idempotency on subscription.created (both subscription-id guard and
 *     eventId-tagged license guard).
 *   - License revocation on new subscription (one-active-license invariant).
 *   - Trial → active transition keeps the license row, renames the plan.
 *   - Cancellation preserves access until `current_billing_period.endsAt`.
 *   - transaction.completed extends the existing license expiration.
 *   - Session one-time purchases are routed to `sessionRequest`, not to
 *     subscription tables.
 *   - Unknown price IDs fall through to the `expired` tier — prevents a
 *     mis-configuration from silently up-plan-ing users.
 *
 * The spec intentionally does NOT re-verify signatures — that's fully
 * covered in `paddle-webhook.service.spec.ts`. Input here is the SDK
 * notification type that the webhook service hands down after unmarshal.
 */

import type {
  SubscriptionCreatedNotification,
  SubscriptionNotification,
  TransactionNotification,
} from '@paddle/paddle-node-sdk';

import { PaddleService } from './paddle.service';
import { PADDLE_CLIENT } from './providers/paddle.provider';
import {
  createMockPrisma,
  type MockPrisma,
} from '../testing/mock-prisma.factory';
import { createTestingNestModule } from '../testing/nest-module-builder';
import { EmailService } from '../email/services/email.service';
import { EventsService } from '../events/events.service';

// ---------------------------------------------------------------------------
// Stub factories
// ---------------------------------------------------------------------------

interface EmailStub {
  sendLicenseKey: jest.Mock;
}

interface EventsStub {
  emitLicenseUpdated: jest.Mock;
  emitSubscriptionStatus: jest.Mock;
}

interface PaddleClientStub {
  customers: { get: jest.Mock };
}

function createEmailStub(): EmailStub {
  return { sendLicenseKey: jest.fn().mockResolvedValue(undefined) };
}

function createEventsStub(): EventsStub {
  return {
    emitLicenseUpdated: jest.fn(),
    emitSubscriptionStatus: jest.fn(),
  };
}

function createPaddleClientStub(): PaddleClientStub {
  return { customers: { get: jest.fn() } };
}

async function buildService(params?: {
  config?: Record<string, unknown>;
  prisma?: MockPrisma;
  email?: EmailStub;
  events?: EventsStub;
  paddle?: PaddleClientStub;
}): Promise<{
  service: PaddleService;
  prisma: MockPrisma;
  email: EmailStub;
  events: EventsStub;
  paddle: PaddleClientStub;
}> {
  const prisma = params?.prisma ?? createMockPrisma();
  const email = params?.email ?? createEmailStub();
  const events = params?.events ?? createEventsStub();
  const paddle = params?.paddle ?? createPaddleClientStub();

  const { module } = await createTestingNestModule({
    prisma,
    config: {
      PADDLE_PRICE_ID_PRO_MONTHLY: 'pri_pro_monthly',
      PADDLE_PRICE_ID_PRO_YEARLY: 'pri_pro_yearly',
      PADDLE_PRICE_ID_SESSION: 'pri_session_onetime',
      ...(params?.config ?? {}),
    },
    providers: [
      { provide: EmailService, useValue: email },
      { provide: EventsService, useValue: events },
      { provide: PADDLE_CLIENT, useValue: paddle },
      PaddleService,
    ],
  });

  return {
    service: module.get<PaddleService>(PaddleService),
    prisma,
    email,
    events,
    paddle,
  };
}

// ---------------------------------------------------------------------------
// Notification builders — shaped like the SDK's typed notifications with
// just enough fields for each handler. We cast at the boundary because
// the full SDK type graph is not under test.
// ---------------------------------------------------------------------------

type BuildSubOverrides = {
  id?: string;
  status?: string;
  customerId?: string | null;
  priceId?: string;
  endsAt?: string;
  trialEndsAt?: string | null;
  canceledAt?: string | null;
};

function buildSubscriptionNotification(
  overrides: BuildSubOverrides = {},
): SubscriptionNotification & SubscriptionCreatedNotification {
  const endsAt = overrides.endsAt ?? '2026-05-24T10:00:00Z';
  return {
    id: overrides.id ?? 'sub_test_0001',
    status: (overrides.status ?? 'active') as never,
    customerId: overrides.customerId ?? 'ctm_test_0001',
    priceId: overrides.priceId ?? 'pri_pro_monthly',
    canceledAt: overrides.canceledAt ?? null,
    currentBillingPeriod: {
      startsAt: '2026-04-24T10:00:00Z',
      endsAt,
    },
    items: [
      {
        price: { id: overrides.priceId ?? 'pri_pro_monthly' },
        trialDates: overrides.trialEndsAt
          ? { startsAt: '2026-04-24T10:00:00Z', endsAt: overrides.trialEndsAt }
          : null,
      },
    ],
  } as unknown as SubscriptionNotification & SubscriptionCreatedNotification;
}

function buildTransactionNotification(
  overrides: {
    id?: string;
    subscriptionId?: string | null;
    priceId?: string;
    endsAt?: string;
    includeBillingPeriod?: boolean;
  } = {},
): TransactionNotification {
  const endsAt = overrides.endsAt ?? '2026-05-24T10:00:00Z';
  // Preserve an explicit `null` override — callers use it to exercise
  // the "non-subscription transaction" branch. `??` short-circuits on
  // null so we must test with `in` instead.
  const subscriptionId =
    'subscriptionId' in overrides ? overrides.subscriptionId : 'sub_test_0001';
  return {
    id: overrides.id ?? 'txn_test_0001',
    subscriptionId,
    billingPeriod:
      overrides.includeBillingPeriod === false
        ? null
        : { startsAt: '2026-04-24T10:00:00Z', endsAt },
    items: [{ price: { id: overrides.priceId ?? 'pri_pro_monthly' } }],
  } as unknown as TransactionNotification;
}

// ---------------------------------------------------------------------------
// getCustomerEmail
// ---------------------------------------------------------------------------

describe('PaddleService — getCustomerEmail', () => {
  it('returns the email from the Paddle customers API', async () => {
    const { service, paddle } = await buildService();
    paddle.customers.get.mockResolvedValue({
      id: 'ctm_test_0001',
      email: 'buyer@example.com',
    });

    await expect(service.getCustomerEmail('ctm_test_0001')).resolves.toBe(
      'buyer@example.com',
    );
    expect(paddle.customers.get).toHaveBeenCalledWith('ctm_test_0001');
  });

  it('returns null (not throws) when the Paddle API fails', async () => {
    const { service, paddle } = await buildService();
    paddle.customers.get.mockRejectedValue(new Error('network down'));

    await expect(service.getCustomerEmail('ctm_test_0001')).resolves.toBeNull();
  });

  it('returns null for an empty customerId', async () => {
    const { service, paddle } = await buildService();
    await expect(service.getCustomerEmail('')).resolves.toBeNull();
    expect(paddle.customers.get).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// handleSubscriptionCreatedEvent — new subscription, trial, idempotency
// ---------------------------------------------------------------------------

describe('PaddleService — handleSubscriptionCreatedEvent', () => {
  it('creates user + subscription + license, revokes prior active licenses, sends email, emits SSE', async () => {
    const { service, prisma, email, events } = await buildService();

    // No existing subscription, no prior license with this eventId.
    prisma.subscription.findUnique.mockResolvedValue(null);
    prisma.license.findFirst.mockResolvedValue(null);
    // New user path.
    prisma.user.findUnique.mockResolvedValue(null);
    prisma.user.create.mockResolvedValue({
      id: 'usr_new',
      email: 'buyer@example.com',
      paddleCustomerId: 'ctm_test_0001',
    });
    prisma.license.updateMany.mockResolvedValue({ count: 2 });
    prisma.subscription.updateMany.mockResolvedValue({ count: 0 });
    prisma.license.create.mockResolvedValue({
      id: 'lic_001',
      licenseKey: 'ptah_lic_stub',
      plan: 'pro',
    });
    prisma.subscription.create.mockResolvedValue({ id: 'sub_db_001' });

    const data = buildSubscriptionNotification({
      id: 'sub_test_0001',
      status: 'active',
      priceId: 'pri_pro_monthly',
    });

    const result = await service.handleSubscriptionCreatedEvent(
      data,
      'Buyer@Example.COM',
      'evt_created_001',
    );

    expect(result).toEqual({ success: true, licenseId: 'lic_001' });

    // Email is always lower-cased.
    expect(prisma.user.findUnique).toHaveBeenCalledWith({
      where: { email: 'buyer@example.com' },
    });

    // Revoke existing active licenses before creating a new one.
    expect(prisma.license.updateMany).toHaveBeenCalledWith({
      where: { userId: 'usr_new', status: 'active' },
      data: { status: 'revoked' },
    });

    // License creation stamps plan = 'pro' and ties to event-id for dedup.
    const licCreateArg = prisma.license.create.mock.calls[0][0] as {
      data: { plan: string; status: string; createdBy: string };
    };
    expect(licCreateArg.data.plan).toBe('pro');
    expect(licCreateArg.data.status).toBe('active');
    expect(licCreateArg.data.createdBy).toBe('paddle_evt_created_001');

    expect(email.sendLicenseKey).toHaveBeenCalledTimes(1);
    expect(events.emitLicenseUpdated).toHaveBeenCalledWith(
      expect.objectContaining({
        email: 'buyer@example.com',
        plan: 'pro',
        status: 'active',
      }),
    );
  });

  it('marks plan as trial_pro when subscription status is trialing', async () => {
    const { service, prisma, events } = await buildService();
    prisma.subscription.findUnique.mockResolvedValue(null);
    prisma.license.findFirst.mockResolvedValue(null);
    prisma.user.findUnique.mockResolvedValue({
      id: 'usr_trial',
      email: 'trial@example.com',
      paddleCustomerId: null,
    });
    prisma.user.update.mockResolvedValue({
      id: 'usr_trial',
      email: 'trial@example.com',
      paddleCustomerId: 'ctm_test_0001',
    });
    prisma.license.updateMany.mockResolvedValue({ count: 0 });
    prisma.subscription.updateMany.mockResolvedValue({ count: 0 });
    prisma.license.create.mockResolvedValue({
      id: 'lic_trial_001',
      plan: 'trial_pro',
    });
    prisma.subscription.create.mockResolvedValue({ id: 'sub_db_trial' });

    const data = buildSubscriptionNotification({
      status: 'trialing',
      trialEndsAt: '2026-05-08T10:00:00Z',
    });

    await service.handleSubscriptionCreatedEvent(
      data,
      'trial@example.com',
      'evt_trial_001',
    );

    const licCreateArg = prisma.license.create.mock.calls[0][0] as {
      data: { plan: string };
    };
    expect(licCreateArg.data.plan).toBe('trial_pro');

    expect(events.emitLicenseUpdated).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'trialing', plan: 'trial_pro' }),
    );
  });

  it('short-circuits duplicates when the subscription id already exists', async () => {
    const { service, prisma, email } = await buildService();
    prisma.subscription.findUnique.mockResolvedValue({
      id: 'sub_db_exists',
      paddleSubscriptionId: 'sub_test_0001',
    });

    const data = buildSubscriptionNotification();
    const result = await service.handleSubscriptionCreatedEvent(
      data,
      'buyer@example.com',
      'evt_retry_001',
    );

    expect(result).toEqual({ success: true, duplicate: true });
    // No downstream side effects.
    expect(prisma.license.create).not.toHaveBeenCalled();
    expect(email.sendLicenseKey).not.toHaveBeenCalled();
  });

  it('short-circuits when a license already carries this eventId (cross-retry dedup)', async () => {
    const { service, prisma } = await buildService();
    prisma.subscription.findUnique.mockResolvedValue(null);
    prisma.license.findFirst.mockResolvedValue({
      id: 'lic_prior',
      createdBy: 'paddle_evt_retry_002',
    });

    const data = buildSubscriptionNotification();
    const result = await service.handleSubscriptionCreatedEvent(
      data,
      'buyer@example.com',
      'evt_retry_002',
    );

    expect(result).toEqual({ success: true, duplicate: true });
    expect(prisma.license.create).not.toHaveBeenCalled();
  });

  it('non-fatal email failures do NOT fail the webhook', async () => {
    const { service, prisma, email } = await buildService();
    prisma.subscription.findUnique.mockResolvedValue(null);
    prisma.license.findFirst.mockResolvedValue(null);
    prisma.user.findUnique.mockResolvedValue(null);
    prisma.user.create.mockResolvedValue({
      id: 'usr_email_fail',
      email: 'x@y.com',
    });
    prisma.license.updateMany.mockResolvedValue({ count: 0 });
    prisma.subscription.updateMany.mockResolvedValue({ count: 0 });
    prisma.license.create.mockResolvedValue({ id: 'lic_email_fail' });
    prisma.subscription.create.mockResolvedValue({ id: 'sub_db_email_fail' });

    email.sendLicenseKey.mockRejectedValue(new Error('SMTP down'));

    const data = buildSubscriptionNotification();
    await expect(
      service.handleSubscriptionCreatedEvent(data, 'x@y.com', 'evt_email_fail'),
    ).resolves.toEqual({ success: true, licenseId: 'lic_email_fail' });
  });

  it('maps unknown price IDs to "expired" (prevents silent mis-charging onto pro)', async () => {
    const { service, prisma } = await buildService();
    prisma.subscription.findUnique.mockResolvedValue(null);
    prisma.license.findFirst.mockResolvedValue(null);
    prisma.user.findUnique.mockResolvedValue(null);
    prisma.user.create.mockResolvedValue({
      id: 'usr_unknown',
      email: 'u@e.com',
    });
    prisma.license.updateMany.mockResolvedValue({ count: 0 });
    prisma.subscription.updateMany.mockResolvedValue({ count: 0 });
    prisma.license.create.mockResolvedValue({ id: 'lic_unknown' });
    prisma.subscription.create.mockResolvedValue({ id: 'sub_unknown' });

    const data = buildSubscriptionNotification({
      priceId: 'pri_attacker_supplied_phantom',
    });

    await service.handleSubscriptionCreatedEvent(
      data,
      'u@e.com',
      'evt_unknown_price',
    );

    const licCreateArg = prisma.license.create.mock.calls[0][0] as {
      data: { plan: string };
    };
    expect(licCreateArg.data.plan).toBe('expired');
  });
});

// ---------------------------------------------------------------------------
// handleSubscriptionActivatedEvent — trial → active transition
// ---------------------------------------------------------------------------

describe('PaddleService — handleSubscriptionActivatedEvent', () => {
  it('upgrades license plan from trial_pro to pro when an existing subscription is present', async () => {
    const { service, prisma, events } = await buildService();
    prisma.subscription.findUnique.mockResolvedValue({
      id: 'sub_db_001',
      paddleSubscriptionId: 'sub_test_0001',
      userId: 'usr_trial',
      user: { id: 'usr_trial', email: 'trial@example.com' },
    });
    prisma.subscription.update.mockResolvedValue({ id: 'sub_db_001' });
    prisma.license.updateMany.mockResolvedValue({ count: 1 });

    const data = buildSubscriptionNotification({
      status: 'active',
      priceId: 'pri_pro_yearly',
    });

    const result = await service.handleSubscriptionActivatedEvent(
      data,
      'trial@example.com',
      'evt_activated_001',
    );

    expect(result).toEqual({ success: true });

    // subscription.update called with status: active + cleared trialEnd.
    const subUpdate = prisma.subscription.update.mock.calls[0][0] as {
      data: { status: string; trialEnd: null | Date };
    };
    expect(subUpdate.data.status).toBe('active');
    expect(subUpdate.data.trialEnd).toBeNull();

    // license.updateMany scoped to trial_ plans.
    const licUpdate = prisma.license.updateMany.mock.calls[0][0] as {
      where: { plan: { startsWith: string } };
      data: { plan: string };
    };
    expect(licUpdate.where.plan.startsWith).toBe('trial_');
    expect(licUpdate.data.plan).toBe('pro');

    expect(events.emitLicenseUpdated).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'trial@example.com', plan: 'pro' }),
    );
    expect(events.emitSubscriptionStatus).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'active' }),
    );
  });

  it('falls through to create-event semantics when no prior subscription exists', async () => {
    const { service, prisma, email } = await buildService();
    // No prior subscription — activated behaves like created.
    prisma.subscription.findUnique.mockResolvedValueOnce(null);
    // Second findUnique inside the created flow — still none.
    prisma.subscription.findUnique.mockResolvedValueOnce(null);
    prisma.license.findFirst.mockResolvedValue(null);
    prisma.user.findUnique.mockResolvedValue(null);
    prisma.user.create.mockResolvedValue({ id: 'usr_new', email: 'x@e.com' });
    prisma.license.updateMany.mockResolvedValue({ count: 0 });
    prisma.subscription.updateMany.mockResolvedValue({ count: 0 });
    prisma.license.create.mockResolvedValue({ id: 'lic_new' });
    prisma.subscription.create.mockResolvedValue({ id: 'sub_db_new' });

    const data = buildSubscriptionNotification();
    const result = await service.handleSubscriptionActivatedEvent(
      data,
      'x@e.com',
      'evt_activated_002',
    );

    expect(result).toEqual({ success: true, licenseId: 'lic_new' });
    expect(email.sendLicenseKey).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// handleSubscriptionUpdatedEvent
// ---------------------------------------------------------------------------

describe('PaddleService — handleSubscriptionUpdatedEvent', () => {
  it('updates subscription + licenses and emits license-updated SSE', async () => {
    const { service, prisma, events } = await buildService();
    prisma.user.findUnique.mockResolvedValue({
      id: 'usr_upd',
      email: 'u@e.com',
    });
    prisma.subscription.updateMany.mockResolvedValue({ count: 1 });
    prisma.license.updateMany.mockResolvedValue({ count: 1 });

    const data = buildSubscriptionNotification({
      priceId: 'pri_pro_yearly',
      endsAt: '2027-04-24T10:00:00Z',
    });

    const result = await service.handleSubscriptionUpdatedEvent(
      data,
      'u@e.com',
      'evt_updated_001',
    );

    expect(result).toEqual({ success: true });

    const licUpdate = prisma.license.updateMany.mock.calls[0][0] as {
      data: { plan: string; expiresAt: Date };
    };
    expect(licUpdate.data.plan).toBe('pro');
    expect(licUpdate.data.expiresAt.toISOString()).toBe(
      '2027-04-24T10:00:00.000Z',
    );

    expect(events.emitLicenseUpdated).toHaveBeenCalledWith(
      expect.objectContaining({
        plan: 'pro',
        status: 'active',
        expiresAt: '2027-04-24T10:00:00.000Z',
      }),
    );
  });

  it('returns error when user is unknown', async () => {
    const { service, prisma } = await buildService();
    prisma.user.findUnique.mockResolvedValue(null);

    const data = buildSubscriptionNotification();
    const result = await service.handleSubscriptionUpdatedEvent(
      data,
      'ghost@example.com',
      'evt_updated_ghost',
    );

    expect(result).toEqual({ success: false, error: 'User not found' });
    expect(prisma.license.updateMany).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// handleSubscriptionCanceledEvent
// ---------------------------------------------------------------------------

describe('PaddleService — handleSubscriptionCanceledEvent', () => {
  it('preserves access until currentBillingPeriod.endsAt', async () => {
    const { service, prisma, events } = await buildService();
    prisma.user.findUnique.mockResolvedValue({
      id: 'usr_cancel',
      email: 'c@e.com',
    });
    prisma.subscription.updateMany.mockResolvedValue({ count: 1 });
    prisma.license.updateMany.mockResolvedValue({ count: 1 });
    prisma.license.findFirst.mockResolvedValue({ id: 'lic_c', plan: 'pro' });

    const data = buildSubscriptionNotification({
      status: 'canceled',
      endsAt: '2026-05-24T10:00:00Z',
      canceledAt: '2026-04-30T10:00:00Z',
    });

    const result = await service.handleSubscriptionCanceledEvent(
      data,
      'c@e.com',
      'evt_cancel_001',
    );

    expect(result).toEqual({ success: true });

    const subUpdate = prisma.subscription.updateMany.mock.calls[0][0] as {
      data: { status: string; currentPeriodEnd: Date; canceledAt: Date };
    };
    expect(subUpdate.data.status).toBe('canceled');
    expect(subUpdate.data.currentPeriodEnd.toISOString()).toBe(
      '2026-05-24T10:00:00.000Z',
    );

    const licUpdate = prisma.license.updateMany.mock.calls[0][0] as {
      data: { expiresAt: Date };
    };
    expect(licUpdate.data.expiresAt.toISOString()).toBe(
      '2026-05-24T10:00:00.000Z',
    );

    expect(events.emitSubscriptionStatus).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'canceled', plan: 'pro' }),
    );
  });

  it('returns error when user is unknown', async () => {
    const { service, prisma } = await buildService();
    prisma.user.findUnique.mockResolvedValue(null);

    const data = buildSubscriptionNotification({ status: 'canceled' });
    const result = await service.handleSubscriptionCanceledEvent(
      data,
      'ghost@example.com',
      'evt_cancel_ghost',
    );

    expect(result).toEqual({ success: false, error: 'User not found' });
  });
});

// ---------------------------------------------------------------------------
// handleSubscriptionPastDueEvent / paused / resumed
// ---------------------------------------------------------------------------

describe('PaddleService — past_due / paused / resumed', () => {
  it('past_due: updates subscription status, emits SSE event', async () => {
    const { service, prisma, events } = await buildService();
    prisma.subscription.updateMany.mockResolvedValue({ count: 1 });
    prisma.user.findUnique.mockResolvedValue({
      id: 'usr_pd',
      email: 'pd@e.com',
    });
    prisma.license.findFirst.mockResolvedValue({ id: 'lic_pd', plan: 'pro' });

    const data = buildSubscriptionNotification({ status: 'past_due' });
    await service.handleSubscriptionPastDueEvent(
      data,
      'pd@e.com',
      'evt_pd_001',
    );

    expect(prisma.subscription.updateMany).toHaveBeenCalledWith({
      where: { paddleSubscriptionId: 'sub_test_0001' },
      data: { status: 'past_due' },
    });
    expect(events.emitSubscriptionStatus).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'past_due', plan: 'pro' }),
    );
  });

  it('paused: sets license status to paused and emits SSE event', async () => {
    const { service, prisma, events } = await buildService();
    prisma.subscription.updateMany.mockResolvedValue({ count: 1 });
    prisma.user.findUnique.mockResolvedValue({
      id: 'usr_p',
      email: 'p@e.com',
    });
    prisma.license.findFirst.mockResolvedValue({ id: 'lic_p', plan: 'pro' });
    prisma.license.updateMany.mockResolvedValue({ count: 1 });

    const data = buildSubscriptionNotification({ status: 'paused' });
    await service.handleSubscriptionPausedEvent(data, 'p@e.com', 'evt_p_001');

    expect(prisma.license.updateMany).toHaveBeenCalledWith({
      where: { userId: 'usr_p', status: 'active' },
      data: { status: 'paused' },
    });
    expect(events.emitSubscriptionStatus).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'paused' }),
    );
  });

  it('resumed: reactivates license, extends expiresAt, emits SSE', async () => {
    const { service, prisma, events } = await buildService();
    prisma.subscription.updateMany.mockResolvedValue({ count: 1 });
    prisma.user.findUnique.mockResolvedValue({
      id: 'usr_r',
      email: 'r@e.com',
    });
    prisma.license.findFirst.mockResolvedValue({ id: 'lic_r', plan: 'pro' });
    prisma.license.updateMany.mockResolvedValue({ count: 1 });

    const data = buildSubscriptionNotification({
      status: 'active',
      endsAt: '2026-06-24T10:00:00Z',
    });
    await service.handleSubscriptionResumedEvent(data, 'r@e.com', 'evt_r_001');

    const licUpdate = prisma.license.updateMany.mock.calls[0][0] as {
      where: { status: string };
      data: { status: string; expiresAt: Date };
    };
    expect(licUpdate.where.status).toBe('paused');
    expect(licUpdate.data.status).toBe('active');
    expect(licUpdate.data.expiresAt.toISOString()).toBe(
      '2026-06-24T10:00:00.000Z',
    );

    expect(events.emitLicenseUpdated).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'active' }),
    );
  });
});

// ---------------------------------------------------------------------------
// handleTransactionCompletedEvent — renewals + session payments
// ---------------------------------------------------------------------------

describe('PaddleService — handleTransactionCompletedEvent', () => {
  it('extends the license expiration on a subscription renewal', async () => {
    const { service, prisma, events } = await buildService();
    prisma.subscription.findUnique.mockResolvedValue({
      id: 'sub_db_001',
      userId: 'usr_renew',
      user: { id: 'usr_renew', email: 'renew@example.com' },
    });
    prisma.subscription.update.mockResolvedValue({ id: 'sub_db_001' });
    prisma.license.updateMany.mockResolvedValue({ count: 1 });
    prisma.license.findFirst.mockResolvedValue({ id: 'lic_r', plan: 'pro' });

    const data = buildTransactionNotification({
      endsAt: '2026-05-24T10:00:00Z',
    });

    const result = await service.handleTransactionCompletedEvent(
      data,
      'evt_txn_renew_001',
    );

    expect(result).toEqual({ success: true });

    const licUpdate = prisma.license.updateMany.mock.calls[0][0] as {
      where: { userId: string; status: string };
      data: { expiresAt: Date };
    };
    expect(licUpdate.where.userId).toBe('usr_renew');
    expect(licUpdate.where.status).toBe('active');
    expect(licUpdate.data.expiresAt.toISOString()).toBe(
      '2026-05-24T10:00:00.000Z',
    );

    expect(events.emitLicenseUpdated).toHaveBeenCalledWith(
      expect.objectContaining({
        email: 'renew@example.com',
        status: 'active',
        plan: 'pro',
      }),
    );
  });

  it('routes session one-time payments to sessionRequest when subscriptionId is absent', async () => {
    const { service, prisma } = await buildService();
    prisma.sessionRequest.updateMany.mockResolvedValue({ count: 1 });

    const data = buildTransactionNotification({
      subscriptionId: null,
      priceId: 'pri_session_onetime',
      includeBillingPeriod: false,
    });

    const result = await service.handleTransactionCompletedEvent(
      data,
      'evt_txn_session_001',
    );

    expect(result).toEqual({ success: true });
    expect(prisma.sessionRequest.updateMany).toHaveBeenCalledWith({
      where: {
        paddleTransactionId: data.id,
        paymentStatus: 'pending',
      },
      data: { paymentStatus: 'completed' },
    });
    expect(prisma.license.updateMany).not.toHaveBeenCalled();
  });

  it('skips non-subscription transactions that do not match the session price', async () => {
    const { service, prisma } = await buildService();
    const data = buildTransactionNotification({
      subscriptionId: null,
      priceId: 'pri_random_checkout',
      includeBillingPeriod: false,
    });

    const result = await service.handleTransactionCompletedEvent(
      data,
      'evt_txn_unknown_001',
    );

    expect(result).toEqual({ success: true, skipped: true });
    expect(prisma.sessionRequest.updateMany).not.toHaveBeenCalled();
    expect(prisma.license.updateMany).not.toHaveBeenCalled();
  });

  it('returns error when a subscription renewal arrives without a billing period', async () => {
    const { service, prisma } = await buildService();

    const data = buildTransactionNotification({ includeBillingPeriod: false });
    const result = await service.handleTransactionCompletedEvent(
      data,
      'evt_txn_no_bp',
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('No billing_period');
    expect(prisma.license.updateMany).not.toHaveBeenCalled();
  });

  it('returns error when the local subscription row is missing', async () => {
    const { service, prisma } = await buildService();
    prisma.subscription.findUnique.mockResolvedValue(null);

    const data = buildTransactionNotification();
    const result = await service.handleTransactionCompletedEvent(
      data,
      'evt_txn_orphan',
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('not found in database');
  });
});
