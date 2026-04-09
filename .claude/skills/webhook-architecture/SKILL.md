---
name: webhook-architecture
description: '3-layer webhook architecture pattern for NestJS applications handling inbound webhooks from external services (payment providers, messaging platforms, CI/CD, etc.). Use when implementing webhook endpoints, processing external events, handling webhook signature verification, building event routing systems, implementing idempotent webhook processing, or setting up webhook failure recovery. Covers controller-level HTTP validation, service-level signature verification and event routing, and business-level domain logic handlers.'
---

# 3-Layer Webhook Architecture

Pattern for handling inbound webhooks in NestJS with strict separation of concerns across three layers: HTTP validation, event verification and routing, and domain logic execution. Apply this pattern whenever an external service sends events to your application via HTTP callbacks.

## Architecture

```
External Service (Stripe, Paddle, GitHub, Twilio, etc.)
          |
          | POST /webhooks/{provider}
          | Headers: signature, timestamp
          | Body: raw bytes
          v
+-----------------------------------------------------------+
| LAYER 1: Controller (HTTP Concerns)                       |
|   - Extract raw body (Buffer, not parsed JSON)            |
|   - Extract signature/timestamp headers                   |
|   - Validate required headers present                     |
|   - Apply rate limiting / throttle                        |
|   - ALWAYS return 200 (delegate errors to service layer)  |
+-----------------------------------------------------------+
          |
          | rawBody: Buffer, signature: string, headers
          v
+-----------------------------------------------------------+
| LAYER 2: Webhook Service (Verification & Routing)         |
|   - Verify signature (SDK or manual HMAC)                 |
|   - Parse raw body into typed event                       |
|   - Check idempotency (skip duplicate event IDs)          |
|   - Route to correct handler by event type                |
|   - Catch ALL errors, store as FailedWebhook              |
|   - Never throw (controller always returns 200)           |
+-----------------------------------------------------------+
          |
          | typed event payload
          v
+-----------------------------------------------------------+
| LAYER 3: Business Service (Domain Logic)                  |
|   - One handler method per event type                     |
|   - Database operations (create/update records)           |
|   - Side effects (email, SSE push, audit log)             |
|   - Can throw errors (Layer 2 catches them)               |
+-----------------------------------------------------------+
```

## Quick Start

### 1. Controller (HTTP Layer)

```typescript
// src/webhooks/external.controller.ts
import { Controller, Post, RawBody, Headers, HttpCode } from '@nestjs/common';
import { ExternalWebhookService } from './external-webhook.service';

@Controller('webhooks')
export class ExternalWebhookController {
  constructor(private readonly webhookService: ExternalWebhookService) {}

  @Post('external-provider')
  @HttpCode(200)
  async handleWebhook(@RawBody() rawBody: Buffer, @Headers('x-provider-signature') signature: string, @Headers('x-provider-timestamp') timestamp: string): Promise<{ received: boolean }> {
    if (!signature) {
      return { received: false };
    }

    await this.webhookService.processWebhook(rawBody, signature, timestamp);
    return { received: true };
  }
}
```

### 2. Webhook Service (Verification and Routing Layer)

```typescript
// src/webhooks/external-webhook.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { BusinessService } from '../services/business.service';

@Injectable()
export class ExternalWebhookService {
  private readonly logger = new Logger(ExternalWebhookService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly businessService: BusinessService,
  ) {}

  async processWebhook(rawBody: Buffer, signature: string, timestamp: string): Promise<void> {
    try {
      // 1. Verify signature (SDK-based or manual HMAC)
      const event = this.verifyAndParse(rawBody, signature, timestamp);

      // 2. Idempotency check
      const existing = await this.prisma.processedEvent.findUnique({
        where: { eventId: event.id },
      });
      if (existing) {
        this.logger.log(`Duplicate event ${event.id}, skipping`);
        return;
      }

      // 3. Route to handler by event type
      await this.routeEvent(event);

      // 4. Mark as processed
      await this.prisma.processedEvent.create({
        data: { eventId: event.id, eventType: event.type, processedAt: new Date() },
      });
    } catch (error) {
      this.logger.error(`Webhook processing failed: ${error.message}`, error.stack);
      await this.storeFailedWebhook(rawBody, error);
      // Do NOT rethrow - controller must return 200
    }
  }

  private async routeEvent(event: ProviderEvent): Promise<void> {
    switch (event.type) {
      case 'subscription.created':
        await this.businessService.handleSubscriptionCreated(event.data);
        break;
      case 'subscription.canceled':
        await this.businessService.handleSubscriptionCanceled(event.data);
        break;
      case 'payment.completed':
        await this.businessService.handlePaymentCompleted(event.data);
        break;
      default:
        this.logger.warn(`Unhandled event type: ${event.type}`);
    }
  }

  private async storeFailedWebhook(rawBody: Buffer, error: Error): Promise<void> {
    await this.prisma.failedWebhook.create({
      data: {
        rawPayload: rawBody.toString('utf-8'),
        errorMessage: error.message,
        stackTrace: error.stack ?? '',
        attemptedAt: new Date(),
      },
    });
  }

  private verifyAndParse(rawBody: Buffer, signature: string, timestamp: string): ProviderEvent {
    // Use provider SDK or manual HMAC - see signature-verification.md
    return sdk.webhooks.unmarshal(rawBody.toString(), signature, timestamp);
  }
}
```

### 3. Business Service (Domain Logic Layer)

```typescript
// src/services/business.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EventEmitter2 } from '@nestjs/event-emitter';

@Injectable()
export class BusinessService {
  private readonly logger = new Logger(BusinessService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async handleSubscriptionCreated(data: SubscriptionData): Promise<void> {
    const subscription = await this.prisma.subscription.create({
      data: {
        externalId: data.id,
        userId: data.customerId,
        planId: data.planId,
        status: 'active',
        currentPeriodEnd: new Date(data.currentPeriodEnd),
      },
    });

    this.eventEmitter.emit('subscription.created', subscription);
    this.logger.log(`Subscription created: ${subscription.id}`);
  }

  async handleSubscriptionCanceled(data: SubscriptionData): Promise<void> {
    await this.prisma.subscription.update({
      where: { externalId: data.id },
      data: { status: 'canceled', canceledAt: new Date() },
    });

    this.logger.log(`Subscription canceled: ${data.id}`);
  }

  async handlePaymentCompleted(data: PaymentData): Promise<void> {
    await this.prisma.payment.create({
      data: {
        externalId: data.id,
        amount: data.amount,
        currency: data.currency,
        userId: data.customerId,
        paidAt: new Date(),
      },
    });

    this.logger.log(`Payment recorded: ${data.id}`);
  }
}
```

## Key Design Decisions

| Decision                                | Rationale                                                                                         |
| --------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Always return 200 to provider           | Providers retry on non-2xx, causing duplicate processing. Store failures internally instead.      |
| Use raw body for signature verification | Parsed JSON alters whitespace/ordering, breaking HMAC comparison. Always pass the original bytes. |
| Track event IDs for idempotency         | Providers may retry even on 200 (network timeouts). Deduplication prevents double-processing.     |
| Keep controllers thin                   | Controllers handle HTTP concerns only (headers, raw body, response code). Zero business logic.    |
| Catch all errors in webhook service     | Handler errors must never bubble up to the controller. Log, store, and swallow.                   |
| One handler method per event type       | Each event type maps to exactly one business method. Easy to test, easy to find.                  |

## When to Use This Pattern

Apply the 3-layer webhook architecture whenever you receive HTTP callbacks from external services:

- **Payment providers**: Stripe, Paddle, LemonSqueezy, PayPal
- **Messaging platforms**: Twilio, SendGrid, Mailgun, Resend
- **CI/CD systems**: GitHub Actions, GitLab CI, CircleCI
- **Version control**: GitHub webhooks, GitLab webhooks, Bitbucket
- **Communication**: Slack, Discord, Microsoft Teams
- **Infrastructure**: AWS SNS, Datadog, PagerDuty

## NestJS Main Configuration

Enable raw body parsing in `main.ts` to preserve the original bytes for signature verification:

```typescript
const app = await NestFactory.create(AppModule, { rawBody: true });

// Exclude webhook routes from global prefix
app.setGlobalPrefix('api', {
  exclude: [{ path: 'webhooks/(.*)', method: RequestMethod.ALL }],
});
```

## References

Load these for detailed implementation guidance:

- [three-layer-pattern.md](references/three-layer-pattern.md) - Full implementation guide for all three layers including module setup, main.ts configuration, and typed event routing
- [signature-verification.md](references/signature-verification.md) - SDK-based and manual HMAC signature verification, timestamp validation, constant-time comparison
- [resilience-and-recovery.md](references/resilience-and-recovery.md) - Idempotent processing, failed webhook storage, always-200 pattern, retry queues
