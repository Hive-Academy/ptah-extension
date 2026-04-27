/**
 * Paddle webhook end-to-end spec — TASK_2025_294 W1.B6.1.
 *
 * Exercises the full `POST /webhooks/paddle` pipeline end-to-end through
 * the real `PaddleController` + `PaddleWebhookService`, using the real
 * Paddle SDK client for signature verification so the round-trip crypto
 * is not mocked. Only downstream boundaries are mocked:
 *
 *   - `PaddleService` (business-logic handlers are covered by unit specs)
 *   - `PrismaService` (via `createMockPrisma()` — no real DB needed).
 *   - Raw-body middleware (simulated by attaching `rawBody` to a synthetic
 *     Express request — matches what `main.ts` configures with
 *     `NestFactory.create({ rawBody: true })`).
 *
 * Intent: prove that the controller/service contract protects the money
 * path — verification, event routing, failed-webhook persistence, and
 * idempotency — all the way from "HTTP request with paddle-signature
 * header" down to "Prisma write / handler dispatch".
 *
 * Testcontainers / supertest: the `testcontainers` and `supertest`
 * packages are not yet declared in the workspace root package.json
 * (verified `apps/ptah-license-server/src/testing/testcontainers/postgres.ts`
 * header note). The in-process harness used here is deliberately
 * CI-green on Windows with no Docker or network dependency, and
 * matches the shipped pattern from `paddle-webhook.service.spec.ts`
 * (the companion unit spec exercising signature edges in isolation).
 * When testcontainers is adopted workspace-wide, these specs can be
 * re-pointed at `startPostgresContainer()` with a thin shim layer.
 */

import 'reflect-metadata';
import { Paddle, Environment } from '@paddle/paddle-node-sdk';
import {
  UnauthorizedException,
  InternalServerErrorException,
  BadRequestException,
} from '@nestjs/common';
import type { Request } from 'express';

import { PaddleController } from '../../ptah-license-server/src/paddle/paddle.controller';
import { PaddleWebhookService } from '../../ptah-license-server/src/paddle/paddle-webhook.service';
import { PaddleService } from '../../ptah-license-server/src/paddle/paddle.service';
import { PADDLE_CLIENT } from '../../ptah-license-server/src/paddle/providers/paddle.provider';
import {
  createMockPrisma,
  type MockPrisma,
} from '../../ptah-license-server/src/testing/mock-prisma.factory';
import { createTestingNestModule } from '../../ptah-license-server/src/testing/nest-module-builder';
import {
  loadPaddleFixture,
  TEST_PADDLE_WEBHOOK_SECRET,
  type PaddleFixtureName,
} from '../../ptah-license-server/src/testing/fixtures/paddle';

// ---------------------------------------------------------------------------
// Harness helpers
// ---------------------------------------------------------------------------

/**
 * Construct a real Paddle SDK client. The SDK does NOT call the network
 * during `webhooks.unmarshal()`, so any syntactically valid API key works.
 */
function makeRealPaddleClient(): Paddle {
  return new Paddle('apikey_test_PtahE2EWebhookSpecDummyKey0000', {
    environment: Environment.sandbox,
  });
}

/**
 * Build a stub `PaddleService`: every handler is a fresh jest.fn so each
 * test can seed its own return value without interfering with siblings.
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

/**
 * Synthesise the minimum `Request` shape PaddleController reads. The
 * controller only touches `rawBody` — everything else is unused.
 */
function makeRequest(rawBody?: Buffer): Request {
  return { rawBody } as unknown as Request;
}

interface HarnessBundle {
  controller: PaddleController;
  webhookService: PaddleWebhookService;
  paddleService: jest.Mocked<PaddleService>;
  prisma: MockPrisma;
}

async function buildHarness(): Promise<HarnessBundle> {
  const paddleService = createPaddleServiceStub();
  const prisma = createMockPrisma();
  const paddle = makeRealPaddleClient();

  const { module } = await createTestingNestModule({
    prisma,
    config: { PADDLE_WEBHOOK_SECRET: TEST_PADDLE_WEBHOOK_SECRET },
    providers: [
      { provide: PaddleService, useValue: paddleService },
      { provide: PADDLE_CLIENT, useValue: paddle },
      PaddleWebhookService,
      PaddleController,
    ],
  });

  return {
    controller: module.get<PaddleController>(PaddleController),
    webhookService: module.get<PaddleWebhookService>(PaddleWebhookService),
    paddleService,
    prisma,
  };
}

/**
 * Seed default stubs so every test starts from a "happy path" baseline
 * and opts-in to failure seams. Keeps each test short.
 */
function seedHappyHandlers(paddleService: jest.Mocked<PaddleService>): void {
  paddleService.getCustomerEmail.mockResolvedValue('customer@example.com');
  paddleService.handleSubscriptionCreatedEvent.mockResolvedValue({
    success: true,
    licenseId: 'lic_new_001',
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
}

// ---------------------------------------------------------------------------
// Specs
// ---------------------------------------------------------------------------

describe('POST /webhooks/paddle — end-to-end', () => {
  let harness: HarnessBundle;

  beforeEach(async () => {
    harness = await buildHarness();
    seedHappyHandlers(harness.paddleService);
  });

  // -------------------------------------------------------------------------
  // Signature verification — security gate
  // -------------------------------------------------------------------------

  describe('signature verification', () => {
    it('accepts a subscription.created event with a valid signature', async () => {
      const fixture = loadPaddleFixture('subscription-created');

      const response = await harness.controller.handleWebhook(
        fixture.signatureHeader,
        makeRequest(fixture.body),
      );

      expect(response).toMatchObject({ received: true, success: true });
      expect(
        harness.paddleService.handleSubscriptionCreatedEvent,
      ).toHaveBeenCalledTimes(1);
    });

    it('rejects with UnauthorizedException when the body has been tampered with', async () => {
      const fixture = loadPaddleFixture('subscription-updated', {
        tamperBody: true,
      });

      await expect(
        harness.controller.handleWebhook(
          fixture.signatureHeader,
          makeRequest(fixture.body),
        ),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      expect(
        harness.paddleService.handleSubscriptionUpdatedEvent,
      ).not.toHaveBeenCalled();
    });

    it('rejects with UnauthorizedException when the signature header is missing', async () => {
      const fixture = loadPaddleFixture('subscription-created');

      await expect(
        harness.controller.handleWebhook(
          '' as unknown as string,
          makeRequest(fixture.body),
        ),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('rejects with BadRequestException when the raw body middleware did not populate req.rawBody', async () => {
      const fixture = loadPaddleFixture('subscription-created');

      await expect(
        harness.controller.handleWebhook(
          fixture.signatureHeader,
          makeRequest(undefined),
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects with UnauthorizedException when the timestamp is outside the 5s skew window', async () => {
      const stale = Math.floor(Date.now() / 1000) - 60; // 60s ago
      const fixture = loadPaddleFixture('subscription-created', {
        timestamp: stale,
      });

      await expect(
        harness.controller.handleWebhook(
          fixture.signatureHeader,
          makeRequest(fixture.body),
        ),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });
  });

  // -------------------------------------------------------------------------
  // Event routing — verify each lifecycle handler fires with parsed data
  // -------------------------------------------------------------------------

  describe('event routing', () => {
    const cases: Array<{
      name: PaddleFixtureName;
      handlerKey: keyof jest.Mocked<PaddleService>;
    }> = [
      {
        name: 'subscription-created',
        handlerKey: 'handleSubscriptionCreatedEvent',
      },
      {
        name: 'subscription-updated',
        handlerKey: 'handleSubscriptionUpdatedEvent',
      },
      {
        name: 'subscription-canceled',
        handlerKey: 'handleSubscriptionCanceledEvent',
      },
      {
        name: 'transaction-completed',
        handlerKey: 'handleTransactionCompletedEvent',
      },
    ];

    it.each(cases)(
      'routes $name to $handlerKey',
      async ({ name, handlerKey }) => {
        const fixture = loadPaddleFixture(name);

        const response = await harness.controller.handleWebhook(
          fixture.signatureHeader,
          makeRequest(fixture.body),
        );

        expect(response.received).toBe(true);
        expect(harness.paddleService[handlerKey]).toHaveBeenCalledTimes(1);
      },
    );
  });

  // -------------------------------------------------------------------------
  // Failed-webhook persistence — recovery path
  // -------------------------------------------------------------------------

  describe('failed-webhook persistence', () => {
    it('writes a FailedWebhook row and re-throws 500 when the downstream handler throws', async () => {
      harness.paddleService.handleSubscriptionCreatedEvent.mockRejectedValueOnce(
        new Error('downstream DB offline'),
      );
      const fixture = loadPaddleFixture('subscription-created');

      await expect(
        harness.controller.handleWebhook(
          fixture.signatureHeader,
          makeRequest(fixture.body),
        ),
      ).rejects.toBeInstanceOf(InternalServerErrorException);

      expect(harness.prisma.failedWebhook.create).toHaveBeenCalledTimes(1);
      const createArgs = harness.prisma.failedWebhook.create.mock
        .calls[0][0] as {
        data: {
          eventType: string;
          eventId: string;
          errorMessage: string;
        };
      };
      expect(createArgs.data.eventType).toBe('subscription.created');
      expect(createArgs.data.eventId).toBeDefined();
      expect(createArgs.data.errorMessage).toContain('downstream DB offline');
    });

    it('never lets a FailedWebhook write error cascade into the response', async () => {
      harness.paddleService.handleSubscriptionUpdatedEvent.mockRejectedValueOnce(
        new Error('handler exploded'),
      );
      harness.prisma.failedWebhook.create.mockRejectedValueOnce(
        new Error('audit DB offline too'),
      );
      const fixture = loadPaddleFixture('subscription-updated');

      // Even with BOTH downstreams broken we expect the SAME 500, never
      // a crash with the audit-store error leaking out.
      await expect(
        harness.controller.handleWebhook(
          fixture.signatureHeader,
          makeRequest(fixture.body),
        ),
      ).rejects.toBeInstanceOf(InternalServerErrorException);
    });
  });

  // -------------------------------------------------------------------------
  // Idempotency — duplicate-delivery protection
  // -------------------------------------------------------------------------

  describe('idempotency', () => {
    it('skips duplicate eventIds after a successful first delivery', async () => {
      const fixture = loadPaddleFixture('subscription-canceled');

      const first = await harness.controller.handleWebhook(
        fixture.signatureHeader,
        makeRequest(fixture.body),
      );
      const second = await harness.controller.handleWebhook(
        fixture.signatureHeader,
        makeRequest(fixture.body),
      );

      expect(first).toMatchObject({ received: true, success: true });
      expect(second).toEqual({ received: true, duplicate: true });
      expect(
        harness.paddleService.handleSubscriptionCanceledEvent,
      ).toHaveBeenCalledTimes(1);
    });

    it('does NOT mark a failed delivery as processed (so Paddle can retry)', async () => {
      harness.paddleService.handleSubscriptionCreatedEvent
        .mockRejectedValueOnce(new Error('transient'))
        .mockResolvedValueOnce({ success: true, licenseId: 'lic_retry_ok' });
      const fixture = loadPaddleFixture('subscription-created');

      // First delivery fails with 500 — event NOT marked processed.
      await expect(
        harness.controller.handleWebhook(
          fixture.signatureHeader,
          makeRequest(fixture.body),
        ),
      ).rejects.toBeInstanceOf(InternalServerErrorException);

      // Paddle retries same eventId — this time it succeeds.
      const retry = await harness.controller.handleWebhook(
        fixture.signatureHeader,
        makeRequest(fixture.body),
      );

      expect(retry).toMatchObject({ received: true, success: true });
      expect(
        harness.paddleService.handleSubscriptionCreatedEvent,
      ).toHaveBeenCalledTimes(2);
    });
  });
});
