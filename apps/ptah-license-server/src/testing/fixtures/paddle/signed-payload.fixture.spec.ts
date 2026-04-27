/**
 * Round-trip spec for the Paddle signed-payload fixtures.
 *
 * Each of the four fixtures is loaded, signed, and then handed to the
 * real `paddle.webhooks.unmarshal()` verifier. A clean verification
 * result proves:
 *   1. The fixture JSON is schema-valid for the event type.
 *   2. The HMAC signature format matches Paddle's `ts=;h1=` contract.
 *   3. The secret + timestamp + hex digest line up end-to-end.
 *
 * Tamper cases (flipped body byte, wrong secret, expired timestamp)
 * MUST reject — any accept here is a correctness hazard for the real
 * webhook handler.
 */

import { Paddle, Environment } from '@paddle/paddle-node-sdk';
import {
  loadPaddleFixture,
  TEST_PADDLE_WEBHOOK_SECRET,
  type PaddleFixtureName,
} from './signed-payload.fixture';

const FIXTURE_NAMES: PaddleFixtureName[] = [
  'subscription-created',
  'subscription-updated',
  'subscription-canceled',
  'transaction-completed',
];

function makePaddle(): Paddle {
  // API key format is `apikey_<env>_<random>` — Paddle doesn't hit the
  // network for unmarshal(), so any syntactically-valid dummy works.
  return new Paddle('apikey_test_PtahFixtureDummyKey0000000000', {
    environment: Environment.sandbox,
  });
}

describe('loadPaddleFixture — signature round-trip', () => {
  const paddle = makePaddle();

  it.each(FIXTURE_NAMES)(
    '%s verifies cleanly through paddle.webhooks.unmarshal',
    async (name) => {
      const fixture = loadPaddleFixture(name);

      const event = await paddle.webhooks.unmarshal(
        fixture.body.toString('utf8'),
        fixture.secret,
        fixture.signatureHeader,
      );

      expect(event).toBeDefined();
      expect(event.eventType).toBe(fixture.bodyJson['event_type']);
      expect(event.eventId).toBe(fixture.bodyJson['event_id']);
    },
  );

  it('tampering the body invalidates the signature', async () => {
    const fixture = loadPaddleFixture('subscription-created', {
      tamperBody: true,
    });

    const isValid = await paddle.webhooks.isSignatureValid(
      fixture.body.toString('utf8'),
      fixture.secret,
      fixture.signatureHeader,
    );

    expect(isValid).toBe(false);
  });

  it('wrong secret invalidates the signature', async () => {
    const fixture = loadPaddleFixture('subscription-updated');

    const isValid = await paddle.webhooks.isSignatureValid(
      fixture.body.toString('utf8'),
      'pdl_ntfset_not_the_real_secret',
      fixture.signatureHeader,
    );

    expect(isValid).toBe(false);
  });

  it('timestamp older than ~5s is rejected (replay protection)', async () => {
    // Paddle SDK rejects ts older than MAX_VALID_TIME_DIFFERENCE (5s).
    // Use a stale timestamp — we still sign it, but the SDK refuses.
    const staleTimestamp = Math.floor(Date.now() / 1000) - 60;
    const fixture = loadPaddleFixture('subscription-canceled', {
      timestamp: staleTimestamp,
    });

    const isValid = await paddle.webhooks.isSignatureValid(
      fixture.body.toString('utf8'),
      fixture.secret,
      fixture.signatureHeader,
    );

    expect(isValid).toBe(false);
  });

  it('signature header format is ts=<unix>;h1=<hex64>', () => {
    const fixture = loadPaddleFixture('transaction-completed');
    expect(fixture.signatureHeader).toMatch(/^ts=\d+;h1=[a-f0-9]{64}$/);
    expect(fixture.secret).toBe(TEST_PADDLE_WEBHOOK_SECRET);
  });
});
