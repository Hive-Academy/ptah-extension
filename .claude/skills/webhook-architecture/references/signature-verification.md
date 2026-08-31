# Webhook Signature Verification

Signature verification ensures a webhook request genuinely came from the expected provider and was not tampered with in transit. Every webhook integration must verify signatures before processing events.

## SDK-Based Verification (Preferred)

Most providers ship SDKs that handle HMAC computation, timestamp validation, replay protection, and schema versioning internally. Always prefer the SDK approach when available.

### General Pattern

```typescript
@Injectable()
export class ProviderWebhookService {
  private readonly webhookSecret: string;
  private readonly client: ProviderSDK;

  constructor(private readonly configService: ConfigService) {
    this.webhookSecret = this.configService.getOrThrow<string>('PROVIDER_WEBHOOK_SECRET');
    this.client = new ProviderSDK(this.configService.getOrThrow<string>('PROVIDER_API_KEY'));
  }

  verifyAndParse(rawBody: Buffer, signature: string): ProviderEvent {
    // The SDK handles HMAC, timestamp validation, and constant-time comparison
    return this.client.webhooks.unmarshal(rawBody.toString('utf-8'), signature, this.webhookSecret);
  }
}
```

### Stripe

```typescript
import Stripe from 'stripe';

private verifyStripeWebhook(rawBody: Buffer, signature: string): Stripe.Event {
  const stripe = new Stripe(this.configService.getOrThrow('STRIPE_SECRET_KEY'));
  // stripe-signature header format: t=timestamp,v1=hash
  return stripe.webhooks.constructEvent(
    rawBody,          // Must be raw Buffer
    signature,        // Full stripe-signature header
    this.configService.getOrThrow('STRIPE_WEBHOOK_SECRET'),
  );
}
```

### Paddle

```typescript
import { Environment, Paddle, EventEntity } from '@paddle/paddle-node-sdk';

private verifyPaddleWebhook(rawBody: Buffer, signature: string): EventEntity {
  const paddle = new Paddle(this.configService.getOrThrow('PADDLE_API_KEY'), {
    environment: this.configService.get('PADDLE_SANDBOX') === 'true'
      ? Environment.sandbox : Environment.production,
  });
  // paddle-signature header format: ts=timestamp;h1=hash
  return paddle.webhooks.unmarshal(
    rawBody.toString('utf-8'),
    this.configService.getOrThrow('PADDLE_WEBHOOK_SECRET'),
    signature,
  );
}
```

### GitHub

```typescript
import { Webhooks } from '@octokit/webhooks';

private async verifyGitHubWebhook(rawBody: Buffer, signature: string): Promise<unknown> {
  const webhooks = new Webhooks({
    secret: this.configService.getOrThrow('GITHUB_WEBHOOK_SECRET'),
  });
  // x-hub-signature-256 header format: sha256=hex_digest
  const isValid = await webhooks.verify(rawBody.toString('utf-8'), signature);
  if (!isValid) throw new Error('GitHub webhook signature verification failed');
  return JSON.parse(rawBody.toString('utf-8'));
}
```

### SDK Verification Benefits

| Benefit                  | Description                                                              |
| ------------------------ | ------------------------------------------------------------------------ |
| Timestamp validation     | Rejects stale requests (typically > 5 minutes) to prevent replay attacks |
| Constant-time comparison | Uses `crypto.timingSafeEqual` to prevent timing attacks                  |
| Schema versioning        | Parses events into versioned types matching the API version              |
| Maintenance              | Provider updates signing scheme, you update the SDK version              |

## Manual HMAC Verification (Fallback)

Use when the provider has no Node.js SDK or the SDK lacks webhook verification.

### Complete Implementation

```typescript
import { createHmac, timingSafeEqual } from 'crypto';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class ManualWebhookVerifier {
  private readonly logger = new Logger(ManualWebhookVerifier.name);
  private readonly webhookSecret: string;
  private readonly MAX_TIMESTAMP_AGE_MS = 5 * 60 * 1000; // 5 minutes

  constructor(private readonly configService: ConfigService) {
    this.webhookSecret = this.configService.getOrThrow<string>('PROVIDER_WEBHOOK_SECRET');
  }

  verifyAndParse<T = Record<string, unknown>>(rawBody: Buffer, signatureHeader: string): T {
    const { timestamp, hash } = this.parseSignatureHeader(signatureHeader);
    this.validateTimestamp(timestamp);
    const expectedHash = this.computeHmac(timestamp, rawBody);
    this.compareSignatures(hash, expectedHash);
    return JSON.parse(rawBody.toString('utf-8'));
  }

  private parseSignatureHeader(header: string): { timestamp: string; hash: string } {
    // Format: "ts=1234567890;h1=abc123..." (Paddle-style)
    if (header.includes(';')) {
      const parts = Object.fromEntries(
        header.split(';').map((p) => {
          const [k, v] = p.split('=');
          return [k, v];
        })
      );
      return { timestamp: parts['ts'], hash: parts['h1'] };
    }
    // Format: "t=1234567890,v1=abc123..." (Stripe-style)
    if (header.includes(',')) {
      const parts = Object.fromEntries(
        header.split(',').map((p) => {
          const [k, v] = p.split('=');
          return [k, v];
        })
      );
      return { timestamp: parts['t'], hash: parts['v1'] };
    }
    // Format: "sha256=abc123..." (GitHub-style, no timestamp)
    if (header.startsWith('sha256=')) {
      return { timestamp: '', hash: header.slice(7) };
    }
    throw new Error(`Unrecognized signature header format: ${header}`);
  }

  private validateTimestamp(timestamp: string): void {
    if (!timestamp) return; // Some providers omit timestamp
    const age = Date.now() - parseInt(timestamp, 10) * 1000;
    if (Math.abs(age) > this.MAX_TIMESTAMP_AGE_MS) {
      throw new Error(`Webhook timestamp outside acceptable window: ${age}ms`);
    }
  }

  private computeHmac(timestamp: string, rawBody: Buffer): string {
    const signedPayload = timestamp ? `${timestamp}:${rawBody.toString('utf-8')}` : rawBody.toString('utf-8');
    return createHmac('sha256', this.webhookSecret).update(signedPayload).digest('hex');
  }

  /**
   * CRITICAL: Never use === for signature comparison.
   * String equality short-circuits on the first differing character,
   * leaking information via timing. timingSafeEqual always takes
   * the same time regardless of where strings differ.
   */
  private compareSignatures(received: string, expected: string): void {
    const receivedBuf = Buffer.from(received, 'hex');
    const expectedBuf = Buffer.from(expected, 'hex');
    if (receivedBuf.length !== expectedBuf.length) {
      throw new Error('Webhook signature length mismatch');
    }
    if (!timingSafeEqual(receivedBuf, expectedBuf)) {
      throw new Error('Webhook signature verification failed');
    }
  }
}
```

### Why Raw Body Matters

JSON parsing and re-serialization can alter whitespace, key ordering, number formatting, and unicode escapes. Any change produces a different HMAC hash, breaking verification.

```typescript
// WRONG - re-serialized body has different bytes
const hash = createHmac('sha256', secret)
  .update(JSON.stringify(JSON.parse(body)))
  .digest('hex');

// CORRECT - original raw bytes match the provider's hash
const hash = createHmac('sha256', secret).update(rawBody).digest('hex');
```

## Configuration

### Environment Variables

```bash
# Each provider has its own webhook secret (separate from API key)
STRIPE_WEBHOOK_SECRET=whsec_abc123...
PADDLE_WEBHOOK_SECRET=pdl_ntfset_abc123...
GITHUB_WEBHOOK_SECRET=ghsec_abc123...

# Sandbox toggle
PROVIDER_SANDBOX=true
```

### Sandbox vs Production Secrets

```typescript
private getWebhookSecret(): string {
  const isSandbox = this.configService.get('PROVIDER_SANDBOX') === 'true';
  return this.configService.getOrThrow<string>(
    isSandbox ? 'PROVIDER_WEBHOOK_SECRET_SANDBOX' : 'PROVIDER_WEBHOOK_SECRET',
  );
}
```

### Local Development with Tunneling

Providers need a public URL. Use ngrok, localtunnel, or Cloudflare Tunnel for local development.

```bash
ngrok http 3000
# Register the tunnel URL with the provider: https://abc123.ngrok.io/webhooks/provider-name
```

## Decision Matrix

| Scenario                                           | Approach                                        |
| -------------------------------------------------- | ----------------------------------------------- |
| Provider has Node.js SDK with webhook verification | SDK-based                                       |
| Provider SDK exists but lacks webhook verification | Manual HMAC                                     |
| No Node.js SDK available                           | Manual HMAC                                     |
| Internal microservice webhooks                     | Manual HMAC or shared secret header             |
| Development/testing                                | Provider sandbox mode with test webhook secrets |
