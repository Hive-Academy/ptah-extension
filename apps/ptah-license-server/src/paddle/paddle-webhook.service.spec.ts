/**
 * Unit tests for `PaddleWebhookService` — money-path batch W1.B1.1.
 *
 * This spec is deliberately the security gate for the webhook pipeline:
 * it exercises EVERY signature-related rejection path the real Paddle
 * SDK enforces (`Webhooks.unmarshal` calls `WebhooksValidator.isValidSignature`
 * which rejects on tamper, wrong-secret, stale-timestamp, and malformed
 * headers). Unit tests use a live Paddle SDK client + the shared
 * `TEST_PADDLE_WEBHOOK_SECRET` so the round-trip is real, not mocked.
 *
 * Non-negotiables covered (per batch brief):
 *   - Round-trip verification for all 4 signed fixtures.
 *   - Tampered body → UnauthorizedException.
 *   - Tampered signature → UnauthorizedException.
 *   - Replay / expired timestamp (outside the 5s skew window) → rejected.
 *   - Timestamp skew edge-cases (now, now+3s, now-60s).
 *   - FailedWebhook DB row created when downstream processing throws.
 *   - Idempotency: duplicate eventId within the process-cache is skipped
 *     AND only-successful events are marked (failed events stay retryable).
 *
 * Pattern: follows `src/audit/audit-log.service.spec.ts` for the MockPrisma
 * factory pattern, but uses the new typed `createMockPrisma()` +
 * `createTestingNestModule()` harness from W0.B4 instead of an inline mock.
 */

import { Paddle, Environment, EventName } from '@paddle/paddle-node-sdk';
import {
  UnauthorizedException,
  InternalServerErrorException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { PaddleService } from './paddle.service';
import { PaddleWebhookService } from './paddle-webhook.service';
import { PADDLE_CLIENT } from './providers/paddle.provider';
import {
  createMockPrisma,
  type MockPrisma,
} from '../testing/mock-prisma.factory';
import { createTestingNestModule } from '../testing/nest-module-builder';
import {
  loadPaddleFixture,
  signPaddlePayload,
  TEST_PADDLE_WEBHOOK_SECRET,
  type PaddleFixtureName,
} from '../testing/fixtures/paddle';

// ---------------------------------------------------------------------------
// Test harness helpers
// ---------------------------------------------------------------------------

/**
 * Build a real Paddle SDK client for signature verification. The SDK does
 * NOT hit the network during `webhooks.unmarshal()`, so any syntactically
 * valid API key suffices.
 */
function makeRealPaddleClient(): Paddle {
  return new Paddle('apikey_test_PtahWebhookSpecDummyKey00000', {
    environment: Environment.sandbox,
  });
}

/**
 * Build a stub PaddleService whose handler methods are all jest mocks.
 * Keeps the PaddleWebhookService spec focused on routing + verification;
 * the handler business logic is covered in `paddle.service.spec.ts`.
 */
function createPaddleServiceStub(): jest.Mocked<PaddleService> {
  const stub = {
    getCustomerEmail: jest.fn(),
    handleSubscriptionCreatedEvent: jest.fn(),
    handleSubscriptionActivatedEvent: jest.fn(),
    handleSubscriptionUpdatedEvent: jest.fn(),
    handleSubscriptionCanceledEvent: jest.fn(),
    handleSubscriptionPastDueEvent: jest.fn(),
    handleSubscriptionPausedEvent: jest.fn(),
    handleSubscriptionResumedEvent: jest.fn(),
    handleTransactionCompletedEvent: jest.fn(),
  };
  return stub as unknown as jest.Mocked<PaddleService>;
}

async function buildWebhookService(params?: {
  secret?: string | undefined;
  paddleService?: jest.Mocked<PaddleService>;
  prisma?: MockPrisma;
}): Promise<{
  service: PaddleWebhookService;
  prisma: MockPrisma;
  paddleService: jest.Mocked<PaddleService>;
  paddle: Paddle;
}> {
  const paddleService = params?.paddleService ?? createPaddleServiceStub();
  const paddle = makeRealPaddleClient();
  const prisma = params?.prisma ?? createMockPrisma();

  const secretForConfig =
    params?.secret === undefined ? TEST_PADDLE_WEBHOOK_SECRET : params.secret;

  const { module } = await createTestingNestModule({
    prisma,
    config: { PADDLE_WEBHOOK_SECRET: secretForConfig },
    providers: [
      { provide: PaddleService, useValue: paddleService },
      { provide: PADDLE_CLIENT, useValue: paddle },
      PaddleWebhookService,
    ],
  });

  return {
    service: module.get<PaddleWebhookService>(PaddleWebhookService),
    prisma,
    paddleService,
    paddle,
  };
}

// ---------------------------------------------------------------------------
// Signature + replay protection
// ---------------------------------------------------------------------------

describe('PaddleWebhookService — signature & replay protection', () => {
  const FIXTURES: PaddleFixtureName[] = [
    'subscription-created',
    'subscription-updated',
    'subscription-canceled',
    'transaction-completed',
  ];

  describe.each(FIXTURES)('%s fixture', (name) => {
    it('round-trips signature verification and routes to the correct handler', async () => {
      const { service, paddleService } = await buildWebhookService();

      // Every handler resolves with a simple success shape so routing
      // wraps the result in `{ received: true, ...result }`.
      paddleService.handleSubscriptionCreatedEvent.mockResolvedValue({
        success: true,
      });
      paddleService.handleSubscriptionUpdatedEvent.mockResolvedValue({
        success: true,
      });
      paddleService.handleSubscriptionCanceledEvent.mockResolvedValue({
        success: true,
      });
      paddleService.handleTransactionCompletedEvent.mockResolvedValue({
        success: true,
      });
      // Customer email is resolved via PaddleService for subscription events.
      paddleService.getCustomerEmail.mockResolvedValue('buyer@example.com');

      const fixture = loadPaddleFixture(name);

      const result = await service.processWebhook(
        fixture.body,
        fixture.signatureHeader,
      );

      expect(result.received).toBe(true);
      expect(result.success).toBe(true);

      // Confirm routing hit the right handler for this event type.
      switch (fixture.bodyJson['event_type']) {
        case EventName.SubscriptionCreated:
          expect(
            paddleService.handleSubscriptionCreatedEvent,
          ).toHaveBeenCalledTimes(1);
          break;
        case EventName.SubscriptionUpdated:
          expect(
            paddleService.handleSubscriptionUpdatedEvent,
          ).toHaveBeenCalledTimes(1);
          break;
        case EventName.SubscriptionCanceled:
          expect(
            paddleService.handleSubscriptionCanceledEvent,
          ).toHaveBeenCalledTimes(1);
          break;
        case EventName.TransactionCompleted:
          expect(
            paddleService.handleTransactionCompletedEvent,
          ).toHaveBeenCalledTimes(1);
          break;
      }
    });

    it('rejects a tampered body with UnauthorizedException', async () => {
      const { service, paddleService } = await buildWebhookService();

      const fixture = loadPaddleFixture(name, { tamperBody: true });

      await expect(
        service.processWebhook(fixture.body, fixture.signatureHeader),
      ).rejects.toBeInstanceOf(UnauthorizedException);

      // Nothing downstream should be invoked if the signature is bad.
      expect(
        paddleService.handleSubscriptionCreatedEvent,
      ).not.toHaveBeenCalled();
      expect(
        paddleService.handleSubscriptionUpdatedEvent,
      ).not.toHaveBeenCalled();
      expect(
        paddleService.handleSubscriptionCanceledEvent,
      ).not.toHaveBeenCalled();
      expect(
        paddleService.handleTransactionCompletedEvent,
      ).not.toHaveBeenCalled();
    });

    it('rejects when the signature header is tampered (h1 flipped)', async () => {
      const { service } = await buildWebhookService();
      const fixture = loadPaddleFixture(name);

      // Flip the last hex char of h1 — still syntactically valid but wrong.
      const mangled = fixture.signatureHeader.replace(/([a-f0-9])$/, (c) =>
        c === '0' ? '1' : '0',
      );

      await expect(
        service.processWebhook(fixture.body, mangled),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('rejects when signature is signed with a different secret', async () => {
      const { service } = await buildWebhookService();
      const fixture = loadPaddleFixture(name, {
        secret: 'pdl_ntfset_attacker_controlled_secret',
      });

      await expect(
        service.processWebhook(fixture.body, fixture.signatureHeader),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });
  });

  // -------------------------------------------------------------------------
  // Timestamp / replay cases — Paddle SDK enforces MAX_VALID_TIME_DIFFERENCE = 5s.
  // -------------------------------------------------------------------------

  describe('timestamp skew window (Paddle SDK enforces 5s max)', () => {
    it('accepts a signature timestamped slightly in the past (within 5s)', async () => {
      const { service, paddleService } = await buildWebhookService();
      paddleService.getCustomerEmail.mockResolvedValue('buyer@example.com');
      paddleService.handleSubscriptionCreatedEvent.mockResolvedValue({
        success: true,
      });

      const now = Math.floor(Date.now() / 1000);
      // Paddle's rule: rejected if now > ts + 5. ts = now - 3 → tolerated.
      const fixture = loadPaddleFixture('subscription-created', {
        timestamp: now - 3,
      });

      await expect(
        service.processWebhook(fixture.body, fixture.signatureHeader),
      ).resolves.toEqual(expect.objectContaining({ received: true }));
    });

    it('rejects a replayed signature with a stale timestamp (60s old)', async () => {
      const { service } = await buildWebhookService();

      // A clock 60s in the past is well outside the 5s tolerance — this is
      // the "replay attack" contract: even with a valid HMAC, an old ts
      // must be refused.
      const staleTimestamp = Math.floor(Date.now() / 1000) - 60;
      const fixture = loadPaddleFixture('transaction-completed', {
        timestamp: staleTimestamp,
      });

      await expect(
        service.processWebhook(fixture.body, fixture.signatureHeader),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('rejects when a fresh HMAC is replayed with a stale timestamp label', async () => {
      // Simulate the attacker strategy: capture a valid signature then
      // rewrite only the `ts=` label to smuggle the payload through.
      // The HMAC covers `ts + ":" + body`, so rewriting ts alone breaks it
      // — combined with a stale ts the request is refused by BOTH checks.
      const { service } = await buildWebhookService();
      const fixture = loadPaddleFixture('subscription-updated');
      const staleTs = Math.floor(Date.now() / 1000) - 120;

      const spoofed = fixture.signatureHeader.replace(
        /^ts=\d+;/,
        `ts=${staleTs};`,
      );

      await expect(
        service.processWebhook(fixture.body, spoofed),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('rejects a malformed signature header', async () => {
      const { service } = await buildWebhookService();
      const fixture = loadPaddleFixture('subscription-canceled');

      await expect(
        service.processWebhook(fixture.body, 'totally-bogus-header'),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });
  });
});

// ---------------------------------------------------------------------------
// Configuration guard
// ---------------------------------------------------------------------------

describe('PaddleWebhookService — configuration guard', () => {
  it('throws UnauthorizedException when PADDLE_WEBHOOK_SECRET is missing', async () => {
    // Build the service with no secret wired in. We override `ConfigService`
    // directly so we get an explicit `undefined` from `get()`.
    const paddleService = createPaddleServiceStub();
    const paddle = makeRealPaddleClient();
    const prisma = createMockPrisma();

    const stubConfig: Pick<ConfigService, 'get'> = {
      get: jest.fn().mockReturnValue(undefined),
    };

    const { module } = await createTestingNestModule({
      prisma,
      providers: [
        { provide: PaddleService, useValue: paddleService },
        { provide: PADDLE_CLIENT, useValue: paddle },
        PaddleWebhookService,
      ],
      overrides: [{ token: ConfigService, useValue: stubConfig }],
    });

    const service = module.get<PaddleWebhookService>(PaddleWebhookService);
    const fixture = loadPaddleFixture('subscription-created');

    await expect(
      service.processWebhook(fixture.body, fixture.signatureHeader),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });
});

// ---------------------------------------------------------------------------
// Idempotency / in-memory dedup
// ---------------------------------------------------------------------------

describe('PaddleWebhookService — idempotency', () => {
  it('returns { duplicate: true } on a replayed successful event (same eventId within window)', async () => {
    const { service, paddleService } = await buildWebhookService();
    paddleService.getCustomerEmail.mockResolvedValue('buyer@example.com');
    paddleService.handleSubscriptionCreatedEvent.mockResolvedValue({
      success: true,
    });

    // First delivery — use a single fixed timestamp so both re-sends hash
    // the same way AND stay within the 5s window.
    const ts = Math.floor(Date.now() / 1000);
    const fixture = loadPaddleFixture('subscription-created', {
      timestamp: ts,
    });

    const first = await service.processWebhook(
      fixture.body,
      fixture.signatureHeader,
    );
    expect(first.received).toBe(true);
    expect(first.duplicate).toBeUndefined();

    // Second delivery (Paddle retry) — signature still valid within window.
    const second = await service.processWebhook(
      fixture.body,
      fixture.signatureHeader,
    );
    expect(second).toEqual({ received: true, duplicate: true });

    // Handler should only have been hit once.
    expect(paddleService.handleSubscriptionCreatedEvent).toHaveBeenCalledTimes(
      1,
    );
  });

  it('does NOT mark a failed event as processed (Paddle retry remains live)', async () => {
    const { service, paddleService, prisma } = await buildWebhookService();
    paddleService.getCustomerEmail.mockResolvedValue('buyer@example.com');

    const boom = new Error('simulated downstream failure');
    paddleService.handleSubscriptionCreatedEvent
      .mockRejectedValueOnce(boom)
      .mockResolvedValueOnce({ success: true });

    prisma.failedWebhook.create.mockResolvedValue({
      id: 'fw_01',
    } as unknown as never);

    const ts = Math.floor(Date.now() / 1000);
    const fixture = loadPaddleFixture('subscription-created', {
      timestamp: ts,
    });

    // First delivery fails — must throw 500 AND store a FailedWebhook.
    await expect(
      service.processWebhook(fixture.body, fixture.signatureHeader),
    ).rejects.toBeInstanceOf(InternalServerErrorException);

    expect(prisma.failedWebhook.create).toHaveBeenCalledTimes(1);

    // Paddle retries — THIS time it should actually be processed (not
    // short-circuited as a duplicate). If we had optimistically marked
    // the event as processed on the failing pass, this would regress to
    // `{ duplicate: true }` and Paddle's retry would be a silent drop.
    const retry = await service.processWebhook(
      fixture.body,
      fixture.signatureHeader,
    );
    expect(retry.duplicate).toBeUndefined();
    expect(retry.received).toBe(true);
    expect(paddleService.handleSubscriptionCreatedEvent).toHaveBeenCalledTimes(
      2,
    );
  });
});

// ---------------------------------------------------------------------------
// FailedWebhook retry path
// ---------------------------------------------------------------------------

describe('PaddleWebhookService — FailedWebhook persistence', () => {
  it('persists eventId, eventType, rawPayload, errorMessage, stackTrace on transient failure', async () => {
    const { service, paddleService, prisma } = await buildWebhookService();
    paddleService.getCustomerEmail.mockResolvedValue('buyer@example.com');
    paddleService.handleSubscriptionUpdatedEvent.mockRejectedValue(
      new Error('Prisma P1001: DB unreachable'),
    );
    prisma.failedWebhook.create.mockResolvedValue({
      id: 'fw_02',
    } as unknown as never);

    const fixture = loadPaddleFixture('subscription-updated');

    await expect(
      service.processWebhook(fixture.body, fixture.signatureHeader),
    ).rejects.toBeInstanceOf(InternalServerErrorException);

    expect(prisma.failedWebhook.create).toHaveBeenCalledTimes(1);
    const createdArg = prisma.failedWebhook.create.mock.calls[0][0] as {
      data: {
        eventId: string;
        eventType: string;
        rawPayload: Record<string, unknown>;
        errorMessage: string;
        stackTrace?: string;
      };
    };

    expect(createdArg.data.eventId).toBe(fixture.bodyJson['event_id']);
    expect(createdArg.data.eventType).toBe('subscription.updated');
    expect(createdArg.data.errorMessage).toContain('DB unreachable');
    expect(typeof createdArg.data.stackTrace).toBe('string');
    expect(createdArg.data.rawPayload).toEqual(
      expect.objectContaining({
        eventId: fixture.bodyJson['event_id'],
        eventType: 'subscription.updated',
      }),
    );
  });

  it('swallows errors from FailedWebhook storage itself (never masks the original failure)', async () => {
    const { service, paddleService, prisma } = await buildWebhookService();
    paddleService.getCustomerEmail.mockResolvedValue('buyer@example.com');
    paddleService.handleSubscriptionCreatedEvent.mockRejectedValue(
      new Error('primary failure'),
    );
    // Simulate the FailedWebhook table also being down.
    prisma.failedWebhook.create.mockRejectedValue(
      new Error('failed-webhook table unavailable'),
    );

    const fixture = loadPaddleFixture('subscription-created');

    // Must still surface the *processing* failure as 500 so Paddle retries.
    await expect(
      service.processWebhook(fixture.body, fixture.signatureHeader),
    ).rejects.toBeInstanceOf(InternalServerErrorException);
  });
});

// ---------------------------------------------------------------------------
// Routing — unhandled events
// ---------------------------------------------------------------------------

describe('PaddleWebhookService — routing', () => {
  it('acks unhandled event types without invoking a handler', async () => {
    const { service, paddleService } = await buildWebhookService();

    // Synthesise a valid-shape payload the SDK unmarshal will accept as
    // a *handled* event (customer.created has a first-class SDK entity).
    // The routeEvent switch has no case for it, so we should fall through
    // to the default branch returning `{ received: true }` only.
    const body = {
      event_id: 'evt_unhandled_000000000001',
      event_type: 'customer.created',
      occurred_at: '2026-04-24T10:00:00.000000Z',
      notification_id: 'ntf_unhandled_000000000001',
      data: {
        id: 'ctm_unhandled_000000000001',
        email: 'anyone@example.com',
        name: 'Anon',
        status: 'active',
        marketing_consent: false,
        locale: 'en',
        created_at: '2026-04-24T10:00:00.000000Z',
        updated_at: '2026-04-24T10:00:00.000000Z',
        custom_data: null,
      },
    };
    const raw = JSON.stringify(body);
    const { signatureHeader } = signPaddlePayload(raw);

    const result = await service.processWebhook(
      Buffer.from(raw, 'utf8'),
      signatureHeader,
    );

    expect(result).toEqual({ received: true });
    expect(paddleService.handleSubscriptionCreatedEvent).not.toHaveBeenCalled();
    expect(
      paddleService.handleTransactionCompletedEvent,
    ).not.toHaveBeenCalled();
  });

  it('throws when customer email cannot be resolved for a subscription event', async () => {
    const { service, paddleService, prisma } = await buildWebhookService();
    paddleService.getCustomerEmail.mockResolvedValue(null);
    prisma.failedWebhook.create.mockResolvedValue({
      id: 'fw_03',
    } as unknown as never);

    const fixture = loadPaddleFixture('subscription-created');

    // Unresolved email surfaces as a processing failure → 500 + FailedWebhook.
    await expect(
      service.processWebhook(fixture.body, fixture.signatureHeader),
    ).rejects.toBeInstanceOf(InternalServerErrorException);

    expect(prisma.failedWebhook.create).toHaveBeenCalledTimes(1);
  });
});
