/**
 * Paddle signed-webhook fixture loader.
 *
 * Reads a sanitised Paddle webhook JSON from disk, serialises it, and
 * wraps it with a live HMAC signature that matches Paddle's real
 * signature format:
 *
 *     paddle-signature: ts=<unix>;h1=<hex-hmac-sha256(ts + ":" + body, secret)>
 *
 * Rules (reverse-engineered from `@paddle/paddle-node-sdk`'s
 * `WebhooksValidator`):
 *   - `ts` is a UNIX seconds integer.
 *   - The validator rejects timestamps older than 5 seconds (see
 *     `MAX_VALID_TIME_DIFFERENCE` in the SDK). For green specs, generate
 *     a fresh timestamp just-in-time.
 *   - The HMAC is computed over the literal string `"<ts>:<rawBody>"`
 *     with the shared secret as the key, as hex.
 *
 * The exported `SignedPaddleFixture` carries everything a spec needs to
 * feed `PaddleWebhookService.processWebhook(rawBody, signatureHeader)`
 * and round-trip through `Webhooks.unmarshal`.
 */

import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

export type PaddleFixtureName =
  | 'subscription-created'
  | 'subscription-updated'
  | 'subscription-canceled'
  | 'transaction-completed';

/** Test-only webhook secret. Not derived from any real Paddle value. */
export const TEST_PADDLE_WEBHOOK_SECRET = 'pdl_ntfset_test_ptah_fixture_secret';

/** The data returned to a spec. */
export interface SignedPaddleFixture {
  /** Raw body Buffer — what PaddleWebhookService expects as input. */
  body: Buffer;
  /** Parsed JSON for convenience assertions. */
  bodyJson: Record<string, unknown>;
  /** The `paddle-signature` HTTP header value. */
  signatureHeader: string;
  /** The UNIX seconds timestamp embedded in the signature. */
  timestamp: number;
  /** The shared secret used to sign this fixture. */
  secret: string;
  /** Fixture file name (without extension). */
  name: PaddleFixtureName;
}

/** Options for `loadPaddleFixture`. */
export interface LoadPaddleFixtureOptions {
  /** Override the secret. Defaults to {@link TEST_PADDLE_WEBHOOK_SECRET}. */
  secret?: string;
  /**
   * Override the timestamp (UNIX seconds). Defaults to now. Useful for
   * replay/tamper/expiry test variants.
   */
  timestamp?: number;
  /**
   * Tamper the body after signing (for signature-mismatch tests).
   * The returned fixture's signature will no longer match its body.
   */
  tamperBody?: boolean;
}

const FIXTURE_DIR = __dirname;

/**
 * Load a Paddle webhook fixture by name, compute its signature, and
 * return the signed bundle.
 *
 * Round-trips cleanly through `paddle.webhooks.unmarshal()` for
 * `timestamp` within the last 5 seconds.
 */
export function loadPaddleFixture(
  name: PaddleFixtureName,
  options: LoadPaddleFixtureOptions = {},
): SignedPaddleFixture {
  const jsonPath = path.join(FIXTURE_DIR, `${name}.json`);
  const raw = fs.readFileSync(jsonPath, 'utf8');

  // Parse once for bodyJson; re-stringify to ensure deterministic bytes.
  // The signing MUST use the exact bytes we later hand to the verifier,
  // so we send the original raw file contents through the HMAC.
  const bodyJson = JSON.parse(raw) as Record<string, unknown>;

  // Use the exact on-disk bytes (trimmed of any trailing whitespace is
  // fine — JSON itself is whitespace-insensitive for HMAC purposes as
  // long as body at verify time == body at sign time).
  const rawBody = raw.replace(/\s+$/, '');
  let body = Buffer.from(rawBody, 'utf8');

  const timestamp = options.timestamp ?? Math.floor(Date.now() / 1000);
  const secret = options.secret ?? TEST_PADDLE_WEBHOOK_SECRET;

  const payloadWithTime = `${timestamp}:${rawBody}`;
  const h1 = crypto
    .createHmac('sha256', secret)
    .update(payloadWithTime, 'utf8')
    .digest('hex');

  if (options.tamperBody) {
    // Flip one byte in the body AFTER signing — signature will no longer match.
    const tampered = Buffer.from(body);
    tampered[0] = tampered[0] ^ 0x01;
    body = tampered;
  }

  const signatureHeader = `ts=${timestamp};h1=${h1}`;

  return {
    body,
    bodyJson,
    signatureHeader,
    timestamp,
    secret,
    name,
  };
}

/**
 * Compute the Paddle-format signature header for an arbitrary body.
 * Exposed so specs can sign synthetic payloads without touching the
 * filesystem.
 */
export function signPaddlePayload(
  rawBody: string,
  secret: string = TEST_PADDLE_WEBHOOK_SECRET,
  timestamp: number = Math.floor(Date.now() / 1000),
): { signatureHeader: string; timestamp: number } {
  const payloadWithTime = `${timestamp}:${rawBody}`;
  const h1 = crypto
    .createHmac('sha256', secret)
    .update(payloadWithTime, 'utf8')
    .digest('hex');
  return {
    signatureHeader: `ts=${timestamp};h1=${h1}`,
    timestamp,
  };
}
