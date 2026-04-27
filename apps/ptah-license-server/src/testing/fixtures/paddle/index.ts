/**
 * Paddle fixture barrel.
 *
 * Specs typically only need `loadPaddleFixture`, but the underlying
 * helpers and the shared test secret are re-exported for ad-hoc cases
 * (replay attacks, synthetic payloads, tamper scenarios).
 */

export {
  loadPaddleFixture,
  signPaddlePayload,
  TEST_PADDLE_WEBHOOK_SECRET,
  type PaddleFixtureName,
  type SignedPaddleFixture,
  type LoadPaddleFixtureOptions,
} from './signed-payload.fixture';
