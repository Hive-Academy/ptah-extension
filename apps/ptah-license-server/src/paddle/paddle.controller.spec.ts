/**
 * Unit tests for `PaddleController` — money-path batch W1.B1.1.
 *
 * The controller is intentionally thin — it only validates request shape
 * (raw body present, signature header present) and delegates to
 * `PaddleWebhookService.processWebhook`. We assert:
 *
 *   - 400 BadRequest when the raw body was not preserved by Express
 *     middleware (regression guard — forgetting this middleware would
 *     silently break signature verification in production).
 *   - 401 Unauthorized when the `paddle-signature` header is missing.
 *   - Success delegates to the service with the exact rawBody + signature.
 *   - Errors from the service surface unchanged (the global exception
 *     filter maps them to 401/500 for Paddle).
 */

import {
  BadRequestException,
  InternalServerErrorException,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';

import { PaddleController } from './paddle.controller';
import { PaddleWebhookService } from './paddle-webhook.service';
import { createTestingNestModule } from '../testing/nest-module-builder';
import {
  loadPaddleFixture,
  TEST_PADDLE_WEBHOOK_SECRET,
} from '../testing/fixtures/paddle';

interface RequestWithRawBody extends Request {
  rawBody?: Buffer;
}

function createWebhookServiceStub(): jest.Mocked<
  Pick<PaddleWebhookService, 'processWebhook'>
> {
  return {
    processWebhook: jest.fn(),
  } as unknown as jest.Mocked<Pick<PaddleWebhookService, 'processWebhook'>>;
}

async function buildController(params?: {
  webhookService?: jest.Mocked<Pick<PaddleWebhookService, 'processWebhook'>>;
}): Promise<{
  controller: PaddleController;
  webhookService: jest.Mocked<Pick<PaddleWebhookService, 'processWebhook'>>;
}> {
  const webhookService = params?.webhookService ?? createWebhookServiceStub();
  const { module } = await createTestingNestModule({
    providers: [
      { provide: PaddleWebhookService, useValue: webhookService },
      PaddleController,
    ],
  });

  return {
    controller: module.get<PaddleController>(PaddleController),
    webhookService,
  };
}

function makeRequest(rawBody: Buffer | undefined): RequestWithRawBody {
  return { rawBody } as unknown as RequestWithRawBody;
}

describe('PaddleController', () => {
  it('throws BadRequestException when raw body is not available (middleware misconfig)', async () => {
    const { controller, webhookService } = await buildController();

    await expect(
      controller.handleWebhook('ts=1;h1=abc', makeRequest(undefined)),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(webhookService.processWebhook).not.toHaveBeenCalled();
  });

  it('throws UnauthorizedException when paddle-signature header is missing', async () => {
    const { controller, webhookService } = await buildController();

    await expect(
      controller.handleWebhook(
        undefined as unknown as string,
        makeRequest(Buffer.from('{"event":"x"}')),
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    expect(webhookService.processWebhook).not.toHaveBeenCalled();
  });

  it('throws UnauthorizedException when paddle-signature header is an empty string', async () => {
    const { controller, webhookService } = await buildController();

    await expect(
      controller.handleWebhook('', makeRequest(Buffer.from('{"event":"x"}'))),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    expect(webhookService.processWebhook).not.toHaveBeenCalled();
  });

  it('delegates valid requests to PaddleWebhookService with exact rawBody + signature', async () => {
    const { controller, webhookService } = await buildController();
    webhookService.processWebhook.mockResolvedValue({
      received: true,
      success: true,
      licenseId: 'lic_deleg_001',
    });

    // Use a real signed fixture so the test is representative of the
    // bytes production Express middleware would hand us.
    const fixture = loadPaddleFixture('subscription-created');
    expect(fixture.secret).toBe(TEST_PADDLE_WEBHOOK_SECRET);

    const result = await controller.handleWebhook(
      fixture.signatureHeader,
      makeRequest(fixture.body),
    );

    expect(result).toEqual({
      received: true,
      success: true,
      licenseId: 'lic_deleg_001',
    });
    expect(webhookService.processWebhook).toHaveBeenCalledTimes(1);
    const [bodyArg, sigArg] = webhookService.processWebhook.mock.calls[0];
    expect(bodyArg).toBe(fixture.body); // same Buffer instance (no copy)
    expect(sigArg).toBe(fixture.signatureHeader);
  });

  it('surfaces UnauthorizedException from the service (signature rejections propagate)', async () => {
    const { controller, webhookService } = await buildController();
    webhookService.processWebhook.mockRejectedValue(
      new UnauthorizedException('Invalid webhook signature: tampered'),
    );

    const fixture = loadPaddleFixture('subscription-updated', {
      tamperBody: true,
    });

    await expect(
      controller.handleWebhook(
        fixture.signatureHeader,
        makeRequest(fixture.body),
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('surfaces 500 InternalServerErrorException so Paddle retries delivery', async () => {
    const { controller, webhookService } = await buildController();
    webhookService.processWebhook.mockRejectedValue(
      new InternalServerErrorException(
        'Webhook processing failed - stored for recovery',
      ),
    );

    const fixture = loadPaddleFixture('transaction-completed');

    await expect(
      controller.handleWebhook(
        fixture.signatureHeader,
        makeRequest(fixture.body),
      ),
    ).rejects.toBeInstanceOf(InternalServerErrorException);
  });
});
